/**
 * dtcExtractor.js - DTC (Diagnostic Trouble Code) extraction from scan PDFs
 *
 * Handles:
 * - DTC code pattern extraction (P, B, C, U codes)
 * - VIN extraction and validation
 * - ADAS-related DTC detection for warnings
 * - Format DTCs for Column L in the format "PRE: P0171, U0100 | POST: None"
 */

import { fileURLToPath } from 'url';
import path from 'path';

const LOG_TAG = '[DTC_EXTRACTOR]';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Standard OBD-II DTC pattern
 * P = Powertrain, B = Body, C = Chassis, U = Network/Communication
 * Followed by 4 hex characters (0-9, A-F)
 */
const DTC_PATTERN = /\b([PBCU][0-9A-Fa-f]{4})\b/gi;

/**
 * Standard VIN pattern (17 alphanumeric characters, excluding I, O, Q)
 */
const VIN_PATTERN = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;

/**
 * ADAS-related DTC prefixes that may indicate calibration issues
 * B1xxx - Body codes (cameras, sensors)
 * U0xxx, U1xxx - Network/communication codes (ADAS module comms)
 * C1xxx - Chassis codes (radar, steering angle)
 */
const ADAS_DTC_PATTERNS = [
  /^B1[0-9A-Fa-f]{3}$/i,  // Body codes (cameras, parking sensors)
  /^U0[0-9A-Fa-f]{3}$/i,  // Network codes (CAN bus communication)
  /^U1[0-9A-Fa-f]{3}$/i,  // Network codes (module communication)
  /^C1[0-9A-Fa-f]{3}$/i,  // Chassis codes (radar, steering)
  /^U3[0-9A-Fa-f]{3}$/i,  // Software incompatibility codes
];

/**
 * Validate a VIN candidate
 * @param {string} vin - 17-character string to validate
 * @returns {boolean} - True if VIN looks valid
 */
export function isValidVIN(vin) {
  if (!vin || vin.length !== 17) return false;

  const upperVin = vin.toUpperCase();

  // Skip common false positives - reference numbers from estimate systems
  if (/^(ALL|AUD|CCM|CCC|EST|REF|INV|DAT|DOC|PDF|IMG|RPT)/i.test(upperVin)) {
    console.log(`${LOG_TAG} Rejecting VIN (estimate system reference): ${upperVin}`);
    return false;
  }

  // WMI (World Manufacturer Identifier) - first character must be valid
  // 1-5: North America, J: Japan, K: Korea, S: UK, W: Germany, etc.
  const validFirstChar = /^[1-5JKLMNSTUVWXYZ]/;
  if (!validFirstChar.test(upperVin)) {
    console.log(`${LOG_TAG} Rejecting VIN (invalid WMI first char): ${upperVin}`);
    return false;
  }

  // Position 9 is the check digit (0-9 or X)
  const checkDigit = upperVin.charAt(8);
  if (!/^[0-9X]$/.test(checkDigit)) {
    console.log(`${LOG_TAG} Rejecting VIN (invalid check digit): ${upperVin}`);
    return false;
  }

  // Must have mix of letters and numbers
  const hasLetters = /[A-HJ-NPR-Z]/i.test(upperVin);
  const hasNumbers = /[0-9]/.test(upperVin);
  if (!hasLetters || !hasNumbers) {
    console.log(`${LOG_TAG} Rejecting VIN (no letter/number mix): ${upperVin}`);
    return false;
  }

  return true;
}

/**
 * Extract VIN from text content
 * @param {string} text - Text to search for VINs
 * @returns {string|null} - Best VIN candidate or null
 */
