/**
 * revvReconciler.js - RevvADAS Comparison and Reconciliation
 *
 * This module compares scrub results against RevvADAS recommendations
 * and identifies discrepancies that need human review.
 *
 * The goal is to ensure:
 * 1. Every calibration we flag has a repair line trigger
 * 2. RevvADAS recommendations are validated against repair operations
 * 3. Discrepancies are clearly flagged for review
 */

import { ADAS_SYSTEMS, CALIBRATION_TYPES } from './calibrationTriggers.js';

const LOG_TAG = '[REVV_RECONCILER]';

/**
 * Normalize calibration names for comparison
 * Different sources may use different naming conventions
 *
 * OEM TERMINOLOGY MAPPING:
 * - Assistant/internal terms map to OEM/RevvADAS terms
 * - This ensures "Front Radar" matches "Millimeter Wave Radar Sensor"
 */
const CALIBRATION_ALIASES = {
  // Front Camera variations
  'front camera': ['front camera', 'forward camera', 'windshield camera', 'fcam', 'sensing camera', 'adas camera', 'eyesight', 'multipurpose camera', 'mpc', 'forward recognition camera', 'frc'],
  'front camera static': ['front camera static', 'front camera (static)', 'static camera', 'camera static calibration'],
  'front camera dynamic': ['front camera dynamic', 'front camera (dynamic)', 'dynamic camera', 'kafas'],

  // Front Radar variations - CRITICAL: millimeter wave = front radar
  'front radar': [
    'front radar', 'forward radar', 'acc radar', 'adaptive cruise radar',
    'millimeter wave', 'millimeter wave radar', 'millimeter wave radar sensor',
    'mwr', 'distronic', 'long range radar', 'lrr',
    'distance sensor', 'acc sensor', 'adaptive cruise control sensor',
    'forward sensing radar', 'pre collision radar', 'precollision radar'
  ],

  // Rear Radar variations - includes rear cross traffic alert
  'rear radar': [
    'rear radar', 'rcta', 'rear cross traffic', 'rear cross-traffic',
    'short range radar', 'srr', 'rear cross traffic alert'
  ],

  // Blind Spot Monitor variations
  'blind spot': [
    'blind spot', 'bsm', 'blind spot monitor', 'blind spot sensor',
    'blind spot monitor sensor', 'blis', 'side radar', 'bsi',
    'side object sensor', 'lane change assist', 'blind spot information'
  ],

  // Surround View / 360 Camera variations
  'surround view': [
    'surround view', 'surround view monitor', 'surround view monitor cameras',
    '360 camera', '360 degree camera', 'around view', 'around view monitor',
    'avm', 'surround vision', 'bird eye view', 'birds eye', 'panoramic view'
  ],

  // Rear Camera variations
  'rear camera': ['rear camera', 'backup camera', 'reverse camera', 'rearview camera', 'rear view camera'],

  // Parking Sensor variations - includes clearance/back sonar
  'parking sensor': [
    'parking sensor', 'parking aid', 'park assist', 'ultrasonic sensor',
    'sonar sensor', 'front parking', 'rear parking', 'clearance sonar',
    'back sonar', 'clearance/back sonar', 'parking sonar'
  ],

  // Steering Angle Sensor / Yaw Rate Sensor variations
  'steering angle': ['steering angle', 'sas', 'steering angle sensor', 'steering sensor reset', 'sas reset', 'sas calibration', 'zero point'],
  'yaw rate': [
    'yaw rate', 'yaw rate sensor', 'yaw rate and acceleration',
    'yaw rate and acceleration sensor', 'yaw sensor', 'stability sensor',
    'g sensor', 'lateral acceleration sensor'
  ],

  // Headlamp variations
  'headlamp': ['headlamp', 'headlight', 'headlamp aim', 'headlight aim', 'afs', 'adaptive front lighting', 'auto leveling', 'headlamp leveling'],

  // Lane assist / Lane Departure variations
  'lane assist': ['lane departure', 'ldw', 'lane keep', 'lkas', 'lane keeping', 'lda', 'lane departure warning', 'lane departure warning camera']
};

/**
 * OEM-specific terminology conversions
 * Maps internal system names to OEM/RevvADAS display names
 */
