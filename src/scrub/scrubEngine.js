/**
 * scrubEngine.js - Main ADAS Scrub Orchestration Engine
 *
 * This is the CORRECTED scrub logic that follows the proper flow:
 *
 * 1. Parse estimate → Extract actual repair operations
 * 2. Map repairs → Determine what calibrations those repairs TRIGGER
 * 3. Verify equipment → Confirm vehicle has the ADAS system
 * 4. Reconcile with RevvADAS → Compare and flag discrepancies
 * 5. Generate output → Legally defensible, traceable results
 *
 * CRITICAL PRINCIPLE: A calibration is ONLY flagged if:
 * - A specific repair line in the estimate triggers it, AND
 * - The vehicle is confirmed/likely to have that ADAS system
 */

import { parseEstimate, extractVehicleInfo, extractMentionedADASFeatures, getRepairSummary } from './estimateParser.js';
import {
  REPAIR_CATEGORIES,
  OPERATION_TYPES,
  ADAS_SYSTEMS,
  checkCalibrationTriggered,
  getCalibrationType,
  loadOEMTriggers
} from './calibrationTriggers.js';
import { buildEquipmentProfile, verifyCalibrationNeeded, decodeVIN } from './vehicleEquipment.js';
import { parseRevvCalibrations, reconcileCalibrations, getReconciliationStatus, generateReconciliationNotes, buildFinalCalibrationList } from './revvReconciler.js';
import { normalizeBrand } from '../../utils/oem/parser.js';

const LOG_TAG = '[SCRUB_ENGINE]';

/**
 * Main scrub function - analyzes estimate and determines required calibrations
 *
 * @param {Object} params
 * @param {string} params.estimateText - Raw text from estimate PDF
 * @param {string} params.vin - Vehicle VIN (optional)
 * @param {string} params.brand - Vehicle brand (optional, derived from VIN if not provided)
 * @param {number} params.year - Model year (optional, derived from VIN if not provided)
 * @param {string} params.revvText - RevvADAS report text / Column J content (optional)
 * @param {string} params.vehicle - Vehicle description string (e.g., "2022 Mercedes-Benz GLC 300")
 * @returns {Object} - Complete scrub result
 */
