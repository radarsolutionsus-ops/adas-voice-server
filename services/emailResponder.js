/**
 * emailResponder.js - Automated email response service for ADAS F1RST
 *
 * Sends confirmation emails to SHOPS (NOT technicians) after processing technician emails.
 *
 * TWO RESPONSE TYPES:
 *
 * 1. INITIAL RESPONSE (Calibration Confirmation):
 *    - Technician sends: Shop Estimate + RevvADAS Report
 *    - System responds to: Shop email (from Shops tab)
 *    - Attachments: RevvADAS Report PDF
 *    - Content: Calibration requirements summary
 *
 * 2. COMPLETION RESPONSE (Job Closed):
 *    - Technician sends: Post-Scan + Invoice + RevvADAS Report
 *    - System responds to: Shop email (from Shops tab)
 *    - Attachments: Post-Scan PDF, Invoice PDF, RevvADAS Report PDF
 *    - Content: Job completion confirmation with all documents
 *
 * CRITICAL: Always sends to shop email from Shops tab, NOT to the technician who sent the email.
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sheetWriter, { getGmailTokenFromSheets, saveGmailTokenToSheets } from './sheetWriter.js';
import { getESTTimestamp, getESTISOTimestamp } from '../utils/timezone.js';

const LOG_TAG = '[EMAIL_RESPONDER]';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gmail configuration
const GMAIL_USER = 'radarsolutionsus@gmail.com';

// OAuth credentials paths (same as other services)
const OAUTH_CREDENTIALS_PATH = process.env.GMAIL_OAUTH_CREDENTIALS_PATH ||
  path.join(__dirname, '../credentials/google-oauth-client.json');
const OAUTH_TOKEN_PATH = process.env.GMAIL_OAUTH_TOKEN_PATH ||
  path.join(__dirname, '../credentials/gmail_oauth_token.json');

let gmailClient = null;

/**
 * Get OAuth credentials from env var (Railway) or file (local dev)
 * @returns {object} - Parsed credentials object
 */
function getOAuthCredentials() {
  // Try env var first (Railway deployment)
  if (process.env.GMAIL_OAUTH_CREDENTIALS_JSON) {
    console.log(`${LOG_TAG} Loading OAuth credentials from environment variable`);
    return JSON.parse(process.env.GMAIL_OAUTH_CREDENTIALS_JSON);
  }
  // Fall back to file (local development)
  if (fs.existsSync(OAUTH_CREDENTIALS_PATH)) {
    console.log(`${LOG_TAG} Loading OAuth credentials from file: ${OAUTH_CREDENTIALS_PATH}`);
    return JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_PATH, 'utf8'));
  }
  throw new Error(`No Gmail OAuth credentials found. Set GMAIL_OAUTH_CREDENTIALS_JSON env var or provide file at ${OAUTH_CREDENTIALS_PATH}`);
}

/**
 * Get OAuth token from Google Sheets (Railway), env var, or file (local dev)
 * Priority: 1. Google Sheets Config tab, 2. Env var, 3. Local file
 * @returns {Promise<object>} - Parsed token object
 */
async function getOAuthToken() {
  // Try Google Sheets first (Railway - persists refreshed tokens)
  try {
    const sheetsToken = await getGmailTokenFromSheets();
    if (sheetsToken) {
      console.log(`${LOG_TAG} Loading OAuth token from Google Sheets Config tab`);
      return sheetsToken;
    }
  } catch (err) {
    console.log(`${LOG_TAG} Could not read token from Sheets: ${err.message}`);
  }

  // Try env var second (Railway fallback)
  if (process.env.GMAIL_OAUTH_TOKEN_JSON) {
    console.log(`${LOG_TAG} Loading OAuth token from environment variable`);
    return JSON.parse(process.env.GMAIL_OAUTH_TOKEN_JSON);
  }

  // Fall back to file (local development)
  if (fs.existsSync(OAUTH_TOKEN_PATH)) {
    console.log(`${LOG_TAG} Loading OAuth token from file: ${OAUTH_TOKEN_PATH}`);
    return JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH, 'utf8'));
  }

  throw new Error(`No Gmail OAuth token found. Set GMAIL_OAUTH_TOKEN_JSON env var or provide file at ${OAUTH_TOKEN_PATH}. Run: node scripts/gmail-auth.js`);
}

/**
 * Initialize Gmail client for sending emails
 * Supports both environment variables (Railway) and file-based credentials (local dev)
 */
