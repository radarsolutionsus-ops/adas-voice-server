/**
 * ADAS F1RST Operations - Google Apps Script
 * 5-STATUS WORKFLOW + AUTO-REFRESH SIDEBAR + VIEW-ONLY + FLOW HISTORY
 *
 * Sheet: ADAS_FIRST_Operations
 * Main tab: ADAS_Schedule (Columns A-U)
 *
 * Column Mapping:
 * A: Timestamp Created (MM/dd/yyyy HH:mm)
 * B: Shop Name
 * C: RO/PO
 * D: VIN
 * E: Vehicle (Year Make Model)
 * F: Status (5 values: New, Ready, Scheduled, Completed, Cancelled)
 * G: Scheduled Date
 * H: Scheduled Time
 * I: Technician Assigned
 * J: Required Calibrations (from Revv Report)
 * K: Completed Calibrations
 * L: DTCs
 * M: Revv Report PDF
 * N: Post Scan PDF
 * O: Invoice PDF
 * P: Invoice Number
 * Q: Invoice Amount
 * R: Invoice Date
 * S: Notes (Short Preview)
 * T: Flow History (timestamped status changes - hidden)
 * U: OEM Position Statement links
 */

const SCHEDULE_SHEET = 'ADAS_Schedule';
const BILLING_SHEET = 'Billing';
const SHOPS_SHEET = 'Shops';
const SCRUB_DETAILS_SHEET = 'Scrub_Details';
const TOTAL_COLUMNS = 22; // A through V

// Column indices (0-based)
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
  FLOW_HISTORY: 19,   // T - Flow History (timestamped status changes)
  FULL_SCRUB: 19,     // T - Alias for backward compatibility (same as FLOW_HISTORY)
  OEM_POSITION: 20,   // U - OEM Position Statement links
  ESTIMATE_PDF: 21    // V - Estimate PDF link
};

/**
 * FINALIZED STATUS VALUES - 7 STATUSES
 * Added "Rescheduled" for when appointments are changed
 * Added "No Cal" for repairs that don't require calibration
 */
const VALID_STATUSES = [
  'New',
  'Ready',
  'No Cal',
  'Scheduled',
  'Rescheduled',
  'Completed',
  'Cancelled'
];

const STATUS_MIGRATION = {
  'Not Ready': 'New',
  'Needs Attention': 'New',
  'Needs Review': 'New',
  'In Progress': 'Scheduled',
  'Blocked': 'Cancelled'
};

// Status colors and icons (used in dropdown and sidebar)
const STATUS_CONFIG = {
  'New':         { background: '#e8f0fe', fontColor: '#1a73e8', icon: 'fiber_new', btnClass: 'btn-new' },
  'Ready':       { background: '#e6f4ea', fontColor: '#137333', icon: 'check_circle', btnClass: 'btn-ready' },
  'No Cal':      { background: '#f5f5f5', fontColor: '#666666', icon: 'check', btnClass: 'btn-nocal' },
  'Scheduled':   { background: '#f3e8fd', fontColor: '#7c3aed', icon: 'event', btnClass: 'btn-scheduled' },
  'Rescheduled': { background: '#fff3e0', fontColor: '#e65100', icon: 'update', btnClass: 'btn-rescheduled' },
  'Completed':   { background: '#d2e3fc', fontColor: '#1967d2', icon: 'done_all', btnClass: 'btn-complete' },
  'Cancelled':   { background: '#fce8e6', fontColor: '#c5221f', icon: 'cancel', btnClass: 'btn-cancel' }
};

/**
 * Check if a VIN looks valid (not a false positive like ALLDATA reference)
 * @param {string} vin - The VIN to validate
 * @returns {boolean} - True if VIN appears valid
 */
function isValidVinFormat(vin) {
  if (!vin || typeof vin !== 'string') return false;
  vin = vin.toUpperCase().trim();
  if (vin.length !== 17) return false;

  // Check for common false positives - estimate system reference numbers
  // ALLDATA, AUDATEX, CCC, etc. reference numbers often start with these
  if (/^(ALL|AUD|CCM|CCC|EST|REF|INV|DAT|DOC|PDF|IMG|RPT)/i.test(vin)) {
    Logger.log('VIN validation: Rejected false positive (estimate system ref): ' + vin);
    return false;
  }

  // Valid WMI (World Manufacturer Identifier) - first character must be valid
  // 1-5: North America, J: Japan, K: Korea, S: UK, W: Germany, etc.
  const validFirstChar = /^[1-5JKLMNSTUVWXYZ]/;
  if (!validFirstChar.test(vin)) {
    Logger.log('VIN validation: Rejected invalid WMI: ' + vin);
    return false;
  }

  // Position 9 is the check digit (0-9 or X)
  const checkDigit = vin.charAt(8);
  if (!/^[0-9X]$/.test(checkDigit)) {
    Logger.log('VIN validation: Rejected invalid check digit: ' + vin);
    return false;
  }

  return true;
}

/**
 * Normalize status to valid values, migrating deprecated statuses
 * @param {string} status - Raw status value
 * @returns {string} - Normalized valid status
 */
function normalizeStatus(status) {
  if (!status) return 'New';
  const trimmed = String(status).trim();
  if (VALID_STATUSES.includes(trimmed)) return trimmed;
  if (STATUS_MIGRATION[trimmed]) return STATUS_MIGRATION[trimmed];
  return 'New';
}

function getStatusColor(status) {
  return (STATUS_CONFIG[status] || {}).fontColor || '#5f6368';
}

function getStatusIcon(status) {
  return (STATUS_CONFIG[status] || {}).icon || 'help';
}

/**
 * Handle POST requests from Node.js server
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    // Validate auth token
    const expectedToken = PropertiesService.getScriptProperties().getProperty('GAS_TOKEN');
    if (payload.token !== expectedToken) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'Unauthorized'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Extract action and data - Node.js sends { token, action, data: {...} }
    const action = payload.action;
    const data = payload.data || payload; // Unwrap nested data, fallback to payload itself

    let result;

    switch (action) {
      case 'log_ro':
      case 'upsert_schedule':
        result = upsertScheduleRow(data);
        break;

      case 'tech_update':
      case 'update_schedule':
        result = techUpdateRow(data);
        break;

      case 'append_tech_note':
        result = appendTechNote(data);
        break;

      case 'lookup_ro':
      case 'get_schedule_by_ro':
        result = getScheduleByRO(data.roPo || data.ro_number);
        break;

      case 'search_schedule':
        result = searchSchedule(data.query);
        break;

      case 'get_by_status':
        result = getByStatus(data.status);
        break;

      case 'get_shop':
        result = getShopInfo(data.shop_name);
        break;

      case 'get_all_shops':
        result = getAllShops();
        break;

      case 'append_billing':
        result = appendBillingRow(data);
        break;

      case 'set_schedule':
        result = setScheduleDateTime(data);
        break;

      case 'update_ro_status':
      case 'update_status':  // Alias for simpler status-only updates
        result = updateROStatus(data);
        break;

      case 'get_row':
        result = getRowByROOrVIN(data);
        break;

      case 'lookup_by_vin':
        result = lookupByVIN(data.vin);
        break;

      case 'append_flow_history':
        result = appendFlowHistory(data.roPo, data.flow_entry);
        break;

      default:
        result = { success: false, error: `Unknown action: ${action}` };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Format timestamp to MM/DD/YY h:mm AM/PM
 * Example: "12/03/25 10:54 PM"
 */
function formatTimestamp(isoOrDate) {
  let date;
  if (typeof isoOrDate === 'string') {
    date = new Date(isoOrDate);
  } else if (isoOrDate instanceof Date) {
    date = isoOrDate;
  } else {
    date = new Date();
  }

  if (isNaN(date.getTime())) {
    date = new Date();
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);  // 2-digit year

  // Convert to 12-hour format with AM/PM
  var hours = date.getHours();
  var ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;  // Convert 0 to 12
  var minutes = String(date.getMinutes()).padStart(2, '0');

  return month + '/' + day + '/' + year + ' ' + hours + ':' + minutes + ' ' + ampm;
}

/**
 * Build vehicle string from components
 */
function buildVehicleString(data) {
  const parts = [
    data.vehicle_year || data.vehicleYear || '',
    data.vehicle_make || data.vehicleMake || '',
    data.vehicle_model || data.vehicleModel || ''
  ].filter(p => p);
  return parts.join(' ');
}

/**
 * Upsert (insert or update) a schedule row
 * PRIORITY: VIN match first, then RO match, then create new row
 * This prevents duplicate rows for the same vehicle when RO numbers differ
 */
function upsertScheduleRow(data) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    return { success: false, error: 'Sheet not found' };
  }

  const roPo = String(data.roPo || data.ro_number || '').trim();
  if (!roPo) {
    return { success: false, error: 'RO/PO number required' };
  }

  const vin = String(data.vin || '').trim();

  // PRIORITY 1: Check VIN first (prevents duplicate rows for same vehicle)
  if (vin && vin.length >= 11) {
    const vinRow = findRowByVIN(sheet, vin);
    if (vinRow > 0) {
      Logger.log('VIN match found: "' + vin + '" at row ' + vinRow + '. Updating existing row with RO: ' + roPo);
      // Update the RO if incoming RO is better (not synthetic)
      if (!roPo.toLowerCase().includes('synthetic') && !roPo.toLowerCase().includes('auto-')) {
        data.roPo = roPo; // Use better RO
      }
      return updateExistingRow(sheet, vinRow, data);
    }
  }

  // PRIORITY 2: Check if RO already exists
  const existingRow = findRowByRO(sheet, roPo);
  if (existingRow > 0) {
    return updateExistingRow(sheet, existingRow, data);
  }

  // PRIORITY 3: Create new row
  return createNewRow(sheet, data, roPo);
}

/**
 * Find row number by VIN (returns 0 if not found)
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The sheet to search
 * @param {string} vin - The VIN to search for
 * @returns {number} - Row number (1-based) or 0 if not found
 */
function findRowByVIN(sheet, vin) {
  if (!vin || vin.length < 11) return 0;

  const data = sheet.getDataRange().getValues();
  const vinClean = String(vin).trim().toUpperCase();

  for (let i = 1; i < data.length; i++) {
    const rowVin = String(data[i][COL.VIN] || '').trim().toUpperCase();
    if (rowVin && rowVin === vinClean) {
      Logger.log('VIN match found: "' + vin + '" in row ' + (i + 1));
      return i + 1; // 1-based row number
    }
  }

  return 0;
}

/**
 * Normalize RO/PO number for fuzzy matching
 * Removes common suffixes like -1, -A, _REV, etc.
 * @param {string} ro - Raw RO/PO number
 * @returns {string} - Normalized RO for matching
 */
function normalizeRO(ro) {
  if (!ro) return '';
  let normalized = String(ro).trim();
  // Remove common suffixes: -PM, -1, -A, _REV, -REV, -FINAL, etc.
  // Pattern handles: 12345-PM, 12345-1, 12345-A, 12345_REV, 12345-REV1, etc.
  normalized = normalized.replace(/[-_]?(REV|rev|PM|pm|FINAL|final)?\d*$/i, '');
  normalized = normalized.replace(/[-_]?[A-Za-z]{1,3}$/i, '');  // Up to 3 letter suffix
  return normalized.trim();
}

/**
 * Find row number by RO/PO (returns 0 if not found)
 * First tries exact match, then falls back to fuzzy/normalized match,
 * then numeric prefix match for partial RO numbers.
 */
function findRowByRO(sheet, roPo) {
  const data = sheet.getDataRange().getValues();
  const roPoStr = String(roPo).trim().toLowerCase();

  // Extract just the numeric portion from input
  const numericInput = String(roPo).replace(/[^0-9]/g, '');

  // First pass: exact match
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.RO_PO]).trim().toLowerCase() === roPoStr) {
      return i + 1; // 1-based row number
    }
  }

  // Second pass: fuzzy match using normalized RO
  const normalizedIncoming = normalizeRO(roPo).toLowerCase();
  if (normalizedIncoming) {
    for (let i = 1; i < data.length; i++) {
      const normalizedExisting = normalizeRO(data[i][COL.RO_PO]).toLowerCase();
      if (normalizedExisting === normalizedIncoming) {
        Logger.log('Fuzzy RO match: "' + roPo + '" matched existing "' + data[i][COL.RO_PO] + '"');
        return i + 1; // 1-based row number
      }
    }
  }

  // Third pass: numeric prefix match (for cases like "11999" matching "11999-PM")
  if (numericInput && numericInput.length >= 4) {
    for (let i = 1; i < data.length; i++) {
      const existingRO = String(data[i][COL.RO_PO]).trim();
      const existingNumeric = existingRO.replace(/[^0-9]/g, '');

      // Check if the existing RO STARTS WITH the numeric input
      // e.g., "11999-PM" starts with numeric "11999"
      if (existingRO.toLowerCase().startsWith(numericInput.toLowerCase()) ||
          existingNumeric === numericInput) {
        Logger.log('Numeric prefix match: "' + roPo + '" matched existing "' + existingRO + '"');
        return i + 1;
      }
    }
  }

  return 0;
}

/**
 * Create a new schedule row
 */
function createNewRow(sheet, data, roPo) {
  const rawTimestamp = data.date_logged || new Date().toISOString();
  const timestamp = formatTimestamp(rawTimestamp);

  const vehicle = data.vehicle || data.vehicle_info || buildVehicleString(data);
  const status = data.status || data.status_from_shop || 'New';

  let scheduledDate = data.scheduled_date || data.scheduledDate || '';
  let scheduledTime = data.scheduled_time || data.scheduledTime || '';
  if (data.scheduled && !scheduledDate) {
    const parts = data.scheduled.split(' ');
    scheduledDate = parts[0] || '';
    scheduledTime = parts.slice(1).join(' ') || '';
  }

  const shopName = data.shop_name || data.shopName || data.shop || '';
  const vin = data.vin || '';

  // Log VIN validation status on new row creation
  if (vin) {
    if (!isValidVinFormat(vin)) {
      Logger.log('⚠️ NEW ROW: VIN may be invalid (false positive?): ' + vin);
    } else {
      Logger.log('NEW ROW: Valid VIN: ' + vin);
    }
  }

  // Initialize Flow History with creation entry (Column T)
  const initialFlowEntry = timestamp + '  NEW          Row created';
  const flowHistory = data.flow_history || data.flowHistory || initialFlowEntry;

  // OEM Position Statement links (Column U)
  const oemPosition = data.oem_position || data.oemPosition || data.oem_links || '';

  // Build new row (A through U = 21 columns)
  const newRow = [
    timestamp,                                                    // A: Timestamp
    shopName,                                                     // B: Shop Name
    roPo,                                                         // C: RO/PO
    vin,                                                          // D: VIN
    vehicle,                                                      // E: Vehicle
    status,                                                       // F: Status
    scheduledDate,                                                // G: Scheduled Date
    scheduledTime,                                                // H: Scheduled Time
    data.technician || '',                                        // I: Technician
    data.required_calibrations || data.requiredCalibrations || '', // J: Required Cals
    data.completed_calibrations || data.completedCalibrations || '', // K: Completed Cals
    data.dtcs || '',                                              // L: DTCs
    data.revv_report_pdf || data.revvReportPdf || '',            // M: Revv PDF
    data.post_scan_pdf || data.postScanPdf || '',                // N: PostScan PDF
    data.invoice_pdf || data.invoicePdf || '',                   // O: Invoice PDF
    data.invoice_number || data.invoiceNumber || '',             // P: Invoice Number
    data.invoice_amount || data.invoiceAmount || '',             // Q: Invoice Amount
    data.invoice_date || data.invoiceDate || '',                 // R: Invoice Date
    data.notes || data.shop_notes || '',                         // S: Notes (short preview)
    flowHistory,                                                  // T: Flow History
    oemPosition,                                                  // U: OEM Position Statement links
    data.estimate_pdf || data.estimatePdf || ''                  // V: Estimate PDF link
  ];

  sheet.appendRow(newRow);

  // Apply Column T formatting after insert
  applyColumnTFormatting(sheet);

  return {
    success: true,
    message: 'Created new schedule row',
    roPo: roPo,
    rowNumber: sheet.getLastRow()
  };
}

/**
 * Update an existing schedule row
 * IMPORTANT: Preserves existing shop_name, VIN, and vehicle if already set
 * This prevents Revv Reports from overwriting data from the original estimate
 */
