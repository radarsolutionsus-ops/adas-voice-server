/**
 * billingMailer.js - Automated billing email service for ADAS F1RST
 *
 * Sends billing emails to shops after calibration is completed.
 * Uses Gmail API as radarsolutionsus@gmail.com.
 *
 * Features:
 * - Reads shop email addresses from "Shops" tab in ADAS_FIRST_Operations
 * - Sends professional billing emails with PDF links
 * - Updates billing status after sending
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sheetWriter from './sheetWriter.js';

const LOG_TAG = '[BILLING_MAILER]';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gmail configuration - same as emailListener
const GMAIL_USER = 'radarsolutionsus@gmail.com';

// OAuth credentials paths
const OAUTH_CREDENTIALS_PATH = process.env.GMAIL_OAUTH_CREDENTIALS_PATH ||
  path.join(__dirname, '../google-oauth-client.json');
const OAUTH_TOKEN_PATH = process.env.GMAIL_OAUTH_TOKEN_PATH ||
  path.join(__dirname, '../gmail_oauth_token.json');

// Cache for shop data
let shopCache = new Map();
let shopCacheExpiry = 0;
const SHOP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
 * Get shop information from the Shops tab
 * Caches results for 5 minutes
 *
 * @param {string} shopName - Shop name to look up
 * @returns {Promise<{email: string, cc: string, name: string}|null>}
 */
