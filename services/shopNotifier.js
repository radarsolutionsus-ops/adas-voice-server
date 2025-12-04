/**
 * shopNotifier.js - Shop email notification service for ADAS F1RST
 *
 * Sends notifications to SHOPS (not technicians) at two key stages:
 * 1. Initial notice: When estimate/Revv info comes in (calibration required or not)
 * 2. Final notice: When job is fully completed (all final docs attached)
 *
 * CRITICAL RULES:
 * - ALWAYS send to shop email from "Shops" tab (Column B), NOT technician email
 * - ALWAYS instruct shop to call ADAS F1RST Ops assistant to schedule/confirm
 * - NEVER reply to the sender email (technician)
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sheetWriter from './sheetWriter.js';
import jobState from '../data/jobState.js';

const LOG_TAG = '[SHOP_EMAIL]';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gmail configuration - same as billingMailer
const GMAIL_USER = 'radarsolutionsus@gmail.com';

// OAuth credentials paths
const OAUTH_CREDENTIALS_PATH = process.env.GMAIL_OAUTH_CREDENTIALS_PATH ||
  path.join(__dirname, '../credentials/google-oauth-client.json');
const OAUTH_TOKEN_PATH = process.env.GMAIL_OAUTH_TOKEN_PATH ||
  path.join(__dirname, '../credentials/gmail_oauth_token.json');

// ADAS F1RST Ops phone line (update this if different)
const OPS_PHONE_LINE = process.env.ADAS_OPS_PHONE || '(786) 456-7890';

let gmailClient = null;

/**
 * Initialize Gmail client for sending emails
 */
async function initializeGmailClient() {
  if (gmailClient) return gmailClient;

  try {
    if (!fs.existsSync(OAUTH_CREDENTIALS_PATH)) {
      throw new Error(`OAuth credentials not found at ${OAUTH_CREDENTIALS_PATH}`);
    }

    if (!fs.existsSync(OAUTH_TOKEN_PATH)) {
      throw new Error(`OAuth token not found at ${OAUTH_TOKEN_PATH}. Run: node scripts/gmail-auth.js`);
    }

    const credentials = JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_PATH, 'utf8'));
    const { client_id, client_secret } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      'urn:ietf:wg:oauth:2.0:oob'
    );

    const token = JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(token);

    // Check if token needs refresh
    if (token.expiry_date && token.expiry_date < Date.now()) {
      console.log(`${LOG_TAG} Token expired, refreshing...`);
      const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newCredentials);
      fs.writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(newCredentials, null, 2));
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
 * CRITICAL: Always use this, never use technician/sender email
 * @param {string} shopName - Shop name
 * @returns {Promise<{email: string, cc: string, name: string}|null>}
 */
