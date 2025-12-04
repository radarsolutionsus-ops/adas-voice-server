/**
 * ADAS F1RST Google Apps Script
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com
 * 2. Create a new project named "ADAS_FIRST_Webhook"
 * 3. Copy ALL of this code into the Code.gs file
 * 4. Click Deploy > New deployment
 * 5. Select "Web app"
 * 6. Set "Execute as" to "Me"
 * 7. Set "Who has access" to "Anyone"
 * 8. Click Deploy and copy the URL
 * 9. Paste the URL into your .env file as GAS_WEBHOOK_URL
 *
 * SPREADSHEET SETUP:
 * Create a Google Sheet named "ADAS_FIRST_Operations" with these tabs:
 * - ADAS_Schedule (columns A-S)
 * - Billing (columns A-L)
 * - Shops (columns A-D)
 *
 * Then copy the Spreadsheet ID from the URL and put it in SPREADSHEET_ID below.
 */

// ============== CONFIGURATION ==============
const SPREADSHEET_ID = '1ia3P446cILKiRnEnrsk3sWi0OmDq3blj8xS_r5nCjIw'; // Your spreadsheet ID
const AUTH_TOKEN = 'adasfirst-secure-2025'; // Must match GAS_TOKEN in .env

// Sheet names
const SCHEDULE_SHEET = 'ADAS_Schedule';
const BILLING_SHEET = 'Billing';
const SHOPS_SHEET = 'Shops';

// ============== COLUMN MAPPINGS ==============
// ADAS_Schedule columns (A-S = 0-18)
const SCHEDULE_COLS = {
  TIMESTAMP: 0,        // A
  SHOP_NAME: 1,        // B
  RO_PO: 2,            // C
  VIN: 3,              // D
  VEHICLE: 4,          // E
  STATUS: 5,           // F
  SCHEDULED_DATE: 6,   // G
  SCHEDULED_TIME: 7,   // H
  TECHNICIAN: 8,       // I
  REQUIRED_CALS: 9,    // J
  COMPLETED_CALS: 10,  // K
  DTCS: 11,            // L
  REVV_PDF: 12,        // M
  POSTSCAN_PDF: 13,    // N
  INVOICE_PDF: 14,     // O
  INVOICE_NUM: 15,     // P
  INVOICE_AMOUNT: 16,  // Q
  INVOICE_DATE: 17,    // R
  NOTES: 18            // S
};

// Billing columns (A-L = 0-11)
const BILLING_COLS = {
  TIMESTAMP: 0,
  SHOP_NAME: 1,
  RO_PO: 2,
  VIN: 3,
  VEHICLE: 4,
  CAL_DESC: 5,
  AMOUNT: 6,
  INVOICE_NUM: 7,
  INVOICE_DATE: 8,
  INVOICE_PDF: 9,
  STATUS: 10,
  NOTES: 11
};

