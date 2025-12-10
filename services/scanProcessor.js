/**
 * scanProcessor.js - PDF classification and VIN-based matching for scan reports
 *
 * Handles:
 * - Classify PDFs as estimate, pre-scan, post-scan, or revv report
 * - Match estimate and pre-scan by VIN when RO not in filename
 * - Process scan reports and extract DTCs
 * - Build consolidated DTC data for Column L
 */

import pdf from 'pdf-parse';
import dtcExtractor from './dtcExtractor.js';

const LOG_TAG = '[SCAN_PROCESSOR]';

/**
 * PDF types for classification
 */
export const PDF_TYPES = {
  ESTIMATE: 'estimate',
  PRE_SCAN: 'pre_scan',
  POST_SCAN: 'post_scan',
  REVV_REPORT: 'revv_report',
  ADAS_INVOICE: 'adas_invoice',
  UNKNOWN: 'unknown'
};

/**
 * Classify PDF type based on filename and content
 * @param {string} filename - PDF filename
 * @param {string} text - Extracted PDF text
 * @returns {string} - PDF type from PDF_TYPES
 */
export function classifyPDF(filename, text) {
  const nameLower = filename.toLowerCase();
  const textLower = text.toLowerCase();

  // Pre-scan indicators (check first - specific naming patterns)
  if (nameLower.includes('prescan') ||
      nameLower.includes('pre scan') ||
      nameLower.includes('pre-scan') ||
      nameLower.includes('entpre') ||
      nameLower.includes('ent pre')) {
    console.log(`${LOG_TAG} Classified as PRE_SCAN (filename pattern): ${filename}`);
    return PDF_TYPES.PRE_SCAN;
  }

  // Post-scan indicators
  if (nameLower.includes('postscan') ||
      nameLower.includes('post scan') ||
      nameLower.includes('post-scan') ||
      nameLower.includes('final scan') ||
      nameLower.includes('after scan')) {
    console.log(`${LOG_TAG} Classified as POST_SCAN (filename pattern): ${filename}`);
    return PDF_TYPES.POST_SCAN;
  }

  // Generic "PRE SCAN.pdf" without RO number
  if (nameLower === 'pre scan.pdf' || nameLower === 'prescan.pdf') {
    console.log(`${LOG_TAG} Classified as PRE_SCAN (generic filename): ${filename}`);
    return PDF_TYPES.PRE_SCAN;
  }

  // RevvADAS report patterns
  if (nameLower.includes('revv') ||
      nameLower.startsWith('vehid') ||
      nameLower.match(/^vehid[_-]?\d/)) {
    console.log(`${LOG_TAG} Classified as REVV_REPORT (filename): ${filename}`);
    return PDF_TYPES.REVV_REPORT;
  }

  // VIN filename pattern (17 characters) - typically RevvADAS
  const nameWithoutExt = filename.replace(/\.pdf$/i, '');
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(nameWithoutExt)) {
    console.log(`${LOG_TAG} Classified as REVV_REPORT (VIN filename): ${filename}`);
    return PDF_TYPES.REVV_REPORT;
  }

  // ADAS Invoice check
  if (textLower.includes('adas f1rst') ||
      textLower.includes('adas first service') ||
      textLower.includes('15021 sw 169th ln')) {
    if (textLower.includes('invoice number') || textLower.includes('bill to')) {
      console.log(`${LOG_TAG} Classified as ADAS_INVOICE: ${filename}`);
      return PDF_TYPES.ADAS_INVOICE;
    }
  }

  // Check content for scan report indicators
  if (textLower.includes('diagnostic scan') ||
      textLower.includes('vehicle scan') ||
      textLower.includes('dtc') ||
      textLower.includes('fault code') ||
      textLower.includes('trouble code') ||
      textLower.includes('autel') ||
      textLower.includes('maxisys') ||
      textLower.includes('module communication')) {

    // Try to determine if pre or post from content
    if (textLower.includes('pre-scan') ||
        textLower.includes('pre scan') ||
        textLower.includes('prescan') ||
        textLower.includes('initial scan')) {
      console.log(`${LOG_TAG} Classified as PRE_SCAN (content): ${filename}`);
      return PDF_TYPES.PRE_SCAN;
    }
    if (textLower.includes('post-scan') ||
        textLower.includes('post scan') ||
        textLower.includes('postscan') ||
        textLower.includes('final scan') ||
        textLower.includes('after repair')) {
      console.log(`${LOG_TAG} Classified as POST_SCAN (content): ${filename}`);
      return PDF_TYPES.POST_SCAN;
    }

    // Default scan to pre-scan for shop emails
    console.log(`${LOG_TAG} Classified as PRE_SCAN (generic scan content): ${filename}`);
    return PDF_TYPES.PRE_SCAN;
  }

  // RevvADAS content patterns
  if (textLower.includes('revv') ||
      textLower.includes('revvadas') ||
      textLower.includes('calibration required') ||
      textLower.includes('required calibrations') ||
      textLower.includes('adas operations')) {
    console.log(`${LOG_TAG} Classified as REVV_REPORT (content): ${filename}`);
    return PDF_TYPES.REVV_REPORT;
  }

  // Estimate detection (check content for estimate indicators)
  if (textLower.includes('estimate') ||
      (textLower.includes('labor') && textLower.includes('parts')) ||
      textLower.includes('repair order') ||
      textLower.includes('grand total') ||
      textLower.includes('subtotal') ||
      textLower.includes('deductible') ||
      textLower.includes('r&i') ||
      textLower.includes('r&r') ||
      textLower.includes('refinish') ||
      textLower.includes('paint labor') ||
      textLower.includes('body labor')) {
    console.log(`${LOG_TAG} Classified as ESTIMATE (content): ${filename}`);
    return PDF_TYPES.ESTIMATE;
  }

  // Filename is just an RO number - likely estimate
  if (/^\d{4,6}\.pdf$/i.test(filename)) {
    console.log(`${LOG_TAG} Classified as ESTIMATE (RO filename pattern): ${filename}`);
    return PDF_TYPES.ESTIMATE;
  }

  console.log(`${LOG_TAG} Could not classify PDF type: ${filename}`);
  return PDF_TYPES.UNKNOWN;
}