export function extractVIN(text) {
  if (!text) return null;

  const matches = text.match(VIN_PATTERN);
  if (!matches) return null;

  // Score candidates - prefer VINs near "VIN" label
  const candidates = [];
  let match;
  const vinRegex = new RegExp(VIN_PATTERN.source, 'gi');

  while ((match = vinRegex.exec(text)) !== null) {
    const candidate = match[1].toUpperCase();

    if (!isValidVIN(candidate)) continue;

    // Check if "VIN" label appears within 50 chars before this match
    const contextBefore = text.substring(Math.max(0, match.index - 50), match.index).toLowerCase();
    const nearVinLabel = contextBefore.includes('vin');

    // Position score - earlier in document is better
    const positionScore = 1 - (match.index / text.length);

    candidates.push({ vin: candidate, nearVinLabel, positionScore });
  }

  if (candidates.length === 0) return null;

  // Sort by quality: near VIN label > position
  candidates.sort((a, b) => {
    if (a.nearVinLabel !== b.nearVinLabel) return b.nearVinLabel - a.nearVinLabel;
    return b.positionScore - a.positionScore;
  });

  console.log(`${LOG_TAG} VIN candidates: ${candidates.length}, selected: ${candidates[0].vin}`);
  return candidates[0].vin;
}

/**
 * Validate DTC code format
 * @param {string} code - DTC code (e.g., "P0100")
 * @returns {boolean} - True if valid DTC format
 */
export function isValidDTC(code) {
  if (!code || code.length !== 5) return false;
  return /^[PBCU][0-9A-Fa-f]{4}$/i.test(code);
}

/**
 * Check if a DTC is ADAS-related
 * @param {string} code - DTC code
 * @returns {boolean} - True if ADAS-related
 */
export function isADASDTC(code) {
  if (!code) return false;
  const upperCode = code.toUpperCase();
  return ADAS_DTC_PATTERNS.some(pattern => pattern.test(upperCode));
}

/**
 * Extract all DTCs from text content
 * @param {string} text - Text to search for DTCs
 * @returns {string[]} - Array of unique DTC codes, sorted by type
 */
export function extractDTCs(text) {
  if (!text) return [];

  const matches = text.match(DTC_PATTERN) || [];

  // Filter valid DTCs and normalize to uppercase
  const validDTCs = matches
    .map(dtc => dtc.toUpperCase())
    .filter(dtc => isValidDTC(dtc));

  // Remove duplicates
  const unique = [...new Set(validDTCs)];

  // Sort by type: P (Powertrain), B (Body), C (Chassis), U (Network)
  const typeOrder = { P: 0, B: 1, C: 2, U: 3 };
  unique.sort((a, b) => {
    const orderA = typeOrder[a[0]] ?? 4;
    const orderB = typeOrder[b[0]] ?? 4;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b);
  });

  console.log(`${LOG_TAG} Extracted ${unique.length} DTCs from text`);
  return unique;
}

/**
 * Check if scan report indicates no DTCs found
 * @param {string} text - Text content to check
 * @returns {boolean} - True if text indicates no DTCs
 */
export function isCleanScan(text) {
  if (!text) return false;

  const lowerText = text.toLowerCase();

  // Common phrases indicating no DTCs
  const cleanIndicators = [
    'no dtc',
    'no diagnostic trouble code',
    'no fault',
    'no faults',
    'no trouble code',
    'system ok',
    'systems ok',
    'all systems ok',
    'pass',
    'no active code',
    'no stored code',
    '0 dtc',
    'dtc count: 0',
    'dtc: none',
    'fault codes: none'
  ];

  return cleanIndicators.some(indicator => lowerText.includes(indicator));
}

/**
 * Format DTCs for Column L
 * @param {string[]} dtcs - Array of DTC codes
 * @param {string} scanType - 'PRE' or 'POST'
 * @returns {string} - Formatted string like "PRE: P0171, U0100" or "PRE: None"
 */
export function formatDTCsForColumn(dtcs, scanType = 'PRE') {
  const prefix = scanType.toUpperCase();

  if (!dtcs || dtcs.length === 0) {
    return `${prefix}: None`;
  }

  return `${prefix}: ${dtcs.join(', ')}`;
}

/**
 * Parse existing Column L value to extract PRE and POST DTCs
 * @param {string} columnValue - Value like "PRE: P0171 | POST: None"
 * @returns {{ pre: string[], post: string[] }} - Parsed DTCs
 */