// ============== MAIN HANDLER ==============
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    // Validate auth token
    if (payload.token !== AUTH_TOKEN) {
      return jsonResponse({ success: false, error: 'Invalid token' });
    }

    const action = payload.action;
    const data = payload.data || {};

    let result;

    switch (action) {
      // Schedule operations
      case 'upsert_schedule':
      case 'log_ro':  // Alias for backward compatibility
        result = upsertScheduleRow(data);
        break;
      case 'get_schedule_by_ro':
      case 'lookup_ro':  // Alias for backward compatibility
        result = getScheduleByRO(data.roPo || data.ro_number);
        break;
      case 'update_schedule':
      case 'tech_update':  // Alias for backward compatibility
        result = updateScheduleRow(data.roPo || data.ro_number, data);
        break;
      case 'search_schedule':
        result = searchSchedule(data.query);
        break;
      case 'get_by_status':
        result = getByStatus(data.status);
        break;
      case 'get_by_technician':
        result = getByTechnician(data.technician);
        break;
      case 'get_scheduled_jobs':
        result = getScheduledJobs(data.technician, data.date);
        break;

      // Billing operations
      case 'upsert_billing':
      case 'append_billing':  // Alias
        result = upsertBillingRow(data);
        break;
      case 'get_billing_by_ro':
        result = getBillingByRO(data.roPo || data.ro_number);
        break;
      case 'update_billing_status':
        result = updateBillingStatus(data.roPo || data.ro_number, data.status);
        break;

      // Shop operations
      case 'get_shop':
      case 'get_shop_info':  // Alias
        result = getShopInfo(data.shopName || data.shop_name);
        break;
      case 'get_all_shops':
        result = getAllShops();
        break;

      // Append tech note (updates notes field for an RO)
      case 'append_tech_note':
        result = appendTechNote(data.roPo || data.ro_number, data.tech_notes || data.notes);
        break;

      default:
        result = { success: false, error: `Unknown action: ${action}. Use 'upsert_schedule', 'lookup_ro', 'tech_update', 'search_schedule', 'get_by_status', 'get_by_technician', 'get_scheduled_jobs', 'upsert_billing', 'get_billing_by_ro', 'update_billing_status', 'get_shop', 'get_all_shops', or 'append_tech_note'` };
    }

    return jsonResponse(result);

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  return jsonResponse({ success: true, message: 'ADAS F1RST Webhook Active' });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============== SCHEDULE OPERATIONS ==============

function upsertScheduleRow(data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const roPo = data.roPo || data.ro_po || data.ro_number;

  if (!roPo) {
    return { success: false, error: 'RO/PO is required' };
  }

  // Find existing row
  const existingRow = findRowByRO(sheet, roPo, SCHEDULE_COLS.RO_PO);

  if (existingRow) {
    // Update existing row
    return updateExistingScheduleRow(sheet, existingRow, data);
  } else {
    // Create new row
    return createNewScheduleRow(sheet, data);
  }
}

function createNewScheduleRow(sheet, data) {
  const timestamp = data.date_logged || new Date().toISOString();
  const roPo = data.roPo || data.ro_po || data.ro_number;

  // Handle vehicle_info from sheetWriter.js
  const vehicle = data.vehicle || data.vehicle_info || buildVehicle(data);

  // Handle status mapping from sheetWriter.js
  const status = data.status || data.status_from_shop || 'New';

  // Handle scheduled from sheetWriter.js (combined date/time)
  let scheduledDate = data.scheduledDate || data.scheduled_date || '';
  let scheduledTime = data.scheduledTime || data.scheduled_time || '';
  if (data.scheduled && !scheduledDate) {
    // Parse combined scheduled string "YYYY-MM-DD HH:MM"
    const parts = data.scheduled.split(' ');
    if (parts.length >= 1) scheduledDate = parts[0];
    if (parts.length >= 2) scheduledTime = parts.slice(1).join(' ');
  }

  // Handle notes from sheetWriter.js
  const notes = data.notes || data.shop_notes || '';

  const newRow = [
    timestamp,                                    // A: Timestamp
    data.shopName || data.shop_name || data.shop || '', // B: Shop Name
    roPo,                                         // C: RO/PO
    data.vin || '',                               // D: VIN
    vehicle,                                      // E: Vehicle
    status,                                       // F: Status
    scheduledDate,                                // G: Scheduled Date
    scheduledTime,                                // H: Scheduled Time
    data.technician || '',                        // I: Technician
    data.requiredCalibrations || data.required_calibrations || data.calibration_required || '', // J: Required Cals
    data.completedCalibrations || data.completed_calibrations || data.calibration_performed || '', // K: Completed Cals
    data.dtcs || '',                              // L: DTCs
    data.revvReportPdf || data.revv_report_pdf || '', // M: Revv PDF
    data.postScanPdf || data.post_scan_pdf || '', // N: PostScan PDF
    data.invoicePdf || data.invoice_pdf || '',    // O: Invoice PDF
    data.invoiceNumber || data.invoice_number || '', // P: Invoice Number
    data.invoiceAmount || data.invoice_amount || '', // Q: Invoice Amount
    data.invoiceDate || data.invoice_date || '',  // R: Invoice Date
    notes                                         // S: Notes
  ];

  sheet.appendRow(newRow);

  return {
    success: true,
    message: 'Created new schedule row',
    roPo: roPo,
    rowNumber: sheet.getLastRow()
  };
}

