/**
 * sheetWriter.js - Google Sheets integration for ADAS_Schedule and Billing sheets
 *
 * Handles all read/write operations to Google Sheets.
 * - WRITE operations: via Google Apps Script webhook (log_ro, tech_update, lookup_ro, append_tech_note)
 * - READ operations: via direct Google Sheets API (for search, shop lookup, billing, etc.)
 *
 * Sheets file: ADAS_FIRST_Operations
 *
 * ADAS_Schedule columns (A-S):
 * A: Timestamp Created
 * B: Shop Name
 * C: RO/PO
 * D: VIN
 * E: Vehicle (Year Make Model combined)
 * F: Status (New, Ready, In Progress, Completed, Blocked)
 * G: Scheduled Date (YYYY-MM-DD)
 * H: Scheduled Time (HH:MM or time range like "9:00 AM - 10:00 AM")
 * I: Technician Assigned
 * J: Required Calibrations
 * K: Completed Calibrations
 * L: DTCs (combined pre-scan and post-scan)
 * M: Revv Report PDF (Drive link)
 * N: Post Scan PDF (Drive link)
 * O: Invoice PDF (Drive link)
 * P: Invoice Number
 * Q: Invoice Amount
 * R: Invoice Date
 * S: Notes
 *
 * Billing columns (A-L):
 * A: Timestamp Created
 * B: Shop Name
 * C: RO/PO
 * D: VIN
 * E: Vehicle
 * F: Calibration Description
 * G: Amount
 * H: Invoice Number
 * I: Invoice Date
 * J: Invoice PDF (Drive link)
 * K: Status (Ready to Bill, Billed, Paid)
 * L: Notes
 *
 * Shops columns (A-D):
 * A: Shop Name
 * B: Email
 * C: Billing CC
 * D: Notes
 */

import axios from 'axios';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_TAG = '[SHEETS]';

// Get environment variables
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
const GAS_TOKEN = process.env.GAS_TOKEN;
const SPREADSHEET_ID = process.env.SHEETS_SPREADSHEET_ID;

// OAuth credentials paths
const OAUTH_CREDENTIALS_PATH = process.env.GMAIL_OAUTH_CREDENTIALS_PATH ||
  path.join(__dirname, '../credentials/google-oauth-client.json');
const OAUTH_TOKEN_PATH = process.env.GMAIL_OAUTH_TOKEN_PATH ||
  path.join(__dirname, '../credentials/gmail_oauth_token.json');

// Debug log to verify env vars are loaded
if (!GAS_WEBHOOK_URL) {
  console.warn(`${LOG_TAG} WARNING: GAS_WEBHOOK_URL not configured at module load`);
} else {
  console.log(`${LOG_TAG} GAS webhook configured: ${GAS_WEBHOOK_URL.substring(0, 50)}...`);
}

if (!SPREADSHEET_ID) {
  console.warn(`${LOG_TAG} WARNING: SHEETS_SPREADSHEET_ID not configured - direct read operations will fail`);
}

// Sheet names from environment
const SCHEDULE_SHEET_NAME = process.env.SCHEDULE_SHEET_ID || 'ADAS_Schedule';
const BILLING_SHEET_NAME = process.env.BILLING_SHEET_ID || 'Billing';
const SHOPS_SHEET_NAME = process.env.SHOPS_SHEET_ID || 'Shops';

// Column mappings for ADAS_Schedule (A-T)
const SCHEDULE_COLUMNS = {
  TIMESTAMP_CREATED: 0,    // A
  SHOP_NAME: 1,            // B
  RO_PO: 2,                // C
  VIN: 3,                  // D
  VEHICLE: 4,              // E
  STATUS: 5,               // F
  SCHEDULED_DATE: 6,       // G
  SCHEDULED_TIME: 7,       // H
  TECHNICIAN_ASSIGNED: 8,  // I
  REQUIRED_CALIBRATIONS: 9, // J
  COMPLETED_CALIBRATIONS: 10, // K
  DTCS: 11,                // L
  REVV_REPORT_PDF: 12,     // M
  POST_SCAN_PDF: 13,       // N
  INVOICE_PDF: 14,         // O
  INVOICE_NUMBER: 15,      // P
  INVOICE_AMOUNT: 16,      // Q
  INVOICE_DATE: 17,        // R
  NOTES: 18,               // S - Short summary notes (2-3 lines max)
  FULL_SCRUB_TEXT: 19      // T - Hidden column for full scrub text (sidebar)
};

// Column mappings for Billing (A-L)
const BILLING_COLUMNS = {
  TIMESTAMP_CREATED: 0,    // A
  SHOP_NAME: 1,            // B
  RO_PO: 2,                // C
  VIN: 3,                  // D
  VEHICLE: 4,              // E
  CALIBRATION_DESCRIPTION: 5, // F
  AMOUNT: 6,               // G
  INVOICE_NUMBER: 7,       // H
  INVOICE_DATE: 8,         // I
  INVOICE_PDF: 9,          // J
  STATUS: 10,              // K
  NOTES: 11                // L
};