async function initializeGmailClient() {
  if (gmailClient) return gmailClient;

  try {
    // Load OAuth credentials (from env var or file)
    const credentials = getOAuthCredentials();
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
    );

    // Load existing token (from Sheets, env var, or file - in that priority)
    const token = await getOAuthToken();
    oauth2Client.setCredentials(token);

    // Check if token needs refresh
    if (token.expiry_date && token.expiry_date < Date.now()) {
      console.log(`${LOG_TAG} Token expired, refreshing...`);
      const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newCredentials);

      // Save refreshed token
      if (process.env.GMAIL_OAUTH_TOKEN_JSON || process.env.RAILWAY_ENVIRONMENT) {
        // Railway: save to Google Sheets
        console.log(`${LOG_TAG} Saving refreshed token to Google Sheets Config tab...`);
        try {
          const result = await saveGmailTokenToSheets(newCredentials);
          if (result.success) {
            console.log(`${LOG_TAG} Token saved to Google Sheets Config tab successfully`);
          } else {
            console.error(`${LOG_TAG} Failed to save token to Sheets: ${result.error}`);
          }
        } catch (err) {
          console.error(`${LOG_TAG} Error saving token to Sheets: ${err.message}`);
        }
      } else {
        // Local dev: save to file
        fs.writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(newCredentials, null, 2));
        console.log(`${LOG_TAG} Token saved to ${OAUTH_TOKEN_PATH}`);
      }
    }

    gmailClient = google.gmail({ version: 'v1', auth: oauth2Client });
    console.log(`${LOG_TAG} Gmail client initialized for ${GMAIL_USER}`);
    return gmailClient;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to initialize Gmail client:`, err.message);
    throw err;
  }
}

/**
 * Look up shop email from Shops tab
 * CRITICAL: Always use this to get shop email, never use technician/sender email
 * @param {string} shopName - Shop name to lookup
 * @returns {Promise<{email: string, billingCC: string, name: string, notes: string}|null>}
 */
export async function lookupShopEmail(shopName) {
  console.log(`${LOG_TAG} Looking up email for shop: ${shopName}`);

  if (!shopName) {
    console.warn(`${LOG_TAG} No shop name provided for email lookup`);
    return null;
  }

  try {
    const shopInfo = await sheetWriter.getShopInfo(shopName);

    if (shopInfo && shopInfo.email) {
      console.log(`${LOG_TAG} Found shop email: ${shopInfo.email}`);
      return {
        name: shopInfo.shopName || shopName,
        email: shopInfo.email,
        billingCC: shopInfo.billingCc || null,
        notes: shopInfo.notes || null
      };
    }

    console.log(`${LOG_TAG} Shop not found in Shops tab: ${shopName}`);
    return null;
  } catch (error) {
    console.error(`${LOG_TAG} Error looking up shop:`, error.message);
    return null;
  }
}

/**
 * Send an email with optional attachments
 * @param {Object} params - Email parameters
 * @param {string} params.to - Recipient email
 * @param {string} params.cc - CC email (optional)
 * @param {string} params.subject - Email subject
 * @param {string} params.htmlBody - HTML email body
 * @param {string} params.textBody - Plain text email body
 * @param {Array} params.attachments - Array of { filename, content, mimeType }
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendEmail({ to, cc, subject, htmlBody, textBody, attachments = [] }) {
  try {
    const gmail = await initializeGmailClient();

    const boundary = `boundary_${Date.now()}`;
    const mixedBoundary = `mixed_${Date.now()}`;

    let mimeMessage;

    if (attachments.length > 0) {
      // Build multipart/mixed message with attachments
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

      // Add attachments
      for (const att of attachments) {
        if (!att.content) continue; // Skip empty attachments
        mimeMessage.push('');
        mimeMessage.push(`--${mixedBoundary}`);
        mimeMessage.push(`Content-Type: ${att.mimeType || 'application/pdf'}; name="${att.filename}"`);
        mimeMessage.push('Content-Transfer-Encoding: base64');
        mimeMessage.push(`Content-Disposition: attachment; filename="${att.filename}"`);
        mimeMessage.push('');
        // Handle both Buffer and base64 string
        const base64Content = Buffer.isBuffer(att.content)
          ? att.content.toString('base64')
          : att.content;
        mimeMessage.push(base64Content);
      }

      mimeMessage.push('');
      mimeMessage.push(`--${mixedBoundary}--`);
    } else {
      // Simple multipart/alternative without attachments
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

    // Encode as base64url
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send the email
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    console.log(`${LOG_TAG} Email sent successfully. Message ID: ${response.data.id}`);

    return {
      success: true,
      messageId: response.data.id,
      to: to,
      cc: cc
    };
  } catch (err) {
    console.error(`${LOG_TAG} Failed to send email:`, err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * RESPONSE TYPE 1: Send calibration confirmation email to shop
 * Triggered when technician sends Shop Estimate + RevvADAS Report
 *
 * @param {Object} params
 * @param {string} params.shopEmail - Shop email address (from Shops tab)
 * @param {string} params.shopName - Shop name
 * @param {string} params.roPo - RO/PO number
 * @param {string} params.vehicle - Vehicle description (Year Make Model)
 * @param {string} params.vin - VIN
 * @param {Array} params.calibrations - List of required calibrations [{name, type}]
 * @param {Array} params.excluded - List of excluded non-ADAS items [{name, reason}]
 * @param {Buffer} params.revvPdfBuffer - RevvADAS PDF buffer
 * @param {string} params.revvPdfLink - Drive link to RevvADAS PDF (fallback)
 * @param {string} params.ccEmail - Optional CC email for billing
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendCalibrationConfirmation(params) {
  const {
    shopEmail,
    shopName,
    roPo,
    vehicle,
    vin,
    calibrations = [],
    excluded = [],
    revvPdfBuffer,
    revvPdfLink,
    ccEmail
  } = params;

  console.log(`${LOG_TAG} Sending calibration confirmation to ${shopEmail} for RO ${roPo}`);

  // Determine if calibration is required
  const calibrationRequired = calibrations.length > 0;
  const calibrationCount = calibrations.length;

  // Build calibration list for email body
  const calibrationListHtml = calibrations.map(cal => {
    const type = cal.type || 'Static';
    return `<li style="margin-bottom: 6px;">${cal.name} <span style="color: #666; font-size: 12px;">(${type})</span></li>`;
  }).join('');

  const calibrationListText = calibrations.map(cal => {
    const type = cal.type || 'Static';
    return `  - ${cal.name} (${type})`;
  }).join('\n');

  // Build excluded list if any
  const excludedListHtml = excluded.length > 0
    ? `<p style="color: #666; font-size: 13px; margin-top: 15px;">
        <strong>Note:</strong> The following are vehicle resets (not ADAS calibrations):<br>
        ${excluded.map(e => `&bull; ${e.name}`).join('<br>')}
       </p>`
    : '';

  const excludedListText = excluded.length > 0
    ? `\nNote: The following are vehicle resets (not ADAS calibrations):\n${excluded.map(e => `  - ${e.name}`).join('\n')}`
    : '';

  // Determine subject and status text
  const subject = calibrationRequired
    ? `RO ${roPo} - Calibration Required - ${vehicle}`
    : `RO ${roPo} - No Calibration Needed - ${vehicle}`;

  const statusText = calibrationRequired
    ? `YES - ${calibrationCount} ADAS calibration(s) required`
    : 'NO - No ADAS calibrations required for this repair';

  const statusColor = calibrationRequired ? '#c53030' : '#38a169';
  const statusBg = calibrationRequired ? '#fed7d7' : '#c6f6d5';

  // Build HTML email body
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
    .header p { margin: 5px 0 0; opacity: 0.9; }
    .content { padding: 25px; background: #fff; }
    .status-box { background: ${statusBg}; border-left: 4px solid ${statusColor}; padding: 15px; margin: 20px 0; border-radius: 0 4px 4px 0; }
    .status-box strong { color: ${statusColor}; }
    .details { background: #f7fafc; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .details p { margin: 8px 0; }
    .details strong { color: #2d3748; }
    .calibrations { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin: 20px 0; }
    .calibrations h3 { margin: 0 0 12px; color: #2d3748; font-size: 16px; }
    .calibrations ul { margin: 0; padding-left: 20px; }
    .prerequisites { background: #fffbeb; border: 1px solid #f6e05e; border-radius: 6px; padding: 15px; margin: 20px 0; }
    .prerequisites h4 { margin: 0 0 10px; color: #744210; font-size: 14px; }
    .prerequisites ul { margin: 0; padding-left: 20px; font-size: 13px; color: #744210; }
    .footer { background: #f7fafc; padding: 20px; text-align: center; font-size: 12px; color: #718096; border-top: 1px solid #e2e8f0; }
    .divider { border-top: 2px solid #e2e8f0; margin: 25px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ADAS F1RST</h1>
      <p>Calibration Requirement Confirmation</p>
    </div>

    <div class="content">
      <p>Hello ${shopName},</p>
      <p>We have received and reviewed the estimate for <strong>RO ${roPo}</strong>.</p>

      <div class="divider"></div>

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
        <h3>Required Calibrations:</h3>
        <ul>${calibrationListHtml}</ul>
      </div>
      ${excludedListHtml}

      <div class="prerequisites">
        <h4>Prerequisites Before Calibration:</h4>
        <ul>
          <li>4-wheel alignment within OEM spec</li>
          <li>Fuel tank at least 1/2 full</li>
          <li>Tires at proper pressure</li>
          <li>No DTC codes present</li>
          <li>Battery fully charged</li>
        </ul>
      </div>

      <p>The attached RevvADAS report contains detailed calibration requirements and OEM procedures.</p>
      ` : `
      <p>Based on the repair operations in this estimate, no ADAS sensor calibrations are needed.</p>
      `}

      <p>If you have any questions, please reply to this email or call us.</p>

      <p>Best regards,<br><strong>ADAS F1RST Team</strong><br>radarsolutionsus@gmail.com</p>
    </div>

    <div class="footer">
      <p>This is an automated response. Please review the attached report for complete details.</p>
      <p>ADAS F1RST | Miami, FL | Professional ADAS Calibration Services</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  // Build plain text email body
  const textBody = `
Hello ${shopName},

We have received and reviewed the estimate for RO ${roPo}.

═══════════════════════════════════════════════════
CALIBRATION REQUIREMENT CONFIRMATION
═══════════════════════════════════════════════════

Vehicle: ${vehicle || 'See attached report'}
VIN: ${vin || 'See attached report'}
RO/PO: ${roPo}

CALIBRATION REQUIRED: ${statusText}

${calibrationRequired ? `Required Calibrations:
${calibrationListText}
${excludedListText}