function updateExistingScheduleRow(sheet, rowNum, data) {
  const range = sheet.getRange(rowNum, 1, 1, 19);
  const currentValues = range.getValues()[0];

  // Handle vehicle_info from sheetWriter.js
  const vehicle = data.vehicle || data.vehicle_info || buildVehicle(data) || currentValues[4];

  // Handle status mapping from sheetWriter.js
  const status = data.status || data.status_from_shop || data.status_from_tech || currentValues[5];

  // Handle scheduled from sheetWriter.js (combined date/time)
  let scheduledDate = data.scheduledDate || data.scheduled_date || '';
  let scheduledTime = data.scheduledTime || data.scheduled_time || '';
  if (data.scheduled && !scheduledDate) {
    const parts = data.scheduled.split(' ');
    if (parts.length >= 1) scheduledDate = parts[0];
    if (parts.length >= 2) scheduledTime = parts.slice(1).join(' ');
  }

  // Handle notes from sheetWriter.js
  let notes = currentValues[18];
  if (data.notes !== undefined) notes = data.notes;
  else if (data.shop_notes !== undefined) notes = data.shop_notes;
  else if (data.tech_notes !== undefined) notes = data.tech_notes;

  // Update only provided fields
  const updatedRow = [
    currentValues[0], // Keep timestamp
    data.shopName || data.shop_name || data.shop || currentValues[1],
    currentValues[2], // Keep RO/PO
    data.vin || currentValues[3],
    vehicle,
    status,
    scheduledDate || currentValues[6],
    scheduledTime || currentValues[7],
    data.technician || currentValues[8],
    data.requiredCalibrations || data.required_calibrations || data.calibration_required || currentValues[9],
    data.completedCalibrations || data.completed_calibrations || data.calibration_performed || currentValues[10],
    data.dtcs || currentValues[11],
    data.revvReportPdf || data.revv_report_pdf || currentValues[12],
    data.postScanPdf || data.post_scan_pdf || currentValues[13],
    data.invoicePdf || data.invoice_pdf || currentValues[14],
    data.invoiceNumber || data.invoice_number || currentValues[15],
    data.invoiceAmount || data.invoice_amount || currentValues[16],
    data.invoiceDate || data.invoice_date || data.completion || currentValues[17],
    notes
  ];

  range.setValues([updatedRow]);

  return {
    success: true,
    message: 'Updated schedule row',
    roPo: currentValues[2],
    rowNumber: rowNum
  };
}

function getScheduleByRO(roPo) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const rowNum = findRowByRO(sheet, roPo, SCHEDULE_COLS.RO_PO);

  if (!rowNum) {
    return { success: false, error: 'RO not found' };
  }

  const values = sheet.getRange(rowNum, 1, 1, 19).getValues()[0];

  return {
    success: true,
    data: {
      timestamp: values[0],
      shopName: values[1],
      roPo: values[2],
      vin: values[3],
      vehicle: values[4],
      status: values[5],
      scheduledDate: values[6],
      scheduledTime: values[7],
      technician: values[8],
      requiredCalibrations: values[9],
      completedCalibrations: values[10],
      dtcs: values[11],
      revvReportPdf: values[12],
      postScanPdf: values[13],
      invoicePdf: values[14],
      invoiceNumber: values[15],
      invoiceAmount: values[16],
      invoiceDate: values[17],
      notes: values[18],
      rowNumber: rowNum
    }
  };
}

function updateScheduleRow(roPo, data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const rowNum = findRowByRO(sheet, roPo, SCHEDULE_COLS.RO_PO);

  if (!rowNum) {
    return { success: false, error: 'RO not found' };
  }

  return updateExistingScheduleRow(sheet, rowNum, data);
}