// Column mappings for Shops (A-D)
const SHOPS_COLUMNS = {
  SHOP_NAME: 0,            // A
  EMAIL: 1,                // B
  BILLING_CC: 2,           // C
  NOTES: 3                 // D
};

// Google Sheets API client (initialized lazily)
let sheetsClient = null;

/**
 * Initialize the Google Sheets API client using OAuth2 (same credentials as Gmail/Drive)
 */
async function initializeSheetsClient() {
  if (sheetsClient) return sheetsClient;

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

    sheetsClient = google.sheets({ version: 'v4', auth: oauth2Client });
    console.log(`${LOG_TAG} Google Sheets API client initialized`);
    return sheetsClient;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to initialize Sheets client:`, err.message);
    throw err;
  }
}

/**
 * Read all rows from a sheet
 * @param {string} sheetName - Name of the sheet to read
 * @param {string} range - Optional range (e.g., 'A:S'), defaults to all columns
 * @returns {Promise<Array<Array<string>>>} - 2D array of row data
 */
async function readSheetData(sheetName, range = '') {
  try {
    const sheets = await initializeSheetsClient();
    const fullRange = range ? `${sheetName}!${range}` : sheetName;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: fullRange
    });

    return response.data.values || [];
  } catch (err) {
    console.error(`${LOG_TAG} Failed to read sheet ${sheetName}:`, err.message);
    return [];
  }
}

/**
 * Convert a row array to an object based on column mapping
 * @param {Array<string>} row - Row data array
 * @param {Object} columnMapping - Column index mapping
 * @param {Array<string>} columnNames - Column names for the object keys
 * @returns {Object} - Row as object
 */
function rowToObject(row, columnMapping, columnNames) {
  const obj = {};
  for (const [key, index] of Object.entries(columnMapping)) {
    const camelKey = key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    obj[camelKey] = row[index] || '';
  }
  return obj;
}

/**
 * Convert ADAS_Schedule row to object
 */
function scheduleRowToObject(row, rowIndex) {
  return {
    rowNumber: rowIndex + 2, // +2 because sheets are 1-indexed and row 1 is header
    timestampCreated: row[SCHEDULE_COLUMNS.TIMESTAMP_CREATED] || '',
    shopName: row[SCHEDULE_COLUMNS.SHOP_NAME] || '',
    roPo: row[SCHEDULE_COLUMNS.RO_PO] || '',
    vin: row[SCHEDULE_COLUMNS.VIN] || '',
    vehicle: row[SCHEDULE_COLUMNS.VEHICLE] || '',
    status: row[SCHEDULE_COLUMNS.STATUS] || '',
    scheduledDate: row[SCHEDULE_COLUMNS.SCHEDULED_DATE] || '',
    scheduledTime: row[SCHEDULE_COLUMNS.SCHEDULED_TIME] || '',
    technicianAssigned: row[SCHEDULE_COLUMNS.TECHNICIAN_ASSIGNED] || '',
    requiredCalibrations: row[SCHEDULE_COLUMNS.REQUIRED_CALIBRATIONS] || '',
    completedCalibrations: row[SCHEDULE_COLUMNS.COMPLETED_CALIBRATIONS] || '',
    dtcs: row[SCHEDULE_COLUMNS.DTCS] || '',
    revvReportPdf: row[SCHEDULE_COLUMNS.REVV_REPORT_PDF] || '',
    postScanPdf: row[SCHEDULE_COLUMNS.POST_SCAN_PDF] || '',
    invoicePdf: row[SCHEDULE_COLUMNS.INVOICE_PDF] || '',
    invoiceNumber: row[SCHEDULE_COLUMNS.INVOICE_NUMBER] || '',
    invoiceAmount: row[SCHEDULE_COLUMNS.INVOICE_AMOUNT] || '',
    invoiceDate: row[SCHEDULE_COLUMNS.INVOICE_DATE] || '',
    notes: row[SCHEDULE_COLUMNS.NOTES] || '',
    fullScrubText: row[SCHEDULE_COLUMNS.FULL_SCRUB_TEXT] || ''
  };
}

/**
 * Convert Billing row to object
 */
function billingRowToObject(row, rowIndex) {
  return {
    rowNumber: rowIndex + 2,
    timestampCreated: row[BILLING_COLUMNS.TIMESTAMP_CREATED] || '',
    shopName: row[BILLING_COLUMNS.SHOP_NAME] || '',
    roPo: row[BILLING_COLUMNS.RO_PO] || '',
    vin: row[BILLING_COLUMNS.VIN] || '',
    vehicle: row[BILLING_COLUMNS.VEHICLE] || '',
    calibrationDescription: row[BILLING_COLUMNS.CALIBRATION_DESCRIPTION] || '',
    amount: row[BILLING_COLUMNS.AMOUNT] || '',
    invoiceNumber: row[BILLING_COLUMNS.INVOICE_NUMBER] || '',
    invoiceDate: row[BILLING_COLUMNS.INVOICE_DATE] || '',
    invoicePdf: row[BILLING_COLUMNS.INVOICE_PDF] || '',
    status: row[BILLING_COLUMNS.STATUS] || '',
    notes: row[BILLING_COLUMNS.NOTES] || ''
  };
}

/**
 * Convert Shops row to object
 */
function shopsRowToObject(row, rowIndex) {
  return {
    rowNumber: rowIndex + 2,
    shopName: row[SHOPS_COLUMNS.SHOP_NAME] || '',
    email: row[SHOPS_COLUMNS.EMAIL] || '',
    billingCc: row[SHOPS_COLUMNS.BILLING_CC] || '',
    notes: row[SHOPS_COLUMNS.NOTES] || ''
  };
}

// Legacy variable names for backward compatibility
const SCHEDULE_SHEET_ID = SCHEDULE_SHEET_NAME;
const BILLING_SHEET_ID = BILLING_SHEET_NAME;
const SHOPS_SHEET_ID = SHOPS_SHEET_NAME;

/**
 * Helper to make authenticated requests to Google Apps Script
 */
async function makeGASRequest(action, data, timeout = 15000) {
  if (!GAS_WEBHOOK_URL) {
    console.error(`${LOG_TAG} GAS_WEBHOOK_URL not configured`);
    return { success: false, error: 'Google Sheets webhook not configured' };
  }

  const payload = {
    token: GAS_TOKEN,
    action,
    data
  };

  try {
    console.log(`${LOG_TAG} Request: ${action}`, JSON.stringify(data, null, 2));

    // Google Apps Script returns a 302 redirect which axios follows as GET
    // We need to manually follow the redirect while keeping POST body
    const response = await axios.post(GAS_WEBHOOK_URL, payload, {
      timeout,
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 0,  // Don't auto-follow redirects
      validateStatus: (status) => status >= 200 && status < 400  // Accept 302
    });

    // If we get a redirect, follow it with a GET (GAS expects this)
    let finalResponse = response;
    if (response.status === 302 && response.headers.location) {
      console.log(`${LOG_TAG} Following redirect to:`, response.headers.location.substring(0, 80) + '...');
      finalResponse = await axios.get(response.headers.location, { timeout });
    }

    if (finalResponse.data && finalResponse.data.success === false) {
      console.error(`${LOG_TAG} GAS rejected request:`, finalResponse.data.error);
      return { success: false, error: finalResponse.data.error };
    }

    console.log(`${LOG_TAG} Response:`, JSON.stringify(finalResponse.data, null, 2));
    return { success: true, data: finalResponse.data };
  } catch (err) {
    console.error(`${LOG_TAG} Request failed:`, err.message);
    if (err.response) {
      console.error(`${LOG_TAG} Response status:`, err.response.status);
      console.error(`${LOG_TAG} Response data:`, typeof err.response.data === 'string' ? err.response.data.substring(0, 200) : err.response.data);
    }
    return { success: false, error: err.message };
  }
}

/**
 * Get a schedule row by RO/PO number
 * @param {string} roPo - The RO or PO number
 * @returns {Promise<Object|null>} - The row data or null if not found
 */
export async function getScheduleRowByRO(roPo) {
  console.log(`${LOG_TAG} Looking up schedule row for RO: ${roPo}`);

  // Use 'lookup_ro' action (matches GAS script)
  // GAS expects 'roPo' field for lookup_ro action
  const result = await makeGASRequest('lookup_ro', {
    roPo: roPo,
    sheet: SCHEDULE_SHEET_ID
  });

  // GAS returns: { success: true, found: true, data: {...fields...}, rowNumber: N }
  // The data is directly in result.data.data (not result.data.row)
  if (result.success && result.data?.found && result.data?.data) {
    return result.data.data;
  }

  // Log if lookup failed for debugging
  if (!result.success) {
    console.log(`${LOG_TAG} Lookup failed: ${result.error}`);
  } else if (!result.data?.found) {
    console.log(`${LOG_TAG} RO ${roPo} not found in sheet`);
  }

  return null;
}

/**
 * Upsert (insert or update) a schedule row by RO/PO
 * If the RO exists, updates it. If not, creates a new row.
 *
 * @param {string} roPo - The RO or PO number
 * @param {Object} dataObject - Object with any of the schedule fields
 * @returns {Promise<{success: boolean, rowNumber?: number, error?: string}>}
 */
export async function upsertScheduleRowByRO(roPo, dataObject) {
  console.log(`${LOG_TAG} Upserting schedule row for RO: ${roPo}`);

  // Build vehicle string (Year Make Model combined)
  const vehicleYear = dataObject.vehicleYear || dataObject.year || '';
  const vehicleMake = dataObject.vehicleMake || dataObject.make || '';
  const vehicleModel = dataObject.vehicleModel || dataObject.model || '';
  const vehicleStr = dataObject.vehicle || `${vehicleYear} ${vehicleMake} ${vehicleModel}`.trim() || '';

  // Combine DTCs into single field if separate pre/post provided
  let dtcsStr = dataObject.dtcs || '';
  if (!dtcsStr) {
    const preScan = dataObject.preScanDTCs || dataObject.preScanDTCsText || '';
    const postScan = dataObject.postScanDTCs || dataObject.postScanDTCsText || '';
    if (preScan || postScan) {
      const parts = [];
      if (preScan) parts.push(`Pre: ${preScan}`);
      if (postScan) parts.push(`Post: ${postScan}`);
      dtcsStr = parts.join(' | ');
    }
  }

  // Build scheduled string (combine date and time if both present)
  let scheduledDate = dataObject.scheduledDate || '';
  let scheduledTime = dataObject.scheduledTime || '';
  if (dataObject.scheduled && !scheduledDate) {
    const parts = dataObject.scheduled.split(' ');
    scheduledDate = parts[0] || '';
    scheduledTime = parts.slice(1).join(' ') || '';
  }

  // Map status to GAS expected format
  const status = dataObject.status || dataObject.statusFromShop || 'New';

  // Build the payload matching GAS ADAS_Schedule columns (A-T):
  // A: Timestamp, B: Shop Name, C: RO/PO, D: VIN, E: Vehicle, F: Status,
  // G: Scheduled Date, H: Scheduled Time, I: Technician, J: Required Cals,
  // K: Completed Cals, L: DTCs, M: Revv PDF, N: PostScan PDF, O: Invoice PDF,
  // P: Invoice Number, Q: Invoice Amount, R: Invoice Date, S: Notes, T: Full Scrub Text
  // GAS accepts both 'roPo' and 'ro_number' - use 'roPo' for consistency
  const normalizedData = {
    roPo: roPo,
    date_logged: dataObject.timestampCreated || new Date().toISOString(),
    // Column B: Shop Name
    shop_name: dataObject.shopName || dataObject.shop || '',
    // Column D: VIN
    vin: dataObject.vin || '',
    // Column E: Vehicle
    vehicle_info: vehicleStr,
    // Column F: Status
    status_from_shop: status,
    // Column G: Scheduled Date
    scheduled_date: scheduledDate,
    // Column H: Scheduled Time
    scheduled_time: scheduledTime,
    // Column I: Technician
    technician: dataObject.technician || '',
    // Column J: Required Calibrations
    required_calibrations: dataObject.requiredCalibrationsText || dataObject.requiredCalibrations || '',
    // Column K: Completed Calibrations
    completed_calibrations: dataObject.completedCalibrationsText || dataObject.completedCalibrations || '',
    // Column L: DTCs
    dtcs: dtcsStr,
    // Column M: Revv Report PDF
    revv_report_pdf: dataObject.revvReportPdf || dataObject.revvReportLink || '',
    // Column N: Post Scan PDF
    post_scan_pdf: dataObject.postScanPdf || dataObject.postScanLink || '',
    // Column O: Invoice PDF
    invoice_pdf: dataObject.invoicePdf || dataObject.invoiceLink || '',
    // Column P: Invoice Number
    invoice_number: dataObject.invoiceNumber || '',
    // Column Q: Invoice Amount
    invoice_amount: dataObject.invoiceAmount || '',
    // Column R: Invoice Date
    invoice_date: dataObject.invoiceDate || '',
    // Column S: Notes (compact summary for display)
    notes: dataObject.notes || '',
    // Column T: Full Scrub Text (for sidebar, hidden in sheet)
    full_scrub_text: dataObject.fullScrubText || ''
  };

  // Remove empty string values (but keep roPo)
  const cleanedData = Object.fromEntries(
    Object.entries(normalizedData).filter(([k, v]) => k === 'roPo' || v !== '')
  );

  // Use 'log_ro' action (matches GAS script)
  const result = await makeGASRequest('log_ro', cleanedData);

  if (result.success) {
    console.log(`${LOG_TAG} Schedule row logged successfully for RO: ${roPo}`);
    return { success: true, rowNumber: result.data?.rowNumber };
  }

  return { success: false, error: result.error };
}

/**
 * Update specific fields on a schedule row (Tech fields H-M)
 * Uses 'tech_update' action which only updates columns H-M
 * @param {string} roPo - The RO or PO number
 * @param {Object} updates - Object with fields to update
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateScheduleRow(roPo, updates) {
  console.log(`${LOG_TAG} Updating schedule row for RO: ${roPo}`);

  // Map to GAS 'tech_update' expected fields:
  // H: technician, I: calibration_required, J: calibration_performed,
  // K: status_from_tech, L: completion, M: tech_notes
  // GAS accepts both 'roPo' and 'ro_number' - use 'roPo' for consistency
  const techData = {
    roPo: roPo,
    technician: updates.technician || updates.technicianAssigned || '',
    calibration_required: updates.calibrationsRequired || updates.requiredCalibrations || updates.required_calibrations || '',
    calibration_performed: updates.calibrationsCompleted || updates.completedCalibrations || updates.completed_calibrations || '',
    status_from_tech: updates.status || updates.statusFromTech || '',
    completion: updates.completion || updates.completedAt || '',
    tech_notes: updates.notes || updates.techNotes || ''
  };

  // Remove empty string values (but keep roPo)
  const cleanedData = Object.fromEntries(
    Object.entries(techData).filter(([k, v]) => k === 'roPo' || v !== '')
  );

  const result = await makeGASRequest('tech_update', cleanedData);

  return result;
}

/**
 * PATCH C: Set schedule date, time, and technician for an RO
 * Uses 'set_schedule' action which updates columns G (Scheduled Date), H (Scheduled Time), and I (Technician)
 * @param {string} roPo - The RO or PO number
 * @param {Object} scheduleData - Schedule data object
 * @param {string} scheduleData.scheduledDate - Date in YYYY-MM-DD format
 * @param {string} scheduleData.scheduledTime - Time like "10:00 AM" or "9:00 AM - 10:00 AM"
 * @param {string} scheduleData.technician - Assigned technician name
 * @param {boolean} scheduleData.override - Whether this is a Needs Attention override
 * @param {string} scheduleData.notes - Optional notes to append
 * @returns {Promise<{success: boolean, technician?: string, error?: string}>}
 */
export async function setSchedule(roPo, scheduleData) {
  console.log(`${LOG_TAG} Setting schedule for RO: ${roPo}`, scheduleData);

  const requestData = {
    roPo: roPo,
    scheduledDate: scheduleData.scheduledDate || '',
    scheduledTime: scheduleData.scheduledTime || '',
    technician: scheduleData.technician || '',
    override: !!scheduleData.override,
    notes: scheduleData.notes || ''
  };

  console.log(`${LOG_TAG} Request: set_schedule`, JSON.stringify(requestData));

  const result = await makeGASRequest('set_schedule', requestData);

  if (result.success) {
    console.log(`${LOG_TAG} Schedule set successfully for RO ${roPo}: ${scheduleData.scheduledDate} at ${scheduleData.scheduledTime}, Tech: ${scheduleData.technician || 'Not assigned'}`);
  } else {
    console.error(`${LOG_TAG} Failed to set schedule for RO ${roPo}:`, result.error);
  }

  return result;
}

/**
 * Append a new billing row
 * NOTE: Current GAS does not support 'append_billing' action.
 * This logs billing data to tech_notes via append_tech_note instead.
 * @param {Object} dataObject - Billing data object
 * @returns {Promise<{success: boolean, rowNumber?: number, error?: string}>}
 */
export async function appendBillingRow(dataObject) {
  console.log(`${LOG_TAG} Appending billing info for RO: ${dataObject.roPo}`);

  // Current GAS only supports: log_ro, tech_update, lookup_ro, append_tech_note
  // Append billing info to tech_notes instead
  const billingNote = [
    `[BILLING INFO]`,
    `Invoice #: ${dataObject.invoiceNumber || 'N/A'}`,
    `Amount: $${dataObject.amount || dataObject.invoiceAmount || 0}`,
    `Date: ${dataObject.invoiceDate || 'N/A'}`,
    `Status: ${dataObject.status || 'Ready to Bill'}`,
    `PDF: ${dataObject.invoiceLink || dataObject.invoicePdf || 'N/A'}`
  ].join('\n');

  const result = await makeGASRequest('append_tech_note', {
    roPo: dataObject.roPo,
    tech_notes: billingNote
  });

  if (result.success) {
    console.log(`${LOG_TAG} Billing info appended to tech notes for RO: ${dataObject.roPo}`);
    return { success: true, rowNumber: result.data?.row_number };
  }

  console.warn(`${LOG_TAG} Could not append billing - RO may not exist yet`);
  return { success: false, error: result.error };
}

