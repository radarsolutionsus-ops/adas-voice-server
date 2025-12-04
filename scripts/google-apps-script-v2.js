/**
 * ADAS F1RST Google Apps Script v2
 *
 * FEATURES:
 * - Webhook handler (doPost) for Node.js server integration
 * - Column T stores full scrub text (hidden), Column S shows compact notes
 * - Sidebar viewer shows full scrub details
 * - Conditional formatting for status-based color coding
 *
 * COLUMN MAPPING (ADAS_Schedule A-T):
 * A: Timestamp Created
 * B: Shop Name
 * C: RO/PO
 * D: VIN
 * E: Vehicle (Year Make Model)
 * F: Status (New, Ready, In Progress, Completed, Blocked, Needs Attention)
 * G: Scheduled Date
 * H: Scheduled Time
 * I: Technician Assigned
 * J: Required Calibrations
 * K: Completed Calibrations
 * L: DTCs
 * M: Revv Report PDF
 * N: Post Scan PDF
 * O: Invoice PDF
 * P: Invoice Number
 * Q: Invoice Amount
 * R: Invoice Date
 * S: Notes (compact summary)
 * T: Full Scrub Text (hidden, for sidebar)
 *
 * SETUP:
 * 1. Go to https://script.google.com
 * 2. Create new project or open existing
 * 3. Paste this entire code
 * 4. Deploy > New deployment > Web app
 * 5. Execute as: Me, Access: Anyone
 * 6. Copy URL to .env GAS_WEBHOOK_URL
 */

// ============== CONFIGURATION ==============
const SPREADSHEET_ID = '1ia3P446cILKiRnEnrsk3sWi0OmDq3blj8xS_r5nCjIw';
const AUTH_TOKEN = 'adasfirst-secure-2025';

const SCHEDULE_SHEET = 'ADAS_Schedule';
const BILLING_SHEET = 'Billing';
const SHOPS_SHEET = 'Shops';

// Column indices (0-based) for ADAS_Schedule
const COL = {
  TIMESTAMP: 0,       // A
  SHOP_NAME: 1,       // B
  RO_PO: 2,           // C
  VIN: 3,             // D
  VEHICLE: 4,         // E
  STATUS: 5,          // F
  SCHEDULED_DATE: 6,  // G
  SCHEDULED_TIME: 7,  // H
  TECHNICIAN: 8,      // I
  REQUIRED_CALS: 9,   // J
  COMPLETED_CALS: 10, // K
  DTCS: 11,           // L
  REVV_PDF: 12,       // M
  POSTSCAN_PDF: 13,   // N
  INVOICE_PDF: 14,    // O
  INVOICE_NUM: 15,    // P
  INVOICE_AMOUNT: 16, // Q
  INVOICE_DATE: 17,   // R
  NOTES: 18,          // S
  FULL_SCRUB: 19      // T (hidden)
};

const TOTAL_COLUMNS = 20; // A through T

// ============== WEBHOOK HANDLERS ==============

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.token !== AUTH_TOKEN) {
      return jsonResponse({ success: false, error: 'Invalid token' });
    }

    const action = payload.action;
    const data = payload.data || {};
    let result;

    switch (action) {
      case 'log_ro':
      case 'upsert_schedule':
        result = upsertScheduleRow(data);
        break;
      case 'lookup_ro':
      case 'get_schedule_by_ro':
        result = getScheduleByRO(data.roPo || data.ro_number);
        break;
      case 'tech_update':
      case 'update_schedule':
        result = updateScheduleRow(data.roPo || data.ro_number, data);
        break;
      case 'get_all_shops':
        result = getAllShops();
        break;
      case 'get_shop':
        result = getShopInfo(data.shopName || data.shop_name);
        break;
      case 'append_tech_note':
        result = appendTechNote(data.roPo || data.ro_number, data.tech_notes || data.notes);
        break;
      case 'search_schedule':
        result = searchSchedule(data.query);
        break;
      case 'get_by_status':
        result = getByStatus(data.status);
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  return jsonResponse({ success: true, message: 'ADAS F1RST Webhook Active v2' });
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

  const existingRow = findRowByRO(sheet, roPo, COL.RO_PO);

  if (existingRow) {
    return updateExistingRow(sheet, existingRow, data);
  } else {
    return createNewRow(sheet, data, roPo);
  }
}