async function getShopEmail(shopName) {
  if (!shopName) {
    console.warn(`${LOG_TAG} No shop name provided for email lookup`);
    return null;
  }

  try {
    const shopInfo = await sheetWriter.getShopInfo(shopName);

    if (shopInfo && shopInfo.email) {
      return {
        name: shopInfo.shopName || shopInfo.shop_name || shopName,
        email: shopInfo.email,
        cc: shopInfo.billingCc || shopInfo.billing_cc || null
      };
    }

    console.warn(`${LOG_TAG} No email found in Shops tab for: ${shopName}`);
    return null;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to get shop email:`, err.message);
    return null;
  }
}

/**
 * Send an email with attachments
 * @param {Object} params - Email parameters
 * @param {string} params.to - Recipient email
 * @param {string} params.cc - CC email (optional)
 * @param {string} params.subject - Email subject
 * @param {string} params.htmlBody - HTML email body
 * @param {string} params.textBody - Plain text email body
 * @param {Array} params.attachments - Array of { filename, content, mimeType } (optional)
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
        `From: ADAS F1RST <${GMAIL_USER}>`,
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
        mimeMessage.push('');
        mimeMessage.push(`--${mixedBoundary}`);
        mimeMessage.push(`Content-Type: ${att.mimeType || 'application/pdf'}; name="${att.filename}"`);
        mimeMessage.push('Content-Transfer-Encoding: base64');
        mimeMessage.push(`Content-Disposition: attachment; filename="${att.filename}"`);
        mimeMessage.push('');
        mimeMessage.push(att.content.toString('base64'));
      }

      mimeMessage.push('');
      mimeMessage.push(`--${mixedBoundary}--`);
    } else {
      // Simple multipart/alternative without attachments
      mimeMessage = [
        `From: ADAS F1RST <${GMAIL_USER}>`,
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
      sentTo: to,
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
 * Send initial notice email - Calibration Required
 * @param {Object} params
 * @param {string} params.roPo - RO/PO number
 * @param {string} params.shopName - Shop name
 * @param {string} params.vehicle - Vehicle description
 * @param {string} params.vin - VIN
 * @param {string} params.revvReportLink - Drive link to RevvADAS report (optional)
 * @param {Buffer} params.revvReportPdf - RevvADAS PDF buffer for attachment (optional)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendCalibrationRequiredNotice({
  roPo,
  shopName,
  vehicle,
  vin,
  revvReportLink,
  revvReportPdf
}) {
  console.log(`${LOG_TAG} Sending Calibration Required notice for RO ${roPo} to ${shopName}`);

  // Look up shop email - CRITICAL: Never use technician email
  const shopEmail = await getShopEmail(shopName);

  if (!shopEmail || !shopEmail.email) {
    console.warn(`${LOG_TAG} Cannot send notice - no email found for shop: ${shopName}`);
    return { success: false, error: `No email configured for shop: ${shopName}` };
  }

  const subject = `RO ${roPo} – ADAS Calibration Required`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background-color: #1a365d; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .details { background-color: #f7fafc; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .alert { background-color: #fed7d7; border-left: 4px solid #c53030; padding: 15px; margin: 15px 0; }
    .action { background-color: #c6f6d5; border-left: 4px solid #38a169; padding: 15px; margin: 15px 0; }
    .footer { background-color: #f7fafc; padding: 15px; text-align: center; font-size: 12px; color: #718096; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ADAS F1RST</h1>
    <p>ADAS Calibration Notice</p>
  </div>

  <div class="content">
    <p>Hello ${shopEmail.name},</p>

    <div class="alert">
      <strong>ADAS Calibration Required</strong>
    </div>

    <p>Based on our analysis of the repair estimate, the following vehicle <strong>requires ADAS calibration</strong>:</p>

    <div class="details">
      <p><strong>RO/PO Number:</strong> ${roPo}</p>
      <p><strong>Vehicle:</strong> ${vehicle || 'See attached report'}</p>
      <p><strong>VIN:</strong> ${vin || 'See attached report'}</p>
    </div>

    ${revvReportLink ? `<p>The RevvADAS calibration report is attached to this email and also available at: <a href="${revvReportLink}">View Report</a></p>` : '<p>The RevvADAS calibration report is attached to this email.</p>'}

    <div class="action">
      <strong>Next Step:</strong> To schedule or confirm this calibration, please call the ADAS F1RST Ops assistant line at <strong>${OPS_PHONE_LINE}</strong>.
    </div>

    <p>Our technicians are ready to perform the required calibrations once the vehicle is prepared according to the report.</p>

    <p>Thank you for choosing ADAS F1RST!</p>

    <p>Best regards,<br>
    <strong>ADAS F1RST Team</strong></p>
  </div>

  <div class="footer">
    <p>ADAS F1RST | Miami, FL | Professional ADAS Calibration Services</p>
    <p>Questions? Call us at ${OPS_PHONE_LINE}</p>
  </div>
</body>
</html>
  `.trim();

  const textBody = `
ADAS F1RST - ADAS Calibration Notice
=====================================

Hello ${shopEmail.name},

ADAS CALIBRATION REQUIRED

Based on our analysis of the repair estimate, the following vehicle requires ADAS calibration:

RO/PO Number: ${roPo}
Vehicle: ${vehicle || 'See attached report'}
VIN: ${vin || 'See attached report'}

${revvReportLink ? `The RevvADAS calibration report is attached and available at: ${revvReportLink}` : 'The RevvADAS calibration report is attached to this email.'}

NEXT STEP: To schedule or confirm this calibration, please call the ADAS F1RST Ops assistant line at ${OPS_PHONE_LINE}.

Our technicians are ready to perform the required calibrations once the vehicle is prepared according to the report.

Thank you for choosing ADAS F1RST!

Best regards,
ADAS F1RST Team

---
ADAS F1RST | Miami, FL | Professional ADAS Calibration Services
Questions? Call us at ${OPS_PHONE_LINE}
  `.trim();

  // Prepare attachments
  const attachments = [];
  if (revvReportPdf) {
    attachments.push({
      filename: `RevvADAS_Report_${roPo}.pdf`,
      content: revvReportPdf,
      mimeType: 'application/pdf'
    });
  }

  const result = await sendEmail({
    to: shopEmail.email,
    cc: shopEmail.cc,
    subject,
    htmlBody,
    textBody,
    attachments
  });

  if (result.success) {
    console.log(`${LOG_TAG} Initial notice sent for RO ${roPo} (Calibration Required) → ${shopEmail.name}`);
    jobState.markInitialNoticeSent(roPo);
  }

  return result;
}

/**
 * Send initial notice email - No Calibration Required
 * @param {Object} params
 * @param {string} params.roPo - RO/PO number
 * @param {string} params.shopName - Shop name
 * @param {string} params.vehicle - Vehicle description
 * @param {string} params.vin - VIN
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendNoCalibrationRequiredNotice({
  roPo,
  shopName,
  vehicle,
  vin
}) {
  console.log(`${LOG_TAG} Sending No Calibration Required notice for RO ${roPo} to ${shopName}`);

  // Look up shop email - CRITICAL: Never use technician email
  const shopEmail = await getShopEmail(shopName);

  if (!shopEmail || !shopEmail.email) {
    console.warn(`${LOG_TAG} Cannot send notice - no email found for shop: ${shopName}`);
    return { success: false, error: `No email configured for shop: ${shopName}` };
  }

  const subject = `RO ${roPo} – No ADAS Calibration Required`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background-color: #1a365d; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .details { background-color: #f7fafc; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .info { background-color: #bee3f8; border-left: 4px solid #3182ce; padding: 15px; margin: 15px 0; }
    .action { background-color: #fefcbf; border-left: 4px solid #d69e2e; padding: 15px; margin: 15px 0; }
    .footer { background-color: #f7fafc; padding: 15px; text-align: center; font-size: 12px; color: #718096; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ADAS F1RST</h1>
    <p>ADAS Assessment Complete</p>
  </div>

  <div class="content">
    <p>Hello ${shopEmail.name},</p>

    <div class="info">
      <strong>No ADAS Calibration Required</strong>
    </div>

    <p>Based on our analysis of the repair estimate, the following vehicle <strong>does not require ADAS calibration</strong> for the repairs described:</p>

    <div class="details">
      <p><strong>RO/PO Number:</strong> ${roPo}</p>
      <p><strong>Vehicle:</strong> ${vehicle || 'N/A'}</p>
      <p><strong>VIN:</strong> ${vin || 'N/A'}</p>
    </div>

    <div class="action">
      <strong>Note:</strong> If you believe this is incorrect, or if there are additional repairs not reflected in the estimate that may require ADAS calibration, please call the ADAS F1RST Ops assistant line at <strong>${OPS_PHONE_LINE}</strong> for clarification.
    </div>

    <p>Thank you for choosing ADAS F1RST!</p>

    <p>Best regards,<br>
    <strong>ADAS F1RST Team</strong></p>
  </div>

  <div class="footer">
    <p>ADAS F1RST | Miami, FL | Professional ADAS Calibration Services</p>
    <p>Questions? Call us at ${OPS_PHONE_LINE}</p>
  </div>
</body>
</html>
  `.trim();

  const textBody = `
ADAS F1RST - ADAS Assessment Complete
======================================

Hello ${shopEmail.name},

NO ADAS CALIBRATION REQUIRED

Based on our analysis of the repair estimate, the following vehicle does not require ADAS calibration for the repairs described:

RO/PO Number: ${roPo}
Vehicle: ${vehicle || 'N/A'}
VIN: ${vin || 'N/A'}

NOTE: If you believe this is incorrect, or if there are additional repairs not reflected in the estimate that may require ADAS calibration, please call the ADAS F1RST Ops assistant line at ${OPS_PHONE_LINE} for clarification.

Thank you for choosing ADAS F1RST!

Best regards,
ADAS F1RST Team

---
ADAS F1RST | Miami, FL | Professional ADAS Calibration Services
Questions? Call us at ${OPS_PHONE_LINE}
  `.trim();

  const result = await sendEmail({
    to: shopEmail.email,
    cc: shopEmail.cc,
    subject,
    htmlBody,
    textBody
  });

  if (result.success) {
    console.log(`${LOG_TAG} Initial notice sent for RO ${roPo} (No Calibration Required) → ${shopEmail.name}`);
    jobState.markInitialNoticeSent(roPo);
  }

  return result;
}

/**
 * Send final completion email with all documents
 * @param {Object} params
 * @param {string} params.roPo - RO/PO number
 * @param {string} params.shopName - Shop name
 * @param {string} params.vehicle - Vehicle description
 * @param {string} params.vin - VIN
 * @param {string} params.calibrationsPerformed - Description of calibrations performed
 * @param {string} params.postScanLink - Drive link to post-scan PDF
 * @param {string} params.revvReportLink - Drive link to RevvADAS report
 * @param {string} params.invoiceLink - Drive link to invoice PDF
 * @param {Buffer} params.postScanPdf - Post-scan PDF buffer (optional)
 * @param {Buffer} params.revvReportPdf - RevvADAS PDF buffer (optional)
 * @param {Buffer} params.invoicePdf - Invoice PDF buffer (optional)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendCompletionNotice({
  roPo,
  shopName,
  vehicle,
  vin,
  calibrationsPerformed,
  postScanLink,
  revvReportLink,
  invoiceLink,
  postScanPdf,
  revvReportPdf,
  invoicePdf
}) {
  console.log(`${LOG_TAG} Sending Completion notice for RO ${roPo} to ${shopName}`);

  // Look up shop email - CRITICAL: Never use technician email
  const shopEmail = await getShopEmail(shopName);

  if (!shopEmail || !shopEmail.email) {
    console.warn(`${LOG_TAG} Cannot send notice - no email found for shop: ${shopName}`);
    return { success: false, error: `No email configured for shop: ${shopName}` };
  }

  const subject = `RO ${roPo} – ADAS Calibration Completed (Documents Attached)`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background-color: #1a365d; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .details { background-color: #f7fafc; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .success { background-color: #c6f6d5; border-left: 4px solid #38a169; padding: 15px; margin: 15px 0; }
    .docs { background-color: #e2e8f0; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .docs a { display: inline-block; background-color: #2b6cb0; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; margin: 5px 5px 5px 0; }
    .action { background-color: #fefcbf; border-left: 4px solid #d69e2e; padding: 15px; margin: 15px 0; }
    .footer { background-color: #f7fafc; padding: 15px; text-align: center; font-size: 12px; color: #718096; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ADAS F1RST</h1>
    <p>ADAS Calibration Completed</p>
  </div>

  <div class="content">
    <p>Hello ${shopEmail.name},</p>

    <div class="success">
      <strong>ADAS Calibration Completed Successfully</strong>
    </div>

    <p>The ADAS calibrations for the following vehicle have been performed and completed:</p>

    <div class="details">
      <p><strong>RO/PO Number:</strong> ${roPo}</p>
      <p><strong>Vehicle:</strong> ${vehicle || 'See attached reports'}</p>
      <p><strong>VIN:</strong> ${vin || 'See attached reports'}</p>
      ${calibrationsPerformed ? `<p><strong>Calibrations Performed:</strong> ${calibrationsPerformed}</p>` : ''}
    </div>

    <p>All documentation is attached to this email and available via the links below:</p>

    <div class="docs">
      <strong>Attached Documents:</strong><br>
      ${postScanLink ? `<a href="${postScanLink}">Post-Scan Report</a>` : ''}
      ${revvReportLink ? `<a href="${revvReportLink}">RevvADAS Report</a>` : ''}
      ${invoiceLink ? `<a href="${invoiceLink}">Invoice</a>` : ''}
    </div>

    <div class="action">
      <strong>Questions?</strong> If you need to reschedule, add additional calibrations, or have any questions, please call the ADAS F1RST Ops assistant line at <strong>${OPS_PHONE_LINE}</strong>.
    </div>

    <p>Thank you for your business!</p>

    <p>Best regards,<br>
    <strong>ADAS F1RST Team</strong></p>
  </div>

  <div class="footer">
    <p>ADAS F1RST | Miami, FL | Professional ADAS Calibration Services</p>
    <p>Questions? Call us at ${OPS_PHONE_LINE}</p>
  </div>
</body>
</html>
  `.trim();

  const textBody = `
ADAS F1RST - ADAS Calibration Completed
========================================

Hello ${shopEmail.name},

ADAS CALIBRATION COMPLETED SUCCESSFULLY

The ADAS calibrations for the following vehicle have been performed and completed:

RO/PO Number: ${roPo}
Vehicle: ${vehicle || 'See attached reports'}
VIN: ${vin || 'See attached reports'}
${calibrationsPerformed ? `Calibrations Performed: ${calibrationsPerformed}` : ''}

All documentation is attached to this email and available at:
${postScanLink ? `- Post-Scan Report: ${postScanLink}` : ''}
${revvReportLink ? `- RevvADAS Report: ${revvReportLink}` : ''}
${invoiceLink ? `- Invoice: ${invoiceLink}` : ''}

QUESTIONS? If you need to reschedule, add additional calibrations, or have any questions, please call the ADAS F1RST Ops assistant line at ${OPS_PHONE_LINE}.

Thank you for your business!

Best regards,
ADAS F1RST Team

---
ADAS F1RST | Miami, FL | Professional ADAS Calibration Services
Questions? Call us at ${OPS_PHONE_LINE}
  `.trim();

  // Prepare attachments
  const attachments = [];
  if (postScanPdf) {
    attachments.push({
      filename: `PostScan_${roPo}.pdf`,
      content: postScanPdf,
      mimeType: 'application/pdf'
    });
  }
  if (revvReportPdf) {
    attachments.push({
      filename: `RevvADAS_Report_${roPo}.pdf`,
      content: revvReportPdf,
      mimeType: 'application/pdf'
    });
  }
  if (invoicePdf) {
    attachments.push({
      filename: `Invoice_${roPo}.pdf`,
      content: invoicePdf,
      mimeType: 'application/pdf'
    });
  }

  const result = await sendEmail({
    to: shopEmail.email,
    cc: shopEmail.cc,
    subject,
    htmlBody,
    textBody,
    attachments
  });

  if (result.success) {
    console.log(`${LOG_TAG} Final completion email sent for RO ${roPo} (post_scan + revv_report + invoice)`);
    jobState.markFinalNoticeSent(roPo);
  }

  return result;
}

/**
 * Check and send initial notice if conditions are met
 * Called after processing an email with estimate/revv data
 * @param {Object} params
 * @param {string} params.roPo - RO/PO number
 * @param {string} params.shopName - Shop name
 * @param {string} params.vehicle - Vehicle description
 * @param {string} params.vin - VIN
 * @param {boolean} params.needsCalibration - Whether calibration is required
 * @param {string} params.revvReportLink - Drive link to RevvADAS report (optional)
 * @param {Buffer} params.revvReportPdf - RevvADAS PDF buffer (optional)
 * @returns {Promise<{sent: boolean, type?: string, error?: string}>}
 */
export async function maybeSendInitialNotice({
  roPo,
  shopName,
  vehicle,
  vin,
  needsCalibration,
  revvReportLink,
  revvReportPdf
}) {
  // Check if we should send
  if (!jobState.shouldSendInitialNotice(roPo)) {
    console.log(`${LOG_TAG} Initial notice already sent for RO ${roPo}, skipping`);
    return { sent: false, reason: 'Already sent' };
  }

  // Update state with calibration requirement
  jobState.setNeedsCalibration(roPo, needsCalibration);

  if (needsCalibration) {
    const result = await sendCalibrationRequiredNotice({
      roPo,
      shopName,
      vehicle,
      vin,
      revvReportLink,
      revvReportPdf
    });
    return { sent: result.success, type: 'calibration_required', error: result.error };
  } else {
    const result = await sendNoCalibrationRequiredNotice({
      roPo,
      shopName,
      vehicle,
      vin
    });
    return { sent: result.success, type: 'no_calibration_required', error: result.error };
  }
}

/**
 * Check and send final completion notice if all docs are present
 * Called after processing an email that may complete the document set
 * @param {Object} params
 * @param {string} params.roPo - RO/PO number
 * @param {string} params.shopName - Shop name
 * @param {string} params.vehicle - Vehicle description
 * @param {string} params.vin - VIN
 * @param {string} params.calibrationsPerformed - Description of calibrations
 * @param {string} params.postScanLink - Drive link to post-scan
 * @param {string} params.revvReportLink - Drive link to RevvADAS report
 * @param {string} params.invoiceLink - Drive link to invoice
 * @param {Buffer} params.postScanPdf - Post-scan PDF buffer (optional)
 * @param {Buffer} params.revvReportPdf - RevvADAS PDF buffer (optional)
 * @param {Buffer} params.invoicePdf - Invoice PDF buffer (optional)
 * @returns {Promise<{sent: boolean, error?: string}>}
 */
export async function maybeSendFinalNotice({
  roPo,
  shopName,
  vehicle,
  vin,
  calibrationsPerformed,
  postScanLink,
  revvReportLink,
  invoiceLink,
  postScanPdf,
  revvReportPdf,
  invoicePdf
}) {
  // Check if we should send
  if (!jobState.shouldSendFinalNotice(roPo)) {
    console.log(`${LOG_TAG} Final notice conditions not met for RO ${roPo}, skipping`);
    return { sent: false, reason: 'Conditions not met or already sent' };
  }

  const result = await sendCompletionNotice({
    roPo,
    shopName,
    vehicle,
    vin,
    calibrationsPerformed,
    postScanLink,
    revvReportLink,
    invoiceLink,
    postScanPdf,
    revvReportPdf,
    invoicePdf
  });

  return { sent: result.success, error: result.error };
}

/**
 * Auto-close job after all final documents are received
 * Updates status to Completed and sends final notification
 * @param {string} roPo - RO/PO number
 * @returns {Promise<{closed: boolean, notificationSent: boolean, error?: string}>}
 */
export async function autoCloseJob(roPo) {
  console.log(`${LOG_TAG} Attempting auto-close for RO ${roPo}`);

  // Check if all final docs are present
  const docStatus = jobState.getDocumentStatus(roPo);

  if (!docStatus.allFinalDocsPresent) {
    console.log(`${LOG_TAG} Cannot auto-close RO ${roPo} - missing documents`);
    return { closed: false, notificationSent: false, reason: 'Missing documents' };
  }

  // Get schedule row for full info
  const scheduleRow = await sheetWriter.getScheduleRowByRO(roPo);

  if (!scheduleRow) {
    console.log(`${LOG_TAG} Cannot auto-close RO ${roPo} - row not found`);
    return { closed: false, notificationSent: false, reason: 'Row not found' };
  }

  // Update status to Completed
  const timestamp = new Date().toISOString();
  const closeNote = `Auto-closed on ${timestamp} after all final documents received.`;

  const updateResult = await sheetWriter.updateScheduleRow(roPo, {
    status: 'Completed',
    notes: scheduleRow.notes ? `${scheduleRow.notes} | ${closeNote}` : closeNote
  });

  if (!updateResult.success) {
    console.error(`${LOG_TAG} Failed to update status for auto-close: ${updateResult.error}`);
    return { closed: false, notificationSent: false, error: updateResult.error };
  }

  console.log(`${LOG_TAG} Auto-closed RO ${roPo} (Completed)`);

  // Send final notification
  const notifyResult = await maybeSendFinalNotice({
    roPo,
    shopName: scheduleRow.shop_name || scheduleRow.shopName,
    vehicle: scheduleRow.vehicle,
    vin: scheduleRow.vin,
    calibrationsPerformed: scheduleRow.completed_calibrations || scheduleRow.completedCalibrations,
    postScanLink: scheduleRow.post_scan_pdf || scheduleRow.postScanPdf,
    revvReportLink: scheduleRow.revv_report_pdf || scheduleRow.revvReportPdf,
    invoiceLink: scheduleRow.invoice_pdf || scheduleRow.invoicePdf
  });

  return {
    closed: true,
    notificationSent: notifyResult.sent,
    error: notifyResult.error
  };
}

export default {
  sendCalibrationRequiredNotice,
  sendNoCalibrationRequiredNotice,
  sendCompletionNotice,
  maybeSendInitialNotice,
  maybeSendFinalNotice,
  autoCloseJob,
  getShopEmail
};