/**
 * Get billing rows by RO/PO using direct Sheets API
 * @param {string} roPo - The RO or PO number
 * @returns {Promise<Array>} - Array of billing rows
 */
export async function getBillingRowsByRO(roPo) {
  console.log(`${LOG_TAG} Looking up billing rows for RO: ${roPo}`);

  try {
    const rows = await readSheetData(BILLING_SHEET_NAME, 'A:L');

    if (rows.length <= 1) {
      console.log(`${LOG_TAG} No data rows found in ${BILLING_SHEET_NAME}`);
      return [];
    }

    // Skip header row (index 0)
    const dataRows = rows.slice(1);
    const results = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length === 0) continue;

      const rowRoPo = row[BILLING_COLUMNS.RO_PO] || '';

      // Case-insensitive match
      if (rowRoPo.toLowerCase() === roPo.toLowerCase()) {
        results.push(billingRowToObject(row, i));
      }
    }

    console.log(`${LOG_TAG} Found ${results.length} billing rows for RO: ${roPo}`);
    return results;
  } catch (err) {
    console.error(`${LOG_TAG} getBillingRowsByRO failed:`, err.message);
    return [];
  }
}

/**
 * Update billing row status using direct Sheets API
 * @param {string} invoiceNumber - The invoice number
 * @param {string} status - New status (Ready to Bill, Billed, Paid)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateBillingStatus(invoiceNumber, status) {
  console.log(`${LOG_TAG} Updating billing status for invoice: ${invoiceNumber} to: ${status}`);

  try {
    const sheets = await initializeSheetsClient();
    const rows = await readSheetData(BILLING_SHEET_NAME, 'A:L');

    if (rows.length <= 1) {
      return { success: false, error: 'No billing data found' };
    }

    // Skip header row (index 0)
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length === 0) continue;

      const rowInvoiceNumber = row[BILLING_COLUMNS.INVOICE_NUMBER] || '';

      if (rowInvoiceNumber === invoiceNumber) {
        // Found the row, update the status (column K, index 10)
        const rowNumber = i + 2; // +2 for 1-indexed and header row
        const range = `${BILLING_SHEET_NAME}!K${rowNumber}`;

        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: range,
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [[status]]
          }
        });

        console.log(`${LOG_TAG} Updated billing status for invoice ${invoiceNumber} to ${status}`);
        return { success: true };
      }
    }

    return { success: false, error: `Invoice ${invoiceNumber} not found` };
  } catch (err) {
    console.error(`${LOG_TAG} updateBillingStatus failed:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Search schedule rows by various criteria using direct Sheets API
 * @param {Object} criteria - Search criteria (shopName, status, technician, scheduledDate, roPo)
 * @returns {Promise<Array>} - Array of matching rows
 */