export async function scrubEstimateV2({
  estimateText,
  vin = null,
  brand = null,
  year = null,
  revvText = null,
  vehicle = null
}) {
  const startTime = Date.now();
  console.log(`${LOG_TAG} Starting V2 scrub...`);

  try {
    // ========================================
    // STEP 1: Parse the Estimate
    // ========================================
    console.log(`${LOG_TAG} Step 1: Parsing estimate...`);

    const parsedEstimate = parseEstimate(estimateText);
    const repairLines = parsedEstimate.repairLines;
    const repairSummary = getRepairSummary(parsedEstimate);

    console.log(`${LOG_TAG} Found ${repairLines.length} repair operations`);

    // Extract vehicle info from estimate if not provided
    const estimateVehicle = extractVehicleInfo(estimateText);
    const estimateFeatures = extractMentionedADASFeatures(estimateText);

    // Use provided values or fall back to estimate-extracted values
    const effectiveVin = vin || estimateVehicle?.vin;
    const effectiveBrand = brand || (vehicle ? extractBrandFromVehicleString(vehicle) : null) || estimateVehicle?.make;
    const effectiveYear = year || estimateVehicle?.year;

    // ========================================
    // STEP 2: Build Vehicle Equipment Profile
    // ========================================
    console.log(`${LOG_TAG} Step 2: Building equipment profile...`);

    const equipmentProfile = buildEquipmentProfile({
      vin: effectiveVin,
      brand: effectiveBrand,
      year: effectiveYear,
      revvText: revvText,
      estimateFeatures: estimateFeatures
    });

    const normalizedBrand = effectiveBrand ? normalizeBrand(effectiveBrand) : null;
    console.log(`${LOG_TAG} Vehicle: ${effectiveYear || '?'} ${normalizedBrand || 'Unknown'}`);
    console.log(`${LOG_TAG} Equipment profile built. Confirmed systems: ${equipmentProfile.equipment.confirmed.length}`);

    // ========================================
    // STEP 3: Map Repair Operations to Calibrations
    // ========================================
    console.log(`${LOG_TAG} Step 3: Mapping repairs to calibrations...`);

    // Load OEM-specific triggers if brand is known
    const oemTriggers = normalizedBrand ? loadOEMTriggers(normalizedBrand) : null;

    // Build list of all equipment for trigger checking
    const allEquipment = [
      ...equipmentProfile.equipment.confirmed,
      ...equipmentProfile.equipment.likely,
      ...estimateFeatures
    ];

    const triggeredCalibrations = [];
    const calibrationsNotTriggered = [];

    // Check each repair line for calibration triggers
    for (const repairLine of repairLines) {
      const triggered = checkCalibrationTriggered({
        brand: normalizedBrand,
        repairCategory: repairLine.component.category,
        operationType: repairLine.operation,
        vehicleEquipment: allEquipment
      });

      for (const cal of triggered) {
        // Verify the vehicle has this system
        const verification = verifyCalibrationNeeded(equipmentProfile, cal.system);

        const calibrationRecord = {
          system: cal.system,
          calibrationType: cal.calibrationType,
          triggeredBy: {
            lineNumber: repairLine.lineNumber,
            repairCategory: repairLine.component.category,
            operationType: repairLine.operation,
            rawText: repairLine.rawText
          },
          reason: cal.reason,
          confidence: cal.confidence,
          vehicleVerification: verification,
          shouldFlag: verification.shouldFlag || verification.needsVerification,
          needsVerification: verification.needsVerification
        };

        // Deduplicate - don't add same calibration twice
        const exists = triggeredCalibrations.some(
          tc => tc.system === calibrationRecord.system
        );

        if (!exists) {
          triggeredCalibrations.push(calibrationRecord);
        }
      }
    }

    // Identify calibrations that COULD apply but weren't triggered
    const allPossibleSystems = Object.values(ADAS_SYSTEMS);
    for (const system of allPossibleSystems) {
      const isTriggered = triggeredCalibrations.some(tc => tc.system === system);
      if (!isTriggered) {
        // Check if vehicle has this system
        const verification = verifyCalibrationNeeded(equipmentProfile, system);
        if (verification.shouldFlag || verification.needsVerification) {
          calibrationsNotTriggered.push({
            system,
            vehicleHasSystem: verification.shouldFlag,
            needsVerification: verification.needsVerification,
            reason: 'No repair operation in this estimate triggers this calibration'
          });
        }
      }
    }

    console.log(`${LOG_TAG} Triggered calibrations: ${triggeredCalibrations.length}`);
    console.log(`${LOG_TAG} Systems present but not triggered: ${calibrationsNotTriggered.length}`);

    // ========================================
    // STEP 4: Reconcile with RevvADAS
    // ========================================
    console.log(`${LOG_TAG} Step 4: Reconciling with RevvADAS...`);

    const revvCalibrations = parseRevvCalibrations(revvText);

    // Convert triggered calibrations to format for reconciliation
    const scrubCalibrations = triggeredCalibrations
      .filter(tc => tc.shouldFlag)
      .map(tc => ({
        system: tc.system,
        calibrationType: tc.calibrationType,
        triggeredBy: tc.triggeredBy.rawText,
        reason: tc.reason,
        confidence: tc.confidence
      }));

    const reconciliation = reconcileCalibrations(scrubCalibrations, revvCalibrations);
    const reconciliationStatus = getReconciliationStatus(reconciliation);
    const reconciliationNotes = generateReconciliationNotes(reconciliation);

    console.log(`${LOG_TAG} Reconciliation status: ${reconciliationStatus}`);

    // ========================================
    // STEP 5: Build Final Result (REVV-FIRST)
    // ========================================
    console.log(`${LOG_TAG} Step 5: Building final result (REVV-FIRST)...`);

    // REVV-FIRST ARCHITECTURE:
    // RevvADAS is the source of truth. We ONLY include calibrations that:
    // 1. RevvADAS recommends AND we can verify with a repair trigger (BEST)
    // 2. RevvADAS recommends but we can't find the trigger (still include - Revv knows the vehicle)
    // 3. We detect a trigger AND Revv confirms (same as #1)
    //
    // We do NOT include:
    // - Calibrations we detect but Revv doesn't list (likely phantom detections)

    const finalCalibrations = buildFinalCalibrationList(reconciliation, {
      includeUnverified: false, // Don't include scrub-only items (may be phantom)
      includeRevvOnly: true,    // ALWAYS include RevvADAS items - it's the source of truth
      preferScrubType: true     // Prefer our OEM-based calibration types when there's a conflict
    });

    const endTime = Date.now();

    const result = {
      // Metadata
      scrubVersion: '2.0',
      scrubTimestamp: new Date().toISOString(),
      processingTimeMs: endTime - startTime,

      // Vehicle Info
      vehicle: {
        vin: effectiveVin,
        brand: normalizedBrand,
        year: effectiveYear,
        vehicleString: vehicle,
        decoded: effectiveVin ? decodeVIN(effectiveVin) : null
      },

      // Equipment Profile
      equipment: {
        confirmed: equipmentProfile.equipment.confirmed,
        likely: equipmentProfile.equipment.likely,
        possible: equipmentProfile.equipment.possible,
        sources: equipmentProfile.sources
      },

      // Repair Operations (from estimate)
      repairOperations: {
        totalFound: repairLines.length,
        lines: repairLines.map(line => ({
          lineNumber: line.lineNumber,
          operation: line.operation,
          category: line.component.category,
          description: line.component.rawDescription,
          location: line.location
        })),
        summary: repairSummary
      },

      // Calibrations TRIGGERED by repair operations
      triggeredCalibrations: triggeredCalibrations.map(tc => ({
        calibration: tc.system,
        type: tc.calibrationType,
        triggeredBy: `Line ${tc.triggeredBy.lineNumber}: ${tc.triggeredBy.rawText}`,
        reason: tc.reason,
        confidence: tc.confidence,
        vehicleHasSystem: tc.vehicleVerification.shouldFlag,
        needsVerification: tc.needsVerification
      })),

      // Calibrations NOT triggered (vehicle has system but no repair touches it)
      calibrationsNotTriggered: calibrationsNotTriggered.map(cnt => ({
        calibration: cnt.system,
        vehicleHasSystem: cnt.vehicleHasSystem,
        reason: cnt.reason
      })),

      // RevvADAS Reconciliation
      revvReconciliation: {
        status: reconciliationStatus,
        matched: reconciliation.matched.length,
        scrubOnly: reconciliation.scrubOnly.length,
        revvOnly: reconciliation.revvOnly.length,
        typeConflicts: reconciliation.typeConflicts.length,
        details: reconciliation,
        notes: reconciliationNotes
      },

      // Final Calibration List (what should be performed)
      calibrationsRequired: finalCalibrations.filter(fc => fc.verified).map(fc => ({
        calibration: fc.calibration,
        type: fc.type,
        triggeredBy: fc.triggeredBy,
        confidence: fc.confidence
      })),

      // Items needing manual verification
      calibrationsNeedingVerification: finalCalibrations.filter(fc => !fc.verified).map(fc => ({
        calibration: fc.calibration,
        source: fc.source,
        note: fc.note
      })),

      // Summary
      summary: {
        repairOperationsFound: repairLines.length,
        calibrationsTriggered: triggeredCalibrations.filter(tc => tc.shouldFlag).length,
        calibrationsVerified: finalCalibrations.filter(fc => fc.verified).length,
        calibrationsNeedingVerification: finalCalibrations.filter(fc => !fc.verified).length,
        reconciliationStatus,
        needsAttention: reconciliationStatus !== 'OK' ||
                        triggeredCalibrations.some(tc => tc.needsVerification)
      }
    };

    console.log(`${LOG_TAG} Scrub complete in ${result.processingTimeMs}ms`);
    return result;

  } catch (err) {
    console.error(`${LOG_TAG} Scrub failed:`, err.message);
    return {
      scrubVersion: '2.0',
      scrubTimestamp: new Date().toISOString(),
      error: err.message,
      vehicle: { vin, brand, year, vehicleString: vehicle },
      repairOperations: { totalFound: 0, lines: [] },
      triggeredCalibrations: [],
      calibrationsNotTriggered: [],
      calibrationsRequired: [],
      calibrationsNeedingVerification: [],
      summary: {
        repairOperationsFound: 0,
        calibrationsTriggered: 0,
        calibrationsVerified: 0,
        calibrationsNeedingVerification: 0,
        reconciliationStatus: 'ERROR',
        needsAttention: true
      }
    };
  }
}