const OEM_DISPLAY_NAMES = {
  'front_radar': 'Millimeter Wave Radar Sensor',
  'front_camera': 'Forward Recognition Camera',
  'rear_camera': 'Backup Camera',
  'bsm': 'Blind Spot Monitor Sensor',
  'blind_spot': 'Blind Spot Monitor Sensor',
  'lkas': 'Lane Departure Warning Camera',
  'lane_assist': 'Lane Departure Warning Camera',
  'acc': 'Adaptive Cruise Control Sensor',
  'surround_view': 'Surround View Monitor Cameras',
  'parking_sensors': 'Clearance/Back Sonar',
  'yaw_rate': 'Yaw Rate and Acceleration Sensor',
  'steering_angle': 'Steering Angle Sensor'
};

/**
 * Normalize a calibration name for comparison
 * @param {string} name - Calibration name
 * @returns {string} - Normalized name
 */
export function normalizeCalibrationName(name) {
  if (!name) return '';

  const lower = name.toLowerCase()
    .replace(/calibration/gi, '')
    .replace(/\(static\)/gi, 'static')
    .replace(/\(dynamic\)/gi, 'dynamic')
    .replace(/[\s\-_]+/g, ' ')
    .trim();

  // Check aliases
  for (const [normalized, aliases] of Object.entries(CALIBRATION_ALIASES)) {
    for (const alias of aliases) {
      if (lower.includes(alias) || alias.includes(lower)) {
        return normalized;
      }
    }
  }

  return lower;
}

/**
 * Parse RevvADAS calibration text into structured array
 * @param {string} revvText - Raw RevvADAS text (from Column J or report)
 * @returns {Array} - Array of calibration objects
 */
export function parseRevvCalibrations(revvText) {
  if (!revvText || typeof revvText !== 'string') {
    return [];
  }

  // Split by common delimiters
  const items = revvText.split(/[;,\n]/).map(s => s.trim()).filter(s => s.length > 0);

  const calibrations = [];

  for (const item of items) {
    // Extract calibration type if specified
    let type = null;
    let name = item;

    if (/static/i.test(item)) {
      type = CALIBRATION_TYPES.STATIC;
      name = item.replace(/\(?\s*static\s*\)?/gi, '').trim();
    } else if (/dynamic/i.test(item)) {
      type = CALIBRATION_TYPES.DYNAMIC;
      name = item.replace(/\(?\s*dynamic\s*\)?/gi, '').trim();
    }

    calibrations.push({
      rawText: item,
      normalizedName: normalizeCalibrationName(name),
      calibrationType: type,
      source: 'RevvADAS'
    });
  }

  return calibrations;
}

/**
 * Compare two calibration names for equivalence
 * @param {string} name1 - First calibration name
 * @param {string} name2 - Second calibration name
 * @returns {boolean} - True if they refer to the same calibration
 */
export function calibrationsMatch(name1, name2) {
  const norm1 = normalizeCalibrationName(name1);
  const norm2 = normalizeCalibrationName(name2);

  // Direct match
  if (norm1 === norm2) return true;

  // Check if one contains the other
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  // Check aliases
  for (const [, aliases] of Object.entries(CALIBRATION_ALIASES)) {
    const norm1InAliases = aliases.some(a => norm1.includes(a) || a.includes(norm1));
    const norm2InAliases = aliases.some(a => norm2.includes(a) || a.includes(norm2));
    if (norm1InAliases && norm2InAliases) return true;
  }

  return false;
}

/**
 * Reconcile scrub results with RevvADAS recommendations
 * @param {Array} scrubCalibrations - Calibrations from our scrub engine
 * @param {Array} revvCalibrations - Calibrations from RevvADAS (parsed)
 * @returns {Object} - Reconciliation result
 */
