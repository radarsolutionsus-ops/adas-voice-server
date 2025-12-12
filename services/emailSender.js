/**
 * emailSender.js - Email sending service for automated ADAS workflow
 *
 * Handles sending professional HTML emails to:
 * 1. SHOPS: Calibration confirmations (when sources agree)
 * 2. TECHS: Review requests (when discrepancies found)
 *
 * Uses Gmail OAuth2 - shares credentials with emailListener.js
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getGmailTokenFromSheets, saveGmailTokenToSheets, getShopEmailByName } from './sheetWriter.js';
import { getESTTimestamp, getESTISOTimestamp } from '../utils/timezone.js';

const LOG_TAG = '[EMAIL_SENDER]';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gmail configuration
const GMAIL_USER = 'radarsolutionsus@gmail.com';

// OAuth credentials paths
const OAUTH_CREDENTIALS_PATH = process.env.GMAIL_OAUTH_CREDENTIALS_PATH ||
  path.join(__dirname, '../credentials/google-oauth-client.json');
const OAUTH_TOKEN_PATH = process.env.GMAIL_OAUTH_TOKEN_PATH ||
  path.join(__dirname, '../credentials/gmail_oauth_token.json');

let gmailClient = null;

/**
 * Get OAuth credentials from env var (Railway) or file (local dev)
 */
function getOAuthCredentials() {
  if (process.env.GMAIL_OAUTH_CREDENTIALS_JSON) {
    return JSON.parse(process.env.GMAIL_OAUTH_CREDENTIALS_JSON);
  }
  if (fs.existsSync(OAUTH_CREDENTIALS_PATH)) {
    return JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_PATH, 'utf8'));
  }
  throw new Error(`No Gmail OAuth credentials found`);
}

/**
 * Get OAuth token with priority: Sheets > Env var > File
 */
async function getOAuthToken() {
  // Try Sheets first (Railway persistence)
  try {
    const sheetsToken = await getGmailTokenFromSheets();
    if (sheetsToken) return sheetsToken;
  } catch (err) {
    console.log(`${LOG_TAG} Could not read token from Sheets: ${err.message}`);
  }

  if (process.env.GMAIL_OAUTH_TOKEN_JSON) {
    return JSON.parse(process.env.GMAIL_OAUTH_TOKEN_JSON);
  }

  if (fs.existsSync(OAUTH_TOKEN_PATH)) {
    return JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH, 'utf8'));
  }

  throw new Error(`No Gmail OAuth token found`);
}

/**
 * Initialize Gmail client
 */