/**
 * Extract brand from vehicle description string
 * @param {string} vehicleString - e.g., "2022 Mercedes-Benz GLC 300"
 * @returns {string|null}
 */
function extractBrandFromVehicleString(vehicleString) {
  if (!vehicleString) return null;

  const brands = [
    'Mercedes-Benz', 'Mercedes', 'BMW', 'Audi', 'Volkswagen', 'VW', 'Porsche',
    'Toyota', 'Lexus', 'Honda', 'Acura', 'Nissan', 'Infiniti', 'Subaru', 'Mazda',
    'Chevrolet', 'Chevy', 'Buick', 'GMC', 'Cadillac', 'Ford', 'Lincoln',
    'Chrysler', 'Dodge', 'Jeep', 'Ram', 'Hyundai', 'Kia', 'Genesis',
    'Volvo', 'Tesla', 'Rivian', 'Mitsubishi', 'MINI', 'Land Rover', 'Jaguar'
  ];

  for (const brand of brands) {
    if (vehicleString.toLowerCase().includes(brand.toLowerCase())) {
      // Normalize common variations
      if (brand.toLowerCase() === 'mercedes') return 'Mercedes-Benz';
      if (brand.toLowerCase() === 'chevy') return 'Chevrolet';
      if (brand.toLowerCase() === 'vw') return 'Volkswagen';
      return brand;
    }
  }

  return null;
}