function searchSchedule(query) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const data = sheet.getDataRange().getValues();
  const results = [];

  const queryLower = query.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const searchString = row.join(' ').toLowerCase();

    if (searchString.includes(queryLower)) {
      results.push({
        roPo: row[2],
        shopName: row[1],
        vehicle: row[4],
        status: row[5],
        technician: row[8],
        rowNumber: i + 1
      });
    }
  }

  return { success: true, results: results };
}

function getByStatus(status) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const data = sheet.getDataRange().getValues();
  const results = [];

  const statusLower = status.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (data[i][SCHEDULE_COLS.STATUS].toString().toLowerCase() === statusLower) {
      results.push({
        roPo: data[i][2],
        shopName: data[i][1],
        vehicle: data[i][4],
        status: data[i][5],
        technician: data[i][8],
        scheduledDate: data[i][6],
        scheduledTime: data[i][7]
      });
    }
  }

  return { success: true, results: results };
}

function getByTechnician(technician) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const data = sheet.getDataRange().getValues();
  const results = [];

  const techLower = technician.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (data[i][SCHEDULE_COLS.TECHNICIAN].toString().toLowerCase().includes(techLower)) {
      results.push({
        roPo: data[i][2],
        shopName: data[i][1],
        vehicle: data[i][4],
        status: data[i][5],
        technician: data[i][8],
        scheduledDate: data[i][6],
        scheduledTime: data[i][7]
      });
    }
  }

  return { success: true, results: results };
}

function getScheduledJobs(technician, date) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const data = sheet.getDataRange().getValues();
  const results = [];

  const techLower = technician ? technician.toLowerCase() : '';

  for (let i = 1; i < data.length; i++) {
    const rowDate = formatDate(data[i][SCHEDULE_COLS.SCHEDULED_DATE]);
    const rowTech = data[i][SCHEDULE_COLS.TECHNICIAN].toString().toLowerCase();

    const dateMatch = !date || rowDate === date;
    const techMatch = !technician || rowTech.includes(techLower);

    if (dateMatch && techMatch && data[i][SCHEDULE_COLS.STATUS] !== 'Completed') {
      results.push({
        roPo: data[i][2],
        shopName: data[i][1],
        vehicle: data[i][4],
        status: data[i][5],
        technician: data[i][8],
        scheduledDate: rowDate,
        scheduledTime: data[i][7]
      });
    }
  }

  return { success: true, jobs: results };
}

/**
 * Append a note to the Notes column (S) for an existing RO
 * Used for tech notes, billing info, etc.
 */
function appendTechNote(roPo, note) {
  if (!roPo) {
    return { success: false, error: 'RO/PO is required' };
  }

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const rowNum = findRowByRO(sheet, roPo, SCHEDULE_COLS.RO_PO);

  if (!rowNum) {
    return { success: false, error: 'RO not found: ' + roPo };
  }

  // Get current notes
  const notesCell = sheet.getRange(rowNum, SCHEDULE_COLS.NOTES + 1);
  const currentNotes = notesCell.getValue() || '';

  // Append new note with timestamp
  const timestamp = new Date().toLocaleString();
  const separator = currentNotes ? '\n\n---\n' : '';
  const newNotes = currentNotes + separator + '[' + timestamp + ']\n' + note;

  notesCell.setValue(newNotes);

  return {
    success: true,
    message: 'Note appended',
    roPo: roPo,
    row_number: rowNum
  };
}

// ============== BILLING OPERATIONS ==============

