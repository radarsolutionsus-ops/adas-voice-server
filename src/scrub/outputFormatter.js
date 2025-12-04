/**
 * outputFormatter.js - Legally Defensible Output Format Generator
 *
 * This module generates output formats that are:
 * 1. Traceable - Every calibration can be traced to a specific repair line
 * 2. Transparent - Clear explanation of why each calibration is/isn't required
 * 3. Defensible - Can be used as documentation for insurance/legal purposes
 * 4. OEM-sourced - References OEM requirements where applicable
 */

import { CALIBRATION_TYPES } from './calibrationTriggers.js';

const LOG_TAG = '[OUTPUT_FORMATTER]';

/**
 * Status indicators for different output contexts
 */
const STATUS = {
  VERIFIED: '✓',
  NEEDS_REVIEW: '⚠',
  ERROR: '✗',
  INFO: 'ℹ'
};

/**
 * Format calibration type for display
 * @param {string} type - Calibration type from CALIBRATION_TYPES
 * @returns {string}
 */
function formatCalibrationType(type) {
  switch (type) {
    case CALIBRATION_TYPES.STATIC:
      return 'Static';
    case CALIBRATION_TYPES.DYNAMIC:
      return 'Dynamic';
    case CALIBRATION_TYPES.STATIC_AND_DYNAMIC:
      return 'Static + Dynamic';
    case CALIBRATION_TYPES.SELF_LEARNING:
      return 'Self-Learning';
    case CALIBRATION_TYPES.PROGRAMMING_ONLY:
      return 'Programming Only';
    default:
      return type || 'Unknown';
  }
}

/**
 * Generate compact notes for Google Sheets (single line)
 * Suitable for Column S preview
 * @param {Object} scrubResult - Result from scrubEstimateV2
 * @returns {string}
 */
export function formatCompactNotes(scrubResult) {
  if (scrubResult.error) {
    return `Error: ${scrubResult.error}`;
  }

  const { summary, triggeredCalibrations, revvReconciliation } = scrubResult;

  // Build compact status line
  const parts = [];

  // Counts
  parts.push(`Repairs: ${summary.repairOperationsFound}`);
  parts.push(`Calibrations: ${summary.calibrationsVerified}`);

  // Status indicator
  if (revvReconciliation?.status === 'OK') {
    parts.push('Status: OK');
  } else if (revvReconciliation?.status === 'NEEDS_REVIEW') {
    parts.push('Status: REVIEW');
  } else if (revvReconciliation?.status === 'DISCREPANCY') {
    parts.push('Status: DISCREPANCY');
  }

  // List first 2 calibrations
  if (triggeredCalibrations.length > 0) {
    const calNames = triggeredCalibrations.slice(0, 2).map(tc => {
      const name = tc.calibration.replace(/Calibration/gi, '').replace(/\s+/g, ' ').trim();
      return name;
    });
    parts.push(`Required: ${calNames.join(', ')}`);
    if (triggeredCalibrations.length > 2) {
      parts.push(`+${triggeredCalibrations.length - 2} more`);
    }
  }

  return parts.join(' | ');
}

/**
 * Generate preview notes for quick review
 * Suitable for Column S (medium detail)
 * @param {Object} scrubResult - Result from scrubEstimateV2
 * @returns {string}
 */