/**
 * Quick check if estimate triggers any ADAS calibrations
 * Lighter-weight version for initial screening
 * @param {string} estimateText - Raw estimate text
 * @returns {Object} - Quick scan result
 */
export function quickScan(estimateText) {
  const parsed = parseEstimate(estimateText);
  const hasADASRelevantRepairs = parsed.repairLines.some(line => {
    const category = line.component.category;
    // These categories typically trigger calibrations
    return [
      REPAIR_CATEGORIES.WINDSHIELD,
      REPAIR_CATEGORIES.FRONT_BUMPER,
      REPAIR_CATEGORIES.REAR_BUMPER,
      REPAIR_CATEGORIES.GRILLE,
      REPAIR_CATEGORIES.SIDE_MIRROR_LEFT,
      REPAIR_CATEGORIES.SIDE_MIRROR_RIGHT,
      REPAIR_CATEGORIES.SIDE_MIRROR_EITHER,
      REPAIR_CATEGORIES.LIFTGATE,
      REPAIR_CATEGORIES.TAILGATE,
      REPAIR_CATEGORIES.FRONT_CAMERA,
      REPAIR_CATEGORIES.FRONT_RADAR,
      REPAIR_CATEGORIES.REAR_RADAR,
      REPAIR_CATEGORIES.BSM_SENSOR,
      REPAIR_CATEGORIES.WHEEL_ALIGNMENT,
      REPAIR_CATEGORIES.STEERING_COLUMN,
      REPAIR_CATEGORIES.STEERING_GEAR,
      REPAIR_CATEGORIES.HEADLAMP_LEFT,
      REPAIR_CATEGORIES.HEADLAMP_RIGHT,
      REPAIR_CATEGORIES.HEADLAMP_EITHER
    ].includes(category);
  });

  return {
    totalRepairLines: parsed.repairLines.length,
    hasADASRelevantRepairs,
    shouldPerformFullScrub: hasADASRelevantRepairs,
    summary: parsed.repairLines.map(line => ({
      category: line.component.category,
      operation: line.operation,
      description: line.component.rawDescription?.substring(0, 50)
    }))
  };
}

/**
 * Generate a concise summary for display
 * @param {Object} scrubResult - Result from scrubEstimateV2
 * @returns {string} - Concise summary string
 */
export function generateScrubSummary(scrubResult) {
  if (scrubResult.error) {
    return `Error: ${scrubResult.error}`;
  }

  const {
    summary,
    triggeredCalibrations,
    calibrationsNotTriggered
  } = scrubResult;

  const lines = [];

  // Status line
  if (summary.needsAttention) {
    lines.push(`⚠️ NEEDS ATTENTION`);
  } else {
    lines.push(`✓ OK`);
  }

  // Counts
  lines.push(`Repairs: ${summary.repairOperationsFound} | Calibrations: ${summary.calibrationsVerified}`);

  // Triggered calibrations
  if (triggeredCalibrations.length > 0) {
    lines.push('Required:');
    for (const cal of triggeredCalibrations.slice(0, 5)) {
      const type = cal.type ? ` (${cal.type})` : '';
      lines.push(`  - ${cal.calibration}${type}`);
    }
    if (triggeredCalibrations.length > 5) {
      lines.push(`  ... +${triggeredCalibrations.length - 5} more`);
    }
  }

  // Verification needed
  if (summary.calibrationsNeedingVerification > 0) {
    lines.push(`\n${summary.calibrationsNeedingVerification} item(s) need verification`);
  }

  return lines.join('\n');
}

export default {
  scrubEstimateV2,
  quickScan,
  generateScrubSummary
};