function createNewRow(sheet, data, roPo) {
  const timestamp = data.date_logged || new Date().toISOString();

  // Build vehicle string
  const vehicle = data.vehicle || data.vehicle_info || buildVehicleString(data);

  // Parse status
  const status = data.status || data.status_from_shop || 'New';

  // Parse scheduled date/time
  let scheduledDate = data.scheduled_date || data.scheduledDate || '';
  let scheduledTime = data.scheduled_time || data.scheduledTime || '';
  if (data.scheduled && !scheduledDate) {
    const parts = data.scheduled.split(' ');
    scheduledDate = parts[0] || '';
    scheduledTime = parts.slice(1).join(' ') || '';
  }

  // Build new row (A through T = 20 columns)
  const newRow = [
    timestamp,                                                    // A: Timestamp
    data.shop_name || data.shopName || data.shop || '',          // B: Shop Name
    roPo,                                                         // C: RO/PO
    data.vin || '',                                               // D: VIN
    vehicle,                                                      // E: Vehicle
    status,                                                       // F: Status
    scheduledDate,                                                // G: Scheduled Date
    scheduledTime,                                                // H: Scheduled Time
    data.technician || '',                                        // I: Technician
    data.required_calibrations || data.requiredCalibrations || data.calibration_required || '', // J
    data.completed_calibrations || data.completedCalibrations || data.calibration_performed || '', // K
    data.dtcs || '',                                              // L: DTCs
    data.revv_report_pdf || data.revvReportPdf || '',            // M: Revv PDF
    data.post_scan_pdf || data.postScanPdf || '',                // N: PostScan PDF
    data.invoice_pdf || data.invoicePdf || '',                   // O: Invoice PDF
    data.invoice_number || data.invoiceNumber || '',             // P: Invoice Number
    data.invoice_amount || data.invoiceAmount || '',             // Q: Invoice Amount
    data.invoice_date || data.invoiceDate || '',                 // R: Invoice Date
    data.notes || data.shop_notes || '',                         // S: Notes (compact)
    data.full_scrub_text || data.fullScrubText || ''             // T: Full Scrub Text
  ];

  sheet.appendRow(newRow);

  return {
    success: true,
    message: 'Created new schedule row',
    roPo: roPo,
    rowNumber: sheet.getLastRow()
  };
}

function updateExistingRow(sheet, rowNum, data) {
  const range = sheet.getRange(rowNum, 1, 1, TOTAL_COLUMNS);
  const curr = range.getValues()[0];

  // Build vehicle string if provided
  const vehicle = data.vehicle || data.vehicle_info || buildVehicleString(data) || curr[COL.VEHICLE];

  // Parse status
  const status = data.status || data.status_from_shop || data.status_from_tech || curr[COL.STATUS];

  // Parse scheduled date/time
  let scheduledDate = data.scheduled_date || data.scheduledDate || '';
  let scheduledTime = data.scheduled_time || data.scheduledTime || '';
  if (data.scheduled && !scheduledDate) {
    const parts = data.scheduled.split(' ');
    scheduledDate = parts[0] || '';
    scheduledTime = parts.slice(1).join(' ') || '';
  }

  // Handle notes - don't overwrite if new is empty
  let notes = curr[COL.NOTES];
  if (data.notes !== undefined && data.notes !== '') notes = data.notes;
  else if (data.shop_notes !== undefined && data.shop_notes !== '') notes = data.shop_notes;

  // Handle full scrub text
  let fullScrub = curr[COL.FULL_SCRUB] || '';
  if (data.full_scrub_text) fullScrub = data.full_scrub_text;
  else if (data.fullScrubText) fullScrub = data.fullScrubText;

  const updatedRow = [
    curr[COL.TIMESTAMP],                                          // A: Keep timestamp
    data.shop_name || data.shopName || data.shop || curr[COL.SHOP_NAME], // B
    curr[COL.RO_PO],                                              // C: Keep RO/PO
    data.vin || curr[COL.VIN],                                    // D
    vehicle,                                                      // E
    status,                                                       // F
    scheduledDate || curr[COL.SCHEDULED_DATE],                    // G
    scheduledTime || curr[COL.SCHEDULED_TIME],                    // H
    data.technician || curr[COL.TECHNICIAN],                      // I
    data.required_calibrations || data.requiredCalibrations || data.calibration_required || curr[COL.REQUIRED_CALS], // J
    data.completed_calibrations || data.completedCalibrations || data.calibration_performed || curr[COL.COMPLETED_CALS], // K
    data.dtcs || curr[COL.DTCS],                                  // L
    data.revv_report_pdf || data.revvReportPdf || curr[COL.REVV_PDF], // M
    data.post_scan_pdf || data.postScanPdf || curr[COL.POSTSCAN_PDF], // N
    data.invoice_pdf || data.invoicePdf || curr[COL.INVOICE_PDF], // O
    data.invoice_number || data.invoiceNumber || curr[COL.INVOICE_NUM], // P
    data.invoice_amount || data.invoiceAmount || curr[COL.INVOICE_AMOUNT], // Q
    data.invoice_date || data.invoiceDate || curr[COL.INVOICE_DATE], // R
    notes,                                                        // S
    fullScrub                                                     // T
  ];

  range.setValues([updatedRow]);

  return {
    success: true,
    message: 'Updated schedule row',
    roPo: curr[COL.RO_PO],
    rowNumber: rowNum
  };
}