export async function searchScheduleRows(criteria) {
  console.log(`${LOG_TAG} Searching schedule rows with criteria:`, JSON.stringify(criteria));

  try {
    const rows = await readSheetData(SCHEDULE_SHEET_NAME, 'A:T');

    if (rows.length <= 1) {
      console.log(`${LOG_TAG} No data rows found in ${SCHEDULE_SHEET_NAME}`);
      return [];
    }

    // Skip header row (index 0)
    const dataRows = rows.slice(1);
    const results = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length === 0) continue;

      let matches = true;

      // Filter by shopName (column B, index 1)
      if (criteria.shopName && row[SCHEDULE_COLUMNS.SHOP_NAME]) {
        if (!row[SCHEDULE_COLUMNS.SHOP_NAME].toLowerCase().includes(criteria.shopName.toLowerCase())) {
          matches = false;
        }
      }

      // Filter by RO/PO (column C, index 2)
      if (criteria.roPo && row[SCHEDULE_COLUMNS.RO_PO]) {
        if (!row[SCHEDULE_COLUMNS.RO_PO].toLowerCase().includes(criteria.roPo.toLowerCase())) {
          matches = false;
        }
      }

      // Filter by status (column F, index 5)
      if (criteria.status && row[SCHEDULE_COLUMNS.STATUS]) {
        if (!row[SCHEDULE_COLUMNS.STATUS].toLowerCase().includes(criteria.status.toLowerCase())) {
          matches = false;
        }
      }

      // Filter by technician (column I, index 8)
      if (criteria.technician && row[SCHEDULE_COLUMNS.TECHNICIAN_ASSIGNED]) {
        if (!row[SCHEDULE_COLUMNS.TECHNICIAN_ASSIGNED].toLowerCase().includes(criteria.technician.toLowerCase())) {
          matches = false;
        }
      }

      // Filter by scheduledDate (column G, index 6)
      if (criteria.scheduledDate && row[SCHEDULE_COLUMNS.SCHEDULED_DATE]) {
        if (row[SCHEDULE_COLUMNS.SCHEDULED_DATE] !== criteria.scheduledDate) {
          matches = false;
        }
      }

      // Filter by date range
      if (criteria.dateRange && row[SCHEDULE_COLUMNS.SCHEDULED_DATE]) {
        const rowDate = row[SCHEDULE_COLUMNS.SCHEDULED_DATE];
        if (criteria.dateRange.start && rowDate < criteria.dateRange.start) {
          matches = false;
        }
        if (criteria.dateRange.end && rowDate > criteria.dateRange.end) {
          matches = false;
        }
      }

      if (matches) {
        results.push(scheduleRowToObject(row, i));
      }
    }

    console.log(`${LOG_TAG} Found ${results.length} matching schedule rows`);
    return results;
  } catch (err) {
    console.error(`${LOG_TAG} searchScheduleRows failed:`, err.message);
    return [];
  }
}

