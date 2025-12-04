/**
 * ADAS Estimate Scrub Module - Index
 *
 * This module provides the CORRECTED scrub logic that:
 * 1. Only flags calibrations when triggered by actual repair operations
 * 2. Verifies vehicle equipment before flagging
 * 3. Reconciles with RevvADAS recommendations
 * 4. Generates legally defensible, traceable output
 *
 * CRITICAL PRINCIPLE: A calibration is ONLY flagged if:
 * - A specific repair line in the estimate triggers it, AND
 * - The vehicle is confirmed/likely to have that ADAS system
 */

// Import for default export
import {
  scrubEstimateV2 as _scrubEstimateV2,
  quickScan as _quickScan,
  generateScrubSummary as _generateScrubSummary
} from './scrubEngine.js';

const LOG_TAG = '[SCRUB]';

/**
 * Backwards-compatible wrapper for scrubEstimateNew
 * Converts old function signature to new scrubEstimateV2 signature
 * AND transforms the new result format into the old expected format
 *
 * Old signature: scrubEstimateNew(pdfText, roPo, options = {})
 * New signature: scrubEstimateV2({ estimateText, vin, brand, year, revvText, vehicle })
 */
export async function scrubEstimateNew(pdfText, roPo, options = {}) {
  console.log(`${LOG_TAG} Using NEW RevvADAS 4-stage scrubber for RO: ${roPo}`);

  const newResult = await _scrubEstimateV2({
    estimateText: pdfText,
    vin: options.vin || null,
    brand: options.brand || null,
    year: options.year || null,
    revvText: options.revvText || null,
    vehicle: options.vehicle || null
  });

  // Transform new result format to old expected format for backwards compatibility
  // Old format expected flat fields like: vin, vehicleMake, status, foundOperations, etc.
  const result = {
    // Metadata
    roPo,
    scrubVersion: newResult.scrubVersion,
    scrubTimestamp: newResult.scrubTimestamp,
    processingTimeMs: newResult.processingTimeMs,

    // Flatten vehicle info (old format had flat fields)
    vin: newResult.vehicle?.vin || null,
    vehicleMake: newResult.vehicle?.brand || null,
    vehicleYear: newResult.vehicle?.year || null,
    vehicle: newResult.vehicle?.vehicleString || buildVehicleString(newResult.vehicle),

    // Map repair operations to old format
    foundOperations: (newResult.repairOperations?.lines || []).map(line => ({
      lineNumber: line.lineNumber,
      operation: line.operation,
      category: line.category,
      description: line.description,
      location: line.location
    })),

    // Map triggered calibrations to old "requiredFromEstimate" format
    requiredFromEstimate: (newResult.triggeredCalibrations || []).map(tc => ({
      system: tc.calibration,
      calibrationType: tc.type,
      triggeredBy: tc.triggeredBy,
      reason: tc.reason,
      confidence: tc.confidence
    })),

    // Map RevvADAS reconciliation
    requiredFromRevv: (newResult.revvReconciliation?.details?.revvItems || []),
    missingCalibrations: (newResult.revvReconciliation?.details?.scrubOnly || []).map(item => item.system || item),

    // Status mapping
    status: mapReconciliationStatus(newResult.revvReconciliation?.status),
    statusMessage: newResult.revvReconciliation?.notes || '',
    needsAttention: newResult.summary?.needsAttention || false,

    // Final calibrations list
    calibrationsRequired: newResult.calibrationsRequired || [],
    calibrationsNeedingVerification: newResult.calibrationsNeedingVerification || [],

    // Summary counts
    operationsCount: newResult.repairOperations?.totalFound || 0,
    calibrationsTriggered: newResult.summary?.calibrationsTriggered || 0,
    reconciliationStatus: newResult.revvReconciliation?.status || 'OK',

    // Keep full new result for reference
    _newFormatResult: newResult
  };

  console.log(`${LOG_TAG} Scrub complete: ${result.operationsCount} ops, ${result.calibrationsTriggered} calibrations, status: ${result.status}`);
  console.log(`${LOG_TAG} Vehicle: ${result.vehicle || 'Unknown'}, VIN: ${result.vin || 'N/A'}`);

  return result;
}

/**
 * Build vehicle string from vehicle object
 */
function buildVehicleString(vehicle) {
  if (!vehicle) return null;
  const parts = [vehicle.year, vehicle.brand, vehicle.model].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Map new reconciliation status to old status format
 */
function mapReconciliationStatus(status) {
  switch (status) {
    case 'OK':
    case 'MATCH':
      return 'OK';
    case 'DISCREPANCY':
    case 'MISMATCH':
      return 'DISCREPANCY';
    case 'REVV_ONLY':
      return 'REVV_ONLY';
    case 'SCRUB_ONLY':
      return 'SCRUB_ONLY';
    case 'NO_REVV':
      return 'NO_REVV_DATA';
    case 'ERROR':
      return 'ERROR';
    default:
      return status || 'UNKNOWN';
  }
}

import {
  formatCompactNotes as _formatCompactNotes,
  formatPreviewNotes as _formatPreviewNotes,
  formatFullScrub as _formatFullScrub,
  formatVoiceSummary as _formatVoiceSummary
} from './outputFormatter.js';

// Main scrub engine
export { scrubEstimateV2, quickScan, generateScrubSummary } from './scrubEngine.js';

// Estimate parsing
export {
  parseEstimate,
  parseEstimateLine,
  extractVehicleInfo,
  extractMentionedADASFeatures,
  getRepairSummary
} from './estimateParser.js';

// Calibration triggers
export {
  REPAIR_CATEGORIES,
  OPERATION_TYPES,
  CALIBRATION_TYPES,
  ADAS_SYSTEMS,
  getTriggersForRepair,
  getCalibrationType,
  getRepairsThatTriggerSystem,
  loadOEMTriggers,
  checkCalibrationTriggered,
  getCalibrationExplanation
} from './calibrationTriggers.js';

// Vehicle equipment
export {
  decodeVIN,
  getExpectedADASByBrandYear,
  parseRevvEquipment,
  mergeEquipmentSources,
  checkVehicleHasSystem,
  buildEquipmentProfile,
  verifyCalibrationNeeded
} from './vehicleEquipment.js';

// RevvADAS reconciliation
export {
  normalizeCalibrationName,
  parseRevvCalibrations,
  calibrationsMatch,
  reconcileCalibrations,
  getReconciliationStatus,
  generateReconciliationNotes,
  buildFinalCalibrationList
} from './revvReconciler.js';

// Output formatting
export {
  formatCompactNotes,
  formatPreviewNotes,
  formatFullScrub,
  formatJSONOutput,
  formatVoiceSummary,
  formatInvoiceLineItems,
  formatLegalDocumentation
} from './outputFormatter.js';

// Default export with main functions
export default {
  // Main scrub function
  scrubEstimateV2: _scrubEstimateV2,
  quickScan: _quickScan,
  generateScrubSummary: _generateScrubSummary,

  // Formatters
  formatCompactNotes: _formatCompactNotes,
  formatPreviewNotes: _formatPreviewNotes,
  formatFullScrub: _formatFullScrub,
  formatVoiceSummary: _formatVoiceSummary
};