function updateExistingRow(sheet, rowNum, data) {
  const range = sheet.getRange(rowNum, 1, 1, TOTAL_COLUMNS);
  const curr = range.getValues()[0];

  // PRESERVE existing shop_name - only set if currently empty
  // This prevents Revv Reports from overwriting the shop name from the estimate
  const existingShopName = curr[COL.SHOP_NAME] || '';
  const newShopName = data.shop_name || data.shopName || data.shop || '';
  const shopName = existingShopName || newShopName;

  // VIN HANDLING: Allow update from Revv Report if existing VIN is invalid
  // This fixes the bug where garbage VINs (like ALLDATA ref numbers) block correct VINs
  const existingVin = curr[COL.VIN] || '';
  const newVin = data.vin || '';
  let vin = existingVin;

  // Check if we should update the VIN
  const hasRevvReport = data.revv_report_pdf || data.revvReportPdf || data.isRevvReport;
  const existingVinValid = isValidVinFormat(existingVin);
  const newVinValid = isValidVinFormat(newVin);

  if (newVin && newVinValid) {
    if (!existingVin) {
      // No existing VIN - use new one
      vin = newVin;
      Logger.log('VIN set (was empty): ' + newVin);
    } else if (!existingVinValid) {
      // Existing VIN is garbage (false positive like ALLDATA ref) - replace it
      vin = newVin;
      Logger.log('VIN UPDATED (existing was invalid): "' + existingVin + '" → "' + newVin + '"');
    } else if (hasRevvReport && data.updateVINFromRevv) {
      // Explicit flag to update VIN from Revv Report
      vin = newVin;
      Logger.log('VIN UPDATED (explicit Revv flag): "' + existingVin + '" → "' + newVin + '"');
    }
    // else: keep existing valid VIN
  } else if (!existingVin && newVin) {
    // Even if new VIN is invalid, use it if nothing else available
    vin = newVin;
    Logger.log('VIN set (new may be invalid): ' + newVin);
  }

  // PRESERVE existing vehicle - only set if currently empty
  const existingVehicle = curr[COL.VEHICLE] || '';
  const newVehicle = data.vehicle || data.vehicle_info || buildVehicleString(data) || '';
  const vehicle = existingVehicle || newVehicle;

  // === STATUS PROTECTION: Prevent downgrade from higher-priority statuses ===
  // Status hierarchy: Completed > Scheduled > Rescheduled > Ready > New
  // Only allow status to go UP, never DOWN
  const STATUS_PRIORITY = {
    'Completed': 5,
    'Scheduled': 4,
    'Rescheduled': 3,
    'Ready': 2,
    'New': 1,
    '': 0
  };

  const existingStatus = curr[COL.STATUS] || '';
  const proposedStatus = data.status || data.status_from_shop || existingStatus;
  const existingPriority = STATUS_PRIORITY[existingStatus] || 0;
  const proposedPriority = STATUS_PRIORITY[proposedStatus] || 0;

  let status;
  if (existingStatus && existingPriority > proposedPriority) {
    Logger.log('STATUS PROTECTION: Keeping "' + existingStatus + '" (priority ' + existingPriority + ') instead of "' + proposedStatus + '" (priority ' + proposedPriority + ')');
    status = existingStatus;
  } else {
    status = proposedStatus;
  }
  // === END STATUS PROTECTION ===

  let scheduledDate = data.scheduled_date || data.scheduledDate || curr[COL.SCHEDULED_DATE];
  let scheduledTime = data.scheduled_time || data.scheduledTime || curr[COL.SCHEDULED_TIME];
  if (data.scheduled && !data.scheduled_date) {
    const parts = data.scheduled.split(' ');
    scheduledDate = parts[0] || scheduledDate;
    scheduledTime = parts.slice(1).join(' ') || scheduledTime;
  }

  // Handle notes - DO NOT duplicate
  let notes = curr[COL.NOTES] || '';
  if (data.notes !== undefined && data.notes !== null && data.notes !== '' && data.notes !== notes) {
    notes = data.notes;
  } else if (data.shop_notes !== undefined && data.shop_notes !== null && data.shop_notes !== '') {
    notes = data.shop_notes;
  }

  // ========= FIXED: Allow RO update from Revv when current is garbage =========
  // Also handle newROFromRevv: when Revv has fuller RO (e.g., "3080-ENT") but we matched on base ("3080")
  let roPo = curr[COL.RO_PO] || '';
  const incomingRO = data.roPo || data.ro_number || '';
  const newROFromRevv = data.newROFromRevv || '';  // Full RO from Revv PDF (e.g., "3080-ENT")

  if (incomingRO && incomingRO.trim()) {
    const currentHasDigits = /\d/.test(roPo);
    const incomingHasDigits = /\d/.test(incomingRO);
    const currentIsGarbage = !roPo ||
                             roPo.length < 4 ||
                             !currentHasDigits ||
                             roPo.toUpperCase() === 'LICY' ||
                             roPo.toUpperCase() === 'UNKNOWN';

    // Update RO if current is garbage OR explicitly flagged for update from Revv
    if ((currentIsGarbage && incomingHasDigits) || data.updateROFromRevv) {
      // Prefer newROFromRevv (full Revv RO like "3080-ENT") over incomingRO (matched base "3080")
      const targetRO = (newROFromRevv && newROFromRevv.trim()) ? newROFromRevv : incomingRO;
      Logger.log('Updating RO from "' + roPo + '" to "' + targetRO + '"' + (newROFromRevv ? ' (from Revv)' : ''));
      roPo = targetRO;
    }
  }
  // ====================================================

  // Handle Flow History (Column T) - append new entries, don't replace
  let flowHistory = curr[COL.FLOW_HISTORY] || '';
  const newFlowEntry = data.flow_history || data.flowHistory || '';
  if (newFlowEntry && newFlowEntry.trim().length > 0) {
    // Append new entry to existing history
    flowHistory = flowHistory ? flowHistory + '\n' + newFlowEntry : newFlowEntry;
  }

  // Handle OEM Position - update if new data provided
  let oemPosition = curr[COL.OEM_POSITION] || '';
  const newOemPosition = data.oem_position || data.oemPosition || data.oem_links || '';
  if (newOemPosition && newOemPosition.trim().length > 0) {
    oemPosition = newOemPosition;
  }

  const updatedRow = [
    curr[COL.TIMESTAMP],                                          // A: Keep original timestamp
    shopName,                                                     // B: Shop Name
    roPo,                                                         // C: RO/PO
    vin,                                                          // D: VIN
    vehicle,                                                      // E: Vehicle
    status,                                                       // F: Status
    scheduledDate,                                                // G: Scheduled Date
    scheduledTime,                                                // H: Scheduled Time
    data.technician || curr[COL.TECHNICIAN],                      // I: Technician
    data.required_calibrations || data.requiredCalibrations || curr[COL.REQUIRED_CALS], // J
    data.completed_calibrations || data.completedCalibrations || curr[COL.COMPLETED_CALS], // K
    data.dtcs || curr[COL.DTCS],                                  // L: DTCs
    data.revv_report_pdf || data.revvReportPdf || curr[COL.REVV_PDF], // M
    data.post_scan_pdf || data.postScanPdf || curr[COL.POSTSCAN_PDF], // N
    data.invoice_pdf || data.invoicePdf || curr[COL.INVOICE_PDF], // O
    data.invoice_number || data.invoiceNumber || curr[COL.INVOICE_NUM], // P
    data.invoice_amount || data.invoiceAmount || curr[COL.INVOICE_AMOUNT], // Q
    data.invoice_date || data.invoiceDate || curr[COL.INVOICE_DATE], // R
    notes,                                                        // S: Notes (short preview)
    flowHistory,                                                  // T: Flow History
    oemPosition,                                                  // U: OEM Position Statement links
    data.estimate_pdf || data.estimatePdf || curr[COL.ESTIMATE_PDF] || '' // V: Estimate PDF link
  ];

  range.setValues([updatedRow]);

  // Apply Column T formatting after update
  applyColumnTFormatting(sheet);

  return {
    success: true,
    message: 'Updated schedule row',
    roPo: roPo,
    rowNumber: rowNum
  };
}

/**
 * Tech-only update - ONLY updates allowed tech columns
 * NEVER overwrites: Shop Name (B), VIN (D), Vehicle (E), Required Cals (J)
 * CAN update: Status (F), Technician (I), DTCs (L), Notes (S) append-only
 */
function techUpdateRow(data) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    return { success: false, error: 'Sheet not found' };
  }

  const roPo = String(data.roPo || data.ro_number || '').trim();
  if (!roPo) {
    return { success: false, error: 'RO/PO number required' };
  }

  const rowNum = findRowByRO(sheet, roPo);
  if (rowNum === 0) {
    return { success: false, error: `RO ${roPo} not found. Must be registered by OPS first.` };
  }

  const range = sheet.getRange(rowNum, 1, 1, TOTAL_COLUMNS);
  const curr = range.getValues()[0];

  // ONLY update allowed columns - preserve protected fields
  // Accept status from either 'status' or 'status_from_tech' field
  const newStatus = data.status || data.status_from_tech || '';
  const normalizedStatus = newStatus ? normalizeStatus(newStatus) : curr[COL.STATUS];

  const updatedRow = [
    curr[COL.TIMESTAMP],                                          // A: KEEP
    curr[COL.SHOP_NAME],                                          // B: PROTECTED - KEEP
    curr[COL.RO_PO],                                              // C: KEEP
    curr[COL.VIN],                                                // D: PROTECTED - KEEP
    curr[COL.VEHICLE],                                            // E: PROTECTED - KEEP
    normalizedStatus,                                             // F: Can update (normalized)
    curr[COL.SCHEDULED_DATE],                                     // G: KEEP
    curr[COL.SCHEDULED_TIME],                                     // H: KEEP
    data.technician || curr[COL.TECHNICIAN],                      // I: Can update
    curr[COL.REQUIRED_CALS],                                      // J: PROTECTED - KEEP
    data.completed_calibrations || curr[COL.COMPLETED_CALS],      // K: Can update
    data.dtcs || curr[COL.DTCS],                                  // L: Can update
    curr[COL.REVV_PDF],                                           // M: KEEP
    data.post_scan_pdf || curr[COL.POSTSCAN_PDF],                // N: Can update
    curr[COL.INVOICE_PDF],                                        // O: KEEP
    curr[COL.INVOICE_NUM],                                        // P: KEEP
    curr[COL.INVOICE_AMOUNT],                                     // Q: KEEP
    curr[COL.INVOICE_DATE],                                       // R: KEEP
    data.notes ? (curr[COL.NOTES] ? curr[COL.NOTES] + ' | ' + data.notes : data.notes) : curr[COL.NOTES], // S: Append
    data.flowHistory || data.flow_history || curr[COL.FLOW_HISTORY] || '', // T: Flow History - append new entries
    curr[COL.OEM_POSITION] || '',                                 // U: KEEP
    curr[COL.ESTIMATE_PDF] || ''                                  // V: KEEP
  ];

  range.setValues([updatedRow]);

  // EXPLICIT STATUS WRITE - Belt and suspenders approach
  // Write status directly to Column F (index 5, so +1 = column 6) to ensure it's set
  if (newStatus) {
    Logger.log('techUpdateRow: Setting status to: ' + normalizedStatus + ' in row ' + rowNum + ' (Column F)');
    sheet.getRange(rowNum, COL.STATUS + 1).setValue(normalizedStatus);
    SpreadsheetApp.flush();  // Force write to sheet immediately
    Logger.log('techUpdateRow: Status write complete for RO ' + roPo);
  }

  return {
    success: true,
    message: 'Tech update applied',
    roPo: roPo,
    rowNumber: rowNum,
    statusUpdated: newStatus ? normalizedStatus : null,
    previousStatus: curr[COL.STATUS] || 'unknown',
    flowHistoryUpdated: !!(data.flowHistory || data.flow_history)
  };
}

/**
 * Append note to existing row (doesn't overwrite)
 */
function appendTechNote(data) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    return { success: false, error: 'Sheet not found' };
  }

  const roPo = String(data.roPo || data.ro_number || '').trim();
  const rowNum = findRowByRO(sheet, roPo);

  if (rowNum === 0) {
    return { success: false, error: `RO ${roPo} not found` };
  }

  const notesCell = sheet.getRange(rowNum, COL.NOTES + 1);
  const existingNotes = notesCell.getValue() || '';
  const newNote = data.note || data.notes || '';

  if (newNote) {
    const updatedNotes = existingNotes
      ? `${existingNotes} | ${newNote}`
      : newNote;
    notesCell.setValue(updatedNotes);
  }

  return {
    success: true,
    message: 'Note appended',
    roPo: roPo
  };
}

/**
 * Get schedule row by RO/PO
 */
function getScheduleByRO(roPo) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    return { success: false, error: 'Sheet not found' };
  }

  const rowNum = findRowByRO(sheet, roPo);
  if (rowNum === 0) {
    return { success: false, found: false, error: `RO ${roPo} not found` };
  }

  const data = sheet.getRange(rowNum, 1, 1, TOTAL_COLUMNS).getValues()[0];

  return {
    success: true,
    found: true,
    data: {
      timestamp: data[COL.TIMESTAMP],
      shop_name: data[COL.SHOP_NAME],
      ro_po: data[COL.RO_PO],
      vin: data[COL.VIN],
      vehicle: data[COL.VEHICLE],
      status: data[COL.STATUS],
      scheduled_date: data[COL.SCHEDULED_DATE],
      scheduled_time: data[COL.SCHEDULED_TIME],
      technician: data[COL.TECHNICIAN],
      required_calibrations: data[COL.REQUIRED_CALS],
      completed_calibrations: data[COL.COMPLETED_CALS],
      dtcs: data[COL.DTCS],
      revv_pdf: data[COL.REVV_PDF],
      postscan_pdf: data[COL.POSTSCAN_PDF],
      invoice_pdf: data[COL.INVOICE_PDF],
      invoice_number: data[COL.INVOICE_NUM],
      invoice_amount: data[COL.INVOICE_AMOUNT],
      invoice_date: data[COL.INVOICE_DATE],
      notes: data[COL.NOTES],
      flow_history: data[COL.FLOW_HISTORY],
      flowHistory: data[COL.FLOW_HISTORY],
      oem_position: data[COL.OEM_POSITION] || '',
      estimate_pdf: data[COL.ESTIMATE_PDF] || ''
    },
    rowNumber: rowNum
  };
}

/**
 * Lookup a schedule row by VIN only
 * Used as fallback when shop name is unknown (e.g., Revv Report arrives first)
 * @param {string} vin - The VIN to search for
 * @returns {Object} - { success, found, data, rowNumber } or { success: false, found: false }
 */
function lookupByVIN(vin) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    return { success: false, found: false, error: 'Sheet not found' };
  }

  if (!vin || vin.length < 11) {
    return { success: false, found: false, error: 'Invalid VIN' };
  }

  const vinUpper = String(vin).toUpperCase().trim();
  const data = sheet.getDataRange().getValues();

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const rowVin = String(data[i][COL.VIN] || '').toUpperCase().trim();
    if (rowVin === vinUpper) {
      return {
        success: true,
        found: true,
        data: {
          shop_name: data[i][COL.SHOP_NAME] || '',
          ro_po: data[i][COL.RO_PO] || '',
          vin: data[i][COL.VIN] || '',
          vehicle: data[i][COL.VEHICLE] || '',
          status: data[i][COL.STATUS] || ''
        },
        rowNumber: i + 1
      };
    }
  }

  return { success: true, found: false };
}

/**
 * Append a single entry to the Flow History column for a given RO
 * Used by email responder to log when confirmations are sent
 * @param {string} roPo - The RO/PO number
 * @param {string} flowEntry - The flow history entry to append
 * @returns {Object} - { success, message } or { success: false, error }
 */
function appendFlowHistory(roPo, flowEntry) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet || !roPo) {
    return { success: false, error: 'Sheet not found or RO missing' };
  }

  const rowNum = findRowByRO(sheet, roPo);
  if (rowNum === 0) {
    return { success: false, error: 'RO not found: ' + roPo };
  }

  const currentHistory = sheet.getRange(rowNum, COL.FLOW_HISTORY + 1).getValue() || '';
  const newHistory = currentHistory ? currentHistory + '\n' + flowEntry : flowEntry;
  sheet.getRange(rowNum, COL.FLOW_HISTORY + 1).setValue(newHistory);

  return { success: true, message: 'Flow history updated', roPo: roPo };
}

/**
 * Get row by RO/PO or VIN - used by Node.js to fetch existing data
 * Priority: VIN (most reliable) > RO/PO
 */
function getRowByROOrVIN(data) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    return { success: false, row: null };
  }

  const roPo = String(data.roPo || '').trim();
  const vin = String(data.vin || '').trim();
  const dataRange = sheet.getDataRange().getValues();

  // Priority 1: Match by VIN (most reliable)
  if (vin && vin.length === 17) {
    for (let i = 1; i < dataRange.length; i++) {
      if (String(dataRange[i][COL.VIN]).trim() === vin) {
        Logger.log('Found row by VIN: ' + vin + ' at row ' + (i + 1));
        return {
          success: true,
          row: {
            roPo: dataRange[i][COL.RO_PO],
            vin: dataRange[i][COL.VIN],
            vehicle_info: dataRange[i][COL.VEHICLE],
            required_calibrations: dataRange[i][COL.REQUIRED_CALS],
            shop_name: dataRange[i][COL.SHOP_NAME]
          }
        };
      }
    }
  }

  // Priority 2: Match by exact RO
  if (roPo) {
    for (let i = 1; i < dataRange.length; i++) {
      if (String(dataRange[i][COL.RO_PO]).trim() === roPo) {
        Logger.log('Found row by RO: ' + roPo + ' at row ' + (i + 1));
        return {
          success: true,
          row: {
            roPo: dataRange[i][COL.RO_PO],
            vin: dataRange[i][COL.VIN],
            vehicle_info: dataRange[i][COL.VEHICLE],
            required_calibrations: dataRange[i][COL.REQUIRED_CALS],
            shop_name: dataRange[i][COL.SHOP_NAME]
          }
        };
      }
    }
  }

  // Priority 3: Match by normalized RO (12313-1 matches 12313)
  if (roPo) {
    const normalizedRO = roPo.replace(/-.*$/, '');
    for (let i = 1; i < dataRange.length; i++) {
      const existingRO = String(dataRange[i][COL.RO_PO]).trim().replace(/-.*$/, '');
      if (existingRO === normalizedRO) {
        Logger.log('Found row by normalized RO: ' + roPo + ' at row ' + (i + 1));
        return {
          success: true,
          row: {
            roPo: dataRange[i][COL.RO_PO],
            vin: dataRange[i][COL.VIN],
            vehicle_info: dataRange[i][COL.VEHICLE],
            required_calibrations: dataRange[i][COL.REQUIRED_CALS],
            shop_name: dataRange[i][COL.SHOP_NAME]
          }
        };
      }
    }
  }

  return { success: false, row: null };
}

/**
 * Search schedule by query
 */
