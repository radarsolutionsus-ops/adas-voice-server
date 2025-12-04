/**
 * jobState.js - Lightweight job state tracking for auto-close and notifications
 *
 * Tracks document arrival and notification status per RO:
 * - Which document types have been received (estimate, revv_report, pre_scan, post_scan, invoice)
 * - Whether initial_notice_sent (calibration required / not required email)
 * - Whether final_notice_sent (job completed with all docs attached)
 *
 * Uses a simple JSON file for persistence: /data/jobState.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_TAG = '[JOB_STATE]';
const STATE_FILE_PATH = path.join(__dirname, 'jobState.json');

// In-memory state cache
let stateCache = {};
let lastLoadTime = 0;
const CACHE_TTL_MS = 5000; // Reload from disk every 5 seconds

/**
 * Document types we track
 */
export const DOC_TYPES = {
  ESTIMATE: 'estimate',
  REVV_REPORT: 'revv_report',
  PRE_SCAN: 'pre_scan',
  POST_SCAN: 'post_scan',
  INVOICE: 'invoice'
};

/**
 * Default state for a new RO
 */
function getDefaultState() {
  return {
    docs: {
      estimate: null,
      revv_report: null,
      pre_scan: null,
      post_scan: null,
      invoice: null
    },
    initial_notice_sent: false,
    final_notice_sent: false,
    needsCalibration: null,       // true, false, or null (unknown)
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Load state from disk (with caching)
 */
function loadState() {
  const now = Date.now();

  // Use cache if fresh
  if (now - lastLoadTime < CACHE_TTL_MS && Object.keys(stateCache).length > 0) {
    return stateCache;
  }

  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const data = fs.readFileSync(STATE_FILE_PATH, 'utf8');
      stateCache = JSON.parse(data);
      lastLoadTime = now;
    } else {
      stateCache = {};
    }
  } catch (err) {
    console.error(`${LOG_TAG} Failed to load state:`, err.message);
    stateCache = {};
  }

  return stateCache;
}

/**
 * Save state to disk
 */
function saveState() {
  try {
    const dir = path.dirname(STATE_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(stateCache, null, 2));
    lastLoadTime = Date.now();
  } catch (err) {
    console.error(`${LOG_TAG} Failed to save state:`, err.message);
  }
}

/**
 * Get state for a specific RO
 * @param {string} roPo - RO/PO number
 * @returns {Object} - State object (creates default if not exists)
 */
export function getROState(roPo) {
  if (!roPo) return null;

  const normalizedRO = String(roPo).toUpperCase().trim();
  const state = loadState();

  if (!state[normalizedRO]) {
    state[normalizedRO] = getDefaultState();
    saveState();
  }

  return state[normalizedRO];
}

/**
 * Update state for a specific RO
 * @param {string} roPo - RO/PO number
 * @param {Object} updates - Partial state updates
 */
export function updateROState(roPo, updates) {
  if (!roPo) return;

  const normalizedRO = String(roPo).toUpperCase().trim();
  const state = loadState();

  if (!state[normalizedRO]) {
    state[normalizedRO] = getDefaultState();
  }

  // Merge updates
  Object.assign(state[normalizedRO], updates, {
    updatedAt: new Date().toISOString()
  });

  stateCache = state;
  saveState();
}

/**
 * Record that a document has been received for an RO
 * @param {string} roPo - RO/PO number
 * @param {string} docType - Document type (from DOC_TYPES)
 * @param {Object} docInfo - Document info { driveFileId, fileName, webViewLink }
 */
export function recordDocument(roPo, docType, docInfo) {
  if (!roPo || !docType) return;

  const normalizedRO = String(roPo).toUpperCase().trim();
  const state = loadState();

  if (!state[normalizedRO]) {
    state[normalizedRO] = getDefaultState();
  }

  state[normalizedRO].docs[docType] = {
    ...docInfo,
    receivedAt: new Date().toISOString()
  };
  state[normalizedRO].updatedAt = new Date().toISOString();

  stateCache = state;
  saveState();

  console.log(`${LOG_TAG} Recorded ${docType} for RO ${normalizedRO}`);
}