Please ensure the vehicle meets the following prerequisites before calibration:
  - 4-wheel alignment within OEM spec
  - Fuel tank at least 1/2 full
  - Tires at proper pressure
  - No DTC codes present
  - Battery fully charged

The attached RevvADAS report contains detailed calibration requirements and OEM procedures.
` : 'Based on the repair operations in this estimate, no ADAS sensor calibrations are needed.'}

If you have any questions, please reply to this email or call us.

Best regards,
ADAS F1RST Team
radarsolutionsus@gmail.com

═══════════════════════════════════════════════════
This is an automated response. Please review the attached report for complete details.
═══════════════════════════════════════════════════
  `.trim();

  // Prepare attachments
  const attachments = [];
  if (revvPdfBuffer) {
    attachments.push({
      filename: `RevvADAS_Report_${roPo}.pdf`,
      content: revvPdfBuffer,
      mimeType: 'application/pdf'
    });
    console.log(`${LOG_TAG} Attaching RevvADAS PDF for RO ${roPo}`);
  }

  // Send email
  const result = await sendEmail({
    to: shopEmail,
    cc: ccEmail,
    subject,
    htmlBody,
    textBody,
    attachments
  });

  if (result.success) {
    console.log(`${LOG_TAG} Calibration confirmation sent to ${shopEmail} for RO ${roPo}`);
  }

  return result;
}