export async function getShopInfoCached(shopName) {
  console.log(`${LOG_TAG} Looking up shop info for: ${shopName}`);

  // Check cache first
  if (Date.now() < shopCacheExpiry && shopCache.has(shopName.toLowerCase())) {
    console.log(`${LOG_TAG} Using cached shop info for: ${shopName}`);
    return shopCache.get(shopName.toLowerCase());
  }

  try {
    // Fetch shop info directly from the Shops tab
    const shopInfo = await sheetWriter.getShopInfo(shopName);

    if (shopInfo) {
      // Cache the result
      const normalizedName = shopName.toLowerCase().trim();
      const cachedInfo = {
        name: shopInfo.shop_name || shopInfo.name || shopName,
        email: shopInfo.email || shopInfo.billing_email || null,
        cc: shopInfo.billing_cc || shopInfo.cc || null,
        notes: shopInfo.notes || null
      };
      shopCache.set(normalizedName, cachedInfo);
      shopCacheExpiry = Date.now() + SHOP_CACHE_TTL_MS;

      return cachedInfo;
    }

    // Try fetching all shops and doing partial match
    const allShops = await sheetWriter.getAllShops();

    // Rebuild cache
    shopCache.clear();
    if (allShops && Array.isArray(allShops)) {
      for (const shop of allShops) {
        const name = (shop.shop_name || shop.name || '').toLowerCase();
        if (name) {
          shopCache.set(name, {
            name: shop.shop_name || shop.name,
            email: shop.email || null,
            cc: shop.billing_cc || shop.cc || null,
            notes: shop.notes || null
          });
        }
      }
    }
    shopCacheExpiry = Date.now() + SHOP_CACHE_TTL_MS;

    // Look up the requested shop
    const normalizedName = shopName.toLowerCase().trim();

    // Try exact match
    if (shopCache.has(normalizedName)) {
      return shopCache.get(normalizedName);
    }

    // Try partial match
    for (const [key, value] of shopCache.entries()) {
      if (key.includes(normalizedName) || normalizedName.includes(key)) {
        return value;
      }
    }

    console.log(`${LOG_TAG} Shop not found in Shops tab: ${shopName}`);
    return null;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to get shop info:`, err.message);
    return null;
  }
}

/**
 * Build email body HTML for billing email
 *
 * @param {Object} billingData - Billing row data
 * @returns {string} - HTML email body
 */
function buildBillingEmailBody(billingData) {
  const {
    roPo,
    vehicle,
    vin,
    calibrationDescription,
    amount,
    invoiceNumber,
    invoiceDate,
    revvReportLink,
    postScanLink,
    invoiceLink
  } = billingData;

  const formattedAmount = typeof amount === 'number'
    ? `$${amount.toFixed(2)}`
    : amount || 'See invoice';

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background-color: #1a365d; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .details { background-color: #f7fafc; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .details table { width: 100%; border-collapse: collapse; }
    .details td { padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .details td:first-child { font-weight: bold; width: 40%; }
    .links { margin: 20px 0; }
    .links a { display: inline-block; background-color: #2b6cb0; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-right: 10px; margin-bottom: 10px; }
    .links a:hover { background-color: #2c5282; }
    .footer { background-color: #f7fafc; padding: 15px; text-align: center; font-size: 12px; color: #718096; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ADAS F1RST</h1>
    <p>ADAS Calibration Completed</p>
  </div>

  <div class="content">
    <p>Hello,</p>

    <p>The ADAS calibration for the following vehicle has been completed:</p>

    <div class="details">
      <table>
        <tr>
          <td>RO/PO Number:</td>
          <td><strong>${roPo || 'N/A'}</strong></td>
        </tr>
        <tr>
          <td>Vehicle:</td>
          <td>${vehicle || 'N/A'}</td>
        </tr>
        <tr>
          <td>VIN:</td>
          <td>${vin || 'N/A'}</td>
        </tr>
        <tr>
          <td>Calibration Performed:</td>
          <td>${calibrationDescription || 'See attached report'}</td>
        </tr>
        <tr>
          <td>Invoice Number:</td>
          <td>${invoiceNumber || 'N/A'}</td>
        </tr>
        <tr>
          <td>Invoice Date:</td>
          <td>${invoiceDate || 'N/A'}</td>
        </tr>
        <tr>
          <td>Amount:</td>
          <td><strong>${formattedAmount}</strong></td>
        </tr>
      </table>
    </div>

    <p>Please find the documentation below:</p>

    <div class="links">
      ${revvReportLink ? `<a href="${revvReportLink}" target="_blank">📄 RevvADAS Report</a>` : ''}
      ${postScanLink ? `<a href="${postScanLink}" target="_blank">📋 Post-Scan Report</a>` : ''}
      ${invoiceLink ? `<a href="${invoiceLink}" target="_blank">💰 Invoice</a>` : ''}
    </div>

    <p>If you have any questions about this calibration or invoice, please contact us.</p>

    <p>Thank you for your business!</p>

    <p>Best regards,<br>
    <strong>ADAS F1RST Team</strong></p>
  </div>

  <div class="footer">
    <p>ADAS F1RST | Miami, FL | Professional ADAS Calibration Services</p>
    <p>This is an automated billing notification. Please do not reply directly to this email.</p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Build plain text email body (fallback)
 *
 * @param {Object} billingData - Billing row data
 * @returns {string} - Plain text email body
 */
function buildBillingEmailText(billingData) {
  const {
    roPo,
    vehicle,
    vin,
    calibrationDescription,
    amount,
    invoiceNumber,
    invoiceDate,
    revvReportLink,
    postScanLink,
    invoiceLink
  } = billingData;

  const formattedAmount = typeof amount === 'number'
    ? `$${amount.toFixed(2)}`
    : amount || 'See invoice';

  let text = `
ADAS F1RST - ADAS Calibration Completed
=======================================

Hello,

The ADAS calibration for the following vehicle has been completed:

RO/PO Number: ${roPo || 'N/A'}
Vehicle: ${vehicle || 'N/A'}
VIN: ${vin || 'N/A'}
Calibration Performed: ${calibrationDescription || 'See attached report'}
Invoice Number: ${invoiceNumber || 'N/A'}
Invoice Date: ${invoiceDate || 'N/A'}
Amount: ${formattedAmount}

Documentation Links:
`;

  if (revvReportLink) text += `- RevvADAS Report: ${revvReportLink}\n`;
  if (postScanLink) text += `- Post-Scan Report: ${postScanLink}\n`;
  if (invoiceLink) text += `- Invoice: ${invoiceLink}\n`;

  text += `
If you have any questions about this calibration or invoice, please contact us.

Thank you for your business!

Best regards,
ADAS F1RST Team

---
ADAS F1RST | Miami, FL | Professional ADAS Calibration Services
  `.trim();

  return text;
}

/**
 * Send a billing email to a shop
 *
 * @param {Object} billingData - Billing data object
 * @param {string} billingData.shopName - Shop name
 * @param {string} billingData.roPo - RO/PO number
 * @param {string} billingData.vin - VIN
 * @param {string} billingData.vehicle - Vehicle description
 * @param {number|string} billingData.amount - Invoice amount
 * @param {string} billingData.invoiceNumber - Invoice number
 * @param {string} billingData.invoiceDate - Invoice date
 * @param {string} billingData.calibrationDescription - Calibration description
 * @param {string} billingData.revvReportLink - Drive link to RevvADAS report
 * @param {string} billingData.postScanLink - Drive link to post-scan report
 * @param {string} billingData.invoiceLink - Drive link to invoice PDF
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendBillingEmail(billingData) {
  console.log(`${LOG_TAG} Sending billing email for RO: ${billingData.roPo}`);

  try {
    const gmail = await initializeGmailClient();

    // Get shop email info
    const shopInfo = await getShopInfoCached(billingData.shopName);

    if (!shopInfo || !shopInfo.email) {
      console.error(`${LOG_TAG} No email address found for shop: ${billingData.shopName}`);
      return {
        success: false,
        error: `No email address configured for shop: ${billingData.shopName}`
      };
    }

    const toEmail = shopInfo.email;
    const ccEmail = shopInfo.cc;

    console.log(`${LOG_TAG} Sending to: ${toEmail}${ccEmail ? `, CC: ${ccEmail}` : ''}`);

    // Build email content
    const subject = `RO/PO ${billingData.roPo} – ADAS Calibration Completed`;
    const htmlBody = buildBillingEmailBody(billingData);
    const textBody = buildBillingEmailText(billingData);

    // Build MIME message
    const boundary = `boundary_${Date.now()}`;
    let mimeMessage = [
      `From: ADAS F1RST <${GMAIL_USER}>`,
      `To: ${toEmail}`,
      ccEmail ? `Cc: ${ccEmail}` : null,
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
    ].filter(line => line !== null).join('\r\n');

    // Encode as base64url
    const encodedMessage = Buffer.from(mimeMessage)
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
      sentTo: toEmail,
      cc: ccEmail
    };
  } catch (err) {
    console.error(`${LOG_TAG} Failed to send billing email:`, err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Check if billing email should be sent and send if appropriate
 * Called after invoice is processed and billing row is created
 *
 * @param {string} roPo - RO/PO number
 * @returns {Promise<{sent: boolean, result?: Object}>}
 */
export async function maybeSendAutoBilling(roPo) {
  console.log(`${LOG_TAG} Checking auto-billing for RO: ${roPo}`);

  try {
    // Get billing rows for this RO
    const billingRows = await sheetWriter.getBillingRowsByRO(roPo);

    if (!billingRows || billingRows.length === 0) {
      console.log(`${LOG_TAG} No billing row found for RO: ${roPo}`);
      return { sent: false, reason: 'No billing row found' };
    }

    // Find the most recent billing row that's ready to bill
    const readyRow = billingRows.find(row => {
      const status = (row.payment_status || row.status || '').toLowerCase();
      return status === 'pending' || status === 'ready to bill';
    });

    if (!readyRow) {
      console.log(`${LOG_TAG} No billing row ready to bill for RO: ${roPo}`);
      return { sent: false, reason: 'No row with Ready to Bill status' };
    }

    // Get schedule row for additional info (PDF links)
    const scheduleRow = await sheetWriter.getScheduleRowByRO(roPo);

    // Build billing data object (using new column names from spec)
    const billingData = {
      shopName: readyRow.shop_name || readyRow.shopName || scheduleRow?.shop_name || scheduleRow?.shopName,
      roPo: roPo,
      vin: readyRow.vin || scheduleRow?.vin,
      vehicle: readyRow.vehicle || scheduleRow?.vehicle,
      amount: readyRow.amount || readyRow.invoice_amount,
      invoiceNumber: readyRow.invoice_number || readyRow.invoiceNumber,
      invoiceDate: readyRow.invoice_date || readyRow.invoiceDate,
      calibrationDescription: readyRow.calibration_description || readyRow.calibrationDescription,
      // New column names: revv_report_pdf, post_scan_pdf, invoice_pdf
      revvReportLink: scheduleRow?.revv_report_pdf || scheduleRow?.revvReportPdf,
      postScanLink: scheduleRow?.post_scan_pdf || scheduleRow?.postScanPdf,
      invoiceLink: readyRow.invoice_pdf || readyRow.invoicePdf || scheduleRow?.invoice_pdf
    };

    // Validate we have required data
    if (!billingData.shopName) {
      console.log(`${LOG_TAG} No shop name found for billing`);
      return { sent: false, reason: 'No shop name' };
    }

    // Send the billing email
    const result = await sendBillingEmail(billingData);

    if (result.success) {
      // Update billing status to "Billed"
      await sheetWriter.updateBillingStatus(billingData.invoiceNumber, 'Billed');
      console.log(`${LOG_TAG} Updated billing status to Billed for invoice: ${billingData.invoiceNumber}`);

      return {
        sent: true,
        result: {
          messageId: result.messageId,
          sentTo: result.sentTo,
          invoiceNumber: billingData.invoiceNumber
        }
      };
    }

    return {
      sent: false,
      reason: result.error
    };
  } catch (err) {
    console.error(`${LOG_TAG} Auto-billing failed:`, err.message);
    return {
      sent: false,
      reason: err.message
    };
  }
}

/**
 * Manually trigger billing email for an RO
 * Can be called from API endpoint
 *
 * @param {string} roPo - RO/PO number
 * @param {boolean} force - Send even if already billed
 * @returns {Promise<Object>}
 */
export async function triggerBillingEmail(roPo, force = false) {
  console.log(`${LOG_TAG} Manual billing trigger for RO: ${roPo} (force: ${force})`);

  if (force) {
    // Get data and send regardless of status
    const billingRows = await sheetWriter.getBillingRowsByRO(roPo);
    const scheduleRow = await sheetWriter.getScheduleRowByRO(roPo);

    if (!billingRows || billingRows.length === 0) {
      return { success: false, error: 'No billing row found' };
    }

    const row = billingRows[0];
    const billingData = {
      shopName: row.shop_name || scheduleRow?.shop_name,
      roPo: roPo,
      vin: row.vin || scheduleRow?.vin,
      vehicle: row.vehicle || scheduleRow?.vehicle,
      amount: row.amount,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      calibrationDescription: row.calibration_description,
      // New column names
      revvReportLink: scheduleRow?.revv_report_pdf,
      postScanLink: scheduleRow?.post_scan_pdf,
      invoiceLink: row.invoice_pdf || scheduleRow?.invoice_pdf
    };

    return sendBillingEmail(billingData);
  }

  return maybeSendAutoBilling(roPo);
}

export default {
  sendBillingEmail,
  maybeSendAutoBilling,
  triggerBillingEmail,
  getShopInfo: getShopInfoCached
};