/**
 * Check which documents are present for an RO
 * @param {string} roPo - RO/PO number
 * @returns {Object} - { hasEstimate, hasRevvReport, hasPreScan, hasPostScan, hasInvoice, allFinalDocsPresent }
 */
export function getDocumentStatus(roPo) {
  const roState = getROState(roPo);

  if (!roState) {
    return {
      hasEstimate: false,
      hasRevvReport: false,
      hasPreScan: false,
      hasPostScan: false,
      hasInvoice: false,
      allFinalDocsPresent: false
    };
  }

  const docs = roState.docs || {};

  return {
    hasEstimate: !!docs.estimate,
    hasRevvReport: !!docs.revv_report,
    hasPreScan: !!docs.pre_scan,
    hasPostScan: !!docs.post_scan,
    hasInvoice: !!docs.invoice,
    // All final docs needed for auto-close
    allFinalDocsPresent: !!(docs.post_scan && docs.revv_report && docs.invoice)
  };
}

/**
 * Check if initial notice should be sent for an RO
 * @param {string} roPo - RO/PO number
 * @returns {boolean} - true if initial notice should be sent
 */
export function shouldSendInitialNotice(roPo) {
  const roState = getROState(roPo);

  if (!roState) return false;

  // Already sent
  if (roState.initial_notice_sent) return false;

  // Need at least an estimate
  if (!roState.docs.estimate) return false;

  return true;
}

/**
 * Mark initial notice as sent
 * @param {string} roPo - RO/PO number
 */
export function markInitialNoticeSent(roPo) {
  updateROState(roPo, { initial_notice_sent: true });
  console.log(`${LOG_TAG} Marked initial_notice_sent for RO ${roPo}`);
}

/**
 * Check if final notice should be sent for an RO
 * @param {string} roPo - RO/PO number
 * @returns {boolean} - true if final notice should be sent
 */
export function shouldSendFinalNotice(roPo) {
  const roState = getROState(roPo);

  if (!roState) return false;

  // Already sent
  if (roState.final_notice_sent) return false;

  const docs = roState.docs || {};

  // Need all three final docs
  return !!(docs.post_scan && docs.revv_report && docs.invoice);
}

/**
 * Mark final notice as sent
 * @param {string} roPo - RO/PO number
 */
export function markFinalNoticeSent(roPo) {
  updateROState(roPo, { final_notice_sent: true });
  console.log(`${LOG_TAG} Marked final_notice_sent for RO ${roPo}`);
}

/**
 * Set whether job needs calibration
 * @param {string} roPo - RO/PO number
 * @param {boolean} needsCalibration - Whether calibrations are required
 */
export function setNeedsCalibration(roPo, needsCalibration) {
  updateROState(roPo, { needsCalibration });
}

/**
 * Get full state for debugging/inspection
 * @returns {Object} - Full state object
 */
export function getAllState() {
  return loadState();
}

/**
 * Clear state for an RO (for testing/cleanup)
 * @param {string} roPo - RO/PO number
 */
export function clearROState(roPo) {
  if (!roPo) return;

  const normalizedRO = String(roPo).toUpperCase().trim();
  const state = loadState();

  delete state[normalizedRO];

  stateCache = state;
  saveState();

  console.log(`${LOG_TAG} Cleared state for RO ${normalizedRO}`);
}

export default {
  DOC_TYPES,
  getROState,
  updateROState,
  recordDocument,
  getDocumentStatus,
  shouldSendInitialNotice,
  markInitialNoticeSent,
  shouldSendFinalNotice,
  markFinalNoticeSent,
  setNeedsCalibration,
  getAllState,
  clearROState
};