function searchSchedule(query) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet || !query) {
    return { success: false, error: 'Sheet not found or query empty' };
  }

  const data = sheet.getDataRange().getValues();
  const results = [];
  const queryLower = query.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const searchable = [
      row[COL.SHOP_NAME],
      row[COL.RO_PO],
      row[COL.VIN],
      row[COL.VEHICLE]
    ].join(' ').toLowerCase();

    if (searchable.includes(queryLower)) {
      results.push({
        rowNumber: i + 1,
        shop_name: row[COL.SHOP_NAME],
        ro_po: row[COL.RO_PO],
        vin: row[COL.VIN],
        vehicle: row[COL.VEHICLE],
        status: row[COL.STATUS]
      });
    }
  }

  return {
    success: true,
    count: results.length,
    results: results.slice(0, 10)
  };
}

/**
 * Get rows by status
 */
function getByStatus(status) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet || !status) {
    return { success: false, error: 'Sheet not found or status empty' };
  }

  const data = sheet.getDataRange().getValues();
  const results = [];
  const statusLower = status.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.STATUS]).toLowerCase() === statusLower) {
      results.push({
        rowNumber: i + 1,
        shop_name: data[i][COL.SHOP_NAME],
        ro_po: data[i][COL.RO_PO],
        vehicle: data[i][COL.VEHICLE],
        scheduled_date: data[i][COL.SCHEDULED_DATE],
        technician: data[i][COL.TECHNICIAN]
      });
    }
  }

  return {
    success: true,
    status: status,
    count: results.length,
    results: results
  };
}

/**
 * Get shop info
 */
function getShopInfo(shopName) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHOPS_SHEET);

  if (!sheet || !shopName) {
    return { success: false, error: 'Shops sheet not found or name empty' };
  }

  const data = sheet.getDataRange().getValues();
  const nameLower = shopName.toLowerCase();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().includes(nameLower)) {
      return {
        success: true,
        found: true,
        data: {
          name: data[i][0],
          email: data[i][1],
          billing_cc: data[i][2],
          notes: data[i][3]
        }
      };
    }
  }

  return { success: true, found: false };
}

/**
 * Get all shops
 */
function getAllShops() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHOPS_SHEET);

  if (!sheet) {
    return { success: false, error: 'Shops sheet not found' };
  }

  const data = sheet.getDataRange().getValues();
  const shops = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      shops.push({
        name: data[i][0],
        email: data[i][1],
        billing_cc: data[i][2]
      });
    }
  }

  return {
    success: true,
    count: shops.length,
    shops: shops
  };
}

/**
 * Append billing row
 */
function appendBillingRow(data) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(BILLING_SHEET);

  if (!sheet) {
    return { success: false, error: 'Billing sheet not found' };
  }

  const newRow = [
    formatTimestamp(new Date()),
    data.shop_name || data.shopName || '',
    data.ro_po || data.roPo || '',
    data.vin || '',
    data.vehicle || '',
    data.calibration_description || data.calibrationDescription || '',
    data.amount || '',
    data.invoice_number || data.invoiceNumber || '',
    data.invoice_date || data.invoiceDate || '',
    data.invoice_pdf || data.invoicePdf || '',
    data.status || 'Ready to Bill',
    data.notes || ''
  ];

  sheet.appendRow(newRow);

  return {
    success: true,
    message: 'Billing row added',
    rowNumber: sheet.getLastRow()
  };
}

/**
 * Apply Column S & T formatting
 * - Column S (Notes): WRAP text for readability, 300px width
 * - Column T (Full Scrub): CLIP to keep hidden/narrow, 50px width
 * Called after each row insert/update to maintain formatting
 */
function applyColumnTFormatting(sheet) {
  try {
    // Column T (20) - Full Scrub Text - CLIP to keep narrow
    const colT = sheet.getRange('T:T');
    colT.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    sheet.setColumnWidth(20, 50);

    // Column S (19) - Notes Preview - WRAP for readability
    const colS = sheet.getRange('S:S');
    colS.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    sheet.setColumnWidth(19, 300);
  } catch (e) {
    // Ignore formatting errors
    Logger.log('Formatting error: ' + e.message);
  }
}

/**
 * Get or create Scrub_Details sheet (for legacy support)
 */
function getScrubDetailsSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SCRUB_DETAILS_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(SCRUB_DETAILS_SHEET);
    sheet.getRange(1, 1, 1, 5).setValues([['RO/PO', 'Shop', 'VIN', 'Vehicle', 'Full Scrub Text']]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }

  return sheet;
}

/**
 * Get full scrub from Scrub_Details sheet (legacy support)
 */
function getFullScrubFromDetails(roPo) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCRUB_DETAILS_SHEET);

  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(roPo).toLowerCase()) {
      return data[i][4] || null;
    }
  }

  return null;
}

/**
 * PATCH C: Set scheduled date and time for an RO
 * Updates columns G (Scheduled Date), H (Scheduled Time), and I (Technician)
 * Optionally appends override note to column S (Notes)
 *
 * @param {Object} data - { roPo, scheduledDate, scheduledTime, technician, override, notes }
 * @returns {Object} - { success, message, roPo, rowNumber, technician } or { success: false, error }
 */
function setScheduleDateTime(data) {
  const roPo = data.roPo || data.ro_number;

  if (!roPo) {
    return { success: false, error: 'RO/PO number required' };
  }

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    return { success: false, error: 'Schedule sheet not found' };
  }

  const dataRange = sheet.getDataRange().getValues();

  // Find the row with matching RO/PO (Column C = index 2)
  for (let i = 1; i < dataRange.length; i++) {
    const rowRoPo = String(dataRange[i][COL.RO_PO] || '').trim();

    if (rowRoPo === String(roPo).trim()) {
      const rowNumber = i + 1; // 1-based row number

      // Update Scheduled Date (Column G)
      if (data.scheduledDate) {
        sheet.getRange(rowNumber, COL.SCHEDULED_DATE + 1).setValue(data.scheduledDate);
        Logger.log(`Set Scheduled Date for RO ${roPo}: ${data.scheduledDate}`);
      }

      // Update Scheduled Time (Column H)
      if (data.scheduledTime) {
        sheet.getRange(rowNumber, COL.SCHEDULED_TIME + 1).setValue(data.scheduledTime);
        Logger.log(`Set Scheduled Time for RO ${roPo}: ${data.scheduledTime}`);
      }

      // Update Technician (Column I) - auto-assigned by dispatcher
      if (data.technician) {
        sheet.getRange(rowNumber, COL.TECHNICIAN + 1).setValue(data.technician);
        Logger.log(`Set Technician for RO ${roPo}: ${data.technician}`);
      }

      // If override note provided, append to Notes (Column S)
      if (data.notes && data.notes.trim()) {
        const existingNotes = dataRange[i][COL.NOTES] || '';
        const newNotes = existingNotes
          ? `${existingNotes} | ${data.notes}`
          : data.notes;
        sheet.getRange(rowNumber, COL.NOTES + 1).setValue(newNotes);
        Logger.log(`Appended override note for RO ${roPo}: ${data.notes}`);
      }

      return {
        success: true,
        message: 'Schedule updated',
        roPo: roPo,
        rowNumber: rowNumber,
        scheduledDate: data.scheduledDate || '',
        scheduledTime: data.scheduledTime || '',
        technician: data.technician || dataRange[i][COL.TECHNICIAN] || ''
      };
    }
  }

  return {
    success: false,
    error: `RO ${roPo} not found in schedule`,
    roPo: roPo
  };
}

/**
 * Update RO status - used by OPS/TECH assistants for status changes
 * Supports: New, Ready, Scheduled, Completed, Cancelled (5 statuses only)
 * Note: Cancelled can only be set via tech_cancel_job with reason
 * @param {Object} data - { roPo, status, notes }
 * @returns {Object} - { success: boolean, message?: string, error?: string }
 */
function updateROStatus(data) {
  const roPo = data.roPo || data.ro_number;
  const newStatus = data.status;
  const notes = data.notes || '';

  if (!roPo) {
    return { success: false, error: 'RO/PO number required' };
  }

  if (!newStatus) {
    return { success: false, error: 'Status required' };
  }

  // Normalize the status to valid values (handles deprecated statuses)
  const normalizedStatus = normalizeStatus(newStatus);
  if (!VALID_STATUSES.includes(normalizedStatus)) {
    return { success: false, error: `Invalid status: ${newStatus}. Valid: ${VALID_STATUSES.join(', ')}` };
  }

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    return { success: false, error: 'Schedule sheet not found' };
  }

  const dataRange = sheet.getDataRange().getValues();

  // Find the row with matching RO/PO (Column C = index 2)
  for (let i = 1; i < dataRange.length; i++) {
    const rowRoPo = String(dataRange[i][COL.RO_PO] || '').trim();

    if (rowRoPo === String(roPo).trim()) {
      const rowNumber = i + 1; // 1-based row number

      // Update Status (Column F) - use normalized status
      sheet.getRange(rowNumber, COL.STATUS + 1).setValue(normalizedStatus);
      Logger.log(`Updated status for RO ${roPo}: ${normalizedStatus}`);

      // Append notes if provided (Column S)
      if (notes && notes.trim()) {
        const existingNotes = dataRange[i][COL.NOTES] || '';
        const newNotes = existingNotes
          ? `${existingNotes} | ${notes}`
          : notes;
        sheet.getRange(rowNumber, COL.NOTES + 1).setValue(newNotes);
        Logger.log(`Appended status note for RO ${roPo}: ${notes}`);
      }

      return {
        success: true,
        message: `Status updated to ${newStatus}`,
        roPo: roPo,
        status: newStatus,
        rowNumber: rowNumber
      };
    }
  }

  return {
    success: false,
    error: `RO ${roPo} not found in schedule`,
    roPo: roPo
  };
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * OEM Portal Links - lookup table for Position Statement access
 * Uses OEM1Stop as central hub - provides direct links to all OEM position statements
 * OEM1Stop is FREE and aggregates all manufacturer links in one place
 */
