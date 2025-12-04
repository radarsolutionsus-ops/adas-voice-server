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