/**
 * RESPONSE TYPE 2: Send job completion email to shop
 * Triggered when technician sends Post-Scan + Invoice + Report
 *
 * @param {Object} params
 * @param {string} params.shopEmail - Shop email address (from Shops tab)
 * @param {string} params.shopName - Shop name
 * @param {string} params.roPo - RO/PO number
 * @param {string} params.vehicle - Vehicle description (Year Make Model)
 * @param {string} params.vin - VIN
 * @param {string} params.calibrationsPerformed - Description of calibrations performed
 * @param {string} params.invoiceNumber - Invoice number
 * @param {string} params.invoiceAmount - Invoice amount
 * @param {Buffer} params.postScanPdfBuffer - Post-Scan PDF buffer
 * @param {Buffer} params.invoicePdfBuffer - Invoice PDF buffer
 * @param {Buffer} params.revvPdfBuffer - RevvADAS PDF buffer
 * @param {string} params.postScanLink - Drive link to Post-Scan (fallback)
 * @param {string} params.invoiceLink - Drive link to Invoice (fallback)
 * @param {string} params.revvPdfLink - Drive link to RevvADAS (fallback)
 * @param {string} params.ccEmail - Optional CC email for billing
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendJobCompletionEmail(params) {
  const {
    shopEmail,
    shopName,
    roPo,
    vehicle,
    vin,
    calibrationsPerformed = '',
    invoiceNumber = '',
    invoiceAmount = '',
    postScanPdfBuffer,
    invoicePdfBuffer,
    revvPdfBuffer,
    postScanLink,
    invoiceLink,
    revvPdfLink,
    ccEmail
  } = params;

  console.log(`${LOG_TAG} Sending job completion email to ${shopEmail} for RO ${roPo}`);

  const subject = `RO ${roPo} - ADAS Calibration Completed - ${vehicle}`;

  // Build HTML email body
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #276749 0%, #38a169 100%); color: white; padding: 25px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 5px 0 0; opacity: 0.9; }
    .content { padding: 25px; background: #fff; }
    .success-box { background: #c6f6d5; border-left: 4px solid #38a169; padding: 15px; margin: 20px 0; border-radius: 0 4px 4px 0; }
    .success-box strong { color: #276749; }
    .details { background: #f7fafc; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .details p { margin: 8px 0; }
    .details strong { color: #2d3748; }
    .docs { background: #e2e8f0; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .docs h3 { margin: 0 0 12px; color: #2d3748; font-size: 16px; }
    .docs ul { margin: 0; padding-left: 20px; }
    .invoice-box { background: #ebf8ff; border: 1px solid #90cdf4; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .invoice-box h4 { margin: 0 0 10px; color: #2b6cb0; }
    .footer { background: #f7fafc; padding: 20px; text-align: center; font-size: 12px; color: #718096; border-top: 1px solid #e2e8f0; }
    .divider { border-top: 2px solid #e2e8f0; margin: 25px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ADAS F1RST</h1>
      <p>Job Completion Confirmation</p>
    </div>

    <div class="content">
      <p>Hello ${shopName},</p>

      <div class="success-box">
        <strong>ADAS CALIBRATION COMPLETED SUCCESSFULLY</strong>
      </div>

      <p>The ADAS calibrations for the following vehicle have been completed:</p>

      <div class="details">
        <p><strong>RO/PO Number:</strong> ${roPo}</p>
        <p><strong>Vehicle:</strong> ${vehicle || 'See attached reports'}</p>
        <p><strong>VIN:</strong> ${vin || 'See attached reports'}</p>
        ${calibrationsPerformed ? `<p><strong>Calibrations Performed:</strong> ${calibrationsPerformed}</p>` : ''}
      </div>

      ${invoiceNumber || invoiceAmount ? `
      <div class="invoice-box">
        <h4>Invoice Details</h4>
        ${invoiceNumber ? `<p><strong>Invoice Number:</strong> ${invoiceNumber}</p>` : ''}
        ${invoiceAmount ? `<p><strong>Amount:</strong> $${invoiceAmount}</p>` : ''}
      </div>
      ` : ''}

      <div class="docs">
        <h3>Attached Documents:</h3>
        <ul>
          <li>Post-Scan Report - Final scan showing all systems clear</li>
          <li>RevvADAS Report - Calibration requirements and OEM procedures</li>
          <li>Invoice - Service charges for completed work</li>
        </ul>
      </div>

      <p>All calibrations have been performed according to OEM specifications. The post-scan report confirms all ADAS systems are functioning properly.</p>

      <p>If you have any questions about this job or need additional services, please reply to this email or call us.</p>

      <p>Thank you for your business!</p>

      <p>Best regards,<br><strong>ADAS F1RST Team</strong><br>radarsolutionsus@gmail.com</p>
    </div>

    <div class="footer">
      <p>ADAS F1RST | Miami, FL | Professional ADAS Calibration Services</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  // Build plain text email body
  const textBody = `
Hello ${shopName},

═══════════════════════════════════════════════════
ADAS CALIBRATION COMPLETED SUCCESSFULLY
═══════════════════════════════════════════════════

The ADAS calibrations for the following vehicle have been completed:

RO/PO Number: ${roPo}
Vehicle: ${vehicle || 'See attached reports'}
VIN: ${vin || 'See attached reports'}
${calibrationsPerformed ? `Calibrations Performed: ${calibrationsPerformed}` : ''}

${invoiceNumber || invoiceAmount ? `
INVOICE DETAILS:
${invoiceNumber ? `Invoice Number: ${invoiceNumber}` : ''}
${invoiceAmount ? `Amount: $${invoiceAmount}` : ''}
` : ''}

ATTACHED DOCUMENTS:
- Post-Scan Report - Final scan showing all systems clear
- RevvADAS Report - Calibration requirements and OEM procedures
- Invoice - Service charges for completed work

All calibrations have been performed according to OEM specifications. The post-scan report confirms all ADAS systems are functioning properly.

If you have any questions about this job or need additional services, please reply to this email or call us.

Thank you for your business!

Best regards,
ADAS F1RST Team
radarsolutionsus@gmail.com

═══════════════════════════════════════════════════
ADAS F1RST | Miami, FL | Professional ADAS Calibration Services
═══════════════════════════════════════════════════
  `.trim();

  // Prepare attachments
  const attachments = [];

  if (postScanPdfBuffer) {
    attachments.push({
      filename: `PostScan_${roPo}.pdf`,
      content: postScanPdfBuffer,
      mimeType: 'application/pdf'
    });
    console.log(`${LOG_TAG} Attaching Post-Scan PDF for RO ${roPo}`);
  }

  if (revvPdfBuffer) {
    attachments.push({
      filename: `RevvADAS_Report_${roPo}.pdf`,
      content: revvPdfBuffer,
      mimeType: 'application/pdf'
    });
    console.log(`${LOG_TAG} Attaching RevvADAS PDF for RO ${roPo}`);
  }

  if (invoicePdfBuffer) {
    attachments.push({
      filename: `Invoice_${roPo}.pdf`,
      content: invoicePdfBuffer,
      mimeType: 'application/pdf'
    });
    console.log(`${LOG_TAG} Attaching Invoice PDF for RO ${roPo}`);
  }

  // Send email
  const result = await sendEmail({
    to: shopEmail,
    cc: ccEmail,
    subject,
    htmlBody,
    textBody,
    attachments
  });

  if (result.success) {
    console.log(`${LOG_TAG} Job completion email sent to ${shopEmail} for RO ${roPo}`);
  }

  return result;
}

/**
 * Send calibration confirmation using auto-discovered shop info
 * Triggered when technician sends: Shop Estimate + RevvADAS Report
 *
 * @param {Object} params
 * @param {string} params.shopName - Shop name (for lookup in Shops tab)
 * @param {string} params.roPo - RO/PO number
 * @param {string} params.vehicle - Vehicle description
 * @param {string} params.vin - VIN
 * @param {Array} params.calibrations - Required calibrations [{name, type}]
 * @param {Array} params.excluded - Excluded non-ADAS items
 * @param {Buffer} params.revvPdfBuffer - RevvADAS PDF buffer
 * @param {string} params.revvPdfLink - Drive link to RevvADAS PDF
 * @returns {Promise<{success: boolean, sent: boolean, error?: string, shopEmail?: string}>}
 */