/**
 * Get all rows with a specific status
 * @param {string} status - Status to filter by
 * @returns {Promise<Array>} - Array of matching rows
 */
export async function getRowsByStatus(status) {
  return searchScheduleRows({ status });
}

/**
 * Get all rows assigned to a specific technician
 * @param {string} technician - Technician name
 * @returns {Promise<Array>} - Array of matching rows
 */
export async function getRowsByTechnician(technician) {
  return searchScheduleRows({ technician });
}

/**
 * Get jobs scheduled for a specific technician on a specific date using direct Sheets API
 * @param {string} technician - Technician name
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<Array>} - Array of scheduled jobs
 */
export async function getScheduledJobsForTechOnDate(technician, date) {
  console.log(`${LOG_TAG} Getting scheduled jobs for ${technician} on ${date}`);

  try {
    const rows = await readSheetData(SCHEDULE_SHEET_NAME, 'A:T');

    if (rows.length <= 1) {
      console.log(`${LOG_TAG} No data rows found in ${SCHEDULE_SHEET_NAME}`);
      return [];
    }

    // Skip header row (index 0)
    const dataRows = rows.slice(1);
    const results = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length === 0) continue;

      const rowTechnician = row[SCHEDULE_COLUMNS.TECHNICIAN_ASSIGNED] || '';
      const rowDate = row[SCHEDULE_COLUMNS.SCHEDULED_DATE] || '';

      // Match technician (case-insensitive partial match)
      const techMatches = technician ?
        rowTechnician.toLowerCase().includes(technician.toLowerCase()) : true;

      // Match date exactly
      const dateMatches = date ? rowDate === date : true;

      if (techMatches && dateMatches) {
        results.push(scheduleRowToObject(row, i));
      }
    }

    console.log(`${LOG_TAG} Found ${results.length} jobs for ${technician} on ${date}`);
    return results;
  } catch (err) {
    console.error(`${LOG_TAG} getScheduledJobsForTechOnDate failed:`, err.message);
    return [];
  }
}