function getScheduleByRO(roPo) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const rowNum = findRowByRO(sheet, roPo, COL.RO_PO);

  if (!rowNum) {
    return { success: false, error: 'RO not found' };
  }

  const v = sheet.getRange(rowNum, 1, 1, TOTAL_COLUMNS).getValues()[0];

  return {
    success: true,
    data: {
      timestamp: v[COL.TIMESTAMP],
      shopName: v[COL.SHOP_NAME],
      roPo: v[COL.RO_PO],
      vin: v[COL.VIN],
      vehicle: v[COL.VEHICLE],
      status: v[COL.STATUS],
      scheduledDate: v[COL.SCHEDULED_DATE],
      scheduledTime: v[COL.SCHEDULED_TIME],
      technician: v[COL.TECHNICIAN],
      requiredCalibrations: v[COL.REQUIRED_CALS],
      completedCalibrations: v[COL.COMPLETED_CALS],
      dtcs: v[COL.DTCS],
      revvReportPdf: v[COL.REVV_PDF],
      postScanPdf: v[COL.POSTSCAN_PDF],
      invoicePdf: v[COL.INVOICE_PDF],
      invoiceNumber: v[COL.INVOICE_NUM],
      invoiceAmount: v[COL.INVOICE_AMOUNT],
      invoiceDate: v[COL.INVOICE_DATE],
      notes: v[COL.NOTES],
      fullScrubText: v[COL.FULL_SCRUB],
      rowNumber: rowNum
    }
  };
}

function updateScheduleRow(roPo, data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const rowNum = findRowByRO(sheet, roPo, COL.RO_PO);

  if (!rowNum) {
    return { success: false, error: 'RO not found' };
  }

  return updateExistingRow(sheet, rowNum, data);
}

function appendTechNote(roPo, note) {
  if (!roPo) return { success: false, error: 'RO/PO is required' };

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const rowNum = findRowByRO(sheet, roPo, COL.RO_PO);

  if (!rowNum) return { success: false, error: 'RO not found: ' + roPo };

  const notesCell = sheet.getRange(rowNum, COL.NOTES + 1);
  const currentNotes = notesCell.getValue() || '';
  const timestamp = new Date().toLocaleString();
  const separator = currentNotes ? '\n---\n' : '';
  notesCell.setValue(currentNotes + separator + '[' + timestamp + '] ' + note);

  return { success: true, message: 'Note appended', roPo: roPo, row_number: rowNum };
}