async function initializeGmailClient() {
  if (gmailClient) return gmailClient;

  try {
    const credentials = getOAuthCredentials();
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
    );

    const token = await getOAuthToken();
    oauth2Client.setCredentials(token);

    // Refresh if expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      console.log(`${LOG_TAG} Token expired, refreshing...`);
      const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newCredentials);

      if (process.env.GMAIL_OAUTH_TOKEN_JSON || process.env.RAILWAY_ENVIRONMENT) {
        await saveGmailTokenToSheets(newCredentials);
      } else {
        fs.writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(newCredentials, null, 2));
      }
    }

    gmailClient = google.gmail({ version: 'v1', auth: oauth2Client });
    console.log(`${LOG_TAG} Gmail client initialized`);
    return gmailClient;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to initialize Gmail client:`, err.message);
    throw err;
  }
}

/**
 * Send an email via Gmail API
 */
async function sendEmail({ to, cc, subject, htmlBody, textBody, attachments = [] }) {
  try {
    const gmail = await initializeGmailClient();

    const boundary = `boundary_${Date.now()}`;
    const mixedBoundary = `mixed_${Date.now()}`;

    let mimeMessage;

    if (attachments.length > 0) {
      mimeMessage = [
        `From: "ADAS F1RST" <${GMAIL_USER}>`,
        `To: ${to}`,
        cc ? `Cc: ${cc}` : null,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
        '',
        `--${mixedBoundary}`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        textBody,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        '',
        htmlBody,
        '',
        `--${boundary}--`
      ].filter(line => line !== null);

      for (const att of attachments) {
        if (!att.content) continue;
        mimeMessage.push('');
        mimeMessage.push(`--${mixedBoundary}`);
        mimeMessage.push(`Content-Type: ${att.mimeType || 'application/pdf'}; name="${att.filename}"`);
        mimeMessage.push('Content-Transfer-Encoding: base64');
        mimeMessage.push(`Content-Disposition: attachment; filename="${att.filename}"`);
        mimeMessage.push('');
        const base64Content = Buffer.isBuffer(att.content)
          ? att.content.toString('base64')
          : att.content;
        mimeMessage.push(base64Content);
      }

      mimeMessage.push('');
      mimeMessage.push(`--${mixedBoundary}--`);
    } else {
      mimeMessage = [
        `From: "ADAS F1RST" <${GMAIL_USER}>`,
        `To: ${to}`,
        cc ? `Cc: ${cc}` : null,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        textBody,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        '',
        htmlBody,
        '',
        `--${boundary}--`
      ].filter(line => line !== null);
    }

    const rawMessage = mimeMessage.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });

    console.log(`${LOG_TAG} Email sent to ${to}. Message ID: ${response.data.id}`);
    return { success: true, messageId: response.data.id, to };
  } catch (err) {
    console.error(`${LOG_TAG} Failed to send email:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send shop confirmation email - when LLM and RevvADAS agree
 *
 * @param {Object} roData - RO information
 * @param {string} roData.roPo - RO/PO number
 * @param {string} roData.shopName - Shop name (for lookup)
 * @param {string} roData.vehicle - Vehicle description
 * @param {string} roData.vin - VIN
 * @param {Array} roData.calibrations - Required calibrations
 * @param {Buffer} roData.revvPdfBuffer - RevvADAS PDF attachment
 */