/**
 * Get shop information from the Shops tab using direct Sheets API
 * @param {string} shopName - Name of the shop
 * @returns {Promise<Object|null>} - Shop info with email, billingCc, notes or null
 */
export async function getShopInfo(shopName) {
  console.log(`${LOG_TAG} Looking up shop info for: ${shopName}`);

  try {
    const rows = await readSheetData(SHOPS_SHEET_NAME, 'A:D');

    if (rows.length <= 1) {
      console.log(`${LOG_TAG} No data rows found in ${SHOPS_SHEET_NAME}`);
      return null;
    }

    // Skip header row (index 0)
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length === 0) continue;

      const rowShopName = row[SHOPS_COLUMNS.SHOP_NAME] || '';

      // Case-insensitive partial match
      if (rowShopName.toLowerCase().includes(shopName.toLowerCase()) ||
          shopName.toLowerCase().includes(rowShopName.toLowerCase())) {
        const shopInfo = shopsRowToObject(row, i);
        console.log(`${LOG_TAG} Found shop: ${shopInfo.shopName}`);
        return shopInfo;
      }
    }

    console.log(`${LOG_TAG} Shop not found: ${shopName}`);
    return null;
  } catch (err) {
    console.error(`${LOG_TAG} getShopInfo failed:`, err.message);
    return null;
  }
}