function searchSchedule(query) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SCHEDULE_SHEET);
  const data = sheet.getDataRange().getValues();
  const results = [];
  const queryLower = query.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (data[i].join(' ').toLowerCase().includes(queryLower)) {
      results.push({
        roPo: data[i][COL.RO_PO],
        shopName: data[i][COL.SHOP_NAME],
        vehicle: data[i][COL.VEHICLE],
        status: data[i][COL.STATUS],
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
    if (String(data[i][COL.STATUS]).toLowerCase() === statusLower) {
      results.push({
        roPo: data[i][COL.RO_PO],
        shopName: data[i][COL.SHOP_NAME],
        vehicle: data[i][COL.VEHICLE],
        status: data[i][COL.STATUS],
        scheduledDate: data[i][COL.SCHEDULED_DATE],
        technician: data[i][COL.TECHNICIAN]
      });
    }
  }

  return { success: true, results: results };
}

// ============== SHOP OPERATIONS ==============

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

function getShopInfo(shopName) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHOPS_SHEET);
  const data = sheet.getDataRange().getValues();
  const shopLower = shopName.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().includes(shopLower)) {
      return {
        success: true,
        shop: { name: data[i][0], email: data[i][1], billingCC: data[i][2], notes: data[i][3] }
      };
    }
  }

  return { success: false, error: 'Shop not found' };
}

// ============== HELPER FUNCTIONS ==============

function findRowByRO(sheet, roPo, column) {
  const data = sheet.getDataRange().getValues();
  const roPoStr = String(roPo).trim().toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][column]).trim().toLowerCase() === roPoStr) {
      return i + 1;
    }
  }

  return null;
}

function buildVehicleString(data) {
  const parts = [];
  if (data.vehicleYear || data.vehicle_year) parts.push(data.vehicleYear || data.vehicle_year);
  if (data.vehicleMake || data.vehicle_make) parts.push(data.vehicleMake || data.vehicle_make);
  if (data.vehicleModel || data.vehicle_model) parts.push(data.vehicleModel || data.vehicle_model);
  return parts.join(' ');
}

// ============== MENU & SIDEBAR ==============

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ADAS Tools')
    .addItem('View Full Scrub Details', 'openScrubSidebar')
    .addItem('Apply Color Coding', 'applyConditionalFormatting')
    .addItem('Hide Column T (Full Scrub)', 'hideFullScrubColumn')
    .addSeparator()
    .addItem('Refresh Formatting', 'applyConditionalFormatting')
    .addToUi();
}