/**
 * Extract RO number from filename
 * Common patterns:
 * - "3095.pdf" -> "3095"
 * - "3095-PRESCAN.pdf" -> "3095"
 * - "RO_3095.pdf" -> "3095"
 * @param {string} filename - PDF filename
 * @returns {string|null} - RO number or null
 */
export function extractROFromFilename(filename) {
  if (!filename) return null;

  // Remove extension
  const baseName = filename.replace(/\.pdf$/i, '');

  // Pattern 1: RO number prefix (RO_12345, RO-12345)
  const roMatch = baseName.match(/^RO[_\-]?(\d+)/i);
  if (roMatch) {
    console.log(`${LOG_TAG} RO from RO prefix: ${roMatch[1]}`);
    return roMatch[1];
  }

  // Pattern 2: Just digits at the start (before any suffix)
  const digitsMatch = baseName.match(/^(\d{4,6})/);
  if (digitsMatch) {
    console.log(`${LOG_TAG} RO from leading digits: ${digitsMatch[1]}`);
    return digitsMatch[1];
  }

  // Pattern 3: Digits with suffix (3095-PRESCAN -> 3095)
  const withSuffixMatch = baseName.match(/^(\d{4,6})[-_]/);
  if (withSuffixMatch) {
    console.log(`${LOG_TAG} RO from digits with suffix: ${withSuffixMatch[1]}`);
    return withSuffixMatch[1];
  }

  return null;
}

/**
 * Process a single PDF attachment
 * @param {Buffer} buffer - PDF file buffer
 * @param {string} filename - PDF filename
 * @returns {Promise<Object>} - Processed PDF data
 */