export function reconcileCalibrations(scrubCalibrations, revvCalibrations) {
  const result = {
    matched: [],          // Both scrub and Revv agree
    scrubOnly: [],        // Scrub found it, Revv didn't mention
    revvOnly: [],         // Revv recommends it, scrub didn't find trigger
    typeConflicts: [],    // Both agree on need, disagree on type (static vs dynamic)
    summary: {
      totalScrub: scrubCalibrations.length,
      totalRevv: revvCalibrations.length,
      matchedCount: 0,
      discrepancyCount: 0
    }
  };

  // Track which Revv items have been matched
  const revvMatched = new Set();

  // Check each scrub calibration against Revv
  for (const scrubCal of scrubCalibrations) {
    let foundMatch = false;

    for (let i = 0; i < revvCalibrations.length; i++) {
      const revvCal = revvCalibrations[i];

      if (calibrationsMatch(scrubCal.system, revvCal.rawText)) {
        foundMatch = true;
        revvMatched.add(i);

        // Check for type conflict
        if (scrubCal.calibrationType && revvCal.calibrationType &&
            scrubCal.calibrationType !== revvCal.calibrationType) {
          result.typeConflicts.push({
            system: scrubCal.system,
            scrubType: scrubCal.calibrationType,
            revvType: revvCal.calibrationType,
            scrubDetails: scrubCal,
            revvDetails: revvCal
          });
        } else {
          result.matched.push({
            system: scrubCal.system,
            calibrationType: scrubCal.calibrationType || revvCal.calibrationType,
            triggeredBy: scrubCal.triggeredBy,
            revvText: revvCal.rawText,
            confidence: 'HIGH'
          });
        }
        break;
      }
    }

    if (!foundMatch) {
      // Scrub found a calibration that Revv didn't mention
      result.scrubOnly.push({
        system: scrubCal.system,
        calibrationType: scrubCal.calibrationType,
        triggeredBy: scrubCal.triggeredBy,
        reason: scrubCal.reason,
        confidence: scrubCal.confidence,
        note: 'Repair operation triggers this calibration but RevvADAS did not list it'
      });
    }
  }

  // Check for Revv calibrations that scrub didn't find
  for (let i = 0; i < revvCalibrations.length; i++) {
    if (!revvMatched.has(i)) {
      const revvCal = revvCalibrations[i];
      result.revvOnly.push({
        system: revvCal.normalizedName,
        rawText: revvCal.rawText,
        calibrationType: revvCal.calibrationType,
        note: 'RevvADAS recommends this but no repair operation triggers it - verify if vehicle feature triggered'
      });
    }
  }

  // Update summary
  result.summary.matchedCount = result.matched.length;
  result.summary.discrepancyCount =
    result.scrubOnly.length + result.revvOnly.length + result.typeConflicts.length;

  return result;
}

/**
 * Generate reconciliation status
 * @param {Object} reconciliation - Result from reconcileCalibrations
 * @returns {string} - Status: 'OK' | 'NEEDS_REVIEW' | 'DISCREPANCY'
 */
export function getReconciliationStatus(reconciliation) {
  // Perfect match - scrub and Revv agree completely
  if (reconciliation.summary.discrepancyCount === 0) {
    return 'OK';
  }

  // Scrub-only items are PHANTOM DETECTIONS - scrub found something Revv didn't
  // This is a potential false positive, NOT a reason to bill
  // Status: DISCREPANCY - because scrub may be detecting phantoms
  if (reconciliation.scrubOnly.length > 0) {
    return 'DISCREPANCY';
  }

  // Revv-only items are OK - Revv knows the vehicle better than the estimate
  // This typically means Revv detected a feature-based calibration need
  // that isn't directly tied to a repair line (e.g., surround view from mirror)
  // We trust Revv here - it's the source of truth
  if (reconciliation.revvOnly.length > 0 && reconciliation.scrubOnly.length === 0) {
    // Only Revv-only items, no scrub-only phantoms - this is OK
    return 'OK';
  }

  // Type conflicts need review (static vs dynamic disagreement)
  if (reconciliation.typeConflicts.length > 0) {
    return 'NEEDS_REVIEW';
  }

  return 'OK';
}

/**
 * Generate detailed reconciliation notes
 * @param {Object} reconciliation - Result from reconcileCalibrations
 * @returns {string} - Human-readable notes
 */