export function parseDTCColumn(columnValue) {
  const result = { pre: [], post: [] };

  if (!columnValue) return result;

  // Split by pipe separator
  const parts = columnValue.split('|').map(p => p.trim());

  for (const part of parts) {
    const lowerPart = part.toLowerCase();

    if (lowerPart.startsWith('pre:')) {
      const dtcsPart = part.substring(4).trim();
      if (dtcsPart.toLowerCase() !== 'none') {
        result.pre = dtcsPart.split(',').map(d => d.trim()).filter(d => isValidDTC(d));
      }
    } else if (lowerPart.startsWith('post:')) {
      const dtcsPart = part.substring(5).trim();
      if (dtcsPart.toLowerCase() !== 'none') {
        result.post = dtcsPart.split(',').map(d => d.trim()).filter(d => isValidDTC(d));
      }
    }
  }

  return result;
}

/**
 * Merge new DTCs with existing Column L value
 * @param {string} existingValue - Current Column L value
 * @param {string[]} newDTCs - New DTCs to merge
 * @param {string} scanType - 'PRE' or 'POST'
 * @returns {string} - Merged Column L value
 */
export function mergeDTCs(existingValue, newDTCs, scanType = 'PRE') {
  const parsed = parseDTCColumn(existingValue);
  const newFormatted = formatDTCsForColumn(newDTCs, scanType);

  if (scanType.toUpperCase() === 'PRE') {
    // Update PRE, keep POST
    if (parsed.post.length > 0) {
      return `${newFormatted} | POST: ${parsed.post.join(', ')}`;
    }
    return newFormatted;
  } else {
    // Keep PRE, update POST
    const preFormatted = parsed.pre.length > 0
      ? `PRE: ${parsed.pre.join(', ')}`
      : 'PRE: None';
    return `${preFormatted} | ${newFormatted}`;
  }
}

/**
 * Extract DTCs from scan report and check for ADAS warnings
 * @param {string} text - Scan report text
 * @param {string} scanType - 'PRE' or 'POST'
 * @returns {{ dtcs: string[], formatted: string, hasADASDTCs: boolean, warning: string|null }}
 */
export function processScanReport(text, scanType = 'PRE') {
  const dtcs = extractDTCs(text);
  const formatted = formatDTCsForColumn(dtcs, scanType);

  // Check for ADAS-related DTCs
  const adasDTCs = dtcs.filter(dtc => isADASDTC(dtc));
  const hasADASDTCs = adasDTCs.length > 0;

  let warning = null;
  if (hasADASDTCs && scanType.toUpperCase() === 'PRE') {
    warning = `Pre-scan has ADAS DTCs (${adasDTCs.join(', ')}) - may need clearing before calibration`;
  }

  console.log(`${LOG_TAG} Processed ${scanType} scan: ${dtcs.length} DTCs, ADAS DTCs: ${adasDTCs.length}`);

  return {
    dtcs,
    formatted,
    hasADASDTCs,
    adasDTCs,
    warning
  };
}

/**
 * Full extraction from scan PDF text
 * Returns VIN, DTCs, scan type detection, and formatted output
 * @param {string} text - PDF text content
 * @param {string} filename - PDF filename for type detection
 * @returns {{ vin: string|null, dtcs: string[], formatted: string, scanType: string, hasADASDTCs: boolean, warning: string|null, isClean: boolean }}
 */
export function extractFromScanPDF(text, filename = '') {
  const vin = extractVIN(text);
  const filenameLower = filename.toLowerCase();

  // Detect scan type from filename
  let scanType = 'PRE';
  if (filenameLower.includes('post') ||
      filenameLower.includes('final') ||
      filenameLower.includes('after')) {
    scanType = 'POST';
  }

  // Check if this is a clean scan
  const isClean = isCleanScan(text);

  // Extract and process DTCs
  const result = processScanReport(text, scanType);

  return {
    vin,
    ...result,
    scanType,
    isClean
  };
}

export default {
  extractVIN,
  extractDTCs,
  isValidVIN,
  isValidDTC,
  isADASDTC,
  isCleanScan,
  formatDTCsForColumn,
  parseDTCColumn,
  mergeDTCs,
  processScanReport,
  extractFromScanPDF
};