export async function processPDF(buffer, filename) {
  try {
    const pdfData = await pdf(buffer);
    const text = pdfData.text || '';

    const pdfType = classifyPDF(filename, text);
    const roFromFilename = extractROFromFilename(filename);
    const vin = dtcExtractor.extractVIN(text);

    const result = {
      filename,
      pdfType,
      roFromFilename,
      vin,
      text,
      dtcs: [],
      formattedDTCs: null,
      hasADASDTCs: false,
      adasWarning: null,
      isClean: false
    };

    // Process scan reports for DTCs
    if (pdfType === PDF_TYPES.PRE_SCAN || pdfType === PDF_TYPES.POST_SCAN) {
      const scanType = pdfType === PDF_TYPES.PRE_SCAN ? 'PRE' : 'POST';
      const scanResult = dtcExtractor.processScanReport(text, scanType);

      result.dtcs = scanResult.dtcs;
      result.formattedDTCs = scanResult.formatted;
      result.hasADASDTCs = scanResult.hasADASDTCs;
      result.adasDTCs = scanResult.adasDTCs;
      result.adasWarning = scanResult.warning;
      result.isClean = dtcExtractor.isCleanScan(text);

      console.log(`${LOG_TAG} Scan processed: ${filename} -> ${scanResult.dtcs.length} DTCs, clean: ${result.isClean}`);
    }

    return result;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to process PDF ${filename}:`, err.message);
    return {
      filename,
      pdfType: PDF_TYPES.UNKNOWN,
      error: err.message
    };
  }
}

/**
 * Process multiple PDF attachments and match by VIN
 * @param {Array<{buffer: Buffer, filename: string}>} pdfs - Array of PDF objects
 * @returns {Promise<Object>} - Consolidated results with VIN matching
 */
export async function processEmailAttachments(pdfs) {
  console.log(`${LOG_TAG} Processing ${pdfs.length} PDF attachments`);

  const results = {
    estimate: null,
    preScan: null,
    postScan: null,
    revvReport: null,
    invoice: null,
    unknown: [],
    matchedByVIN: false,
    commonVIN: null,
    roNumber: null,
    dtcsForColumn: null,
    adasWarning: null
  };

  // Process all PDFs
  const processed = [];
  for (const pdf of pdfs) {
    const result = await processPDF(pdf.buffer, pdf.filename);
    processed.push(result);

    // Categorize by type
    switch (result.pdfType) {
      case PDF_TYPES.ESTIMATE:
        if (!results.estimate) results.estimate = result;
        break;
      case PDF_TYPES.PRE_SCAN:
        if (!results.preScan) results.preScan = result;
        break;
      case PDF_TYPES.POST_SCAN:
        if (!results.postScan) results.postScan = result;
        break;
      case PDF_TYPES.REVV_REPORT:
        if (!results.revvReport) results.revvReport = result;
        break;
      case PDF_TYPES.ADAS_INVOICE:
        if (!results.invoice) results.invoice = result;
        break;
      default:
        results.unknown.push(result);
    }

    // Collect RO from filename
    if (!results.roNumber && result.roFromFilename) {
      results.roNumber = result.roFromFilename;
    }
  }

  // VIN matching logic
  const vinCounts = {};
  for (const result of processed) {
    if (result.vin) {
      vinCounts[result.vin] = (vinCounts[result.vin] || 0) + 1;
    }
  }

  // Find VIN that appears in multiple documents (or any VIN if only one found)
  const vins = Object.keys(vinCounts);
  if (vins.length === 1) {
    results.commonVIN = vins[0];
    results.matchedByVIN = true;
    console.log(`${LOG_TAG} Single VIN found across documents: ${results.commonVIN}`);
  } else if (vins.length > 1) {
    // Use VIN from estimate if available, otherwise most common
    const estimateVin = results.estimate?.vin;
    if (estimateVin && vinCounts[estimateVin]) {
      results.commonVIN = estimateVin;
      console.log(`${LOG_TAG} Using VIN from estimate: ${results.commonVIN}`);
    } else {
      // Use most common VIN
      results.commonVIN = vins.reduce((a, b) => vinCounts[a] > vinCounts[b] ? a : b);
      console.log(`${LOG_TAG} Using most common VIN: ${results.commonVIN}`);
    }

    // Check if estimate and pre-scan share the same VIN
    if (results.estimate?.vin && results.preScan?.vin) {
      results.matchedByVIN = results.estimate.vin === results.preScan.vin;
      console.log(`${LOG_TAG} Estimate-PreScan VIN match: ${results.matchedByVIN}`);
    }
  }

  // Build DTCs for Column L
  let dtcsForColumn = null;

  if (results.preScan?.formattedDTCs) {
    dtcsForColumn = results.preScan.formattedDTCs;

    // Add post-scan if available
    if (results.postScan?.formattedDTCs) {
      dtcsForColumn = dtcExtractor.mergeDTCs(
        dtcsForColumn,
        results.postScan.dtcs,
        'POST'
      );
    }
  } else if (results.postScan?.formattedDTCs) {
    // Only post-scan available
    dtcsForColumn = `PRE: None | ${results.postScan.formattedDTCs}`;
  }

  results.dtcsForColumn = dtcsForColumn;

  // Collect ADAS warnings
  if (results.preScan?.adasWarning) {
    results.adasWarning = results.preScan.adasWarning;
  }

  console.log(`${LOG_TAG} Processing complete:`, {
    hasEstimate: !!results.estimate,
    hasPreScan: !!results.preScan,
    hasPostScan: !!results.postScan,
    hasRevvReport: !!results.revvReport,
    commonVIN: results.commonVIN,
    dtcsForColumn: results.dtcsForColumn
  });

  return results;
}

/**
 * Build update payload for Google Sheets
 * @param {Object} processedResults - Results from processEmailAttachments
 * @param {Object} existingData - Existing row data (for merging DTCs)
 * @returns {Object} - Payload with dtcs field for Column L
 */
export function buildSheetUpdatePayload(processedResults, existingData = {}) {
  const payload = {
    vin: processedResults.commonVIN || null,
    dtcs: null,
    notes: null
  };

  // Handle DTCs - merge with existing if present
  if (processedResults.dtcsForColumn) {
    if (existingData.dtcs) {
      // Parse existing and merge
      const existingParsed = dtcExtractor.parseDTCColumn(existingData.dtcs);

      if (processedResults.preScan && existingParsed.post.length > 0) {
        // Keep existing POST, update PRE
        payload.dtcs = dtcExtractor.mergeDTCs(
          existingData.dtcs,
          processedResults.preScan.dtcs,
          'PRE'
        );
      } else if (processedResults.postScan && existingParsed.pre.length > 0) {
        // Keep existing PRE, update POST
        payload.dtcs = dtcExtractor.mergeDTCs(
          existingData.dtcs,
          processedResults.postScan.dtcs,
          'POST'
        );
      } else {
        payload.dtcs = processedResults.dtcsForColumn;
      }
    } else {
      payload.dtcs = processedResults.dtcsForColumn;
    }
  }

  // Add ADAS warning to notes if present
  if (processedResults.adasWarning) {
    payload.notes = processedResults.adasWarning;
  }

  return payload;
}

export default {
  PDF_TYPES,
  classifyPDF,
  extractROFromFilename,
  processPDF,
  processEmailAttachments,
  buildSheetUpdatePayload
};