export async function sendShopConfirmationEmail(roData) {
  const {
    roPo,
    shopName,
    vehicle,
    vin,
    calibrations = [],
    revvPdfBuffer,
    ccEmail
  } = roData;

  console.log(`${LOG_TAG} Sending confirmation to shop: ${shopName} for RO ${roPo}`);

  // Look up shop email using smart matching
  const shopInfo = await getShopEmailByName(shopName);

  if (!shopInfo || !shopInfo.email) {
    console.log(`${LOG_TAG} No email found for shop "${shopName}" - skipping auto-email`);
    return {
      success: false,
      sent: false,
      error: `No email configured for shop: ${shopName}`
    };
  }

  const shopEmail = shopInfo.email;
  const calibrationCount = calibrations.length;
  const calibrationRequired = calibrationCount > 0;

  // Build calibration list
  const calibrationListHtml = calibrations.map(cal => {
    const name = cal.triggersCalibration || cal.name || cal;
    const type = cal.type || 'Static';
    return `<li style="margin-bottom: 6px;">${name} <span style="color: #666; font-size: 12px;">(${type})</span></li>`;
  }).join('');

  const calibrationListText = calibrations.map(cal => {
    const name = cal.triggersCalibration || cal.name || cal;
    return `  - ${name}`;
  }).join('\n');

  const subject = calibrationRequired
    ? `RO ${roPo} - Calibration Confirmed - ${vehicle}`
    : `RO ${roPo} - No Calibration Needed - ${vehicle}`;

  const statusText = calibrationRequired
    ? `YES - ${calibrationCount} ADAS calibration(s) confirmed`
    : 'NO - No ADAS calibrations required for this repair';

  const statusColor = calibrationRequired ? '#2563eb' : '#38a169';
  const statusBg = calibrationRequired ? '#dbeafe' : '#c6f6d5';

  // HTML email body
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%); color: white; padding: 25px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 25px; background: #fff; }
    .status-box { background: ${statusBg}; border-left: 4px solid ${statusColor}; padding: 15px; margin: 20px 0; border-radius: 0 4px 4px 0; }
    .status-box strong { color: ${statusColor}; }
    .details { background: #f7fafc; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .calibrations { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin: 20px 0; }
    .prerequisites { background: #fffbeb; border: 1px solid #f6e05e; border-radius: 6px; padding: 15px; margin: 20px 0; }
    .footer { background: #f7fafc; padding: 20px; text-align: center; font-size: 12px; color: #718096; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ADAS F1RST</h1>
      <p>Calibration Confirmation</p>
    </div>
    <div class="content">
      <p>Hello ${shopInfo.shopName || shopName},</p>
      <p>We have analyzed the estimate for <strong>RO ${roPo}</strong> and confirmed the calibration requirements.</p>

      <div class="details">
        <p><strong>Vehicle:</strong> ${vehicle || 'See attached report'}</p>
        <p><strong>VIN:</strong> ${vin || 'See attached report'}</p>
        <p><strong>RO/PO:</strong> ${roPo}</p>
      </div>

      <div class="status-box">
        <strong>CALIBRATION REQUIRED: ${statusText}</strong>
      </div>

      ${calibrationRequired ? `
      <div class="calibrations">
        <h3 style="margin: 0 0 12px; font-size: 16px;">Required Calibrations:</h3>
        <ul style="margin: 0; padding-left: 20px;">${calibrationListHtml}</ul>
      </div>

      <div class="prerequisites">
        <h4 style="margin: 0 0 10px; color: #744210;">Prerequisites Before Calibration:</h4>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #744210;">
          <li>4-wheel alignment within OEM spec</li>
          <li>Fuel tank at least 1/2 full</li>
          <li>Tires at proper pressure</li>
          <li>No active DTC codes</li>
          <li>Battery fully charged</li>
        </ul>
      </div>
      ` : '<p>Based on the repair operations, no ADAS sensor calibrations are needed.</p>'}

      <p>If you have any questions, please reply to this email.</p>
      <p>Best regards,<br><strong>ADAS F1RST Team</strong></p>
    </div>
    <div class="footer">
      <p>ADAS F1RST | Miami, FL | Professional ADAS Calibration Services</p>
      <p style="font-size: 11px; color: #999;">Sent: ${getESTTimestamp()}</p>
    </div>
  </div>
</body>
</html>`.trim();

  // Plain text version
  const textBody = `
Hello ${shopInfo.shopName || shopName},

We have analyzed the estimate for RO ${roPo} and confirmed the calibration requirements.

Vehicle: ${vehicle || 'See attached report'}
VIN: ${vin || 'See attached report'}
RO/PO: ${roPo}

CALIBRATION REQUIRED: ${statusText}

${calibrationRequired ? `Required Calibrations:
${calibrationListText}

Prerequisites Before Calibration:
- 4-wheel alignment within OEM spec
- Fuel tank at least 1/2 full
- Tires at proper pressure
- No active DTC codes
- Battery fully charged
` : 'Based on the repair operations, no ADAS sensor calibrations are needed.'}

If you have any questions, please reply to this email.

Best regards,
ADAS F1RST Team
`.trim();

  // Prepare attachments
  const attachments = [];
  if (revvPdfBuffer) {
    attachments.push({
      filename: `RevvADAS_Report_${roPo}.pdf`,
      content: revvPdfBuffer,
      mimeType: 'application/pdf'
    });
  }

  const result = await sendEmail({
    to: shopEmail,
    cc: ccEmail || shopInfo.billingCc,
    subject,
    htmlBody,
    textBody,
    attachments
  });

  if (result.success) {
    console.log(`${LOG_TAG} Confirmation sent to ${shopEmail} for RO ${roPo}`);
  }

  return {
    ...result,
    sent: result.success,
    shopEmail,
    matched: shopInfo.matched
  };
}

/**
 * Send "Ready to Schedule" email to shop when RevvADAS report is submitted
 * Focus: Vehicle is ready, go to portal to book appointment
 *
 * @param {Object} roData - RO information
 * @param {string} roData.roPo - RO/PO number
 * @param {string} roData.shopName - Shop name (for lookup)
 * @param {string} roData.vehicle - Vehicle description
 * @param {string} roData.vin - VIN
 * @param {Array} roData.calibrations - Required calibrations from RevvADAS report
 * @param {Buffer} roData.revvPdfBuffer - RevvADAS PDF attachment
 */
export async function sendReadyToScheduleEmail(roData) {
  const {
    roPo,
    shopName,
    vehicle,
    vin,
    calibrations = [],
    revvPdfBuffer,
    ccEmail
  } = roData;

  console.log(`${LOG_TAG} Sending Ready to Schedule email to shop: ${shopName} for RO ${roPo}`);

  // Look up shop email using smart matching
  const shopInfo = await getShopEmailByName(shopName);

  if (!shopInfo || !shopInfo.email) {
    console.log(`${LOG_TAG} No email found for shop "${shopName}" - skipping auto-email`);
    return {
      success: false,
      sent: false,
      error: `No email configured for shop: ${shopName}`
    };
  }

  const shopEmail = shopInfo.email;
  const hasCalibrations = calibrations.length > 0;

  // Build calibration list
  const calibrationListHtml = calibrations.map(cal => {
    return `<li style="margin-bottom: 8px; font-size: 15px;">${cal}</li>`;
  }).join('');

  const calibrationListText = calibrations.map(cal => `  • ${cal}`).join('\n');

  const subject = hasCalibrations
    ? `Ready to Schedule: ${vehicle} - RO# ${roPo}`
    : `No Calibration Required: ${vehicle} - RO# ${roPo}`;

  // Portal URL - shop portal for scheduling
  const portalUrl = 'https://adasfirst.com/shop';

  // HTML email body - Clean, action-focused
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; background: #f5f5f7; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: #1d1d1f; color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.5px; }
    .content { padding: 30px; }
    .greeting { font-size: 16px; margin-bottom: 20px; }
    .highlight-box { background: ${hasCalibrations ? '#e8f5e9' : '#fff3e0'}; border-radius: 12px; padding: 20px; margin: 25px 0; }
    .highlight-box h2 { margin: 0 0 5px; font-size: 14px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
    .highlight-box .status { font-size: 20px; font-weight: 600; color: ${hasCalibrations ? '#2e7d32' : '#e65100'}; }
    .vehicle-card { background: #f5f5f7; border-radius: 12px; padding: 20px; margin: 20px 0; }
    .vehicle-card p { margin: 8px 0; font-size: 15px; }
    .vehicle-card strong { color: #1d1d1f; }
    .calibrations { margin: 25px 0; }
    .calibrations h3 { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #1d1d1f; }
    .calibrations ul { margin: 0; padding-left: 20px; }
    .cta-button { display: inline-block; background: #0071e3; color: white !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; margin: 20px 0; }
    .cta-button:hover { background: #0077ED; }
    .footer { background: #f5f5f7; padding: 25px; text-align: center; font-size: 13px; color: #86868b; }
    .footer a { color: #0071e3; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ADAS F1RST</h1>
    </div>
    <div class="content">
      <p class="greeting">Hi ${shopInfo.shopName || shopName},</p>

      <div class="highlight-box">
        <h2>Status</h2>
        <div class="status">${hasCalibrations ? '✓ Ready to Schedule' : 'No Calibration Required'}</div>
      </div>

      <div class="vehicle-card">
        <p><strong>Vehicle:</strong> ${vehicle || 'See attached report'}</p>
        <p><strong>VIN:</strong> ${vin || 'See attached report'}</p>
        <p><strong>RO#:</strong> ${roPo}</p>
      </div>

      ${hasCalibrations ? `
      <div class="calibrations">
        <h3>Calibrations Required:</h3>
        <ul>${calibrationListHtml}</ul>
      </div>

      <p style="font-size: 15px;">The full RevvADAS report is attached with complete details.</p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${portalUrl}" class="cta-button">Schedule Appointment</a>
      </div>

      <p style="font-size: 14px; color: #666;">Or call us at <strong>(786) 838-4497</strong> to schedule.</p>
      ` : `
      <p style="font-size: 15px;">Based on the RevvADAS analysis, no ADAS calibrations are required for this repair.</p>
      <p style="font-size: 15px;">The full report is attached for your records.</p>
      `}

      <p style="margin-top: 30px; font-size: 14px; color: #666;">Questions? Just reply to this email.</p>
    </div>
    <div class="footer">
      <p><strong>ADAS F1RST</strong> | Miami, FL</p>
      <p>Professional ADAS Calibration Services</p>
      <p style="margin-top: 15px;"><a href="${portalUrl}">Shop Portal</a> | (786) 838-4497</p>
    </div>
  </div>
</body>
</html>`.trim();

  // Plain text version
  const textBody = `
Hi ${shopInfo.shopName || shopName},

${hasCalibrations ? 'READY TO SCHEDULE' : 'NO CALIBRATION REQUIRED'}

Vehicle: ${vehicle || 'See attached report'}
VIN: ${vin || 'See attached report'}
RO#: ${roPo}

${hasCalibrations ? `CALIBRATIONS REQUIRED:
${calibrationListText}

NEXT STEP:
Schedule your appointment at: ${portalUrl}
Or call us at (786) 838-4497

The full RevvADAS report is attached.` : `Based on the RevvADAS analysis, no ADAS calibrations are required for this repair.

The full report is attached for your records.`}

Questions? Reply to this email.

— ADAS F1RST Team
`.trim();

  // Prepare attachments
  const attachments = [];
  if (revvPdfBuffer) {
    attachments.push({
      filename: `RevvADAS_Report_${roPo}.pdf`,
      content: revvPdfBuffer,
      mimeType: 'application/pdf'
    });
  }

  const result = await sendEmail({
    to: shopEmail,
    cc: ccEmail || shopInfo.billingCc,
    subject,
    htmlBody,
    textBody,
    attachments
  });

  if (result.success) {
    console.log(`${LOG_TAG} Ready to Schedule email sent to ${shopEmail} for RO ${roPo}`);
  }

  return {
    ...result,
    sent: result.success,
    shopEmail,
    matched: shopInfo.matched
  };
}

/**
 * Send tech review email - when LLM and RevvADAS disagree
 *
 * @param {Object} roData - RO information
 * @param {Object} scrubResult - Scrub analysis result
 */
export async function sendTechReviewEmail(roData, scrubResult) {
  const {
    roPo,
    shopName,
    vehicle,
    vin,
    techEmail = 'radarsolutionsus@gmail.com'
  } = roData;

  console.log(`${LOG_TAG} Sending tech review request for RO ${roPo}`);

  const llmCalibrations = scrubResult.adasOperations || [];
  const revvCalibrations = scrubResult.revvCalibrations || [];

  const llmCount = llmCalibrations.length;
  const revvCount = revvCalibrations.length;

  // Build comparison lists
  const llmListHtml = llmCalibrations.length > 0
    ? llmCalibrations.map(op => `<li>${op.triggersCalibration || op.operation} - ${op.reason || ''}</li>`).join('')
    : '<li style="color: #888;">(No calibrations detected from estimate)</li>';

  const revvListHtml = revvCalibrations.length > 0
    ? revvCalibrations.map(cal => `<li>${cal.name || cal}</li>`).join('')
    : '<li style="color: #888;">(No calibrations in RevvADAS)</li>';

  let discrepancyReason = '';
  if (llmCount > 0 && revvCount === 0) {
    discrepancyReason = `Estimate suggests ${llmCount} calibration(s) but RevvADAS shows none`;
  } else if (llmCount === 0 && revvCount > 0) {
    discrepancyReason = `RevvADAS shows ${revvCount} calibration(s) but no matching repair operations found`;
  } else {
    discrepancyReason = `Estimate: ${llmCount} calibrations vs RevvADAS: ${revvCount} calibrations`;
  }

  const subject = `RO ${roPo} - REVIEW REQUIRED - ${vehicle}`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 650px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #c53030 0%, #e53e3e 100%); color: white; padding: 20px; text-align: center; }
    .content { padding: 25px; background: #fff; }
    .warning-box { background: #fff5f5; border-left: 4px solid #c53030; padding: 15px; margin: 15px 0; }
    .details { background: #f7fafc; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .comparison { display: table; width: 100%; margin: 20px 0; }
    .comparison-col { display: table-cell; width: 50%; padding: 10px; vertical-align: top; background: #f7fafc; }
    .steps { background: #ebf8ff; border: 1px solid #90cdf4; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .footer { background: #f7fafc; padding: 15px; text-align: center; font-size: 12px; color: #718096; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>RevvADAS Review Required</h1>
    </div>
    <div class="content">
      <p>A discrepancy was found that needs review before sending confirmation to the shop.</p>

      <div class="warning-box">
        <strong style="color: #c53030;">DISCREPANCY:</strong> ${discrepancyReason}
      </div>

      <div class="details">
        <p><strong>Vehicle:</strong> ${vehicle || 'Unknown'}</p>
        <p><strong>VIN:</strong> ${vin || 'Unknown'}</p>
        <p><strong>Shop:</strong> ${shopName || 'Unknown'}</p>
        <p><strong>RO/PO:</strong> ${roPo}</p>
      </div>

      <div class="comparison">
        <div class="comparison-col" style="border-right: 1px solid #e2e8f0;">
          <h4 style="margin: 0 0 10px;">LLM Analysis Found:</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px;">${llmListHtml}</ul>
        </div>
        <div class="comparison-col">
          <h4 style="margin: 0 0 10px;">RevvADAS Shows:</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px;">${revvListHtml}</ul>
        </div>
      </div>

      <div class="steps">
        <h4 style="margin: 0 0 10px; color: #2b6cb0;">What To Do:</h4>
        <ol style="margin: 0; padding-left: 20px;">
          <li>Review the estimate operations</li>
          <li>Update RevvADAS if needed (re-run VIN lookup)</li>
          <li>Reply with corrected RevvADAS report</li>
          <li>System will re-verify and send confirmation</li>
        </ol>
      </div>

      <p>Thanks,<br><strong>ADAS Assistant</strong></p>
    </div>
    <div class="footer">
      <p>Automated message from ADAS F1RST email processing</p>
      <p style="font-size: 11px; color: #999;">Sent: ${getESTTimestamp()}</p>
    </div>
  </div>
</body>
</html>`.trim();

  const textBody = `
REVVADAS REVIEW REQUIRED
========================

Vehicle: ${vehicle || 'Unknown'}
VIN: ${vin || 'Unknown'}
Shop: ${shopName || 'Unknown'}
RO/PO: ${roPo}

DISCREPANCY: ${discrepancyReason}

LLM Analysis Found:
${llmCalibrations.map(op => `  - ${op.triggersCalibration || op.operation}`).join('\n') || '  (None detected)'}

RevvADAS Shows:
${revvCalibrations.map(cal => `  - ${cal.name || cal}`).join('\n') || '  (None)'}

WHAT TO DO:
1. Review the estimate operations
2. Update RevvADAS if needed
3. Reply with corrected report
4. System will re-verify and send confirmation

Thanks,
ADAS Assistant
`.trim();

  const result = await sendEmail({
    to: techEmail,
    subject,
    htmlBody,
    textBody,
    attachments: []
  });

  if (result.success) {
    console.log(`${LOG_TAG} Review request sent to ${techEmail} for RO ${roPo}`);
  }

  return {
    ...result,
    sent: result.success,
    techEmail
  };
}

/**
 * Send "No Calibration Required" email to shop
 * Used when Revv Report shows no calibrations are needed for the repair
 *
 * @param {Object} roData - RO information
 * @param {string} roData.roPo - RO/PO number
 * @param {string} roData.shopName - Shop name (for lookup)
 * @param {string} roData.vehicle - Vehicle description
 * @param {string} roData.vin - VIN
 * @param {Buffer} roData.revvPdfBuffer - RevvADAS PDF attachment
 */
export async function sendNoCalibrationEmail(roData) {
  const {
    roPo,
    shopName,
    vehicle,
    vin,
    revvPdfBuffer,
    ccEmail
  } = roData;

  console.log(`${LOG_TAG} Sending "No Calibration Required" email to shop: ${shopName} for RO ${roPo}`);

  // Look up shop email using smart matching
  const shopInfo = await getShopEmailByName(shopName);

  if (!shopInfo || !shopInfo.email) {
    console.log(`${LOG_TAG} No email found for shop "${shopName}" - skipping no-cal email`);
    return {
      success: false,
      sent: false,
      error: `No email configured for shop: ${shopName}`
    };
  }

  const shopEmail = shopInfo.email;

  const subject = `RO ${roPo} - No Calibration Required - ${vehicle}`;

  // HTML email body
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #1a365d 0%, #2c5282 100%); color: white; padding: 25px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { padding: 25px; background: #fff; }
    .status-box { background: #f5f5f5; border-left: 4px solid #666666; padding: 15px; margin: 20px 0; border-radius: 0 4px 4px 0; }
    .status-box strong { color: #333; }
    .details { background: #f7fafc; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .info-box { background: #e8f5e9; border: 1px solid #a5d6a7; border-radius: 6px; padding: 15px; margin: 20px 0; }
    .footer { background: #f7fafc; padding: 20px; text-align: center; font-size: 12px; color: #718096; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ADAS F1RST</h1>
      <p>Calibration Assessment Complete</p>
    </div>
    <div class="content">
      <p>Hello ${shopInfo.shopName || shopName},</p>
      <p>We have reviewed the estimate and Revv Report for <strong>RO ${roPo}</strong>.</p>

      <div class="details">
        <p><strong>Vehicle:</strong> ${vehicle || 'See attached report'}</p>
        <p><strong>VIN:</strong> ${vin || 'See attached report'}</p>
        <p><strong>RO/PO:</strong> ${roPo}</p>
      </div>

      <div class="status-box">
        <strong>NO ADAS CALIBRATION REQUIRED</strong>
        <p style="margin: 10px 0 0; font-size: 14px;">Based on the repair operations and vehicle ADAS equipment, no calibration is needed for this repair.</p>
      </div>

      <div class="info-box">
        <h4 style="margin: 0 0 10px; color: #2e7d32;">What This Means:</h4>
        <ul style="margin: 0; padding-left: 20px; font-size: 14px;">
          <li>The repairs do not affect any ADAS sensors or cameras</li>
          <li>No post-repair calibration procedures are necessary</li>
          <li>The vehicle can be returned to the customer after repairs</li>
        </ul>
      </div>

      <p>The attached Revv Report provides details on the vehicle's ADAS equipment for your reference.</p>

      <p>If you have any questions or believe calibration may still be needed, please reply to this email.</p>
      <p>Best regards,<br><strong>ADAS F1RST Team</strong></p>
    </div>
    <div class="footer">
      <p>ADAS F1RST | Miami, FL | Professional ADAS Calibration Services</p>
      <p style="font-size: 11px; color: #999;">Sent: ${getESTTimestamp()}</p>
    </div>
  </div>
</body>
</html>`.trim();

  // Plain text version
  const textBody = `
Hello ${shopInfo.shopName || shopName},

We have reviewed the estimate and Revv Report for RO ${roPo}.

Vehicle: ${vehicle || 'See attached report'}
VIN: ${vin || 'See attached report'}
RO/PO: ${roPo}

NO ADAS CALIBRATION REQUIRED

Based on the repair operations and vehicle ADAS equipment, no calibration is needed for this repair.

What This Means:
- The repairs do not affect any ADAS sensors or cameras
- No post-repair calibration procedures are necessary
- The vehicle can be returned to the customer after repairs

The attached Revv Report provides details on the vehicle's ADAS equipment for your reference.

If you have any questions or believe calibration may still be needed, please reply to this email.

Best regards,
ADAS F1RST Team
`.trim();

  // Prepare attachments
  const attachments = [];
  if (revvPdfBuffer) {
    attachments.push({
      filename: `RevvADAS_Report_${roPo}.pdf`,
      content: revvPdfBuffer,
      mimeType: 'application/pdf'
    });
  }

  const result = await sendEmail({
    to: shopEmail,
    cc: ccEmail || shopInfo.billingCc,
    subject,
    htmlBody,
    textBody,
    attachments
  });

  if (result.success) {
    console.log(`${LOG_TAG} "No Calibration Required" email sent to ${shopEmail} for RO ${roPo}`);
  }

  return {
    ...result,
    sent: result.success,
    shopEmail,
    matched: shopInfo.matched
  };
}

/**
 * Process scrub result and send appropriate email
 *
 * @param {Object} llmResult - Result from analyzeEstimateWithLLM
 * @param {Array} revvCalibrations - Calibrations from RevvADAS
 * @param {Object} options - Additional options (revvPdfBuffer, etc.)
 * @returns {Promise<Object>} - Email sending result
 */
export async function processAndSendEmail(llmResult, revvCalibrations = [], options = {}) {
  const {
    revvPdfBuffer,
    techEmail = 'radarsolutionsus@gmail.com'
  } = options;

  const roPo = llmResult.roNumber || 'Unknown';
  const shopName = llmResult.shopName;
  const vehicle = llmResult.vehicle?.full || '';
  const vin = llmResult.vin;

  const llmCalibrations = llmResult.adasOperations || [];
  const llmCount = llmCalibrations.length;
  const revvCount = revvCalibrations.length;

  // Determine if sources agree
  // Simple heuristic: both have calibrations OR both have none
  const sourcesAgree = (llmCount > 0 && revvCount > 0) || (llmCount === 0 && revvCount === 0);

  console.log(`${LOG_TAG} Processing RO ${roPo}: LLM=${llmCount}, RevvADAS=${revvCount}, agree=${sourcesAgree}`);

  if (sourcesAgree) {
    // Send confirmation to shop
    const result = await sendShopConfirmationEmail({
      roPo,
      shopName,
      vehicle,
      vin,
      calibrations: llmCalibrations,
      revvPdfBuffer
    });

    return {
      action: result.success ? 'SENT_TO_SHOP' : 'SHOP_EMAIL_FAILED',
      ...result,
      status: 'Ready'
    };
  } else {
    // Send review request to tech
    const result = await sendTechReviewEmail(
      { roPo, shopName, vehicle, vin, techEmail },
      { adasOperations: llmCalibrations, revvCalibrations }
    );

    return {
      action: result.success ? 'SENT_TO_TECH' : 'TECH_EMAIL_FAILED',
      ...result,
      status: 'Needs Review'
    };
  }
}

export default {
  sendShopConfirmationEmail,
  sendReadyToScheduleEmail,
  sendTechReviewEmail,
  sendNoCalibrationEmail,
  processAndSendEmail,
  initializeGmailClient
};