function openScrubSidebar() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet 'ADAS_Schedule' not found.");
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row === 1) {
    SpreadsheetApp.getUi().alert("Select a data row (not header).");
    return;
  }

  const rowData = sheet.getRange(row, 1, 1, TOTAL_COLUMNS).getValues()[0];
  const roPo = rowData[COL.RO_PO] || 'Unknown';
  const status = rowData[COL.STATUS] || 'Unknown';
  const vehicle = rowData[COL.VEHICLE] || '';
  const shopName = rowData[COL.SHOP_NAME] || '';
  const notes = rowData[COL.NOTES] || 'No notes';
  const fullScrub = rowData[COL.FULL_SCRUB] || 'No detailed scrub data available.';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; padding: 16px; margin: 0; font-size: 13px; }
    h2 { color: #1a73e8; margin-bottom: 8px; font-size: 18px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e0e0e0; }
    .status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .status-attention { background: #ffcccc; color: #7f0000; }
    .status-ready { background: #d9ead3; color: #274e13; }
    .status-progress { background: #cfe2f3; color: #073763; }
    .status-completed { background: #b6d7a8; color: #274e13; }
    .status-blocked { background: #ea9999; color: #660000; }
    .section { margin-top: 16px; }
    .section-title { font-weight: bold; color: #333; margin-bottom: 4px; font-size: 14px; }
    .notes-box { background: #f8f9fa; padding: 12px; border-radius: 4px; border: 1px solid #e0e0e0; white-space: pre-wrap; font-size: 12px; line-height: 1.5; max-height: 150px; overflow-y: auto; }
    .scrub-box { background: #fff3e0; padding: 12px; border-radius: 4px; border: 1px solid #ffcc80; white-space: pre-wrap; font-family: monospace; font-size: 11px; line-height: 1.4; max-height: 400px; overflow-y: auto; }
    .warning { color: #c62828; font-weight: bold; }
    .ok { color: #2e7d32; font-weight: bold; }
  </style>
</head>
<body>
  <h2>RO: ${escapeHtml(roPo)}</h2>
  <div class="meta">
    Row ${row} | <span class="status ${getStatusClass(status)}">${escapeHtml(status)}</span><br>
    ${escapeHtml(shopName)} | ${escapeHtml(vehicle)}
  </div>

  <div class="section">
    <div class="section-title">Summary (Column S):</div>
    <div class="notes-box">${escapeHtml(notes)}</div>
  </div>

  <div class="section">
    <div class="section-title">Full Scrub Details (Column T):</div>
    <div class="scrub-box">${formatScrubHtml(fullScrub)}</div>
  </div>
</body>
</html>`;

  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(html).setTitle('ADAS Scrub Details').setWidth(400)
  );
}

function getStatusClass(status) {
  const s = String(status).toLowerCase();
  if (s.includes('attention') || s.includes('needs')) return 'status-attention';
  if (s.includes('blocked')) return 'status-blocked';
  if (s.includes('completed')) return 'status-completed';
  if (s.includes('progress')) return 'status-progress';
  if (s.includes('ready')) return 'status-ready';
  return '';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatScrubHtml(text) {
  let html = escapeHtml(text);
  // Highlight warnings
  html = html.replace(/(MISSING CALIBRATIONS|ATTENTION REQUIRED|WARNING)/g, '<span class="warning">$1</span>');
  // Highlight OK messages
  html = html.replace(/(OK –|Estimate matches|aligned)/g, '<span class="ok">$1</span>');
  return html;
}

function hideFullScrubColumn() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (sheet) {
    sheet.hideColumns(COL.FULL_SCRUB + 1); // Column T
    SpreadsheetApp.getUi().alert('Column T (Full Scrub Text) is now hidden. Use View Full Scrub Details from the menu to see it.');
  }
}

// ============== CONDITIONAL FORMATTING ==============

function applyConditionalFormatting() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet 'ADAS_Schedule' not found.");
    return;
  }

  // Clear existing rules
  sheet.clearConditionalFormatRules();

  const lastRow = Math.max(sheet.getLastRow(), 100);
  const fullRange = sheet.getRange('A2:T' + lastRow);
  const statusRange = sheet.getRange('F2:F' + lastRow);
  const notesRange = sheet.getRange('S2:S' + lastRow);

  const rules = [];

  // === STATUS COLUMN (F) RULES ===

  // Needs Attention - Red row
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('Needs Attention')
    .setBackground('#ffcccc')
    .setFontColor('#7f0000')
    .setRanges([fullRange])
    .build());

  // Blocked - Dark red row
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Blocked')
    .setBackground('#ea9999')
    .setFontColor('#660000')
    .setRanges([fullRange])
    .build());

  // Ready - Light green row
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Ready')
    .setBackground('#d9ead3')
    .setFontColor('#274e13')
    .setRanges([fullRange])
    .build());

  // In Progress - Light blue row
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('In Progress')
    .setBackground('#cfe2f3')
    .setFontColor('#073763')
    .setRanges([fullRange])
    .build());

  // Completed - Medium green row
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Completed')
    .setBackground('#b6d7a8')
    .setFontColor('#274e13')
    .setRanges([fullRange])
    .build());

  // === NOTES COLUMN (S) RULES ===

  // Missing calibrations - Yellow/Orange highlight on notes
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('Missing:')
    .setBackground('#fff2cc')
    .setFontColor('#7f6000')
    .setRanges([notesRange])
    .build());

  // Mismatch - Yellow highlight
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('Mismatch')
    .setBackground('#fff2cc')
    .setFontColor('#7f6000')
    .setRanges([notesRange])
    .build());

  // Revv: 0 when estimate has calibrations - Orange
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('Revv: 0')
    .setBackground('#ffebcc')
    .setFontColor('#703200')
    .setRanges([notesRange])
    .build());

  // OK - Estimate matches - Soft green
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('OK –')
    .setBackground('#e2f0d9')
    .setFontColor('#0b5a2b')
    .setRanges([notesRange])
    .build());

  // Needs review - Light red
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('Needs review')
    .setBackground('#f4cccc')
    .setFontColor('#990000')
    .setRanges([notesRange])
    .build());

  sheet.setConditionalFormatRules(rules);
  SpreadsheetApp.getUi().alert('Conditional formatting applied! Rows are now color-coded by status and notes content.');
}

// ============== TEST FUNCTION ==============

function testWebhook() {
  const testPayload = { token: AUTH_TOKEN, action: 'get_all_shops', data: {} };
  Logger.log('Test payload: ' + JSON.stringify(testPayload));
  const result = getAllShops();
  Logger.log('Result: ' + JSON.stringify(result));
}