/**
 * Get all shops from the Shops tab using direct Sheets API
 * @returns {Promise<Array>} - Array of shop objects
 */
export async function getAllShops() {
  console.log(`${LOG_TAG} Getting all shops`);

  try {
    const rows = await readSheetData(SHOPS_SHEET_NAME, 'A:D');

    if (rows.length <= 1) {
      console.log(`${LOG_TAG} No data rows found in ${SHOPS_SHEET_NAME}`);
      return [];
    }

    // Skip header row (index 0)
    const dataRows = rows.slice(1);
    const results = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row || row.length === 0) continue;

      // Only include rows with a shop name
      if (row[SHOPS_COLUMNS.SHOP_NAME]) {
        results.push(shopsRowToObject(row, i));
      }
    }

    console.log(`${LOG_TAG} Found ${results.length} shops`);
    return results;
  } catch (err) {
    console.error(`${LOG_TAG} getAllShops failed:`, err.message);
    return [];
  }
}

/**
 * Append scrub notes to existing Notes field for an RO
 * Used for estimate scrubbing results
 * @param {string} roPo - The RO or PO number
 * @param {string} scrubNotes - Notes from estimate scrubbing
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function appendScrubNotes(roPo, scrubNotes) {
  console.log(`${LOG_TAG} Appending scrub notes for RO: ${roPo}`);

  // First get existing row to preserve existing notes
  const existing = await getScheduleRowByRO(roPo);
  let notes = '';

  if (existing && existing.notes) {
    notes = existing.notes + '\n\n' + scrubNotes;
  } else {
    notes = scrubNotes;
  }

  return updateScheduleRow(roPo, { notes });
}

/**
 * Update schedule row with estimate scrub result
 * @param {string} roPo - The RO or PO number
 * @param {Object} scrubResult - Result from estimateScrubber.scrubEstimate
 * @param {string} formattedNotes - Formatted notes from formatScrubResultsAsNotes
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateWithScrubResult(roPo, scrubResult, formattedNotes) {
  console.log(`${LOG_TAG} Updating schedule with scrub result for RO: ${roPo}`);

  const updates = {
    notes: formattedNotes
  };

  // If scrub found missing calibrations, update status to indicate attention needed
  if (scrubResult.needsAttention) {
    updates.status = 'Needs Attention';
  }

  // If estimate found required calibrations but no RevvADAS data, add them
  if (scrubResult.requiredFromEstimate && scrubResult.requiredFromEstimate.length > 0) {
    const existing = await getScheduleRowByRO(roPo);
    if (!existing?.required_calibrations && !existing?.requiredCalibrations) {
      updates.required_calibrations = scrubResult.requiredFromEstimate.join('; ');
    }
  }

  return updateScheduleRow(roPo, updates);
}

/**
 * Legacy compatibility: log_ro action for OPS assistant
 * Maps to upsertScheduleRowByRO with status defaults
 */