export function formatPreviewNotes(scrubResult) {
  if (scrubResult.error) {
    return `SCRUB ERROR: ${scrubResult.error}`;
  }

  const { summary, vehicle, triggeredCalibrations, calibrationsNeedingVerification, revvReconciliation } = scrubResult;

  const lines = [];

  // Header with status
  const statusIcon = summary.needsAttention ? STATUS.NEEDS_REVIEW : STATUS.VERIFIED;
  lines.push(`${statusIcon} ${vehicle.brand || 'Unknown'} ${vehicle.year || ''} - ${summary.repairOperationsFound} repairs, ${summary.calibrationsVerified} calibrations`);

  // Required calibrations
  if (triggeredCalibrations.length > 0) {
    lines.push('Required:');
    for (const cal of triggeredCalibrations) {
      const type = cal.type ? ` (${formatCalibrationType(cal.type)})` : '';
      lines.push(`  ${STATUS.VERIFIED} ${cal.calibration}${type}`);
    }
  } else {
    lines.push('No calibrations triggered by repair operations');
  }

  // Items needing verification
  if (calibrationsNeedingVerification?.length > 0) {
    lines.push('Needs Verification:');
    for (const cal of calibrationsNeedingVerification) {
      lines.push(`  ${STATUS.NEEDS_REVIEW} ${cal.calibration}`);
    }
  }

  // Reconciliation status
  if (revvReconciliation) {
    if (revvReconciliation.status !== 'OK') {
      lines.push(`RevvADAS: ${revvReconciliation.status} (${revvReconciliation.matched} matched, ${revvReconciliation.revvOnly + revvReconciliation.scrubOnly} discrepancies)`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate full detailed scrub report
 * Suitable for Column T (full detail) or standalone report
 * @param {Object} scrubResult - Result from scrubEstimateV2
 * @returns {string}
 */
export function formatFullScrub(scrubResult) {
  if (scrubResult.error) {
    return `=== SCRUB ERROR ===\n${scrubResult.error}\n===================`;
  }

  const {
    scrubVersion,
    scrubTimestamp,
    vehicle,
    equipment,
    repairOperations,
    triggeredCalibrations,
    calibrationsNotTriggered,
    calibrationsRequired,
    calibrationsNeedingVerification,
    revvReconciliation,
    summary
  } = scrubResult;

  const lines = [];

  // Header
  lines.push('═══════════════════════════════════════════');
  lines.push('    ADAS ESTIMATE SCRUB REPORT (REVV-FIRST)');
  lines.push('═══════════════════════════════════════════');
  lines.push(`Scrub Version: ${scrubVersion}`);
  lines.push(`Timestamp: ${scrubTimestamp}`);
  lines.push('');
  lines.push('METHODOLOGY: RevvADAS is the source of truth.');
  lines.push('Calibrations are ONLY included if verified by RevvADAS.');
  lines.push('');

  // Vehicle Information
  lines.push('─── VEHICLE INFORMATION ───');
  lines.push(`Brand: ${vehicle.brand || 'Unknown'}`);
  lines.push(`Year: ${vehicle.year || 'Unknown'}`);
  lines.push(`VIN: ${vehicle.vin || 'Not provided'}`);
  if (vehicle.vehicleString) {
    lines.push(`Description: ${vehicle.vehicleString}`);
  }
  lines.push('');

  // Equipment Profile
  lines.push('─── ADAS EQUIPMENT PROFILE ───');
  if (equipment.confirmed.length > 0) {
    lines.push(`Confirmed Systems: ${equipment.confirmed.join(', ')}`);
  }
  if (equipment.likely.length > 0) {
    lines.push(`Likely Systems: ${equipment.likely.join(', ')}`);
  }
  if (equipment.possible.length > 0) {
    lines.push(`Possible Systems: ${equipment.possible.join(', ')}`);
  }
  lines.push(`Data Sources: ${Object.entries(equipment.sources).filter(([, v]) => v).map(([k]) => k).join(', ') || 'None'}`);
  lines.push('');

  // Repair Operations
  lines.push('─── REPAIR OPERATIONS ANALYZED ───');
  lines.push(`Total Operations: ${repairOperations.totalFound}`);
  if (repairOperations.lines.length > 0) {
    for (const op of repairOperations.lines) {
      const loc = [];
      if (op.location.side) loc.push(op.location.side);
      if (op.location.position) loc.push(op.location.position);
      const locStr = loc.length > 0 ? ` [${loc.join(', ')}]` : '';
      lines.push(`  Line ${op.lineNumber}: ${op.operation.toUpperCase()} - ${op.category}${locStr}`);
      if (op.description) {
        lines.push(`    "${op.description}"`);
      }
    }
  } else {
    lines.push('  No ADAS-relevant repair operations found');
  }
  lines.push('');

  // Calibrations Required (with traceability)
  lines.push('═══════════════════════════════════════════');
  lines.push('       CALIBRATIONS REQUIRED');
  lines.push('═══════════════════════════════════════════');

  if (triggeredCalibrations.length > 0) {
    for (const cal of triggeredCalibrations) {
      lines.push('');
      lines.push(`${STATUS.VERIFIED} ${cal.calibration}`);
      lines.push(`  Type: ${formatCalibrationType(cal.type)}`);
      lines.push(`  Triggered By: ${cal.triggeredBy}`);
      lines.push(`  Reason: ${cal.reason}`);
      lines.push(`  Confidence: ${cal.confidence}`);
      if (!cal.vehicleHasSystem) {
        lines.push(`  ${STATUS.NEEDS_REVIEW} Vehicle equipment not confirmed - verify before billing`);
      }
    }
  } else {
    lines.push('');
    lines.push('No calibrations triggered by repair operations in this estimate.');
  }
  lines.push('');

  // Calibrations NOT Required (with explanation)
  if (calibrationsNotTriggered.length > 0) {
    lines.push('─── CALIBRATIONS NOT REQUIRED ───');
    lines.push('(Vehicle may have these systems but no repair triggers them)');
    for (const cal of calibrationsNotTriggered) {
      const hasStr = cal.vehicleHasSystem ? 'Vehicle has' : 'Vehicle may have';
      lines.push(`  ${STATUS.INFO} ${cal.calibration}`);
      lines.push(`    ${hasStr} this system`);
      lines.push(`    Reason NOT required: ${cal.reason}`);
    }
    lines.push('');
  }

  // Items Needing Verification
  if (calibrationsNeedingVerification?.length > 0) {
    lines.push('─── NEEDS VERIFICATION ───');
    for (const cal of calibrationsNeedingVerification) {
      lines.push(`  ${STATUS.NEEDS_REVIEW} ${cal.calibration}`);
      lines.push(`    Source: ${cal.source}`);
      lines.push(`    Note: ${cal.note}`);
    }
    lines.push('');
  }

  // RevvADAS Reconciliation
  if (revvReconciliation) {
    lines.push('─── REVVADAS RECONCILIATION ───');
    lines.push(`Status: ${revvReconciliation.status}`);
    lines.push(`Matched: ${revvReconciliation.matched}`);
    lines.push(`Scrub Only (not in Revv): ${revvReconciliation.scrubOnly}`);
    lines.push(`Revv Only (no repair trigger): ${revvReconciliation.revvOnly}`);
    lines.push(`Type Conflicts: ${revvReconciliation.typeConflicts}`);

    if (revvReconciliation.notes) {
      lines.push('');
      lines.push('Reconciliation Details:');
      lines.push(revvReconciliation.notes);
    }
    lines.push('');
  }

  // Summary
  lines.push('═══════════════════════════════════════════');
  lines.push('              SUMMARY');
  lines.push('═══════════════════════════════════════════');
  lines.push(`Repair Operations Found: ${summary.repairOperationsFound}`);
  lines.push(`Calibrations Triggered: ${summary.calibrationsTriggered}`);
  lines.push(`Calibrations Verified: ${summary.calibrationsVerified}`);
  lines.push(`Needs Verification: ${summary.calibrationsNeedingVerification}`);
  lines.push(`Reconciliation Status: ${summary.reconciliationStatus}`);
  lines.push(`Needs Attention: ${summary.needsAttention ? 'YES' : 'NO'}`);
  lines.push('');
  lines.push('═══════════════════════════════════════════');
  lines.push('            END OF SCRUB REPORT');
  lines.push('═══════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Generate JSON output for API responses
 * @param {Object} scrubResult - Result from scrubEstimateV2
 * @returns {Object}
 */
export function formatJSONOutput(scrubResult) {
  return {
    metadata: {
      version: scrubResult.scrubVersion,
      timestamp: scrubResult.scrubTimestamp,
      processingTimeMs: scrubResult.processingTimeMs
    },
    vehicle: scrubResult.vehicle,
    calibrations: {
      required: scrubResult.calibrationsRequired,
      needsVerification: scrubResult.calibrationsNeedingVerification,
      notRequired: scrubResult.calibrationsNotTriggered
    },
    repairOperations: scrubResult.repairOperations.lines,
    reconciliation: {
      status: scrubResult.revvReconciliation?.status,
      matched: scrubResult.revvReconciliation?.matched,
      discrepancies: {
        scrubOnly: scrubResult.revvReconciliation?.scrubOnly,
        revvOnly: scrubResult.revvReconciliation?.revvOnly,
        typeConflicts: scrubResult.revvReconciliation?.typeConflicts
      }
    },
    summary: scrubResult.summary
  };
}

/**
 * Generate voice assistant summary
 * For the voice assistant to read to technicians/ops
 * @param {Object} scrubResult - Result from scrubEstimateV2
 * @returns {string}
 */
export function formatVoiceSummary(scrubResult) {
  if (scrubResult.error) {
    return `The estimate scrub encountered an error: ${scrubResult.error}`;
  }

  const { summary, vehicle, triggeredCalibrations, calibrationsNeedingVerification } = scrubResult;

  const parts = [];

  // Vehicle context
  if (vehicle.brand && vehicle.year) {
    parts.push(`For the ${vehicle.year} ${vehicle.brand},`);
  }

  // Repair count
  parts.push(`I found ${summary.repairOperationsFound} repair operations.`);

  // Calibrations
  if (summary.calibrationsVerified === 0) {
    parts.push('No ADAS calibrations are triggered by these repairs.');
  } else if (summary.calibrationsVerified === 1) {
    const cal = triggeredCalibrations[0];
    parts.push(`One calibration is required: ${cal.calibration}, triggered by ${cal.triggeredBy}.`);
  } else {
    parts.push(`${summary.calibrationsVerified} calibrations are required:`);
    for (const cal of triggeredCalibrations.slice(0, 3)) {
      parts.push(`${cal.calibration}.`);
    }
    if (triggeredCalibrations.length > 3) {
      parts.push(`And ${triggeredCalibrations.length - 3} more.`);
    }
  }

  // Verification needed
  if (calibrationsNeedingVerification?.length > 0) {
    parts.push(`${calibrationsNeedingVerification.length} items need verification before billing.`);
  }

  // Status
  if (summary.needsAttention) {
    parts.push('This estimate needs review.');
  } else {
    parts.push('The estimate looks good.');
  }

  return parts.join(' ');
}

/**
 * Generate calibration invoice line items
 * For billing/quoting purposes
 * @param {Object} scrubResult - Result from scrubEstimateV2
 * @returns {Array}
 */
export function formatInvoiceLineItems(scrubResult) {
  if (scrubResult.error) {
    return [];
  }

  const lineItems = [];

  for (const cal of scrubResult.calibrationsRequired) {
    lineItems.push({
      description: `${cal.calibration} Calibration`,
      type: formatCalibrationType(cal.type),
      triggeredBy: cal.triggeredBy,
      verified: true,
      confidence: cal.confidence,
      notes: null
    });
  }

  // Add verification items with warning
  for (const cal of scrubResult.calibrationsNeedingVerification || []) {
    lineItems.push({
      description: `${cal.calibration} Calibration`,
      type: 'TBD',
      triggeredBy: null,
      verified: false,
      confidence: 'LOW',
      notes: cal.note
    });
  }

  return lineItems;
}

/**
 * Generate legally defensible documentation
 * For insurance claims and dispute resolution
 * @param {Object} scrubResult - Result from scrubEstimateV2
 * @returns {string}
 */
export function formatLegalDocumentation(scrubResult) {
  const lines = [];

  lines.push('ADAS CALIBRATION REQUIREMENTS DOCUMENTATION');
  lines.push('============================================');
  lines.push('');
  lines.push(`Generated: ${scrubResult.scrubTimestamp}`);
  lines.push(`Scrub Engine Version: ${scrubResult.scrubVersion}`);
  lines.push('');

  // Vehicle Identification
  lines.push('VEHICLE IDENTIFICATION');
  lines.push('----------------------');
  lines.push(`VIN: ${scrubResult.vehicle.vin || 'Not Provided'}`);
  lines.push(`Year: ${scrubResult.vehicle.year || 'Unknown'}`);
  lines.push(`Make: ${scrubResult.vehicle.brand || 'Unknown'}`);
  lines.push('');

  // Methodology Statement
  lines.push('METHODOLOGY');
  lines.push('-----------');
  lines.push('This analysis was performed by extracting repair operations from the');
  lines.push('collision repair estimate and cross-referencing against OEM ADAS');
  lines.push('calibration requirements. Each calibration recommendation is traced');
  lines.push('to a specific repair operation that triggers the calibration need.');
  lines.push('');

  // Traceability Matrix
  lines.push('CALIBRATION REQUIREMENTS (TRACEABLE)');
  lines.push('------------------------------------');

  if (scrubResult.triggeredCalibrations.length === 0) {
    lines.push('No ADAS calibrations are triggered by the repair operations');
    lines.push('listed in this estimate.');
  } else {
    for (let i = 0; i < scrubResult.triggeredCalibrations.length; i++) {
      const cal = scrubResult.triggeredCalibrations[i];
      lines.push('');
      lines.push(`${i + 1}. ${cal.calibration}`);
      lines.push(`   Calibration Type: ${formatCalibrationType(cal.type)}`);
      lines.push(`   Triggering Repair: ${cal.triggeredBy}`);
      lines.push(`   Technical Reason: ${cal.reason}`);
      lines.push(`   Confidence Level: ${cal.confidence}`);
      lines.push(`   Vehicle Equipment Verified: ${cal.vehicleHasSystem ? 'Yes' : 'Needs Confirmation'}`);
    }
  }

  lines.push('');

  // Non-Requirements (for dispute prevention)
  if (scrubResult.calibrationsNotTriggered?.length > 0) {
    lines.push('CALIBRATIONS NOT REQUIRED FOR THIS REPAIR');
    lines.push('-----------------------------------------');
    lines.push('The following calibrations are NOT required because no repair');
    lines.push('operation in this estimate triggers them:');
    lines.push('');
    for (const cal of scrubResult.calibrationsNotTriggered) {
      lines.push(`- ${cal.calibration}: ${cal.reason}`);
    }
    lines.push('');
  }

  // Disclaimer
  lines.push('DISCLAIMER');
  lines.push('----------');
  lines.push('This analysis is based on the repair operations documented in the');
  lines.push('collision estimate and general OEM ADAS calibration requirements.');
  lines.push('Specific vehicle equipment configuration should be verified against');
  lines.push('the vehicle build sheet or VIN decode. OEM repair procedures should');
  lines.push('be consulted for exact calibration requirements and methods.');
  lines.push('');

  return lines.join('\n');
}

export default {
  formatCompactNotes,
  formatPreviewNotes,
  formatFullScrub,
  formatJSONOutput,
  formatVoiceSummary,
  formatInvoiceLineItems,
  formatLegalDocumentation
};