export async function sendAutoCalibrationResponse(params) {
  const {
    shopName,
    roPo,
    vehicle,
    vin,
    calibrations,
    excluded,
    revvPdfBuffer,
    revvPdfLink
  } = params;

  console.log(`${LOG_TAG} Auto calibration response for RO ${roPo}, shop: ${shopName}`);

  // Look up shop email from Shops tab
  const shopInfo = await lookupShopEmail(shopName);

  if (!shopInfo || !shopInfo.email) {
    console.log(`${LOG_TAG} No email found for shop "${shopName}", skipping auto-response`);
    return {
      success: false,
      sent: false,
      error: `No email configured for shop: ${shopName}`
    };
  }

  // Send calibration confirmation email
  const result = await sendCalibrationConfirmation({
    shopEmail: shopInfo.email,
    shopName: shopInfo.name,
    roPo,
    vehicle,
    vin,
    calibrations,
    excluded,
    revvPdfBuffer,
    revvPdfLink,
    ccEmail: shopInfo.billingCC
  });

  return {
    success: result.success,
    sent: result.success,
    messageId: result.messageId,
    shopEmail: shopInfo.email,
    error: result.error
  };
}

/**
 * Send job completion email using auto-discovered shop info
 * Triggered when technician sends: Post-Scan + Invoice + Report
 *
 * @param {Object} params
 * @param {string} params.shopName - Shop name (for lookup in Shops tab)
 * @param {string} params.roPo - RO/PO number
 * @param {string} params.vehicle - Vehicle description
 * @param {string} params.vin - VIN
 * @param {string} params.calibrationsPerformed - Calibrations performed
 * @param {string} params.invoiceNumber - Invoice number
 * @param {string} params.invoiceAmount - Invoice amount
 * @param {Buffer} params.postScanPdfBuffer - Post-Scan PDF buffer
 * @param {Buffer} params.invoicePdfBuffer - Invoice PDF buffer
 * @param {Buffer} params.revvPdfBuffer - RevvADAS PDF buffer
 * @returns {Promise<{success: boolean, sent: boolean, error?: string, shopEmail?: string}>}
 */
export async function sendAutoCompletionResponse(params) {
  const {
    shopName,
    roPo,
    vehicle,
    vin,
    calibrationsPerformed,
    invoiceNumber,
    invoiceAmount,
    postScanPdfBuffer,
    invoicePdfBuffer,
    revvPdfBuffer,
    postScanLink,
    invoiceLink,
    revvPdfLink
  } = params;

  console.log(`${LOG_TAG} Auto completion response for RO ${roPo}, shop: ${shopName}`);

  // Look up shop email from Shops tab
  const shopInfo = await lookupShopEmail(shopName);

  if (!shopInfo || !shopInfo.email) {
    console.log(`${LOG_TAG} No email found for shop "${shopName}", skipping auto-response`);
    return {
      success: false,
      sent: false,
      error: `No email configured for shop: ${shopName}`
    };
  }

  // Send job completion email
  const result = await sendJobCompletionEmail({
    shopEmail: shopInfo.email,
    shopName: shopInfo.name,
    roPo,
    vehicle,
    vin,
    calibrationsPerformed,
    invoiceNumber,
    invoiceAmount,
    postScanPdfBuffer,
    invoicePdfBuffer,
    revvPdfBuffer,
    postScanLink,
    invoiceLink,
    revvPdfLink,
    ccEmail: shopInfo.billingCC
  });

  return {
    success: result.success,
    sent: result.success,
    messageId: result.messageId,
    shopEmail: shopInfo.email,
    error: result.error
  };
}