export async function logROFromOps(data) {
  const mappedData = {
    shopName: data.shop,
    vin: data.vin || extractVINFromVehicleInfo(data.vehicle_info),
    vehicleYear: extractYearFromVehicleInfo(data.vehicle_info),
    vehicleMake: extractMakeFromVehicleInfo(data.vehicle_info),
    vehicleModel: extractModelFromVehicleInfo(data.vehicle_info),
    status: data.status_from_shop === 'ready' ? 'Ready' : 'Not Ready',
    notes: data.shop_notes,
    timestampCreated: data.date_logged || new Date().toISOString()
  };

  return upsertScheduleRowByRO(data.ro_number, mappedData);
}

/**
 * Legacy compatibility: tech_update action
 */
export async function updateFromTech(data) {
  const mappedData = {
    technician: data.technician,
    requiredCalibrationsText: data.calibration_required,
    completedCalibrationsText: data.calibration_performed,
    status: data.status_from_tech,
    notes: data.tech_notes
  };

  return upsertScheduleRowByRO(data.ro_number, mappedData);
}

// Helper functions to parse vehicle_info string
function extractVINFromVehicleInfo(vehicleInfo) {
  if (!vehicleInfo) return null;
  const match = vehicleInfo.match(/VIN\s+(?:ending\s+)?([A-Z0-9]{4,17})/i);
  return match ? match[1] : null;
}

function extractYearFromVehicleInfo(vehicleInfo) {
  if (!vehicleInfo) return null;
  const match = vehicleInfo.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

function extractMakeFromVehicleInfo(vehicleInfo) {
  if (!vehicleInfo) return null;
  const makes = ['Toyota', 'Honda', 'Nissan', 'Ford', 'Chevrolet', 'BMW', 'Mercedes',
                 'Audi', 'Volkswagen', 'Hyundai', 'Kia', 'Mazda', 'Subaru', 'Lexus',
                 'Acura', 'Infiniti', 'Jeep', 'Ram', 'Dodge', 'Chrysler', 'GMC',
                 'Buick', 'Cadillac', 'Lincoln', 'Tesla', 'Volvo', 'Porsche', 'Genesis'];

  for (const make of makes) {
    if (vehicleInfo.toLowerCase().includes(make.toLowerCase())) {
      return make;
    }
  }
  return null;
}

function extractModelFromVehicleInfo(vehicleInfo) {
  if (!vehicleInfo) return null;
  // Try to extract model after make
  const makeMatch = extractMakeFromVehicleInfo(vehicleInfo);
  if (makeMatch) {
    const afterMake = vehicleInfo.split(new RegExp(makeMatch, 'i'))[1];
    if (afterMake) {
      const modelMatch = afterMake.trim().match(/^([A-Za-z0-9\-]+)/);
      return modelMatch ? modelMatch[1] : null;
    }
  }
  return null;
}

export default {
  getScheduleRowByRO,
  upsertScheduleRowByRO,
  updateScheduleRow,
  setSchedule,  // PATCH C: New function for setting schedule date/time
  appendBillingRow,
  getBillingRowsByRO,
  updateBillingStatus,
  searchScheduleRows,
  getRowsByStatus,
  getRowsByTechnician,
  getScheduledJobsForTechOnDate,
  getShopInfo,
  getAllShops,
  appendScrubNotes,
  updateWithScrubResult,
  logROFromOps,
  updateFromTech
};
