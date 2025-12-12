/**
 * learningLogger.js - Learning memory system for ADAS F1RST
 *
 * Logs data that helps improve over time:
 * - Shop estimate patterns (how each shop formats estimates)
 * - Vehicle/calibration combinations from RevvADAS
 * - Tech corrections or notes
 * - Job outcomes
 *
 * Data is stored in JSONL format for easy analysis and future ML training
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_TAG = '[LEARNING]';

// Learning log file path
const DATA_DIR = path.join(__dirname, '../data');
const LEARNING_LOG_PATH = path.join(DATA_DIR, 'learning-log.jsonl');

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`${LOG_TAG} Created data directory: ${DATA_DIR}`);
  }
}

/**
 * Log an event to the learning system
 * @param {Object} event - Event data
 * @returns {Object} The logged entry
 */
async function logEvent(event) {
  ensureDataDir();

  const entry = {
    timestamp: new Date().toISOString(),
    eventType: event.type,
    roNumber: event.roNumber || null,

    // Vehicle data
    vehicle: event.vehicle || null,
    vin: event.vin || null,

    // Shop patterns
    shopId: event.shopId || null,
    shopName: event.shopName || null,
    estimateFormat: event.estimateFormat || null, // CCC, Mitchell, handwritten, etc.

    // RevvADAS data
    revvCalibrations: event.calibrations || [],

    // Tech actions
    techId: event.techId || null,
    techNotes: event.notes || null,
    corrections: event.corrections || [],

    // Outcome tracking
    jobCompleted: event.completed || null,
    comeback: event.comeback || null,

    // Additional metadata
    metadata: event.metadata || {}
  };

  try {
    fs.appendFileSync(LEARNING_LOG_PATH, JSON.stringify(entry) + '\n');
    console.log(`${LOG_TAG} Logged ${event.type} for RO ${event.roNumber || 'N/A'}`);
  } catch (err) {
    console.error(`${LOG_TAG} Failed to log event:`, err.message);
  }

  return entry;
}

/**
 * Log when estimate received (shop patterns)
 * @param {string} roNumber - RO/PO number
 * @param {Object} vehicle - Vehicle info { year, make, model, full }
 * @param {string} shopId - Shop identifier
 * @param {string} shopName - Shop name
 * @param {string} estimateFormat - Format type (CCC, Mitchell, handwritten, etc.)
 * @param {Object} metadata - Additional metadata
 */
export async function logEstimateReceived(roNumber, vehicle, shopId, shopName, estimateFormat, metadata = {}) {
  return logEvent({
    type: 'ESTIMATE_RECEIVED',
    roNumber,
    vehicle,
    shopId,
    shopName,
    estimateFormat,
    metadata
  });
}

/**
 * Log when Revv report submitted
 * @param {string} roNumber - RO/PO number
 * @param {Object} vehicle - Vehicle info { year, make, model, full }
 * @param {Array} calibrations - Calibrations from RevvADAS
 * @param {string} techId - Tech who submitted
 */
export async function logRevvSubmitted(roNumber, vehicle, calibrations, techId) {
  return logEvent({
    type: 'REVV_SUBMITTED',
    roNumber,
    vehicle,
    calibrations,
    techId
  });
}

/**
 * Log if tech makes corrections or adds notes
 * @param {string} roNumber - RO/PO number
 * @param {string} techId - Tech ID
 * @param {Array} corrections - Array of corrections made
 * @param {string} notes - Tech notes
 */
export async function logTechCorrection(roNumber, techId, corrections, notes) {
  return logEvent({
    type: 'TECH_CORRECTION',
    roNumber,
    techId,
    corrections,
    notes
  });
}

/**
 * Log job outcome (for long-term tracking)
 * @param {string} roNumber - RO/PO number
 * @param {boolean} completed - Whether job was completed successfully
 * @param {boolean} comeback - Whether there was a comeback/redo
 * @param {string} notes - Any outcome notes
 */
export async function logOutcome(roNumber, completed, comeback, notes) {
  return logEvent({
    type: 'OUTCOME',
    roNumber,
    completed,
    comeback,
    notes
  });
}

/**
 * Log VIN lookup result for vehicle equipment learning
 * @param {string} vin - VIN
 * @param {Object} vehicle - Vehicle info
 * @param {Array} adasEquipment - ADAS equipment found
 * @param {string} source - Source of data (RevvADAS, manual, etc.)
 */
export async function logVinLookup(vin, vehicle, adasEquipment, source = 'RevvADAS') {
  return logEvent({
    type: 'VIN_LOOKUP',
    vin,
    vehicle,
    metadata: {
      adasEquipment,
      source
    }
  });
}

/**
 * Log estimate parsing result for pattern learning
 * @param {string} roNumber - RO/PO number
 * @param {string} shopName - Shop name
 * @param {string} estimateFormat - Detected format
 * @param {Array} extractedOperations - Operations extracted from estimate
 * @param {number} confidence - Parsing confidence score (0-1)
 */
export async function logEstimateParsing(roNumber, shopName, estimateFormat, extractedOperations, confidence) {
  return logEvent({
    type: 'ESTIMATE_PARSED',
    roNumber,
    shopName,
    estimateFormat,
    metadata: {
      extractedOperations,
      confidence
    }
  });
}

/**
 * Log email sent event
 * @param {string} roNumber - RO/PO number
 * @param {string} emailType - Type of email (confirmation, review_request, etc.)
 * @param {string} recipient - Email recipient
 * @param {boolean} success - Whether email was sent successfully
 */
export async function logEmailSent(roNumber, emailType, recipient, success) {
  return logEvent({
    type: 'EMAIL_SENT',
    roNumber,
    metadata: {
      emailType,
      recipient,
      success
    }
  });
}

/**
 * Read recent events from the log
 * @param {number} limit - Number of events to return
 * @param {string} eventType - Optional filter by event type
 * @returns {Array} Array of events
 */
export function getRecentEvents(limit = 100, eventType = null) {
  ensureDataDir();

  if (!fs.existsSync(LEARNING_LOG_PATH)) {
    return [];
  }

  try {
    const content = fs.readFileSync(LEARNING_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(line => line);

    let events = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(e => e !== null);

    if (eventType) {
      events = events.filter(e => e.eventType === eventType);
    }

    // Return most recent first
    return events.slice(-limit).reverse();
  } catch (err) {
    console.error(`${LOG_TAG} Failed to read events:`, err.message);
    return [];
  }
}

/**
 * Get statistics from the learning log
 * @returns {Object} Statistics object
 */
export function getStats() {
  const events = getRecentEvents(10000);

  const stats = {
    totalEvents: events.length,
    byType: {},
    byShop: {},
    recentActivity: events.slice(0, 10)
  };

  events.forEach(e => {
    // Count by type
    stats.byType[e.eventType] = (stats.byType[e.eventType] || 0) + 1;

    // Count by shop
    if (e.shopName) {
      stats.byShop[e.shopName] = (stats.byShop[e.shopName] || 0) + 1;
    }
  });

  return stats;
}

export default {
  logEstimateReceived,
  logRevvSubmitted,
  logTechCorrection,
  logOutcome,
  logVinLookup,
  logEstimateParsing,
  logEmailSent,
  getRecentEvents,
  getStats
};