/**
 * Send tech review email - discrepancy found, needs RevvADAS correction
 * Sent to the technician (original sender) as a reply to the incoming email
 *
 * @param {Object} params
 * @param {string} params.techEmail - Technician's email (original sender)
 * @param {string} params.replyToMessageId - Original message ID for threading
 * @param {string} params.roPo - RO/PO number
 * @param {string} params.shopName - Shop name
 * @param {string} params.vehicle - Vehicle description
 * @param {string} params.vin - VIN
 * @param {Array} params.estimateCalibrations - Calibrations found from estimate analysis
 * @param {Array} params.revvCalibrations - Calibrations from RevvADAS
 * @param {Array} params.operations - Repair operations detected
 * @param {string} params.discrepancyReason - Reason for the discrepancy
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendTechReviewEmail(params) {
  const {
    techEmail,
    replyToMessageId,
    roPo,
    shopName,
    vehicle,
    vin,
    estimateCalibrations = [],
    revvCalibrations = [],
    operations = [],
    discrepancyReason = 'Calibration counts do not match'
  } = params;

  console.log(`${LOG_TAG} Sending tech review request to ${techEmail} for RO ${roPo}`);

  const subject = `⚠️ RevvADAS Review Needed - RO ${roPo}`;

  // Build operations list
  const operationsListHtml = operations.slice(0, 10).map(op => {
    const component = op.category || op.component || op.area || 'unknown';
    const action = op.operation || op.action || 'repair';
    return `<li><code>${action}</code> [${component}]</li>`;
  }).join('');

  const operationsListText = operations.slice(0, 10).map(op => {
    const component = op.category || op.component || op.area || 'unknown';
    const action = op.operation || op.action || 'repair';
    return `  - ${action} [${component}]`;
  }).join('\n');

  // Build estimate calibrations list
  const estCalsHtml = estimateCalibrations.length > 0
    ? estimateCalibrations.map(c => `<li>${c.calibration || c.name || c}</li>`).join('')
    : '<li style="color: #888;">(No calibrations detected from estimate)</li>';

  const estCalsText = estimateCalibrations.length > 0
    ? estimateCalibrations.map(c => `  • ${c.calibration || c.name || c}`).join('\n')
    : '  (No calibrations detected from estimate)';

  // Build RevvADAS calibrations list
  const revvCalsHtml = revvCalibrations.length > 0
    ? revvCalibrations.map(c => `<li>${c.calibration || c.name || c}</li>`).join('')
    : '<li style="color: #888;">(No calibrations in RevvADAS)</li>';

  const revvCalsText = revvCalibrations.length > 0
    ? revvCalibrations.map(c => `  • ${c.calibration || c.name || c}`).join('\n')
    : '  (No calibrations in RevvADAS)';

  // HTML email body
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 650px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #c53030 0%, #e53e3e 100%); color: white; padding: 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; }
    .content { padding: 25px; background: #fff; }
    .warning-box { background: #fff5f5; border-left: 4px solid #c53030; padding: 15px; margin: 15px 0; border-radius: 0 4px 4px 0; }
    .warning-box strong { color: #c53030; }
    .details { background: #f7fafc; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .details p { margin: 6px 0; }
    .comparison { display: flex; gap: 20px; margin: 20px 0; }
    .comparison-col { flex: 1; background: #f7fafc; padding: 15px; border-radius: 6px; }
    .comparison-col h4 { margin: 0 0 10px; font-size: 14px; color: #2d3748; }
    .comparison-col ul { margin: 0; padding-left: 20px; font-size: 13px; }
    .operations { background: #edf2f7; border: 1px solid #cbd5e0; padding: 15px; border-radius: 6px; margin: 20px 0; font-size: 13px; }
    .operations h4 { margin: 0 0 10px; color: #4a5568; font-size: 14px; }
    .operations ul { margin: 0; padding-left: 20px; }
    .operations code { background: #e2e8f0; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
    .steps { background: #ebf8ff; border: 1px solid #90cdf4; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .steps h4 { margin: 0 0 10px; color: #2b6cb0; }
    .steps ol { margin: 0; padding-left: 20px; }
    .footer { background: #f7fafc; padding: 15px; text-align: center; font-size: 12px; color: #718096; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ RevvADAS Review Required</h1>
    </div>

    <div class="content">
      <p>Hi,</p>
      <p>I've reviewed the estimate for <strong>RO ${roPo}</strong>, but found a discrepancy that needs your attention before I can send confirmation to the shop.</p>

      <div class="warning-box">
        <strong>DISCREPANCY FOUND:</strong> ${discrepancyReason}
      </div>

      <div class="details">
        <p><strong>Vehicle:</strong> ${vehicle || 'Unknown'}</p>
        <p><strong>VIN:</strong> ${vin || 'Unknown'}</p>
        <p><strong>Shop:</strong> ${shopName || 'Unknown'}</p>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="width: 50%; vertical-align: top; padding-right: 10px;">
            <div style="background: #f7fafc; padding: 15px; border-radius: 6px; height: 100%;">
              <h4 style="margin: 0 0 10px; font-size: 14px; color: #2d3748;">My Analysis Found:</h4>
              <ul style="margin: 0; padding-left: 20px; font-size: 13px;">${estCalsHtml}</ul>
            </div>
          </td>
          <td style="width: 50%; vertical-align: top; padding-left: 10px;">
            <div style="background: #f7fafc; padding: 15px; border-radius: 6px; height: 100%;">
              <h4 style="margin: 0 0 10px; font-size: 14px; color: #2d3748;">RevvADAS Report Shows:</h4>
              <ul style="margin: 0; padding-left: 20px; font-size: 13px;">${revvCalsHtml}</ul>
            </div>
          </td>
        </tr>
      </table>

      <div class="operations">
        <h4>Operations I detected in the estimate:</h4>
        <ul>${operationsListHtml || '<li>No operations detected</li>'}</ul>
      </div>

      <div class="steps">
        <h4>What To Do:</h4>
        <ol>
          <li>Review the estimate operations vs RevvADAS output</li>
          <li>Update RevvADAS if needed (re-run the VIN lookup)</li>
          <li><strong>Reply to this email</strong> with the corrected RevvADAS report attached</li>
          <li>I'll re-verify and send confirmation to the shop automatically</li>
        </ol>
      </div>

      <p>Once you send the updated report, I'll process it right away.</p>

      <p>Thanks,<br><strong>ADAS Assistant</strong></p>
    </div>

    <div class="footer">
      <p>This is an automated message from the ADAS F1RST email processing system.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  // Plain text email body
  const textBody = `
Hi,

I've reviewed the estimate for RO ${roPo}, but found a discrepancy that needs your attention before I can send confirmation to the shop.

════════════════════════════════════════
⚠️ REVVADAS REVIEW REQUIRED
════════════════════════════════════════

Vehicle: ${vehicle || 'Unknown'}
VIN: ${vin || 'Unknown'}
Shop: ${shopName || 'Unknown'}

DISCREPANCY: ${discrepancyReason}

My Analysis Found:
${estCalsText}

RevvADAS Report Shows:
${revvCalsText}

────────────────────────────────────────
Operations I detected in the estimate:
${operationsListText || '  (No operations detected)'}
────────────────────────────────────────

WHAT TO DO:
1. Review the estimate operations vs RevvADAS output
2. Update RevvADAS if needed (re-run the VIN lookup)
3. Reply to this email with the corrected RevvADAS report attached
4. I'll re-verify and send confirmation to the shop automatically

Once you send the updated report, I'll process it right away.

Thanks,
ADAS Assistant
  `.trim();

  // Send email (no attachments on review request)
  const result = await sendEmail({
    to: techEmail,
    subject,
    htmlBody,
    textBody,
    attachments: []
  });

  if (result.success) {
    console.log(`${LOG_TAG} Tech review request sent to ${techEmail} for RO ${roPo}`);
  }

  return result;
}

/**
 * Handle scrub result - automatically route email based on verification status
 * This is the main decision point for the automated workflow
 *
 * @param {Object} scrubResult - Result from estimate scrubbing
 * @param {Object} originalEmail - Original email info { from, messageId, subject }
 * @param {string} roPo - RO/PO number
 * @param {Object} options - Additional options
 * @param {Buffer} options.revvPdfBuffer - RevvADAS PDF buffer for attachment
 * @param {Object} options.sheetWriter - Sheet writer service for updates
 * @returns {Promise<{action: string, success: boolean, recipient?: string, error?: string}>}
 */