const OEM_PORTAL_LINKS = {
  // Japanese OEMs - via OEM1Stop
  'toyota': { name: 'Toyota', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/toyota' },
  'lexus': { name: 'Lexus', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/lexus' },
  'scion': { name: 'Scion', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/toyota' },
  'honda': { name: 'Honda', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/honda' },
  'acura': { name: 'Acura', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/acura' },
  'nissan': { name: 'Nissan', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/nissan' },
  'infiniti': { name: 'Infiniti', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/infiniti' },
  'subaru': { name: 'Subaru', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/subaru' },
  'mazda': { name: 'Mazda', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/mazda' },
  'mitsubishi': { name: 'Mitsubishi', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/mitsubishi' },

  // Korean OEMs - via OEM1Stop
  'hyundai': { name: 'Hyundai', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/hyundai' },
  'kia': { name: 'Kia', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/kia' },
  'genesis': { name: 'Genesis', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/genesis' },

  // German OEMs - via OEM1Stop
  'bmw': { name: 'BMW', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/bmw' },
  'mini': { name: 'MINI', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/mini' },
  'mercedes-benz': { name: 'Mercedes-Benz', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/mercedes-benz' },
  'mercedes': { name: 'Mercedes-Benz', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/mercedes-benz' },
  'audi': { name: 'Audi', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/audi' },
  'volkswagen': { name: 'Volkswagen', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/volkswagen' },
  'vw': { name: 'Volkswagen', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/volkswagen' },
  'porsche': { name: 'Porsche', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/porsche' },

  // American OEMs - via OEM1Stop
  'ford': { name: 'Ford', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/ford' },
  'lincoln': { name: 'Lincoln', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/lincoln' },
  'chevrolet': { name: 'Chevrolet', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/chevrolet' },
  'chevy': { name: 'Chevrolet', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/chevrolet' },
  'gmc': { name: 'GMC', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/gmc' },
  'buick': { name: 'Buick', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/buick' },
  'cadillac': { name: 'Cadillac', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/cadillac' },
  'chrysler': { name: 'Chrysler', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/chrysler' },
  'dodge': { name: 'Dodge', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/dodge' },
  'jeep': { name: 'Jeep', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/jeep' },
  'ram': { name: 'Ram', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/ram' },
  'fiat': { name: 'Fiat', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/fiat' },
  'alfa romeo': { name: 'Alfa Romeo', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/alfa-romeo' },
  'tesla': { name: 'Tesla', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/tesla' },

  // European OEMs - via OEM1Stop
  'volvo': { name: 'Volvo', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/volvo' },
  'jaguar': { name: 'Jaguar', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/jaguar' },
  'land rover': { name: 'Land Rover', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/land-rover' },
  'range rover': { name: 'Land Rover', portal: 'OEM1Stop', url: 'https://www.oem1stop.com/content/land-rover' }
};

/**
 * Get OEM portal link for a vehicle make
 * @param {string} make - Vehicle make (e.g., "Toyota", "Honda")
 * @returns {Object|null} - { name, portal, url } or null if not found
 */
function getOemPortalLink(make) {
  if (!make) return null;
  const makeLower = make.toLowerCase().trim();
  return OEM_PORTAL_LINKS[makeLower] || null;
}

/**
 * Get OEM portal link from vehicle string (Year Make Model)
 * @param {string} vehicle - Vehicle string (e.g., "2023 Toyota Camry")
 * @returns {Object|null} - { name, portal, url } or null if not found
 */
function getOemPortalFromVehicle(vehicle) {
  if (!vehicle) return null;

  const vehicleLower = vehicle.toLowerCase();

  // Check each OEM make against the vehicle string
  for (const [key, value] of Object.entries(OEM_PORTAL_LINKS)) {
    if (vehicleLower.includes(key)) {
      return value;
    }
  }

  return null;
}

/**
 * Populate Column U (OEM Position) for a row based on vehicle make
 * Called from sidebar or can be run on a range
 * Uses RichText to create clickable hyperlinks
 * @param {number} rowNum - Row number to update
 * @returns {Object} - { success: boolean, message: string }
 */
function populateOemLinkForRow(rowNum) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (!sheet) return { success: false, message: 'Sheet not found' };

  const rowData = sheet.getRange(rowNum, 1, 1, TOTAL_COLUMNS).getValues()[0];
  const vehicle = rowData[COL.VEHICLE] || '';
  const currentOem = rowData[COL.OEM_POSITION] || '';

  // Skip if already has OEM link
  if (currentOem && currentOem.length > 0) {
    return { success: true, message: 'OEM link already populated' };
  }

  const oemInfo = getOemPortalFromVehicle(vehicle);
  if (!oemInfo) {
    return { success: false, message: 'Could not determine OEM from vehicle: ' + vehicle };
  }

  // Set the OEM link as clickable RichText hyperlink
  setOemLinkAsRichText(sheet, rowNum, oemInfo.name, oemInfo.url);

  return { success: true, message: 'Added OEM link: ' + oemInfo.url };
}

/**
 * Set OEM link as clickable RichText hyperlink
 * This ensures links open in browser, not Google Drive
 * @param {Sheet} sheet - The sheet to update
 * @param {number} rowNum - Row number
 * @param {string} makeName - OEM name (e.g., "Toyota")
 * @param {string} url - The OEM1Stop URL
 */
function setOemLinkAsRichText(sheet, rowNum, makeName, url) {
  const label = makeName + ' Position Statements';
  const richText = SpreadsheetApp.newRichTextValue()
    .setText(label)
    .setLinkUrl(url)
    .build();
  sheet.getRange(rowNum, COL.OEM_POSITION + 1).setRichTextValue(richText);
}

/**
 * Populate OEM links for all rows missing them
 * Can be run from menu
 */
function populateAllMissingOemLinks() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Sheet not found');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('No data rows found');
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, TOTAL_COLUMNS).getValues();
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < data.length; i++) {
    const vehicle = data[i][COL.VEHICLE] || '';
    const currentOem = data[i][COL.OEM_POSITION] || '';

    // Skip if already has OEM link
    if (currentOem && currentOem.length > 0) {
      skipped++;
      continue;
    }

    const oemInfo = getOemPortalFromVehicle(vehicle);
    if (oemInfo) {
      // Use RichText for clickable hyperlink
      setOemLinkAsRichText(sheet, i + 2, oemInfo.name, oemInfo.url);
      updated++;
    } else {
      failed++;
    }
  }

  SpreadsheetApp.getUi().alert(
    'OEM Links Update Complete\n\n' +
    'Updated: ' + updated + '\n' +
    'Already populated: ' + skipped + '\n' +
    'Could not determine OEM: ' + failed
  );
}

/**
 * Create custom menu on spreadsheet open
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('ADAS Tools')
    .addItem('View Job Details', 'openJobDetailsSidebar')

    .addSeparator()

    .addSubMenu(ui.createMenu('Admin & Setup')
      .addItem('Setup Status Column (6 Statuses)', 'setupStatusColumn')
      .addItem('Apply Status Colors', 'applyStatusColorFormatting')
      .addItem('Install Auto-Refresh Trigger', 'installSelectionTrigger')
      .addItem('Populate OEM Links (All Rows)', 'populateAllMissingOemLinks')
      .addSeparator()
      .addItem('Hide Column T (Flow History)', 'hideColumnT')
      .addItem('Refresh Row Heights', 'reduceRowHeights')
    )

    .addToUi();
}

/**
 * Trigger that fires when selection changes
 * Updates the sidebar if it's open
 */
function onSelectionChange(e) {
  const range = e.range;
  const sheet = range.getSheet();

  // Only trigger for ADAS_Schedule sheet
  if (sheet.getName() !== SCHEDULE_SHEET) return;

  // Only trigger for data rows (not header)
  const row = range.getRow();
  if (row === 1) return;

  // Store selected row for sidebar polling
  PropertiesService.getScriptProperties().setProperty('SELECTED_ROW', row.toString());
}

/**
 * Install the onSelectionChange trigger (run once)
 */
function installSelectionTrigger() {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'onSelectionChange') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new trigger
  ScriptApp.newTrigger('onSelectionChange')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onSelectionChange()
    .create();

  SpreadsheetApp.getUi().alert('Auto-refresh trigger installed! The sidebar will now update when you select different rows.');
}

/**
 * Get currently selected row (for sidebar polling)
 * ALWAYS return live active cell - don't rely on stored property
 */
function getSelectedRow() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (sheet) {
    return sheet.getActiveCell().getRow();
  }
  return null;
}

/**
 * Get current active row number (alternative helper for sidebar polling)
 */
function getActiveRowNumber() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (!sheet) return 1;
  return sheet.getActiveCell().getRow();
}

/**
 * Track sidebar open state (called when sidebar closes)
 */
function closeSidebar() {
  PropertiesService.getUserProperties().setProperty('sidebarOpen', 'false');
}

/**
 * Setup the Status column with dropdown and colors
 * Call from: ADAS Tools → Admin & Setup → Setup Status Column
 */
function setupStatusColumn() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet 'ADAS_Schedule' not found.");
    return;
  }

  const statusRange = sheet.getRange('F2:F1000');

  // 1. DATA VALIDATION (DROPDOWN) - 6 STATUSES
  const validationRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(VALID_STATUSES, true)
    .setAllowInvalid(false)
    .setHelpText('Select: New, Ready, Scheduled, Rescheduled, Completed, Cancelled')
    .build();

  statusRange.setDataValidation(validationRule);

  // 2. CONDITIONAL FORMATTING (COLORS) - using STATUS_CONFIG
  const existingRules = sheet.getConditionalFormatRules();
  const newRules = existingRules.filter(function(rule) {
    const ranges = rule.getRanges();
    return !ranges.some(function(r) {
      return r.getColumn() === 6 && r.getNumColumns() === 1;
    });
  });

  for (var i = 0; i < VALID_STATUSES.length; i++) {
    var status = VALID_STATUSES[i];
    var config = STATUS_CONFIG[status];
    var formatRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status)
      .setBackground(config.background)
      .setFontColor(config.fontColor)
      .setBold(true)
      .setRanges([statusRange])
      .build();
    newRules.push(formatRule);
  }

  sheet.setConditionalFormatRules(newRules);

  // 3. COLUMN WIDTH
  sheet.setColumnWidth(6, 110);

  SpreadsheetApp.getUi().alert(
    'Status Column Configured!',
    'Column F now has:\n\n' +
    '✓ Dropdown with 6 valid statuses\n' +
    '✓ Color coding applied\n\n' +
    'Statuses: New, Ready, Scheduled, Rescheduled, Completed, Cancelled\n\n' +
    'Note: Cancellation requires calling assistant with a reason.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Hide Column T (Flow History - visible in sidebar only)
 */
function hideColumnT() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (sheet) {
    sheet.hideColumns(20);  // Column T = 20
    SpreadsheetApp.getUi().alert('Column T (Flow History) hidden. View flow history in the sidebar.');
  }
}

/**
 * Open Material UI Job Details Sidebar with status controls
 * 5-STATUS WORKFLOW + AUTO-REFRESH + VIEW-ONLY + FLOW HISTORY
 */
function openJobDetailsSidebar() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet 'ADAS_Schedule' not found.");
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row === 1) {
    SpreadsheetApp.getUi().alert('Please select a data row (not the header).');
    return;
  }

  // Store selected row for auto-refresh
  PropertiesService.getScriptProperties().setProperty('SELECTED_ROW', row.toString());

  const html = buildSidebarHtml(row);
  const htmlOutput = HtmlService.createHtmlOutput(html)
    .setTitle('Job Details')
    .setWidth(380);

  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

/**
 * Build sidebar HTML for a specific row
 */
function buildSidebarHtml(row) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (!sheet || row === 1) return '<html><body>Select a data row.</body></html>';

  const rowData = sheet.getRange(row, 1, 1, TOTAL_COLUMNS).getValues()[0];

  // Extract fields
  const roPo = rowData[COL.RO_PO] || 'Unknown';
  const shopName = rowData[COL.SHOP_NAME] || '';
  const status = normalizeStatus(rowData[COL.STATUS]);
  const vehicle = rowData[COL.VEHICLE] || '';
  const vin = rowData[COL.VIN] || '';
  const requiredCals = rowData[COL.REQUIRED_CALS] || '';
  const technician = rowData[COL.TECHNICIAN] || '';
  const scheduledDate = rowData[COL.SCHEDULED_DATE] || '';
  const scheduledTime = rowData[COL.SCHEDULED_TIME] || '';
  const revvPdfUrl = rowData[COL.REVV_PDF] || '';
  const postScanUrl = rowData[COL.POSTSCAN_PDF] || '';
  const invoiceUrl = rowData[COL.INVOICE_PDF] || '';
  const flowHistory = rowData[COL.FLOW_HISTORY] || '';
  const oemPosition = rowData[COL.OEM_POSITION] || '';
  const estimateUrl = rowData[COL.ESTIMATE_PDF] || '';

  // DEBUG: Log flow history for troubleshooting
  console.log('Flow History for row ' + row + ': "' + flowHistory + '" (Column T index ' + COL.FLOW_HISTORY + ')');

  // Parse calibrations
  const calibrationList = requiredCals
    ? requiredCals.split(/[;,]/).map(function(c) { return c.trim(); }).filter(function(c) { return c.length > 0; })
    : [];

  // Document status
  const hasRevv = !!revvPdfUrl;
  const hasPostScan = !!postScanUrl;
  const hasInvoice = !!invoiceUrl;

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['New'];
  const statusColor = cfg.fontColor;
  const statusIcon = cfg.icon;

  // Flow history entries
  const historyEntries = flowHistory
    ? flowHistory.split('\n').filter(function(e) { return e.trim().length > 0; })
    : [];

  // Build HTML - VIEW ONLY (no status buttons)
  var html = '<!DOCTYPE html>' +
'<html>' +
'<head>' +
'  <base target="_top">' +
'  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">' +
'  <style>' +
'    * { box-sizing: border-box; }' +
'    body { font-family: "Google Sans", Arial, sans-serif; padding: 0; margin: 0; background: #f8f9fa; color: #202124; }' +
'    .header { background: linear-gradient(135deg, #1a73e8 0%, #4285f4 100%); color: white; padding: 24px 20px; }' +
'    .header h2 { margin: 0 0 8px 0; font-size: 20px; font-weight: 500; }' +
'    .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 500; background: ' + statusColor + '; color: white; }' +
'    .content { padding: 16px 20px; }' +
'    .section { background: white; border-radius: 12px; padding: 16px 20px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(60,64,67,0.1); }' +
'    .section-title { font-weight: 500; color: #202124; margin-bottom: 14px; font-size: 13px; display: flex; align-items: center; gap: 10px; text-transform: uppercase; letter-spacing: 0.5px; }' +
'    .section-title .material-icons { font-size: 20px; color: #5f6368; }' +
'    .field { margin-bottom: 10px; }' +
'    .field-label { font-size: 11px; color: #5f6368; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }' +
'    .field-value { font-size: 14px; color: #202124; }' +
'    .cal-item { padding: 8px 12px; background: #e8f0fe; border-radius: 6px; margin-bottom: 6px; font-size: 13px; color: #1967d2; }' +
'    .doc-link { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 8px; margin-bottom: 8px; font-size: 14px; text-decoration: none; transition: all 0.2s; }' +
'    .doc-link .material-icons { font-size: 20px; }' +
'    .doc-link.present { background: #e6f4ea; color: #137333; cursor: pointer; }' +
'    .doc-link.present:hover { background: #ceead6; }' +
'    .doc-link.present .open-icon { margin-left: auto; font-size: 16px; opacity: 0.7; }' +
'    .doc-link.missing { background: #fce8e6; color: #c5221f; }' +
'    .doc-link.pending { background: #fff8e1; color: #ef6c00; }' +
'    .doc-link.oem { background: #fff3e0; color: #e65100; cursor: pointer; }' +
'    .doc-link.oem:hover { background: #ffe0b2; }' +
'    .empty { color: #9aa0a6; font-style: italic; font-size: 13px; }' +
'    .flow-history { max-height: 200px; overflow-y: auto; background: #f8f9fa; border-radius: 8px; padding: 10px; font-family: monospace; font-size: 11px; }' +
'    .flow-entry { padding: 6px 0; border-bottom: 1px solid #e8eaed; color: #3c4043; }' +
'    .flow-entry:last-child { border-bottom: none; }' +
'    .view-notice { background: #e8f0fe; border-radius: 8px; padding: 12px; font-size: 12px; color: #1a73e8; text-align: center; }' +
'  </style>' +
'</head>' +
'<body>' +
'  <div class="header">' +
'    <h2>RO: ' + escapeHtml(roPo) + '</h2>' +
'    <div class="status-badge"><span class="material-icons">' + statusIcon + '</span>' + escapeHtml(status) + '</div>' +
'  </div>' +
'  <div class="content">' +
'    <div class="section">' +
'      <div class="section-title"><span class="material-icons">directions_car</span>Vehicle</div>' +
'      <div class="field"><div class="field-label">Vehicle</div><div class="field-value">' + (vehicle || '<span class="empty">Not specified</span>') + '</div></div>' +
'      <div class="field"><div class="field-label">VIN</div><div class="field-value">' + (vin || '<span class="empty">Not specified</span>') + '</div></div>' +
'      <div class="field"><div class="field-label">Shop</div><div class="field-value">' + (shopName || '<span class="empty">Not specified</span>') + '</div></div>' +
'      <div class="field"><div class="field-label">Technician</div><div class="field-value">' + (technician || '<span class="empty">Not assigned</span>') + '</div></div>' +
'      <div class="field"><div class="field-label">Scheduled</div><div class="field-value">' + (scheduledDate ? escapeHtml(scheduledDate) + (scheduledTime ? ' at ' + escapeHtml(scheduledTime) : '') : '<span class="empty">Not scheduled</span>') + '</div></div>' +
'    </div>' +
'    <div class="section">' +
'      <div class="section-title"><span class="material-icons">build</span>Calibrations' + (status === 'No Cal' ? '' : ' (' + calibrationList.length + ')') + '</div>' +
       (status === 'No Cal'
         ? '<div style="background:#e9ecef;color:#6c757d;padding:12px;border-radius:6px;text-align:center;"><strong>⊘ No calibration required per Revv Report</strong></div>'
         : (calibrationList.length > 0
           ? calibrationList.map(function(c) { return '<div class="cal-item">' + escapeHtml(c) + '</div>'; }).join('')
           : '<div class="empty">Awaiting Revv Report</div>')) +
'    </div>' +
'    <div class="section">' +
'      <div class="section-title"><span class="material-icons">folder</span>Documents</div>' +
       (estimateUrl
         ? '<a href="' + escapeHtml(estimateUrl) + '" target="_blank" class="doc-link present"><span class="material-icons">description</span><span>Estimate PDF</span><span class="material-icons open-icon">open_in_new</span></a>'
         : '<div class="doc-link pending"><span class="material-icons">hourglass_empty</span><span>Estimate - Not uploaded</span></div>') +
       (hasRevv
         ? '<a href="' + escapeHtml(revvPdfUrl) + '" target="_blank" class="doc-link present"><span class="material-icons">check_circle</span><span>Revv Report</span><span class="material-icons open-icon">open_in_new</span></a>'
         : (calibrationList.length > 0
           ? '<div class="doc-link present"><span class="material-icons">check_circle</span><span>Revv Report (processed)</span></div>'
           : '<div class="doc-link missing"><span class="material-icons">cancel</span><span>Revv Report - Missing</span></div>')) +
       (hasPostScan
         ? '<a href="' + escapeHtml(postScanUrl) + '" target="_blank" class="doc-link present"><span class="material-icons">check_circle</span><span>Post Scan</span><span class="material-icons open-icon">open_in_new</span></a>'
         : '<div class="doc-link pending"><span class="material-icons">hourglass_empty</span><span>Post Scan - Pending</span></div>') +
       (hasInvoice
         ? '<a href="' + escapeHtml(invoiceUrl) + '" target="_blank" class="doc-link present"><span class="material-icons">check_circle</span><span>Invoice</span><span class="material-icons open-icon">open_in_new</span></a>'
         : '<div class="doc-link pending"><span class="material-icons">hourglass_empty</span><span>Invoice - Pending</span></div>') +
       (oemPosition
         ? '<a href="' + escapeHtml(oemPosition) + '" target="_blank" class="doc-link oem"><span class="material-icons">business</span><span>OEM Position Statement</span><span class="material-icons open-icon">open_in_new</span></a>'
         : '') +
'    </div>' +
'    <div class="section">' +
'      <div class="section-title"><span class="material-icons">history</span>Flow History</div>' +
'      <div class="flow-history">' + (historyEntries.length > 0 ? historyEntries.map(function(e) { return '<div class="flow-entry">' + escapeHtml(e) + '</div>'; }).join('') : '<div class="empty">No history recorded yet. History will appear when documents are submitted via email.</div>') + '</div>' +
'    </div>' +
'    <div class="view-notice">Status changes are managed by the voice assistant</div>' +
'  </div>' +
'  <script>' +
'    var currentRow = ' + row + ';' +
'    setInterval(function() {' +
'      google.script.run.withSuccessHandler(function(newRow) {' +
'        if (newRow && newRow !== currentRow) {' +
'          currentRow = newRow;' +
'          google.script.run.withSuccessHandler(function(html) {' +
'            if (html) document.body.innerHTML = html.replace(/<body[^>]*>/, "").replace(/<\\/body>/, "");' +
'          }).getSidebarBodyHtml(newRow);' +
'        }' +
'      }).getSelectedRow();' +
'    }, 500);' +
'  </script>' +
'</body>' +
'</html>';

  return html;
}

/**
 * Get sidebar body HTML for auto-refresh (called from sidebar JS)
 */
function getSidebarBodyHtml(row) {
  return buildSidebarHtml(row);
}

/**
 * Apply color formatting to Status column (F)
 * Sets up conditional formatting rules for all status values
 */
function applyStatusColorFormatting() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet 'ADAS_Schedule' not found.");
    return;
  }

  // Clear existing conditional formatting rules for column F only
  const existingRules = sheet.getConditionalFormatRules();
  const newRules = existingRules.filter(function(rule) {
    const ranges = rule.getRanges();
    // Keep rules that don't apply to column F (column 6)
    return !ranges.some(function(r) {
      return r.getColumn() === 6 && r.getNumColumns() === 1;
    });
  });

  // Define the status column range (F2:F1000)
  const statusRange = sheet.getRange('F2:F1000');

  // Status color configurations (FINALIZED December 2024 - 7 statuses)
  const statusColors = [
    { text: 'New', background: '#e8f0fe', fontColor: '#1a73e8' },
    { text: 'Ready', background: '#e6f4ea', fontColor: '#137333' },
    { text: 'No Cal', background: '#e9ecef', fontColor: '#6c757d' },  // Gray - No calibration required
    { text: 'Scheduled', background: '#f3e8fd', fontColor: '#7c3aed' },
    { text: 'Rescheduled', background: '#fff3e0', fontColor: '#e65100' },
    { text: 'Completed', background: '#d2e3fc', fontColor: '#1967d2' },
    { text: 'Cancelled', background: '#fce8e6', fontColor: '#c5221f' }
  ];

  // Create conditional formatting rules for each status
  for (var i = 0; i < statusColors.length; i++) {
    var status = statusColors[i];
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status.text)
      .setBackground(status.background)
      .setFontColor(status.fontColor)
      .setBold(true)
      .setRanges([statusRange])
      .build();

    newRules.push(rule);
  }

  // Apply all rules
  sheet.setConditionalFormatRules(newRules);

  SpreadsheetApp.getUi().alert(
    'Status Colors Applied!',
    'The following colors are now active:\n\n' +
    '🔵 New = Blue\n' +
    '🟢 Ready = Green\n' +
    '⚪ No Cal = Gray\n' +
    '🟣 Scheduled = Purple\n' +
    '🟠 Rescheduled = Orange\n' +
    '🔵 Completed = Dark Blue\n' +
    '🔴 Cancelled = Red',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Setup Columns S and T formatting
 * - Column S: WRAP text for notes readability
 * - Column T: CLIP and hide for full scrub storage
 */
function setupColumnsST() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet 'ADAS_Schedule' not found.");
    return;
  }

  // Column S (Notes - Preview) - WRAP for readability
  sheet.getRange('S:S').setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sheet.setColumnWidth(19, 300);

  const notesHeaderCell = sheet.getRange(1, 19);
  if (!notesHeaderCell.getValue()) {
    notesHeaderCell.setValue('Notes');
  }

  // Column T (Full Scrub Text) - CLIP and hidden
  sheet.getRange('T:T').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.setColumnWidth(20, 50);
  sheet.hideColumns(20);

  const fullScrubHeaderCell = sheet.getRange(1, 20);
  if (!fullScrubHeaderCell.getValue()) {
    fullScrubHeaderCell.setValue('Full Scrub Text');
  }

  SpreadsheetApp.getUi().alert(
    'Columns S and T configured!\n\n' +
    'S: Notes (300px, WRAP)\n' +
    'T: Full Scrub (50px, hidden, CLIP)\n\n' +
    'Use "View Full Scrub Details" to see full text.'
  );
}

/**
 * Hide Column T
 */
function hideFullScrubColumn() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (sheet) {
    sheet.hideColumns(20);
    SpreadsheetApp.getUi().alert('Column T hidden.');
  }
}

/**
 * Show Column T
 */
function showFullScrubColumn() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (sheet) {
    sheet.showColumns(20);
    SpreadsheetApp.getUi().alert('Column T visible.');
  }
}

/**
 * Reduce all row heights to standard
 */
function reduceRowHeights() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  if (sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.setRowHeights(2, lastRow - 1, 21);
    }
  }
}

/**
 * UNIFIED SIDEBAR - Shows ALL info + manual override buttons
 * Replaces both "View Status & Override" and "View Full Scrub Details"
 *
 * Features:
 * - Vehicle info (RO, VIN, Shop, Vehicle, Status)
 * - Calibrations required (from Column J/RevvADAS)
 * - Full scrub analysis (from Column T)
 * - OEM Position Statement link (from Column U)
 * - Revv PDF link (from Column M)
 * - Manual override buttons for status
 */
function openUnifiedSidebar() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet 'ADAS_Schedule' not found.");
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row === 1) {
    SpreadsheetApp.getUi().alert('Please select a data row (not the header).');
    return;
  }

  const rowData = sheet.getRange(row, 1, 1, TOTAL_COLUMNS).getValues()[0];

  // Extract all fields
  const roPo = rowData[COL.RO_PO] || 'Unknown';
  const shopName = rowData[COL.SHOP_NAME] || '';
  const status = rowData[COL.STATUS] || 'Unknown';
  const vehicle = rowData[COL.VEHICLE] || '';
  const vin = rowData[COL.VIN] || '';
  const requiredCals = rowData[COL.REQUIRED_CALS] || '';
  const completedCals = rowData[COL.COMPLETED_CALS] || '';
  const technician = rowData[COL.TECHNICIAN] || '';
  const scheduledDate = rowData[COL.SCHEDULED_DATE] || '';
  const scheduledTime = rowData[COL.SCHEDULED_TIME] || '';
  const notes = rowData[COL.NOTES] || '';
  const revvPdfUrl = rowData[COL.REVV_PDF] || '';
  const postScanUrl = rowData[COL.POSTSCAN_PDF] || '';
  const invoiceUrl = rowData[COL.INVOICE_PDF] || '';
  const oemPosition = rowData[COL.OEM_POSITION] || '';

  // Get full scrub DIRECTLY from Column T
  let fullScrub = rowData[COL.FULL_SCRUB] || '';
  if (fullScrub && fullScrub.startsWith('See ')) {
    const detailScrub = getFullScrubFromDetails(roPo);
    if (detailScrub) fullScrub = detailScrub;
  }

  // Parse calibrations for display
  const calibrationList = requiredCals
    ? requiredCals.split(/[;,]/).map(function(c) { return c.trim(); }).filter(function(c) { return c.length > 0; })
    : [];

  // Determine status color (FINALIZED December 2024 - 7 statuses)
  const statusColors = {
    'New': '#1a73e8',
    'Ready': '#137333',
    'No Cal': '#666666',
    'Scheduled': '#7c3aed',
    'Rescheduled': '#e65100',
    'Completed': '#1967d2',
    'Cancelled': '#5f6368'
  };
  const statusColor = statusColors[status] || '#5f6368';

  // Build HTML for sidebar
  const html = `
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    body { font-family: 'Google Sans', Arial, sans-serif; padding: 16px; margin: 0; background: #f8f9fa; }
    .header { background: linear-gradient(135deg, #1a73e8, #4285f4); color: white; padding: 20px; margin: -16px -16px 16px; border-radius: 0 0 12px 12px; }
    .header h2 { margin: 0 0 8px 0; font-size: 20px; }
    .header .status { display: inline-block; padding: 4px 12px; border-radius: 16px; font-size: 12px; font-weight: 500; background: ${statusColor}; color: white; }
    .section { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .section-title { font-weight: 600; color: #202124; margin-bottom: 12px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
    .section-title .icon { font-size: 16px; }
    .field { margin-bottom: 10px; }
    .field-label { font-size: 11px; color: #5f6368; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .field-value { font-size: 14px; color: #202124; word-break: break-word; }
    .cal-list { list-style: none; padding: 0; margin: 0; }
    .cal-list li { padding: 8px 12px; background: #e8f0fe; border-radius: 4px; margin-bottom: 6px; font-size: 13px; color: #1967d2; }
    .scrub-box { background: #f1f3f4; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 300px; overflow-y: auto; color: #3c4043; }
    .btn { display: block; width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; margin-bottom: 8px; transition: background 0.2s; }
    .btn-ready { background: #34a853; color: white; }
    .btn-ready:hover { background: #2e9348; }
    .btn-nocal { background: #666666; color: white; }
    .btn-nocal:hover { background: #555555; }
    .btn-attention { background: #ea4335; color: white; }
    .btn-attention:hover { background: #d93025; }
    .btn-completed { background: #1a73e8; color: white; }
    .btn-completed:hover { background: #1557b0; }
    .btn-secondary { background: #e8eaed; color: #3c4043; }
    .btn-secondary:hover { background: #dadce0; }
    .link { color: #1a73e8; text-decoration: none; font-size: 13px; display: flex; align-items: center; gap: 4px; }
    .link:hover { text-decoration: underline; }
    .links-section { display: flex; flex-direction: column; gap: 8px; }
    .empty { color: #9aa0a6; font-style: italic; font-size: 13px; }
    .override-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid #dadce0; }
  </style>
</head>
<body>
  <div class="header">
    <h2>RO: ${escapeHtml(roPo)}</h2>
    <div class="status">${escapeHtml(status)}</div>
  </div>

  <!-- Vehicle Info Section -->
  <div class="section">
    <div class="section-title"><span class="icon">🚗</span> Vehicle Info</div>
    <div class="field">
      <div class="field-label">Vehicle</div>
      <div class="field-value">${vehicle ? escapeHtml(vehicle) : '<span class="empty">Not specified</span>'}</div>
    </div>
    <div class="field">
      <div class="field-label">VIN</div>
      <div class="field-value">${vin ? escapeHtml(vin) : '<span class="empty">Not specified</span>'}</div>
    </div>
    <div class="field">
      <div class="field-label">Shop</div>
      <div class="field-value">${shopName ? escapeHtml(shopName) : '<span class="empty">Not specified</span>'}</div>
    </div>
    <div class="field">
      <div class="field-label">Technician</div>
      <div class="field-value">${technician ? escapeHtml(technician) : '<span class="empty">Not assigned</span>'}</div>
    </div>
    <div class="field">
      <div class="field-label">Scheduled</div>
      <div class="field-value">${scheduledDate ? escapeHtml(scheduledDate) + (scheduledTime ? ' at ' + escapeHtml(scheduledTime) : '') : '<span class="empty">Not scheduled</span>'}</div>
    </div>
  </div>

  <!-- Calibrations Section -->
  <div class="section">
    <div class="section-title"><span class="icon">🔧</span> Required Calibrations ${status === 'No Cal' ? '' : '(' + calibrationList.length + ')'}</div>
    ${status === 'No Cal'
      ? '<div style="background: #f5f5f5; border-left: 4px solid #666666; padding: 15px; border-radius: 0 4px 4px 0; text-align: center;"><strong style="color: #666666;">⊘ No calibration required for this repair</strong><p style="margin: 8px 0 0; font-size: 12px; color: #888;">Revv Report confirmed no ADAS calibration is needed.</p></div>'
      : (calibrationList.length > 0
        ? '<ul class="cal-list">' + calibrationList.map(function(c) { return '<li>' + escapeHtml(c) + '</li>'; }).join('') + '</ul>'
        : '<div class="empty">Awaiting Revv Report</div>')}
    ${completedCals ? '<div class="field" style="margin-top:12px;"><div class="field-label">Completed</div><div class="field-value">' + escapeHtml(completedCals) + '</div></div>' : ''}
  </div>

  <!-- Links Section -->
  <div class="section">
    <div class="section-title"><span class="icon">📎</span> Documents & Links</div>
    <div class="links-section">
      ${revvPdfUrl ? '<a href="' + escapeHtml(revvPdfUrl) + '" target="_blank" class="link">📄 Revv Report PDF</a>' : ''}
      ${postScanUrl ? '<a href="' + escapeHtml(postScanUrl) + '" target="_blank" class="link">📄 Post-Scan Report</a>' : ''}
      ${invoiceUrl ? '<a href="' + escapeHtml(invoiceUrl) + '" target="_blank" class="link">📄 Invoice PDF</a>' : ''}
      ${oemPosition ? '<div class="field"><div class="field-label">OEM Position Statement</div><div class="field-value"><a href="' + escapeHtml(oemPosition) + '" target="_blank" class="link">' + escapeHtml(oemPosition) + '</a></div></div>' : ''}
      ${!revvPdfUrl && !postScanUrl && !invoiceUrl && !oemPosition ? '<div class="empty">No documents attached</div>' : ''}
    </div>
  </div>

  <!-- Full Scrub Analysis Section -->
  <div class="section">
    <div class="section-title"><span class="icon">📋</span> Scrub Analysis</div>
    ${fullScrub && fullScrub.trim()
      ? '<div class="scrub-box">' + escapeHtml(fullScrub) + '</div>'
      : '<div class="empty">No scrub analysis available. Run estimate scrub to populate.</div>'}
  </div>

  <!-- Notes Section -->
  ${notes ? '<div class="section"><div class="section-title"><span class="icon">📝</span> Notes</div><div class="field-value">' + escapeHtml(notes) + '</div></div>' : ''}

  <!-- Manual Override Section (6 statuses - Cancelled only via assistant) -->
  <div class="section override-section">
    <div class="section-title"><span class="icon">⚡</span> Update Status</div>
    <button class="btn btn-secondary" onclick="setStatus('New')">📋 New</button>
    <button class="btn btn-ready" onclick="setStatus('Ready')">✓ Ready</button>
    <button class="btn btn-nocal" onclick="setStatus('No Cal')">⊘ No Cal</button>
    <button class="btn btn-scheduled" onclick="setStatus('Scheduled')">📅 Scheduled</button>
    <button class="btn btn-rescheduled" onclick="setStatus('Rescheduled')">🔄 Rescheduled</button>
    <button class="btn btn-completed" onclick="setStatus('Completed')">✓ Completed</button>
    <p style="font-size: 11px; color: #666; margin-top: 10px;">To cancel: Call assistant with reason.</p>
  </div>

  <script>
    function setStatus(newStatus) {
      google.script.run
        .withSuccessHandler(function() {
          alert('Status updated to: ' + newStatus);
          google.script.host.close();
        })
        .withFailureHandler(function(e) {
          alert('Error: ' + e.message);
        })
        .updateRowStatusFromSidebar(${row}, newStatus);
    }
  </script>
</body>
</html>
  `;

  const htmlOutput = HtmlService.createHtmlOutput(html)
    .setTitle('RO ' + roPo + ' - Status & Details')
    .setWidth(400);

  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

/**
 * Open sidebar with full scrub details - REVV-FIRST formatted display
 * LEGACY: Keep for backward compatibility, but unified sidebar is preferred
 */
function openScrubSidebar() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet 'ADAS_Schedule' not found.");
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row === 1) {
    SpreadsheetApp.getUi().alert('Please select a data row (not the header).');
    return;
  }

  const rowData = sheet.getRange(row, 1, 1, TOTAL_COLUMNS).getValues()[0];
  const roPo = rowData[COL.RO_PO] || 'Unknown';
  const status = rowData[COL.STATUS] || 'Unknown';
  const vehicle = rowData[COL.VEHICLE] || '';
  const shopName = rowData[COL.SHOP_NAME] || '';
  const vin = rowData[COL.VIN] || '';
  const notes = rowData[COL.NOTES] || '';
  const requiredCals = rowData[COL.REQUIRED_CALS] || '';
  const technician = rowData[COL.TECHNICIAN] || '';
  const scheduledDate = rowData[COL.SCHEDULED_DATE] || '';
  const completedCals = rowData[COL.COMPLETED_CALS] || '';

  // Get full scrub DIRECTLY from Column T
  let fullScrub = rowData[COL.FULL_SCRUB] || '';

  if (!fullScrub || fullScrub.trim().length === 0) {
    fullScrub = '';
  } else if (fullScrub.startsWith('See ')) {
    // Legacy reference format - try Scrub_Details sheet
    const detailScrub = getFullScrubFromDetails(roPo);
    if (detailScrub) {
      fullScrub = detailScrub;
    } else {
      fullScrub = '';
    }
  }

  // Parse scrub data for structured display (uses hybrid format if available)
  const scrubData = parseHybridScrubText(fullScrub);

  // Parse calibrations into cards (now supports confidence levels)
  const calibrationCards = generateCalibrationCardsHtml(requiredCals, scrubData);

  // Generate conflicts HTML (if any sources disagree)
  const conflictsHtml = generateConflictsHtml(scrubData.conflicts);

  // Generate excluded items HTML (non-ADAS items)
  const excludedHtml = generateExcludedHtml(scrubData.excluded);

  // Calculate stats for new hybrid format
  const verifiedCount = scrubData.calibrations ? scrubData.calibrations.filter(c => c.confidence === 'HIGH').length : 0;
  const reviewCount = scrubData.calibrations ? scrubData.calibrations.filter(c => c.confidence !== 'HIGH').length : scrubData.needsReviewCount || 0;
  const excludedCount = scrubData.excluded ? scrubData.excluded.length : scrubData.phantomCount || 0;
  const conflictCount = scrubData.conflicts ? scrubData.conflicts.length : 0;
  const totalCals = scrubData.calibrations && scrubData.calibrations.length > 0
    ? scrubData.calibrations.length
    : (scrubData.revvCount || countCalibrations(requiredCals));

  // Determine overall status
  const scrubStatus = scrubData.status || 'UNKNOWN';
  const isVerified = scrubStatus === 'VERIFIED' || (scrubStatus === 'OK' && !scrubData.hasPhantoms);
  const needsReview = scrubStatus === 'NEEDS_REVIEW' || reviewCount > 0 || conflictCount > 0;

  // Get status class for badge
  const statusClass = getStatusClass(needsReview ? 'needs-review' : status);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Google Sans', Roboto, Arial, sans-serif;
      padding: 16px;
      font-size: 13px;
      color: #202124;
      margin: 0;
      background: #f8f9fa;
    }

    /* Header */
    .ro-header {
      background: linear-gradient(135deg, #1a73e8 0%, #1557b0 100%);
      color: white;
      padding: 16px;
      border-radius: 12px;
      margin-bottom: 16px;
      box-shadow: 0 2px 8px rgba(26,115,232,0.3);
    }
    .ro-number {
      font-size: 22px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .vehicle-info {
      font-size: 14px;
      opacity: 0.95;
    }
    .vin-display {
      font-family: 'Roboto Mono', monospace;
      font-size: 11px;
      background: rgba(255,255,255,0.2);
      padding: 4px 8px;
      border-radius: 4px;
      margin-top: 8px;
      display: inline-block;
    }

    /* Status Badge */
    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding: 0 4px;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 20px;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-ready, .status-completed { background: #e6f4ea; color: #137333; }
    .status-new { background: #e8f0fe; color: #1a73e8; }
    .status-in-progress { background: #fef7e0; color: #ea8600; }
    .status-needs-review, .status-needs-attention { background: #fce8e6; color: #c5221f; }
    .status-not-ready { background: #f1f3f4; color: #5f6368; }
    .shop-name {
      color: #5f6368;
      font-size: 12px;
    }

    /* Sections */
    .section {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .section-header {
      background: #f8f9fa;
      padding: 10px 14px;
      font-weight: 600;
      color: #5f6368;
      border-bottom: 1px solid #e0e0e0;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }
    .section-header .icon {
      font-size: 16px;
    }
    .section-content {
      padding: 14px;
    }

    /* Summary Stats */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 16px;
    }
    .stat-card {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }
    .stat-number {
      font-size: 22px;
      font-weight: 600;
      color: #1a73e8;
    }
    .stat-label {
      font-size: 10px;
      color: #5f6368;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .stat-card.success .stat-number { color: #137333; }
    .stat-card.warning .stat-number { color: #ea8600; }
    .stat-card.error .stat-number { color: #c5221f; }

    /* Calibration Cards */
    .calibration-card {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      border-left: 4px solid #1a73e8;
    }
    .calibration-card:last-child {
      margin-bottom: 0;
    }
    .calibration-card.verified {
      border-left-color: #137333;
    }
    .calibration-card.revv-source {
      border-left-color: #1a73e8;
    }
    .calibration-card.warning {
      border-left-color: #ea8600;
    }
    .calibration-card.phantom {
      border-left-color: #c5221f;
      background: #fce8e6;
    }
    .cal-name {
      font-weight: 600;
      color: #202124;
      margin-bottom: 4px;
      font-size: 13px;
    }
    .cal-type {
      display: inline-block;
      background: #e8f0fe;
      color: #1a73e8;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
    }
    .cal-type.dynamic {
      background: #fef7e0;
      color: #ea8600;
    }
    .cal-trigger {
      font-size: 11px;
      color: #5f6368;
      margin-top: 6px;
    }
    .cal-source {
      font-size: 10px;
      color: #80868b;
      margin-top: 4px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .cal-source.verified { color: #137333; }

    /* Needs Review Cards (orange border - medium confidence) */
    .calibration-card.needs-review {
      border-left: 4px solid #ea8600;
      background: #fff;
    }
    .calibration-card.needs-review .cal-name {
      color: #b45309;
      font-weight: 600;
    }
    .calibration-card.needs-review .cal-type {
      background: #fef7e0;
      color: #ea8600;
    }
    .calibration-card.needs-review .cal-source {
      color: #ea8600;
    }

    /* Conflict Cards (red border - sources disagree) */
    .calibration-card.conflict {
      border-left: 4px solid #c5221f;
      background: #fef2f2;
    }
    .calibration-card.conflict .cal-name {
      color: #c5221f;
      font-weight: 600;
    }
    .conflict-detail {
      font-size: 11px;
      margin-top: 8px;
      padding: 8px;
      background: #fff5f5;
      border-radius: 4px;
    }
    .conflict-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .conflict-label {
      font-weight: 500;
      color: #5f6368;
    }

    /* Excluded Cards (gray - non-ADAS items) */
    .calibration-card.excluded {
      border-left: 4px solid #9ca3af;
      background: #f3f4f6;
      opacity: 0.85;
    }
    .calibration-card.excluded .cal-name {
      text-decoration: line-through;
      color: #6b7280;
    }
    .calibration-card.excluded .cal-source {
      color: #9ca3af;
    }

    /* Reasoning text for calibrations */
    .cal-reasoning {
      font-size: 10px;
      color: #9ca3af;
      margin-top: 4px;
      padding-top: 4px;
      border-top: 1px dashed #e0e0e0;
      font-style: italic;
    }

    /* Notes */
    .notes-box {
      background: #fffde7;
      padding: 10px 12px;
      border-radius: 6px;
      border-left: 3px solid #fbc02d;
      font-size: 12px;
      line-height: 1.5;
    }

    /* Alert Box */
    .alert {
      padding: 12px 14px;
      border-radius: 8px;
      margin-bottom: 12px;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .alert-success {
      background: #e6f4ea;
      border: 1px solid #137333;
    }
    .alert-warning {
      background: #fef7e0;
      border: 1px solid #fbc02d;
    }
    .alert-error {
      background: #fce8e6;
      border: 1px solid #f28b82;
    }
    .alert-icon {
      font-size: 18px;
      flex-shrink: 0;
    }
    .alert-content {
      flex: 1;
    }
    .alert-title {
      font-weight: 600;
      margin-bottom: 2px;
      font-size: 13px;
    }
    .alert-message {
      font-size: 11px;
      color: #5f6368;
    }

    /* Tech Info */
    .tech-info {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .tech-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #5f6368;
    }
    .tech-item .icon { font-size: 14px; }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 20px;
      color: #5f6368;
    }
    .empty-state .icon {
      font-size: 32px;
      margin-bottom: 8px;
    }

    /* Scrub Details (collapsible) */
    .scrub-details {
      font-family: 'Roboto Mono', monospace;
      font-size: 10px;
      background: #f8f9fa;
      padding: 12px;
      border-radius: 6px;
      white-space: pre-wrap;
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid #e0e0e0;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="ro-header">
    <div class="ro-number">RO: ${escapeHtml(roPo)}</div>
    <div class="vehicle-info">${escapeHtml(vehicle)}</div>
    ${vin ? '<div class="vin-display">VIN: ' + escapeHtml(vin) + '</div>' : ''}
  </div>

  <!-- Status & Shop Row -->
  <div class="status-row">
    <span class="status-badge ${statusClass}">${escapeHtml(status)}</span>
    <span class="shop-name">${escapeHtml(shopName)}</span>
  </div>

  <!-- Tech/Schedule Info -->
  ${technician || scheduledDate ? '<div class="tech-info">' +
    (technician ? '<div class="tech-item"><span class="icon">👤</span>' + escapeHtml(technician) + '</div>' : '') +
    (scheduledDate ? '<div class="tech-item"><span class="icon">📅</span>' + escapeHtml(scheduledDate) + '</div>' : '') +
  '</div>' : ''}

  <!-- Summary Stats - Updated for Hybrid Scrub -->
  <div class="stats-grid">
    <div class="stat-card success">
      <div class="stat-number">${verifiedCount > 0 ? verifiedCount : totalCals}</div>
      <div class="stat-label">${verifiedCount > 0 ? 'Verified' : 'Required'}</div>
    </div>
    <div class="stat-card ${reviewCount > 0 ? 'warning' : ''}">
      <div class="stat-number">${reviewCount}</div>
      <div class="stat-label">Review</div>
    </div>
    <div class="stat-card ${excludedCount > 0 ? '' : ''}">
      <div class="stat-number">${excludedCount}</div>
      <div class="stat-label">Excluded</div>
    </div>
    <div class="stat-card ${conflictCount > 0 ? 'error' : ''}">
      <div class="stat-number">${conflictCount}</div>
      <div class="stat-label">Conflicts</div>
    </div>
  </div>

  <!-- Status Alert - Updated for Hybrid Scrub -->
  ${isVerified && !needsReview ?
    '<div class="alert alert-success">' +
    '<div class="alert-icon">✓</div>' +
    '<div class="alert-content">' +
    '<div class="alert-title">All Sources Agree</div>' +
    '<div class="alert-message">Calibrations verified by multiple sources (Knowledge Base, LLM, RevvADAS).</div>' +
    '</div></div>' : ''}

  ${needsReview ?
    '<div class="alert alert-warning">' +
    '<div class="alert-icon">⚠️</div>' +
    '<div class="alert-content">' +
    '<div class="alert-title">Review Recommended</div>' +
    '<div class="alert-message">' + (conflictCount > 0 ? conflictCount + ' conflict(s) detected. ' : '') + (reviewCount > 0 ? reviewCount + ' calibration(s) found by only one source.' : '') + '</div>' +
    '</div></div>' : ''}

  ${excludedCount > 0 && !needsReview ?
    '<div class="alert alert-warning">' +
    '<div class="alert-icon">🚫</div>' +
    '<div class="alert-content">' +
    '<div class="alert-title">Non-ADAS Items Excluded</div>' +
    '<div class="alert-message">' + excludedCount + ' item(s) excluded (SRS, Seat Weight, TPMS, etc. are not ADAS calibrations).</div>' +
    '</div></div>' : ''}

  <!-- Required Calibrations -->
  <div class="section">
    <div class="section-header">
      <span class="icon">🎯</span>
      Required Calibrations (${totalCals})
    </div>
    <div class="section-content">
      ${calibrationCards || '<div class="empty-state"><div class="icon">📋</div>No calibrations required</div>'}
    </div>
  </div>

  <!-- Conflicts Section (if any) -->
  ${conflictsHtml}

  <!-- Excluded Items Section (if any) -->
  ${excludedHtml}

  <!-- Notes -->
  ${notes ?
    '<div class="section">' +
    '<div class="section-header"><span class="icon">📝</span>Notes</div>' +
    '<div class="section-content"><div class="notes-box">' + escapeHtml(notes) + '</div></div>' +
    '</div>' : ''}

  <!-- Full Scrub Details (Collapsible) -->
  ${fullScrub ?
    '<details class="section" style="border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 12px;">' +
    '<summary class="section-header" style="cursor: pointer; list-style: none;"><span class="icon">🔍</span>View Raw Scrub Data</summary>' +
    '<div class="section-content"><div class="scrub-details">' + escapeHtml(fullScrub) + '</div></div>' +
    '</details>' : ''}
</body>
</html>
`;

  const htmlOutput = HtmlService.createHtmlOutput(html)
    .setTitle('RO Details: ' + roPo)
    .setWidth(400);

  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

/**
 * Parse hybrid scrub text into structured data
 * Handles new format with confidence levels and multiple sources (KB + LLM + RevvADAS)
 */
function parseHybridScrubText(fullScrubText) {
  const result = {
    calibrations: [],
    excluded: [],
    conflicts: [],
    status: 'UNKNOWN',
    vehicle: '',
    vin: '',
    // Legacy compatibility fields
    revvCount: 0,
    estimateCount: 0,
    phantomCount: 0,
    hasPhantoms: false,
    needsReviewCount: 0,
    needsReviewCalibrations: [],
    assistantCalibrations: []
  };

  if (!fullScrubText || fullScrubText.trim() === '' || fullScrubText === 'No detailed scrub data available.') {
    return result;
  }

  const lines = fullScrubText.split('\n');
  let currentSection = null;
  let currentCal = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and markers
    if (!line || line === '---' || line.startsWith('═══')) continue;

    // Parse header info
    if (line.startsWith('Vehicle:')) {
      result.vehicle = line.replace('Vehicle:', '').trim();
      continue;
    }
    if (line.startsWith('VIN:')) {
      result.vin = line.replace('VIN:', '').trim();
      continue;
    }
    if (line.startsWith('Status:')) {
      result.status = line.replace('Status:', '').trim();
      continue;
    }

    // Detect sections (new format)
    if (line.startsWith('REQUIRED CALIBRATIONS') || line.startsWith('─── REQUIRED')) {
      currentSection = 'calibrations';
      continue;
    }
    if (line.startsWith('EXCLUDED') || line.startsWith('─── EXCLUDED')) {
      currentSection = 'excluded';
      continue;
    }
    if (line.startsWith('CONFLICTS TO REVIEW') || line.startsWith('─── CONFLICTS')) {
      currentSection = 'conflicts';
      continue;
    }
    if (line.startsWith('─── SUMMARY') || line.startsWith('--- END') || line.startsWith('─── SOURCES')) {
      // Save last calibration if exists
      if (currentCal) {
        result.calibrations.push(currentCal);
        currentCal = null;
      }
      if (line.startsWith('--- END')) break;
      currentSection = null;
      continue;
    }

    // Parse calibrations (new hybrid format)
    if (currentSection === 'calibrations') {
      // New calibration line: "  Surround View Monitor Cameras (Dynamic)"
      const calMatch = line.match(/^\s{2,}([^(]+)\s*\(([^)]+)\)/);
      if (calMatch) {
        // Save previous calibration if exists
        if (currentCal) {
          result.calibrations.push(currentCal);
        }
        currentCal = {
          name: calMatch[1].trim(),
          type: calMatch[2].trim(),
          confidence: 'MEDIUM',
          sources: [],
          triggeredBy: null,
          reasoning: null,
          verificationText: ''
        };
        continue;
      }

      // Parse calibration details
      if (currentCal) {
        if (line.startsWith('Confidence:')) {
          currentCal.confidence = line.replace('Confidence:', '').trim();
        } else if (line.startsWith('Sources:')) {
          currentCal.sources = line.replace('Sources:', '').trim().split(', ');
          // Build verification text
          if (currentCal.sources.length >= 3) {
            currentCal.verificationText = '✓ Verified by RevvADAS, LLM & Knowledge Base';
          } else if (currentCal.sources.length === 2) {
            currentCal.verificationText = '✓ Verified by ' + currentCal.sources.join(' & ');
          } else if (currentCal.sources.length === 1) {
            currentCal.verificationText = '⚠ Found by ' + currentCal.sources[0] + ' only - Review recommended';
          }
        } else if (line.startsWith('Triggered by:')) {
          currentCal.triggeredBy = line.replace('Triggered by:', '').trim();
        } else if (line.startsWith('Reasoning:')) {
          currentCal.reasoning = line.replace('Reasoning:', '').trim();
        } else if (line.startsWith('✓') || line.startsWith('⚠')) {
          currentCal.verificationText = line.trim();
        }
      }
    }

    // Parse excluded items
    if (currentSection === 'excluded') {
      // Format: "  ✗ SRS Unit: Non-ADAS - airbag system reset" or "  • SRS Unit: reason"
      const excludedMatch = line.match(/^\s*[✗•]\s*([^:]+):\s*(.+)/);
      if (excludedMatch) {
        const itemName = excludedMatch[1].trim();
        // Skip "None" entries
        if (itemName.toLowerCase() !== 'none' && itemName.length > 2) {
          result.excluded.push({
            name: itemName,
            reason: excludedMatch[2].trim()
          });
        }
      }
    }

    // Parse conflicts
    if (currentSection === 'conflicts') {
      // Format: "  ⚠ Item Name"
      const conflictMatch = line.match(/^\s*⚠\s*(.+)/);
      if (conflictMatch && !line.includes(':')) {
        result.conflicts.push({
          item: conflictMatch[1].trim(),
          revvSays: '',
          llmSays: '',
          reason: ''
        });
      } else if (result.conflicts.length > 0) {
        const lastConflict = result.conflicts[result.conflicts.length - 1];
        if (line.startsWith('RevvADAS says:')) {
          lastConflict.revvSays = line.replace('RevvADAS says:', '').trim();
        } else if (line.startsWith('LLM says:') || line.startsWith('Assistant says:')) {
          lastConflict.llmSays = line.replace(/(?:LLM|Assistant) says:/i, '').trim();
        } else if (line.startsWith('Reason:')) {
          lastConflict.reason = line.replace('Reason:', '').trim();
        }
      }
    }
  }

  // Don't forget last calibration
  if (currentCal) {
    result.calibrations.push(currentCal);
  }

  // Update legacy compatibility fields
  result.revvCount = result.calibrations.length;
  result.phantomCount = result.excluded.length;
  result.hasPhantoms = result.excluded.length > 0;
  result.needsReviewCount = result.calibrations.filter(c => c.confidence !== 'HIGH').length;
  result.needsReviewCalibrations = result.calibrations
    .filter(c => c.confidence !== 'HIGH')
    .map(c => ({ name: c.name, type: 'REVIEW' }));

  // If no calibrations parsed but we have text, try legacy parsing
  if (result.calibrations.length === 0 && fullScrubText.length > 50) {
    return parseLegacyScrubText(fullScrubText);
  }

  return result;
}

/**
 * Parse legacy scrub text format (backward compatibility)
 */
function parseLegacyScrubText(fullScrubText) {
  const data = {
    calibrations: [],
    excluded: [],
    conflicts: [],
    status: 'OK',
    vehicle: '',
    vin: '',
    revvCount: 0,
    estimateCount: 0,
    phantomCount: 0,
    hasPhantoms: false,
    needsReviewCount: 0,
    needsReviewCalibrations: [],
    assistantCalibrations: []
  };

  if (!fullScrubText) return data;

  // Extract Revv count
  const revvMatch = fullScrubText.match(/(?:Revv|RevvADAS).*?:?\s*(\d+)/i);
  if (revvMatch) data.revvCount = parseInt(revvMatch[1]);

  // Extract estimate count
  const estMatch = fullScrubText.match(/Estimate.*?:?\s*(\d+)/i);
  if (estMatch) data.estimateCount = parseInt(estMatch[1]);

  // Check for phantom detections
  if (fullScrubText.includes('PHANTOM') || fullScrubText.includes('EXCLUDED') || fullScrubText.includes('NOT in RevvADAS')) {
    data.hasPhantoms = true;
    const phantomLines = (fullScrubText.match(/✗.*EXCLUDED/gi) || []).length;
    data.phantomCount = phantomLines || 1;
  }

  // Extract "needs review" calibrations
  const missingMatch = fullScrubText.match(/MISSING:\s*([^\n]+)/i);
  if (missingMatch) {
    const missingText = missingMatch[1].trim();
    if (missingText.toLowerCase() !== 'none' && missingText !== '' && missingText !== '-') {
      const missingItems = missingText.split(',')
        .map(s => s.trim())
        .filter(s => s && s.toLowerCase() !== 'none' && s.length > 2);

      data.needsReviewCalibrations = missingItems.map(name => ({
        name: name.replace(/Calibration$/i, '').trim(),
        type: 'REVIEW'
      }));
      data.needsReviewCount = data.needsReviewCalibrations.length;
    }
  }

  // Check status
  if (fullScrubText.includes('DISCREPANCY')) {
    data.status = 'DISCREPANCY';
  } else if (fullScrubText.includes('NEEDS_REVIEW') || fullScrubText.includes('NEEDS REVIEW')) {
    data.status = 'NEEDS_REVIEW';
  } else if (fullScrubText.includes('Status: OK') || fullScrubText.includes('✓ OK')) {
    data.status = 'OK';
  }

  return data;
}

/**
 * Alias for backward compatibility
 */
function parseFullScrubText(fullScrubText) {
  return parseHybridScrubText(fullScrubText);
}

/**
 * Count calibrations from a semicolon-separated string
 */
function countCalibrations(calString) {
  if (!calString || typeof calString !== 'string') return 0;
  return calString.split(';').map(c => c.trim()).filter(c => c.length > 0).length;
}

/**
 * Get status CSS class
 */
function getStatusClass(status) {
  if (!status) return '';
  const normalized = status.toLowerCase().replace(/\s+/g, '-');
  return 'status-' + normalized;
}

/**
 * Generate calibration cards HTML with confidence-based styling
 * NEW: Supports hybrid scrub data with confidence levels (HIGH, MEDIUM, LOW)
 *
 * Colors:
 * - GREEN (verified): HIGH confidence (2+ sources agree)
 * - ORANGE (review): MEDIUM confidence (1 source only)
 * - GRAY (excluded): Non-ADAS items
 */
function generateCalibrationCardsHtml(requiredCals, scrubData) {
  var html = '';

  // NEW FORMAT: Use parsed calibrations from hybrid scrub if available
  if (scrubData && scrubData.calibrations && scrubData.calibrations.length > 0) {
    for (var i = 0; i < scrubData.calibrations.length; i++) {
      var cal = scrubData.calibrations[i];

      // Determine card class based on confidence
      var cardClass = 'verified'; // Default to green
      if (cal.confidence === 'MEDIUM' || cal.confidence === 'LOW') {
        cardClass = 'needs-review'; // Orange
      }

      // Type class for dynamic calibrations
      var typeClass = (cal.type || '').toLowerCase() === 'dynamic' ? 'dynamic' : '';

      // Source verification text
      var verificationText = cal.verificationText || '';
      if (!verificationText && cal.sources && cal.sources.length > 0) {
        if (cal.sources.length >= 3) {
          verificationText = '✓ Verified by RevvADAS, LLM & Knowledge Base';
        } else if (cal.sources.length === 2) {
          verificationText = '✓ Verified by ' + cal.sources.join(' & ');
        } else {
          verificationText = '⚠ Found by ' + cal.sources[0] + ' only - Review recommended';
        }
      }

      html += '<div class="calibration-card ' + cardClass + '">' +
        '<div class="cal-name">' + escapeHtml(cal.name) + '</div>' +
        '<span class="cal-type ' + typeClass + '">' + escapeHtml(cal.type || 'Static') + '</span>' +
        '<div class="cal-source ' + (cal.confidence === 'HIGH' ? 'verified' : '') + '">' + escapeHtml(verificationText) + '</div>' +
        (cal.triggeredBy ? '<div class="cal-trigger">Trigger: ' + escapeHtml(cal.triggeredBy) + '</div>' : '') +
        (cal.reasoning ? '<div class="cal-reasoning">' + escapeHtml(cal.reasoning) + '</div>' : '') +
      '</div>';
    }

    return html;
  }

  // LEGACY FORMAT: Fall back to requiredCals string parsing
  // Helper function to check if assistant also detected this calibration
  function assistantAlsoFound(calName, assistantCals) {
    if (!assistantCals || assistantCals.length === 0) return false;
    var nameLower = calName.toLowerCase();

    for (var i = 0; i < assistantCals.length; i++) {
      var aCal = assistantCals[i];
      if (nameLower.includes(aCal) || aCal.includes(nameLower)) return true;
      if ((nameLower.includes('surround') && (aCal.includes('mirror') || aCal.includes('surround') || aCal.includes('360'))) ||
          (nameLower.includes('radar') && aCal.includes('radar')) ||
          (nameLower.includes('camera') && aCal.includes('camera')) ||
          (nameLower.includes('blind') && aCal.includes('blind')) ||
          (nameLower.includes('steering') && aCal.includes('steering')) ||
          (nameLower.includes('headlamp') && (aCal.includes('headlamp') || aCal.includes('headlight'))) ||
          (nameLower.includes('park') && aCal.includes('park'))) {
        return true;
      }
    }
    return false;
  }

  // Show RevvADAS verified calibrations (green) from requiredCals
  if (requiredCals) {
    var cals = requiredCals.split(';').map(function(c) { return c.trim(); }).filter(function(c) { return c; });

    for (var i = 0; i < cals.length; i++) {
      var cal = cals[i];
      var typeMatch = cal.match(/\((Static|Dynamic|Reset|Vehicle Diagnostics|Programming)\)/i);
      var type = typeMatch ? typeMatch[1] : 'Static';
      var name = cal.replace(/\s*\([^)]+\)/g, '').trim();
      var typeClass = type.toLowerCase() === 'dynamic' ? 'dynamic' : '';

      var dualVerified = scrubData && assistantAlsoFound(name, scrubData.assistantCalibrations);
      var verificationMsg = dualVerified
        ? '✓ Verified by RevvADAS & Assistant'
        : '✓ Verified by RevvADAS';

      html += '<div class="calibration-card verified">' +
        '<div class="cal-name">' + escapeHtml(name) + '</div>' +
        '<span class="cal-type ' + typeClass + '">' + escapeHtml(type) + '</span>' +
        '<div class="cal-source verified">' + verificationMsg + '</div>' +
      '</div>';
    }
  }

  // Show needs-review calibrations (orange border) - detected but NOT in RevvADAS
  if (scrubData && scrubData.needsReviewCalibrations && scrubData.needsReviewCalibrations.length > 0) {
    for (var j = 0; j < scrubData.needsReviewCalibrations.length; j++) {
      var reviewCal = scrubData.needsReviewCalibrations[j];

      if (!reviewCal.name ||
          reviewCal.name.toLowerCase() === 'none' ||
          reviewCal.name.toLowerCase() === 'n/a' ||
          reviewCal.name.length < 3) {
        continue;
      }

      html += '<div class="calibration-card needs-review">' +
        '<div class="cal-name">' + escapeHtml(reviewCal.name) + '</div>' +
        '<span class="cal-type">REVIEW</span>' +
        '<div class="cal-source">⚠ Assistant detected - Not in RevvADAS</div>' +
      '</div>';
    }
  }

  return html;
}

/**
 * Generate HTML for conflict cards (when sources disagree)
 * Shows red border with details of the disagreement
 */
function generateConflictsHtml(conflicts) {
  if (!conflicts || conflicts.length === 0) {
    return '';
  }

  var html = '<div class="section">' +
    '<div class="section-header"><span class="icon">⚠️</span>Conflicts to Review (' + conflicts.length + ')</div>' +
    '<div class="section-content">';

  for (var i = 0; i < conflicts.length; i++) {
    var conflict = conflicts[i];

    html += '<div class="calibration-card conflict">' +
      '<div class="cal-name">' + escapeHtml(conflict.item) + '</div>' +
      '<div class="conflict-detail">' +
        '<div class="conflict-row">' +
          '<span class="conflict-label">RevvADAS:</span>' +
          '<span>' + escapeHtml(conflict.revvSays || 'Not specified') + '</span>' +
        '</div>' +
        '<div class="conflict-row">' +
          '<span class="conflict-label">LLM:</span>' +
          '<span>' + escapeHtml(conflict.llmSays || 'Not specified') + '</span>' +
        '</div>' +
        (conflict.reason ? '<div class="conflict-row"><span class="conflict-label">Reason:</span><span>' + escapeHtml(conflict.reason) + '</span></div>' : '') +
      '</div>' +
    '</div>';
  }

  html += '</div></div>';

  return html;
}

/**
 * Generate HTML for excluded items (non-ADAS)
 * Shows gray strikethrough cards
 */
function generateExcludedHtml(excluded) {
  if (!excluded || excluded.length === 0) {
    return '';
  }

  var html = '<div class="section">' +
    '<div class="section-header"><span class="icon">🚫</span>Excluded - Non-ADAS (' + excluded.length + ')</div>' +
    '<div class="section-content">';

  for (var i = 0; i < excluded.length; i++) {
    var item = excluded[i];

    html += '<div class="calibration-card excluded">' +
      '<div class="cal-name">' + escapeHtml(item.name) + '</div>' +
      '<div class="cal-source">✗ ' + escapeHtml(item.reason) + '</div>' +
    '</div>';
  }

  html += '</div></div>';

  return html;
}

/**
 * Test function
 */
function testUpsert() {
  const testData = {
    ro_number: 'TEST123',
    shop_name: 'Test Shop',
    vin: 'W1N0G8DB4NG070405',
    vehicle_year: '2022',
    vehicle_make: 'Mercedes-Benz',
    vehicle_model: 'GLC 300',
    status: 'New',
    required_calibrations: 'Front Camera, Surround View',
    notes: 'Estimate: 7 ADAS ops. Revv: 1. Missing: ABS Module. Needs review.',
    full_scrub_text: '--- ESTIMATE vs REVV SUMMARY ---\nEstimate Ops: 7\nRevv Ops: 1\nMISSING: ABS Module\n--- END ---'
  };

  const result = upsertScheduleRow(testData);
  Logger.log('Result: ' + JSON.stringify(result));
  return result;
}

// =====================================================
// EMAIL APPROVAL WORKFLOW FUNCTIONS
// =====================================================

/**
 * Get shop email from Shops tab by name (fuzzy match)
 * @param {string} shopName - Shop name to lookup
 * @returns {string|null} Shop email or null if not found
 */
function getShopEmailByName(shopName) {
  if (!shopName) return null;

  const ss = SpreadsheetApp.getActive();
  const shopsSheet = ss.getSheetByName(SHOPS_SHEET);

  if (!shopsSheet) return null;

  const data = shopsSheet.getDataRange().getValues();
  const nameLower = shopName.toLowerCase().trim();

  for (let i = 1; i < data.length; i++) {
    const rowShopName = String(data[i][0] || '').toLowerCase().trim();
    // Fuzzy match - check if either contains the other
    if (rowShopName.includes(nameLower) || nameLower.includes(rowShopName)) {
      return data[i][1] || null; // Column B = Email
    }
  }

  return null;
}

/**
 * Get shop billing CC email from Shops tab
 * @param {string} shopName - Shop name to lookup
 * @returns {string|null} Billing CC email or null
 */
function getShopBillingCC(shopName) {
  if (!shopName) return null;

  const ss = SpreadsheetApp.getActive();
  const shopsSheet = ss.getSheetByName(SHOPS_SHEET);

  if (!shopsSheet) return null;

  const data = shopsSheet.getDataRange().getValues();
  const nameLower = shopName.toLowerCase().trim();

  for (let i = 1; i < data.length; i++) {
    const rowShopName = String(data[i][0] || '').toLowerCase().trim();
    if (rowShopName.includes(nameLower) || nameLower.includes(rowShopName)) {
      return data[i][2] || null; // Column C = Billing CC
    }
  }

  return null;
}

/**
 * Send intake email to shop (with RevvADAS report)
 * Called from sidebar "Send Intake Email" button
 * @param {number} rowNum - Row number in ADAS_Schedule
 * @returns {Object} { success: boolean, email?: string, error?: string }
 */
function sendIntakeEmailToShop(rowNum) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  const rowData = sheet.getRange(rowNum, 1, 1, TOTAL_COLUMNS).getValues()[0];

  const roPo = rowData[COL.RO_PO];
  const shopName = rowData[COL.SHOP_NAME];
  const vehicle = rowData[COL.VEHICLE];
  const vin = rowData[COL.VIN];
  const requiredCals = rowData[COL.REQUIRED_CALS];
  const revvPdfUrl = rowData[COL.REVV_PDF]; // Column M - Revv Report PDF

  const shopEmail = getShopEmailByName(shopName);
  const billingCC = getShopBillingCC(shopName);

  if (!shopEmail) {
    return { success: false, error: 'Shop email not found for: ' + shopName };
  }

  // Parse calibrations
  const calibrationList = requiredCals
    ? requiredCals.split(/[;,]/).map(function(c) { return c.trim(); }).filter(function(c) { return c; })
    : [];

  const calibrationRequired = calibrationList.length > 0;

  // Build email subject
  const subject = 'RO ' + roPo + ' - ' + (calibrationRequired ? 'Calibration Required' : 'No Calibration Needed') + ' - ' + vehicle;

  // Build email body
  const body = 'Hello ' + shopName + ',\n\n' +
    'We have received and reviewed the estimate for RO ' + roPo + '.\n\n' +
    '═══════════════════════════════════════════════════\n' +
    'CALIBRATION REQUIREMENT CONFIRMATION\n' +
    '═══════════════════════════════════════════════════\n\n' +
    'Vehicle: ' + vehicle + '\n' +
    'VIN: ' + vin + '\n' +
    'RO/PO: ' + roPo + '\n\n' +
    'CALIBRATION REQUIRED: ' + (calibrationRequired ? '✓ YES - ' + calibrationList.length + ' calibration(s)' : '✗ NO') + '\n\n' +
    (calibrationRequired ? 'Required Calibrations:\n' + calibrationList.map(function(c) { return '  • ' + c; }).join('\n') + '\n\n' : '') +
    (calibrationRequired ? 'Please ensure the vehicle meets prerequisites before calibration:\n' +
      '  • 4-wheel alignment within OEM spec\n' +
      '  • Fuel tank at least 1/2 full\n' +
      '  • Tires at proper pressure\n' +
      '  • No DTC codes present\n' +
      '  • Battery fully charged\n\n' : '') +
    'The attached RevvADAS report contains detailed requirements.\n\n' +
    'If you have any questions, please reply to this email or call us.\n\n' +
    'Best regards,\n' +
    'ADAS F1RST Team\n' +
    'radarsolutionsus@gmail.com\n\n' +
    '═══════════════════════════════════════════════════\n' +
    'This is an automated message from ADAS F1RST.\n' +
    '═══════════════════════════════════════════════════';

  try {
    // Build email options
    const mailOptions = {
      name: 'ADAS F1RST',
      cc: billingCC || undefined
    };

    // Attach RevvADAS PDF if URL exists
    if (revvPdfUrl && revvPdfUrl.startsWith('http')) {
      try {
        const response = UrlFetchApp.fetch(revvPdfUrl);
        const blob = response.getBlob().setName('RevvADAS_Report_' + roPo + '.pdf');
        mailOptions.attachments = [blob];
      } catch (e) {
        Logger.log('Could not attach PDF: ' + e.message);
        // Continue without attachment
      }
    }

    // Send email
    GmailApp.sendEmail(shopEmail, subject, body, mailOptions);

    // Update status and add note
    const timestamp = Utilities.formatDate(new Date(), 'America/New_York', 'MM/dd/yy h:mm a');
    const existingNotes = rowData[COL.NOTES] || '';
    const newNote = 'Intake email sent to ' + shopEmail + ' on ' + timestamp;

    sheet.getRange(rowNum, COL.STATUS + 1).setValue('Ready'); // Status = Ready
    sheet.getRange(rowNum, COL.NOTES + 1).setValue(existingNotes ? existingNotes + ' | ' + newNote : newNote);

    return { success: true, email: shopEmail };

  } catch (e) {
    Logger.log('Email send error: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Send closure email to shop (with Post Scan, Invoice, Report)
 * Called from sidebar "Send Closure Email" button
 * @param {number} rowNum - Row number in ADAS_Schedule
 * @returns {Object} { success: boolean, email?: string, error?: string }
 */
function sendClosureEmailToShop(rowNum) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  const rowData = sheet.getRange(rowNum, 1, 1, TOTAL_COLUMNS).getValues()[0];

  const roPo = rowData[COL.RO_PO];
  const shopName = rowData[COL.SHOP_NAME];
  const vehicle = rowData[COL.VEHICLE];
  const vin = rowData[COL.VIN];
  const completedCals = rowData[COL.COMPLETED_CALS] || rowData[COL.REQUIRED_CALS]; // Use completed or required
  const postScanUrl = rowData[COL.POSTSCAN_PDF];   // Column N - Post Scan PDF
  const invoiceUrl = rowData[COL.INVOICE_PDF];     // Column O - Invoice PDF
  const invoiceNum = rowData[COL.INVOICE_NUM];     // Column P - Invoice Number
  const invoiceAmount = rowData[COL.INVOICE_AMOUNT]; // Column Q - Invoice Amount
  const revvPdfUrl = rowData[COL.REVV_PDF];        // Column M - Revv Report PDF

  const shopEmail = getShopEmailByName(shopName);
  const billingCC = getShopBillingCC(shopName);

  if (!shopEmail) {
    return { success: false, error: 'Shop email not found for: ' + shopName };
  }

  // Build email subject
  const subject = 'RO ' + roPo + ' - ADAS Calibration Complete - ' + vehicle;

  // Build calibration list
  const calList = completedCals
    ? completedCals.split(/[;,]/).map(function(c) { return c.trim(); }).filter(function(c) { return c; })
    : [];

  // Build email body
  const body = 'Hello ' + shopName + ',\n\n' +
    'The ADAS calibration for RO ' + roPo + ' has been completed.\n\n' +
    '═══════════════════════════════════════════════════\n' +
    'JOB COMPLETION SUMMARY\n' +
    '═══════════════════════════════════════════════════\n\n' +
    'Vehicle: ' + vehicle + '\n' +
    'VIN: ' + vin + '\n' +
    'RO/PO: ' + roPo + '\n\n' +
    'CALIBRATIONS COMPLETED:\n' +
    (calList.length > 0 ? calList.map(function(c) { return '  ✓ ' + c; }).join('\n') : '  (See attached report)') + '\n\n' +
    (invoiceNum ? 'Invoice #: ' + invoiceNum + '\n' : '') +
    (invoiceAmount ? 'Amount: $' + invoiceAmount + '\n' : '') +
    '\n' +
    'Attached Documents:\n' +
    '  • Post-Scan Report - Final scan showing all systems clear\n' +
    '  • Calibration Report - Detailed calibration procedures performed\n' +
    '  • Invoice - Service charges for completed work\n\n' +
    'All calibrations have been performed according to OEM specifications.\n' +
    'The post-scan report confirms all ADAS systems are functioning properly.\n\n' +
    'Thank you for your business!\n\n' +
    'Best regards,\n' +
    'ADAS F1RST Team\n' +
    'radarsolutionsus@gmail.com\n\n' +
    '═══════════════════════════════════════════════════\n' +
    'ADAS F1RST | Miami, FL | Professional ADAS Calibration Services\n' +
    '═══════════════════════════════════════════════════';

  try {
    const attachments = [];

    // Attach Post Scan PDF
    if (postScanUrl && postScanUrl.startsWith('http')) {
      try {
        const response = UrlFetchApp.fetch(postScanUrl);
        attachments.push(response.getBlob().setName('PostScan_' + roPo + '.pdf'));
      } catch (e) {
        Logger.log('Could not attach Post Scan: ' + e.message);
      }
    }

    // Attach Invoice PDF
    if (invoiceUrl && invoiceUrl.startsWith('http')) {
      try {
        const response = UrlFetchApp.fetch(invoiceUrl);
        attachments.push(response.getBlob().setName('Invoice_' + roPo + '.pdf'));
      } catch (e) {
        Logger.log('Could not attach Invoice: ' + e.message);
      }
    }

    // Attach Revv Report PDF
    if (revvPdfUrl && revvPdfUrl.startsWith('http')) {
      try {
        const response = UrlFetchApp.fetch(revvPdfUrl);
        attachments.push(response.getBlob().setName('CalibrationReport_' + roPo + '.pdf'));
      } catch (e) {
        Logger.log('Could not attach Report: ' + e.message);
      }
    }

    // Build email options
    const mailOptions = {
      name: 'ADAS F1RST',
      cc: billingCC || undefined,
      attachments: attachments.length > 0 ? attachments : undefined
    };

    // Send email
    GmailApp.sendEmail(shopEmail, subject, body, mailOptions);

    // Update status and add note
    const timestamp = Utilities.formatDate(new Date(), 'America/New_York', 'MM/dd/yy h:mm a');
    const existingNotes = rowData[COL.NOTES] || '';
    const newNote = 'Closure email sent to ' + shopEmail + ' on ' + timestamp;

    sheet.getRange(rowNum, COL.STATUS + 1).setValue('Completed'); // Status = Completed
    sheet.getRange(rowNum, COL.NOTES + 1).setValue(existingNotes ? existingNotes + ' | ' + newNote : newNote);

    return { success: true, email: shopEmail };

  } catch (e) {
    Logger.log('Email send error: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Check if RO is eligible for completion
 * @param {string} roPo - RO or PO number
 * @returns {Object} - Eligibility details
 */
function checkCompletionEligibility(roPo) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);
  if (!sheet) return { success: false, error: 'Sheet not found' };

  const row = findRowByRO(sheet, roPo);
  if (row === 0) return { success: false, error: 'RO not found', eligible: false };

  const rowData = sheet.getRange(row, 1, 1, TOTAL_COLUMNS).getValues()[0];

  const hasRevvReport = !!rowData[COL.REVV_PDF];
  const hasPostScan = !!rowData[COL.POSTSCAN_PDF];
  const hasInvoice = !!rowData[COL.INVOICE_PDF];

  const eligible = hasRevvReport && hasPostScan && hasInvoice;

  return {
    success: true,
    eligible: eligible,
    hasRevvReport: hasRevvReport,
    hasPostScan: hasPostScan,
    hasInvoice: hasInvoice
  };
}

/**
 * Focus on specific cell (for editing from sidebar)
 * @param {number} rowNum - Row number
 * @param {number} colNum - Column number (1-based)
 */
function focusOnCell(rowNum, colNum) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SCHEDULE_SHEET);
  sheet.getRange(rowNum, colNum).activate();
}

/**
 * Open status sidebar - VIEW ONLY
 * Shows the automated workflow status (emails are sent automatically by the server)
 *
 * AUTOMATED WORKFLOW:
 * 1. Tech emails estimate + RevvADAS → Server scrubs and compares
 * 2. Sources agree → Auto-send to SHOP → Status: Ready
 * 3. Sources disagree → Auto-send review request to TECH → Status: Needs Attention
 * 4. Tech fixes RevvADAS, re-sends → Re-scrub → Loop
 *
 * This sidebar is for VIEWING status only - no manual send buttons
 */
function openApprovalSidebar() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULE_SHEET);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Sheet 'ADAS_Schedule' not found.");
    return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row === 1) {
    SpreadsheetApp.getUi().alert('Please select a data row (not the header).');
    return;
  }

  const rowData = sheet.getRange(row, 1, 1, TOTAL_COLUMNS).getValues()[0];

  // Extract all fields
  const roPo = rowData[COL.RO_PO] || 'Unknown';
  const shopName = rowData[COL.SHOP_NAME] || '';
  const status = rowData[COL.STATUS] || 'Unknown';
  const vehicle = rowData[COL.VEHICLE] || '';
  const vin = rowData[COL.VIN] || '';
  const requiredCals = rowData[COL.REQUIRED_CALS] || '';
  const technician = rowData[COL.TECHNICIAN] || '';
  const scheduledDate = rowData[COL.SCHEDULED_DATE] || '';
  const notes = rowData[COL.NOTES] || '';
  const fullScrub = rowData[COL.FULL_SCRUB] || '';
  const revvPdfUrl = rowData[COL.REVV_PDF] || '';
  const postScanUrl = rowData[COL.POSTSCAN_PDF] || '';
  const invoiceUrl = rowData[COL.INVOICE_PDF] || '';

  // Get shop email from Shops tab
  const shopEmail = getShopEmailByName(shopName);

  // Parse calibrations for display
  const calibrationList = requiredCals
    ? requiredCals.split(/[;,]/).map(function(c) { return c.trim(); }).filter(function(c) { return c; })
    : [];

  // Determine which documents are available
  // Revv: has URL OR has calibrations (proves Revv was processed even if URL missing)
  const hasRevvPdf = (revvPdfUrl && revvPdfUrl.startsWith('http')) || calibrationList.length > 0;
  const hasPostScan = postScanUrl && postScanUrl.startsWith('http');
  const hasInvoice = invoiceUrl && invoiceUrl.startsWith('http');

  // Determine workflow status based on notes and status
  const isReady = status.toLowerCase() === 'ready';
  const needsAttention = status.toLowerCase().indexOf('attention') >= 0 || status.toLowerCase().indexOf('review') >= 0;
  const isCompleted = status.toLowerCase() === 'completed';
  const confirmationSent = notes.indexOf('Confirmation sent') >= 0 || notes.indexOf('✅') >= 0;
  const reviewRequestSent = notes.indexOf('Review request sent') >= 0 || notes.indexOf('⚠️') >= 0;

  // Build status message
  var workflowStatus = '';
  var workflowClass = '';
  if (isCompleted) {
    workflowStatus = '✓ Job Completed';
    workflowClass = 'workflow-completed';
  } else if (isReady && confirmationSent) {
    workflowStatus = '✓ Confirmation sent to shop';
    workflowClass = 'workflow-ready';
  } else if (needsAttention && reviewRequestSent) {
    workflowStatus = '⚠️ Awaiting corrected RevvADAS from tech';
    workflowClass = 'workflow-attention';
  } else if (needsAttention) {
    workflowStatus = '⚠️ Needs manual attention';
    workflowClass = 'workflow-attention';
  } else {
    workflowStatus = '⏳ Processing...';
    workflowClass = 'workflow-pending';
  }

  const html = '<!DOCTYPE html>' +
'<html>' +
'<head>' +
'  <base target="_top">' +
'  <style>' +
'    body { font-family: Arial, sans-serif; padding: 16px; font-size: 13px; }' +
'    h2 { color: #1a73e8; margin-bottom: 8px; font-size: 18px; }' +
'    .header { background: #f1f3f4; padding: 12px; border-radius: 8px; margin-bottom: 16px; }' +
'    .header-row { display: flex; justify-content: space-between; margin-bottom: 4px; }' +
'    .label { font-weight: bold; color: #5f6368; }' +
'    .value { color: #202124; }' +
'    .status { display: inline-block; padding: 4px 12px; border-radius: 12px; font-weight: bold; }' +
'    .status-pending-review, .status-needs-attention { background: #fef7e0; color: #ea8600; }' +
'    .status-ready { background: #e6f4ea; color: #137333; }' +
'    .status-new { background: #e8f0fe; color: #1a73e8; }' +
'    .status-completed { background: #e6f4ea; color: #137333; }' +
'    .status-in-progress { background: #fef7e0; color: #ea8600; }' +
'    .section { margin-bottom: 16px; }' +
'    .section-title { font-weight: bold; color: #5f6368; margin-bottom: 8px; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; }' +
'    .calibration-item { background: #fff; border-left: 4px solid #137333; padding: 8px 12px; margin-bottom: 8px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }' +
'    .calibration-name { font-weight: bold; color: #202124; }' +
'    .calibration-type { font-size: 11px; color: #5f6368; }' +
'    .workflow-box { padding: 16px; border-radius: 8px; margin-bottom: 16px; text-align: center; }' +
'    .workflow-ready { background: #e6f4ea; border: 2px solid #137333; }' +
'    .workflow-attention { background: #fef7e0; border: 2px solid #ea8600; }' +
'    .workflow-completed { background: #e6f4ea; border: 2px solid #137333; }' +
'    .workflow-pending { background: #e8f0fe; border: 2px solid #1a73e8; }' +
'    .workflow-icon { font-size: 32px; margin-bottom: 8px; }' +
'    .workflow-text { font-weight: bold; font-size: 14px; }' +
'    .notes-box { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px; font-size: 12px; max-height: 150px; overflow-y: auto; margin-bottom: 12px; white-space: pre-wrap; }' +
'    .doc-status { font-size: 11px; margin-top: 8px; }' +
'    .doc-ok { color: #137333; }' +
'    .doc-missing { color: #c5221f; }' +
'    .info-box { background: #e8f0fe; border-left: 4px solid #1a73e8; padding: 12px; margin-bottom: 16px; border-radius: 4px; font-size: 12px; }' +
'    .scrub-details { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px; font-size: 11px; max-height: 200px; overflow-y: auto; font-family: monospace; white-space: pre-wrap; }' +
'    .btn { width: 100%; padding: 10px; font-size: 13px; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 8px; }' +
'    .btn-primary { background: #1a73e8; color: white; }' +
'    .btn-primary:hover { background: #1557b0; }' +
'    .btn-success { background: #137333; color: white; }' +
'    .btn-success:hover { background: #0d5c28; }' +
'    .btn-warning { background: #ea8600; color: white; }' +
'    .btn-warning:hover { background: #c87000; }' +
'    .btn-secondary { background: #f1f3f4; color: #5f6368; }' +
'    .btn-secondary:hover { background: #e0e0e0; }' +
'    .btn:disabled { opacity: 0.5; cursor: not-allowed; }' +
'    .btn-group { display: flex; gap: 8px; margin-bottom: 8px; }' +
'    .btn-group .btn { width: auto; flex: 1; }' +
'    .manual-override-section { background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 12px; margin-bottom: 16px; }' +
'    .manual-override-section .section-title { color: #856404; }' +
'    .status-result { margin-top: 8px; padding: 8px; border-radius: 4px; font-size: 12px; display: none; }' +
'    .status-result.success { background: #e6f4ea; color: #137333; display: block; }' +
'    .status-result.error { background: #fce8e6; color: #c5221f; display: block; }' +
'  </style>' +
'</head>' +
'<body>' +
'  <h2>RO: ' + escapeHtml(roPo) + '</h2>' +
'  <div class="workflow-box ' + workflowClass + '">' +
'    <div class="workflow-icon">' + (isCompleted || (isReady && confirmationSent) ? '✅' : needsAttention ? '⚠️' : '⏳') + '</div>' +
'    <div class="workflow-text">' + workflowStatus + '</div>' +
'  </div>' +
'  <div class="info-box">' +
'    <strong>📧 Automated Email Workflow</strong><br>' +
'    Emails are sent automatically by the server:<br>' +
'    • Sources agree → Confirmation to shop<br>' +
'    • Discrepancy → Review request to tech' +
'  </div>' +
'  <div class="header">' +
'    <div class="header-row"><span class="label">Shop:</span><span class="value">' + (shopName ? escapeHtml(shopName) : '<span style="color:#c5221f">NOT SET</span>') + '</span></div>' +
'    <div class="header-row"><span class="label">Shop Email:</span><span class="value">' + (shopEmail ? escapeHtml(shopEmail) : '<span style="color:#5f6368">Not configured</span>') + '</span></div>' +
'    <div class="header-row"><span class="label">Vehicle:</span><span class="value">' + escapeHtml(vehicle) + '</span></div>' +
'    <div class="header-row"><span class="label">VIN:</span><span class="value">' + escapeHtml(vin) + '</span></div>' +
'    <div class="header-row"><span class="label">Status:</span><span class="status status-' + status.toLowerCase().replace(/\s+/g, '-') + '">' + escapeHtml(status) + '</span></div>' +
'  </div>' +
'  <div class="section">' +
'    <div class="section-title">🎯 Required Calibrations (' + calibrationList.length + ')</div>' +
(calibrationList.length > 0 ? calibrationList.map(function(cal) {
  var parts = cal.match(/(.+?)\s*\((.+?)\)/);
  var name = parts ? parts[1] : cal;
  var type = parts ? parts[2] : '';
  return '<div class="calibration-item"><div class="calibration-name">' + escapeHtml(name) + '</div>' + (type ? '<div class="calibration-type">' + escapeHtml(type) + '</div>' : '') + '</div>';
}).join('') : '<div style="color:#5f6368;font-style:italic;">No calibrations required</div>') +
'  </div>' +
'  <div class="section">' +
'    <div class="section-title">📋 Documents</div>' +
'    <div class="doc-status">' +
'      ' + (hasRevvPdf
  ? (revvPdfUrl && revvPdfUrl.startsWith('http')
     ? '<a href="' + escapeHtml(revvPdfUrl) + '" target="_blank" style="color:#137333;text-decoration:none;">✓ RevvADAS PDF ↗</a>'
     : '<span class="doc-ok">✓ RevvADAS PDF (processed)</span>')
  : '<span class="doc-missing">✗ RevvADAS PDF</span>') + '<br>' +
'      ' + (hasPostScan
  ? '<a href="' + escapeHtml(postScanUrl) + '" target="_blank" style="color:#137333;text-decoration:none;">✓ Post-Scan ↗</a>'
  : '<span class="doc-missing">✗ Post-Scan</span>') + '<br>' +
'      ' + (hasInvoice
  ? '<a href="' + escapeHtml(invoiceUrl) + '" target="_blank" style="color:#137333;text-decoration:none;">✓ Invoice ↗</a>'
  : '<span class="doc-missing">✗ Invoice</span>') +
'    </div>' +
'  </div>' +
(notes ? '<div class="section"><div class="section-title">📝 Notes</div><div class="notes-box">' + escapeHtml(notes) + '</div></div>' : '') +
(fullScrub ? '<div class="section"><div class="section-title">🔍 Full Scrub Details</div><div class="scrub-details">' + escapeHtml(fullScrub) + '</div></div>' : '') +
'  <div class="manual-override-section">' +
'    <div class="section-title">⚠️ Manual Overrides</div>' +
'    <p style="font-size:11px;color:#856404;margin-bottom:12px;">Use these only when automated workflow needs manual intervention.</p>' +
'    <div class="section-title" style="font-size:12px;margin-top:8px;">Change Status:</div>' +
'    <div class="btn-group">' +
'      <button class="btn btn-secondary" onclick="changeStatus(\'New\')">New</button>' +
'      <button class="btn btn-success" onclick="changeStatus(\'Ready\')">Ready</button>' +
'    </div>' +
'    <div class="btn-group">' +
'      <button class="btn btn-primary" onclick="changeStatus(\'Scheduled\')">Scheduled</button>' +
'      <button class="btn btn-warning" onclick="changeStatus(\'Rescheduled\')">Rescheduled</button>' +
'    </div>' +
'    <div class="btn-group">' +
'      <button class="btn btn-primary" onclick="changeStatus(\'Completed\')">Completed</button>' +
'    </div>' +
'    <p style="font-size:11px;color:#666;margin:8px 0 0 0;">To cancel: Call assistant with reason.</p>' +
'    <div class="section-title" style="font-size:12px;margin-top:12px;">Manual Actions:</div>' +
'    <button class="btn btn-primary" id="btnSendIntake" onclick="manualSendIntake()">📧 Send Intake Email to Shop</button>' +
'    <button class="btn btn-success" id="btnSendClosure" onclick="manualSendClosure()">📧 Send Closure Email</button>' +
'    <div id="statusResult" class="status-result"></div>' +
'  </div>' +
'  <div style="margin-top: 16px;">' +
'    <button class="btn btn-secondary" onclick="google.script.host.close()">Close</button>' +
'  </div>' +
'  <script>' +
'    var rowNum = ' + row + ';' +
'    function changeStatus(newStatus) {' +
'      google.script.run' +
'        .withSuccessHandler(function(result) {' +
'          showResult(true, "Status changed to: " + newStatus);' +
'          setTimeout(function() { location.reload(); }, 1000);' +
'        })' +
'        .withFailureHandler(function(err) {' +
'          showResult(false, "Error: " + err.message);' +
'        })' +
'        .updateRowStatusFromSidebar(rowNum, newStatus);' +
'    }' +
'    function manualSendIntake() {' +
'      var btn = document.getElementById("btnSendIntake");' +
'      btn.disabled = true;' +
'      btn.textContent = "Sending...";' +
'      google.script.run' +
'        .withSuccessHandler(function(result) {' +
'          btn.disabled = false;' +
'          btn.textContent = "📧 Send Intake Email to Shop";' +
'          if (result.success) {' +
'            showResult(true, "Intake email sent to: " + result.email);' +
'          } else {' +
'            showResult(false, "Error: " + result.error);' +
'          }' +
'        })' +
'        .withFailureHandler(function(err) {' +
'          btn.disabled = false;' +
'          btn.textContent = "📧 Send Intake Email to Shop";' +
'          showResult(false, "Error: " + err.message);' +
'        })' +
'        .sendIntakeEmailToShop(rowNum);' +
'    }' +
'    function manualSendClosure() {' +
'      var btn = document.getElementById("btnSendClosure");' +
'      btn.disabled = true;' +
'      btn.textContent = "Sending...";' +
'      google.script.run' +
'        .withSuccessHandler(function(result) {' +
'          btn.disabled = false;' +
'          btn.textContent = "📧 Send Closure Email";' +
'          if (result.success) {' +
'            showResult(true, "Closure email sent to: " + result.email);' +
'          } else {' +
'            showResult(false, "Error: " + result.error);' +
'          }' +
'        })' +
'        .withFailureHandler(function(err) {' +
'          btn.disabled = false;' +
'          btn.textContent = "📧 Send Closure Email";' +
'          showResult(false, "Error: " + err.message);' +
'        })' +
'        .sendClosureEmailToShop(rowNum);' +
'    }' +
'    function showResult(success, message) {' +
'      var el = document.getElementById("statusResult");' +
'      el.className = "status-result " + (success ? "success" : "error");' +
'      el.textContent = message;' +
'    }' +
'  </script>' +
'</body>' +
'</html>';

  const htmlOutput = HtmlService.createHtmlOutput(html)
    .setTitle('Status: ' + roPo)
    .setWidth(400);

  SpreadsheetApp.getUi().showSidebar(htmlOutput);
}