export function generateReconciliationNotes(reconciliation) {
  const lines = [];

  const status = getReconciliationStatus(reconciliation);
  lines.push(`Reconciliation Status: ${status}`);
  lines.push(`Matched: ${reconciliation.summary.matchedCount} | Discrepancies: ${reconciliation.summary.discrepancyCount}`);
  lines.push('');

  // Matched calibrations
  if (reconciliation.matched.length > 0) {
    lines.push('CONFIRMED CALIBRATIONS:');
    for (const item of reconciliation.matched) {
      const type = item.calibrationType ? ` (${item.calibrationType})` : '';
      lines.push(`  ✓ ${item.system}${type}`);
      if (item.triggeredBy) {
        lines.push(`    Triggered by: ${item.triggeredBy}`);
      }
    }
    lines.push('');
  }

  // Scrub-only (repair triggers but Revv didn't list) - POTENTIAL PHANTOM DETECTIONS
  if (reconciliation.scrubOnly.length > 0) {
    lines.push('⚠ POTENTIAL PHANTOM DETECTIONS (NOT in RevvADAS):');
    lines.push('These were detected by keyword matching but RevvADAS does not list them.');
    lines.push('DO NOT BILL for these without verifying with RevvADAS:');
    for (const item of reconciliation.scrubOnly) {
      const type = item.calibrationType ? ` (${item.calibrationType})` : '';
      lines.push(`  ✗ ${item.system}${type} - EXCLUDED`);
      lines.push(`    Detection reason: ${item.reason}`);
      lines.push(`    This is likely a FALSE POSITIVE - verify before billing`);
    }
    lines.push('');
  }

  // Revv-only (Revv listed but no repair trigger) - THESE ARE VALID, REVV IS SOURCE OF TRUTH
  if (reconciliation.revvOnly.length > 0) {
    lines.push('✓ FROM REVVADAS (source of truth):');
    lines.push('RevvADAS identified these calibrations based on the vehicle and repair scope.');
    lines.push('These ARE REQUIRED even if no specific repair line triggers them:');
    for (const item of reconciliation.revvOnly) {
      const type = item.calibrationType ? ` (${item.calibrationType})` : '';
      lines.push(`  ✓ ${item.rawText}${type} - INCLUDE`);
      lines.push(`    RevvADAS determined this calibration is needed for this repair`);
    }
    lines.push('');
  }

  // Type conflicts
  if (reconciliation.typeConflicts.length > 0) {
    lines.push('CALIBRATION TYPE CONFLICTS:');
    for (const item of reconciliation.typeConflicts) {
      lines.push(`  ⚡ ${item.system}`);
      lines.push(`    Scrub says: ${item.scrubType} | Revv says: ${item.revvType}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build final calibration list from reconciliation
 * This is what should be billed/performed
 * @param {Object} reconciliation - Result from reconcileCalibrations
 * @param {Object} options - Options for final list
 * @returns {Array} - Final calibration list
 */
export function buildFinalCalibrationList(reconciliation, options = {}) {
  const {
    includeUnverified = false,    // Include scrub-only items
    includeRevvOnly = true,       // Include items from Revv without repair trigger
    preferScrubType = true        // When type conflicts, prefer scrub type (OEM-based)
  } = options;

  const finalList = [];

  // Add matched calibrations
  for (const item of reconciliation.matched) {
    finalList.push({
      calibration: item.system,
      type: item.calibrationType,
      triggeredBy: item.triggeredBy,
      source: 'Matched',
      confidence: 'HIGH',
      verified: true
    });
  }

  // Add type conflicts (using preferred type)
  for (const item of reconciliation.typeConflicts) {
    finalList.push({
      calibration: item.system,
      type: preferScrubType ? item.scrubType : item.revvType,
      triggeredBy: item.scrubDetails.triggeredBy,
      source: 'TypeConflict',
      confidence: 'MEDIUM',
      verified: true,
      note: `Type conflict: Scrub=${item.scrubType}, Revv=${item.revvType}`
    });
  }

  // Optionally add scrub-only items
  if (includeUnverified) {
    for (const item of reconciliation.scrubOnly) {
      finalList.push({
        calibration: item.system,
        type: item.calibrationType,
        triggeredBy: item.triggeredBy,
        source: 'ScrubOnly',
        confidence: item.confidence,
        verified: false,
        note: 'Not in RevvADAS - verify vehicle has this system before billing'
      });
    }
  }

  // ALWAYS include Revv-only items - RevvADAS is the SOURCE OF TRUTH
  // These are VERIFIED calibrations because RevvADAS analyzed the full repair scope
  if (includeRevvOnly) {
    for (const item of reconciliation.revvOnly) {
      finalList.push({
        calibration: item.rawText,
        type: item.calibrationType,
        triggeredBy: 'RevvADAS Analysis',
        source: 'RevvADAS',
        confidence: 'HIGH', // RevvADAS is trusted source
        verified: true,     // RevvADAS verification = verified
        note: 'Identified by RevvADAS based on vehicle configuration and repair scope'
      });
    }
  }

  return finalList;
}

export default {
  normalizeCalibrationName,
  parseRevvCalibrations,
  calibrationsMatch,
  reconcileCalibrations,
  getReconciliationStatus,
  generateReconciliationNotes,
  buildFinalCalibrationList
};