export async function handleScrubResult(scrubResult, originalEmail, roPo, options = {}) {
  const { revvPdfBuffer, sheetWriter: sw } = options;

  console.log(`${LOG_TAG} Handling scrub result for RO ${roPo}`);

  // Determine if sources agree (verified)
  const isVerified = determineVerificationStatus(scrubResult);

  console.log(`${LOG_TAG} RO ${roPo} verification status: ${isVerified ? 'VERIFIED' : 'NEEDS_REVIEW'}`);

  if (isVerified) {
    // ✅ SOURCES AGREE - Send confirmation to SHOP
    return await handleVerifiedScrub(scrubResult, roPo, revvPdfBuffer, sw);
  } else {
    // ⚠️ SOURCES DISAGREE - Send review request to TECH
    return await handleUnverifiedScrub(scrubResult, originalEmail, roPo, sw);
  }
}

/**
 * Determine if scrub result is verified (sources agree)
 */
function determineVerificationStatus(scrubResult) {
  // Check various status indicators
  const status = scrubResult.status || scrubResult.reconciliationStatus || '';

  // Explicitly verified statuses
  if (['ALL_SOURCES_AGREE', 'VERIFIED', 'OK', 'ALIGNED'].includes(status)) {
    return true;
  }

  // No calibration needed is also verified
  if (status === 'NO_CALIBRATION_NEEDED') {
    return true;
  }

  // Check if needs review is explicitly false
  if (scrubResult.needsReview === false && scrubResult.needsAttention !== true) {
    // Check counts match
    const estCount = scrubResult.requiredFromEstimate?.length ||
                     scrubResult.estimateCalibrations?.length || 0;
    const revvCount = scrubResult.requiredFromRevv?.length ||
                      scrubResult.revvCalibrations?.length ||
                      scrubResult.actualRevvCount || 0;

    // If both are 0, that's verified (no calibration needed)
    if (estCount === 0 && revvCount === 0) {
      return true;
    }

    // If counts match and no discrepancies, verified
    if (estCount === revvCount && !scrubResult.missingCalibrations?.length) {
      return true;
    }
  }

  // Check for explicit discrepancy indicators
  if (scrubResult.needsAttention === true || scrubResult.needsReview === true) {
    return false;
  }

  // Status indicates discrepancy
  if (['NEEDS_REVIEW', 'DISCREPANCY', 'MISMATCH', 'ERROR'].includes(status)) {
    return false;
  }

  // Default: if there are missing calibrations, not verified
  if (scrubResult.missingCalibrations?.length > 0) {
    return false;
  }

  // Default to verified if no clear discrepancy
  return true;
}

/**
 * Handle verified scrub - send confirmation to shop
 */