function upsertBillingRow(data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(BILLING_SHEET);
  const roPo = data.roPo || data.ro_po || data.ro_number;

  if (!roPo) {
    return { success: false, error: 'RO/PO is required' };
  }

  const existingRow = findRowByRO(sheet, roPo, BILLING_COLS.RO_PO);

  if (existingRow) {
    // Update existing
    const range = sheet.getRange(existingRow, 1, 1, 12);
    const current = range.getValues()[0];

    const updated = [
      current[0],
      data.shopName || data.shop_name || current[1],
      current[2],
      data.vin || current[3],
      data.vehicle || current[4],
      data.calibrationDescription || data.cal_desc || current[5],
      data.amount || current[6],
      data.invoiceNumber || data.invoice_number || current[7],
      data.invoiceDate || data.invoice_date || current[8],
      data.invoicePdf || data.invoice_pdf || current[9],
      data.status || current[10],
      data.notes !== undefined ? data.notes : current[11]
    ];

    range.setValues([updated]);
    return { success: true, message: 'Updated billing row', roPo: roPo };
  } else {
    // Create new
    const newRow = [
      new Date().toISOString(),
      data.shopName || data.shop_name || '',
      roPo,
      data.vin || '',
      data.vehicle || '',
      data.calibrationDescription || data.cal_desc || '',
      data.amount || '',
      data.invoiceNumber || data.invoice_number || '',
      data.invoiceDate || data.invoice_date || '',
      data.invoicePdf || data.invoice_pdf || '',
      data.status || 'Ready to Bill',
      data.notes || ''
    ];

    sheet.appendRow(newRow);
    return { success: true, message: 'Created billing row', roPo: roPo };
  }
}

function getBillingByRO(roPo) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(BILLING_SHEET);
  const rowNum = findRowByRO(sheet, roPo, BILLING_COLS.RO_PO);

  if (!rowNum) {
    return { success: false, error: 'Billing record not found' };
  }

  const values = sheet.getRange(rowNum, 1, 1, 12).getValues()[0];

  return {
    success: true,
    data: {
      timestamp: values[0],
      shopName: values[1],
      roPo: values[2],
      vin: values[3],
      vehicle: values[4],
      calibrationDescription: values[5],
      amount: values[6],
      invoiceNumber: values[7],
      invoiceDate: values[8],
      invoicePdf: values[9],
      status: values[10],
      notes: values[11]
    }
  };
}

function updateBillingStatus(roPo, status) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(BILLING_SHEET);
  const rowNum = findRowByRO(sheet, roPo, BILLING_COLS.RO_PO);

  if (!rowNum) {
    return { success: false, error: 'Billing record not found' };
  }

  sheet.getRange(rowNum, BILLING_COLS.STATUS + 1).setValue(status);
  return { success: true, message: 'Billing status updated' };
}

// ============== SHOP OPERATIONS ==============

function getShopInfo(shopName) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHOPS_SHEET);
  const data = sheet.getDataRange().getValues();

  const shopLower = shopName.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase().includes(shopLower)) {
      return {
        success: true,
        shop: {
          name: data[i][0],
          email: data[i][1],
          billingCC: data[i][2],
          notes: data[i][3]
        }
      };
    }
  }

  return { success: false, error: 'Shop not found' };
}

function getAllShops() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHOPS_SHEET);
  const data = sheet.getDataRange().getValues();
  const shops = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      shops.push({
        name: data[i][0],
        email: data[i][1],
        billingCC: data[i][2],
        notes: data[i][3]
      });
    }
  }

  return { success: true, shops: shops };
}

// ============== HELPER FUNCTIONS ==============

function findRowByRO(sheet, roPo, column) {
  const data = sheet.getDataRange().getValues();
  const roPoStr = roPo.toString().trim().toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (data[i][column].toString().trim().toLowerCase() === roPoStr) {
      return i + 1; // Sheet rows are 1-indexed
    }
  }

  return null;
}

function buildVehicle(data) {
  const parts = [];
  if (data.vehicleYear || data.vehicle_year) parts.push(data.vehicleYear || data.vehicle_year);
  if (data.vehicleMake || data.vehicle_make) parts.push(data.vehicleMake || data.vehicle_make);
  if (data.vehicleModel || data.vehicle_model) parts.push(data.vehicleModel || data.vehicle_model);
  return parts.join(' ');
}

function formatDate(date) {
  if (!date) return '';
  if (date instanceof Date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return date.toString();
}

// ============== TEST FUNCTION ==============
function testWebhook() {
  const testPayload = {
    token: AUTH_TOKEN,
    action: 'get_all_shops',
    data: {}
  };

  Logger.log('Testing webhook with payload:');
  Logger.log(JSON.stringify(testPayload));

  // Simulate the response
  const result = getAllShops();
  Logger.log('Result:');
  Logger.log(JSON.stringify(result));
}