async function handleVerifiedScrub(scrubResult, roPo, revvPdfBuffer, sw) {
  const shopName = scrubResult.shopName;

  if (!shopName) {
    console.error(`${LOG_TAG} ❌ RO ${roPo}: No shop name found in scrub result`);
    return {
      action: 'MANUAL_REQUIRED',
      success: false,
      error: 'Shop name not found - manual send required'
    };
  }

  // Look up shop email
  const shopInfo = await lookupShopEmail(shopName);

  if (!shopInfo || !shopInfo.email) {
    console.error(`${LOG_TAG} ❌ RO ${roPo}: No shop email found for "${shopName}"`);

    // Update sheet with error
    if (sw) {
      try {
        await sw.updateScheduleRow(roPo, {
          status: 'Needs Attention',
          notes: `Shop email not found for "${shopName}" - manual send required`
        });
      } catch (err) {
        console.error(`${LOG_TAG} Failed to update sheet:`, err.message);
      }
    }

    return {
      action: 'MANUAL_REQUIRED',
      success: false,
      error: `No email configured for shop: ${shopName}`
    };
  }

  // Build calibrations list from RevvADAS (source of truth)
  const calibrations = [];
  const rawRevvText = scrubResult.rawRevvText || scrubResult.requiredCalibrationsText || '';

  if (rawRevvText) {
    const revvItems = rawRevvText.split(/[;,]/).map(s => s.trim()).filter(s => s.length > 0);
    for (const item of revvItems) {
      const typeMatch = item.match(/\((Static|Dynamic|Reset)\)/i);
      const type = typeMatch ? typeMatch[1] : 'Static';
      const name = item.replace(/\s*\([^)]+\)/g, '').trim();
      calibrations.push({ name, type });
    }
  } else if (scrubResult.requiredFromRevv?.length > 0) {
    for (const cal of scrubResult.requiredFromRevv) {
      calibrations.push({
        name: cal.calibration || cal.name || cal,
        type: cal.type || 'Static'
      });
    }
  }

  console.log(`${LOG_TAG} ✅ RO ${roPo}: Sources agree, sending confirmation to shop ${shopInfo.email}`);

  // Send calibration confirmation to shop
  const result = await sendCalibrationConfirmation({
    shopEmail: shopInfo.email,
    shopName: shopInfo.name,
    roPo,
    vehicle: scrubResult.vehicle || scrubResult.vehicleString || '',
    vin: scrubResult.vin || '',
    calibrations,
    excluded: [],
    revvPdfBuffer,
    ccEmail: shopInfo.billingCC
  });

  // Update sheet with success
  if (result.success && sw) {
    try {
      const timestamp = getESTTimestamp();
      await sw.updateScheduleRow(roPo, {
        status: 'Ready',
        notes: `✅ Confirmation sent to ${shopInfo.email} on ${timestamp}`
      });
    } catch (err) {
      console.error(`${LOG_TAG} Failed to update sheet:`, err.message);
    }
  }

  return {
    action: 'SENT_TO_SHOP',
    success: result.success,
    recipient: shopInfo.email,
    messageId: result.messageId,
    error: result.error
  };
}

/**
 * Handle unverified scrub - send review request to tech
 */
async function handleUnverifiedScrub(scrubResult, originalEmail, roPo, sw) {
  const techEmail = originalEmail?.from;

  if (!techEmail) {
    console.error(`${LOG_TAG} ⚠️ RO ${roPo}: No tech email (original sender) available`);
    return {
      action: 'MANUAL_REQUIRED',
      success: false,
      error: 'Original sender email not available'
    };
  }

  // Build discrepancy reason
  let discrepancyReason = scrubResult.statusMessage || 'Calibration counts do not match';

  const estCount = scrubResult.requiredFromEstimate?.length ||
                   scrubResult.estimateCalibrations?.length || 0;
  const revvCount = scrubResult.requiredFromRevv?.length ||
                    scrubResult.actualRevvCount || 0;

  if (estCount > 0 && revvCount === 0) {
    discrepancyReason = `Estimate suggests ${estCount} calibration(s) but RevvADAS shows none`;
  } else if (estCount === 0 && revvCount > 0) {
    discrepancyReason = `RevvADAS shows ${revvCount} calibration(s) but no matching repair operations found`;
  } else if (estCount !== revvCount) {
    discrepancyReason = `Estimate: ${estCount} calibrations vs RevvADAS: ${revvCount} calibrations`;
  }

  console.log(`${LOG_TAG} ⚠️ RO ${roPo}: Discrepancy found, sending review request to ${techEmail}`);

  // Build calibration lists
  const estimateCalibrations = scrubResult.requiredFromEstimate || [];
  const revvCalibrations = scrubResult.requiredFromRevv || [];
  const operations = scrubResult.foundOperations || [];

  // Send review request to tech
  const result = await sendTechReviewEmail({
    techEmail,
    replyToMessageId: originalEmail?.messageId,
    roPo,
    shopName: scrubResult.shopName || 'Unknown',
    vehicle: scrubResult.vehicle || scrubResult.vehicleString || '',
    vin: scrubResult.vin || '',
    estimateCalibrations,
    revvCalibrations,
    operations,
    discrepancyReason
  });

  // Update sheet with review pending status
  if (result.success && sw) {
    try {
      const timestamp = getESTTimestamp();
      await sw.updateScheduleRow(roPo, {
        status: 'Needs Attention',
        notes: `⚠️ Review request sent to ${techEmail} on ${timestamp} - awaiting corrected RevvADAS`
      });
    } catch (err) {
      console.error(`${LOG_TAG} Failed to update sheet:`, err.message);
    }
  }

  return {
    action: 'SENT_TO_TECH',
    success: result.success,
    recipient: techEmail,
    messageId: result.messageId,
    error: result.error
  };
}

// Legacy alias for backward compatibility
export const sendAutoResponse = sendAutoCalibrationResponse;

export default {
  sendCalibrationConfirmation,
  sendJobCompletionEmail,
  sendAutoCalibrationResponse,
  sendAutoCompletionResponse,
  sendTechReviewEmail,
  handleScrubResult,
  sendAutoResponse,  // Legacy alias
  lookupShopEmail
};
