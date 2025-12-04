/**
 * estimateScrubber.js - Automatic estimate scrubbing for ADAS calibration requirements
 *
 * Analyzes repair estimate PDFs to identify ADAS-related operations and
 * determine required calibrations. Compares against RevvADAS output to
 * find missing or extra calibrations.
 *
 * VERSION 2.0 UPDATE:
 * This module now integrates with the new scrub engine (src/scrub/) which
 * implements CORRECT repair-line-based calibration triggering:
 *
 * CRITICAL PRINCIPLE: A calibration is ONLY flagged if:
 * 1. A specific repair line in the estimate triggers it, AND
 * 2. The vehicle is confirmed/likely to have that ADAS system
 *
 * The new scrubEstimateV2() function replaces the old logic that incorrectly
 * flagged calibrations based on vehicle features rather than repair operations.
 *
 * Operations detected:
 * - R&I / R&R bumper cover (front/rear)
 * - R&I / R&R grille
 * - R&I / R&R mirror
 * - Windshield replacement
 * - Camera replacement or removal
 * - Radar sensor replacement / adjustment
 * - Blind spot monitor replacement
 * - Quarter panel repair (rear)
 * - Tail lamp R&I (BSM dependency)
 * - Radar bracket replacement
 * - Wiring harness replacement
 * - Module replacements (ABS, BCM, ECM, SAS, EPS, HVAC, IPMA, etc.)
 */

import * as sheetWriter from './sheetWriter.js';
import oem from '../utils/oem/index.js';
import * as oemKnowledge from '../utils/oemKnowledge.js';

// Import LLM-powered scrub (GPT-4o Vision) and new Hybrid Scrub
import {
  llmScrubEstimate,
  llmScrubFromText,
  formatLLMScrubAsNotes,
  formatLLMScrubFull,
  // NEW: Hybrid KB + LLM + RevvADAS Scrub
  hybridScrubEstimate,
  formatScrubNotes as formatHybridNotes,
  formatFullScrubText as formatHybridFullText,
  generateCalibrationCardsHTML,
  getCalibrationCardCSS
} from './llmScrubber.js';

// Import the new V2 scrub engine
import {
  scrubEstimateV2,
  quickScan,
  generateScrubSummary,
  formatCompactNotes as formatCompactNotesV2,
  formatPreviewNotes as formatPreviewNotesV2,
  formatFullScrub as formatFullScrubV2,
  formatVoiceSummary
} from '../src/scrub/index.js';

const LOG_TAG = '[ESTIMATE_SCRUB]';

// Known shops to match against (from Shops tab)
const KNOWN_SHOPS = [
  { patterns: ['paintmax', 'paint max', 'paint-max'], name: 'PaintMax' },
  { patterns: ['autosport', 'auto sport', 'autosport international'], name: 'AutoSport' },
  { patterns: ['ccnm', 'collision center', 'north miami'], name: 'CCNM' },
  { patterns: ['jmd', 'j.m.d', 'j m d'], name: 'JMD' },
  { patterns: ['reinaldo', 'reynaldo'], name: 'Reinaldo Body Shop' },
  { patterns: ['caliber', 'caliber collision'], name: 'Caliber Collision' },
  { patterns: ['gerber', 'gerber collision'], name: 'Gerber Collision' },
  { patterns: ['service king'], name: 'Service King' },
  { patterns: ['maaco'], name: 'Maaco' },
  { patterns: ['carstar'], name: 'Carstar' }
];

/**
 * Extract shop name from estimate text
 * Searches header area and matches against known shops
 * @param {string} estimateText - Full estimate text
 * @returns {string|null} Shop name or null
 */
export function extractShopFromEstimate(estimateText) {
  if (!estimateText) return null;

  // Get first 2000 chars (header area where shop name usually appears)
  const headerArea = estimateText.substring(0, 2000).toLowerCase();

  // Try to match known shops
  for (const shop of KNOWN_SHOPS) {
    for (const pattern of shop.patterns) {
      if (headerArea.includes(pattern)) {
        console.log(`${LOG_TAG} Found shop name: ${shop.name}`);
        return shop.name;
      }
    }
  }

  // Fallback: Look for common header patterns
  const headerPatterns = [
    /(?:body\s*shop|collision|auto\s*body)[:\s]+([A-Za-z0-9\s&'.-]{3,30})/i,
    /(?:shop|dealer|customer)[:\s]+([A-Za-z0-9\s&'.-]{3,30})/i,
    /^([A-Za-z0-9\s&'.-]{3,30})(?:\n|body\s*shop|collision)/im
  ];

  for (const pattern of headerPatterns) {
    const match = estimateText.match(pattern);
    if (match && match[1]) {
      const shopName = match[1].trim();
      // Verify it's not a vehicle name or generic word
      const skipWords = ['toyota', 'honda', 'ford', 'nissan', 'estimate', 'repair', 'order', 'vehicle', 'year', 'make', 'model'];
      if (!skipWords.some(w => shopName.toLowerCase().includes(w))) {
        console.log(`${LOG_TAG} Extracted shop name from header: ${shopName}`);
        return shopName;
      }
    }
  }

  console.log(`${LOG_TAG} Could not extract shop name from estimate`);
  return null;
}

/**
 * Determine scrub status based on estimate vs RevvADAS comparison
 * CRITICAL: 0 vs 1 is NOT aligned - it's a mismatch!
 * @param {Array} estimateCalibrations - Calibrations from estimate mapping
 * @param {Array} revvCalibrations - Calibrations from RevvADAS
 * @returns {Object} { status, message, needsReview }
 */
export function determineScrubStatus(estimateCalibrations, revvCalibrations) {
  const estCount = estimateCalibrations?.length || 0;
  const revvCount = revvCalibrations?.length || 0;

  // Case 1: Both empty - no calibrations needed
  if (estCount === 0 && revvCount === 0) {
    return {
      status: 'NO_CALIBRATION_NEEDED',
      message: 'No ADAS calibrations required for this repair.',
      needsReview: false
    };
  }

  // Case 2: RevvADAS has calibrations but estimate mapping found none
  // THIS IS A MISMATCH - needs review!
  if (estCount === 0 && revvCount > 0) {
    return {
      status: 'NEEDS_REVIEW',
      message: `RevvADAS found ${revvCount} calibration(s) but estimate operations didn't map to any. Review repair operations.`,
      needsReview: true
    };
  }

  // Case 3: Estimate found calibrations but RevvADAS is empty
  if (estCount > 0 && revvCount === 0) {
    return {
      status: 'NEEDS_REVIEW',
      message: `Estimate suggests ${estCount} calibration(s) but RevvADAS returned none. Verify VIN lookup.`,
      needsReview: true
    };
  }

  // Case 4: Both have calibrations - they are aligned
  // (Detailed mismatch checking happens elsewhere)
  return {
    status: 'ALIGNED',
    message: 'Both estimate and RevvADAS have calibrations.',
    needsReview: false
  };
}

/**
 * Normalize calibration names for comparison
 * "Millimeter Wave Radar Sensor" and "Millimeter Wave Radar" should match
 * "Front Radar" and "Millimeter Wave Radar" are equivalent (Toyota terminology)
 */
export function normalizeCalibrationName(name) {
  if (!name) return '';
  let normalized = name
    .toLowerCase()
    .replace(/\s+sensor$/i, '')
    .replace(/\s+camera$/i, '')
    .replace(/forward\s+/i, 'front ')
    .replace(/calibration/gi, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Normalize Toyota's "Millimeter Wave Radar" to "Front Radar" for comparison
  if (normalized.includes('millimeter wave') || normalized.includes('mm wave')) {
    normalized = 'front radar';
  }

  return normalized;
}

/**
 * Convert Spanish spoken numbers to digits
 * @param {string} text - Text that may contain Spanish number words
 * @returns {string} - Text with Spanish numbers converted to digits
 */
export function convertSpanishNumbersToDigits(text) {
  if (!text) return text;

  const spanishNumbers = {
    'cero': '0', 'uno': '1', 'dos': '2', 'tres': '3', 'cuatro': '4',
    'cinco': '5', 'seis': '6', 'siete': '7', 'ocho': '8', 'nueve': '9',
    'diez': '10', 'once': '11', 'doce': '12', 'trece': '13', 'catorce': '14',
    'quince': '15', 'dieciseis': '16', 'diecisiete': '17', 'dieciocho': '18', 'diecinueve': '19',
    'veinte': '20', 'veintiuno': '21', 'veintidos': '22', 'veintitres': '23', 'veinticuatro': '24',
    'veinticinco': '25', 'veintiseis': '26', 'veintisiete': '27', 'veintiocho': '28', 'veintinueve': '29',
    'treinta': '30', 'cuarenta': '40', 'cincuenta': '50', 'sesenta': '60',
    'setenta': '70', 'ochenta': '80', 'noventa': '90',
    'cien': '100', 'ciento': '100', 'doscientos': '200', 'trescientos': '300',
    'cuatrocientos': '400', 'quinientos': '500', 'seiscientos': '600',
    'setecientos': '700', 'ochocientos': '800', 'novecientos': '900',
    'mil': '1000'
  };

  let result = text.toLowerCase();

  // Handle compound numbers like "veinticuatro mil quinientos sesenta y siete"
  // First, replace "mil" with marker
  result = result.replace(/\bmil\b/g, ' MIL ');

  // Replace Spanish number words with digits
  for (const [word, digit] of Object.entries(spanishNumbers)) {
    if (word !== 'mil') {
      result = result.replace(new RegExp(`\\b${word}\\b`, 'gi'), digit);
    }
  }

  // Handle "y" between numbers (e.g., "sesenta y siete" = 67)
  result = result.replace(/(\d+)\s+y\s+(\d+)/g, (match, tens, ones) => {
    return String(parseInt(tens) + parseInt(ones));
  });

  // Handle MIL (thousands)
  result = result.replace(/(\d+)\s*MIL\s*(\d*)/gi, (match, thousands, rest) => {
    const thousandPart = parseInt(thousands) * 1000;
    const restPart = rest ? parseInt(rest) : 0;
    return String(thousandPart + restPart);
  });

  // Also handle standalone MIL (= 1000)
  result = result.replace(/\bMIL\b/gi, '1000');

  return result;
}

/**
 * Extract RO number from text, supporting both English and Spanish
 * @param {string} text - Text to search for RO
 * @returns {string|null} - Extracted RO number (4-8 digits) or null
 */
export function extractROFromText(text) {
  if (!text) return null;

  // First convert any Spanish numbers to digits
  const normalizedText = convertSpanishNumbersToDigits(text);

  // Pattern 1: Explicit RO/PO prefix with number
  const prefixPatterns = [
    /(?:ro|r\.o\.|po|p\.o\.)\s*(?:is|es|number|numero|#|:)?\s*(\d{4,8})\b/i,
    /(?:repair\s*order|work\s*order|orden)\s*(?:#|:)?\s*(\d{4,8})\b/i
  ];

  for (const pattern of prefixPatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      return padRO(match[1]);
    }
  }

  // Pattern 2: Standalone 4-8 digit number (not a year)
  const standaloneMatch = normalizedText.match(/\b(\d{4,8})\b/g);
  if (standaloneMatch) {
    for (const num of standaloneMatch) {
      // Skip if it looks like a year (2015-2030)
      if (/^20(1[5-9]|2[0-9]|30)$/.test(num)) continue;
      // Skip if it looks like a VIN fragment (17 chars context)
      if (num.length === 4 && normalizedText.toLowerCase().includes('vin')) continue;
      return padRO(num);
    }
  }

  return null;
}

/**
 * Pad RO number to minimum 4 digits
 * @param {string} ro - RO number
 * @returns {string} - Padded RO number
 */
export function padRO(ro) {
  if (!ro) return ro;
  const digits = ro.replace(/\D/g, '');
  if (digits.length < 4) {
    return digits.padStart(4, '0');
  }
  return digits;
}

/**
 * Build compact notes for Google Sheets (internal helper)
 * Called during scrubEstimate before formatCompactNotes is defined
 *
 * @param {Object} params
 * @param {string} params.roPo - RO/PO number
 * @param {Array} params.operationsFound - Operations detected from estimate
 * @param {Array} params.requiredFromEstimate - Calibrations inferred from estimate ops
 * @param {Array} params.requiredFromRevv - Calibrations from RevvADAS report (Column J)
 * @param {Array} params.missing - Calibrations in estimate but not in Revv
 * @param {Array} params.extra - Calibrations in Revv but not in estimate
 * @param {number} params.actualRevvCount - The actual count from Column J (override for revvCount)
 */
function buildCompactNotes({
  roPo,
  operationsFound = [],
  requiredFromEstimate = [],
  requiredFromRevv = [],
  missing = [],
  extra = [],
  actualRevvCount = null
}) {
  const estCount = requiredFromEstimate.length;
  // Use actualRevvCount if provided (from Column J text), otherwise use array length
  const revvCount = actualRevvCount !== null ? actualRevvCount : requiredFromRevv.length;

  // If everything matches
  if (missing.length === 0 && extra.length === 0) {
    return `OK – Estimate matches RevvADAS (${estCount} calibrations). Ready to schedule.`;
  }

  // If RevvADAS returned nothing but estimate has calibrations
  if (revvCount === 0 && estCount > 0) {
    const mList = missing.slice(0, 2).join(", ");
    const more = missing.length > 2 ? `, +${missing.length - 2} more` : "";
    return `Estimate: ${estCount} ADAS ops, Revv: 0. Missing: ${mList}${more}. Needs review.`;
  }

  // If missing calibrations
  if (missing.length > 0) {
    const mList = missing.slice(0, 2).join(", ");
    const more = missing.length > 2 ? `, +${missing.length - 2} more` : "";
    return `Mismatch – Est: ${estCount}, Revv: ${revvCount}. Missing: ${mList}${more}.`;
  }

  // Extra calibrations not in Revv
  if (extra.length > 0) {
    const xList = extra.slice(0, 2).join(", ");
    const more = extra.length > 2 ? `, +${extra.length - 2} more` : "";
    return `Extra ops – Estimate includes: ${xList}${more}.`;
  }

  return "OK – Reviewed.";
}

// Operation categories for classification
const OPERATION_CATEGORIES = {
  FRONT_BUMPER: 'front_bumper',
  REAR_BUMPER: 'rear_bumper',
  WINDSHIELD: 'windshield',
  FRONT_CAMERA: 'front_camera',
  FRONT_RADAR: 'front_radar',
  REAR_RADAR: 'rear_radar',
  SIDE_MIRROR: 'side_mirror',
  BLIND_SPOT: 'blind_spot',
  QUARTER_PANEL: 'quarter_panel',
  TAIL_LAMP: 'tail_lamp',
  GRILLE: 'grille',
  HOOD: 'hood',
  WIRING: 'wiring',
  SUSPENSION: 'suspension',
  MODULE_ABS: 'module_abs',
  MODULE_BCM: 'module_bcm',
  MODULE_ECM: 'module_ecm',
  MODULE_SAS: 'module_sas',
  MODULE_EPS: 'module_eps',
  MODULE_HVAC: 'module_hvac',
  MODULE_IPMA: 'module_ipma',
  MODULE_ADAS: 'module_adas',
  PROGRAMMING: 'programming',
  CALIBRATION: 'calibration',
  ALIGNMENT: 'alignment',
  HEADLAMP: 'headlamp',
  LANE_ASSIST: 'lane_assist',
  FENDER: 'fender',
  DOOR: 'door',
  ROOF: 'roof',
  TRUNK: 'trunk',
  LIFTGATE: 'liftgate',
  UNKNOWN: 'unknown'
};

/**
 * Parse an estimate line to extract operation type and part name
 * @param {string} line - Raw estimate line
 * @returns {Object|null} - { operationType, partName, normalizedPart } or null
 */
function parseEstimateLine(line) {
  if (!line || typeof line !== 'string') return null;

  const trimmed = line.trim();
  if (trimmed.length < 3) return null;

  // Operation type patterns (order matters - more specific first)
  const operationPatterns = [
    { pattern: /^(?:remove\s*(?:&|and)\s*install|r\s*[&\/]\s*i)\s+/i, type: 'r&i' },
    { pattern: /^(?:remove\s*(?:&|and)\s*replace|r\s*[&\/]\s*r)\s+/i, type: 'r&r' },
    { pattern: /^replace\s+/i, type: 'replace' },
    { pattern: /^refinish\s+/i, type: 'refinish' },
    { pattern: /^repair\s+/i, type: 'repair' },
    { pattern: /^remove\s+/i, type: 'remove' },
    { pattern: /^install\s+/i, type: 'install' },
    { pattern: /^overhaul\s+/i, type: 'overhaul' },
    { pattern: /^blend\s+/i, type: 'blend' },
    { pattern: /^aim\s+/i, type: 'aim' },
    { pattern: /^align\s+/i, type: 'align' },
    { pattern: /^calibrate\s+/i, type: 'calibrate' },
    { pattern: /^program\s+/i, type: 'program' }
  ];

  let operationType = null;
  let remainder = trimmed;

  // Extract operation type
  for (const { pattern, type } of operationPatterns) {
    if (pattern.test(trimmed)) {
      operationType = type;
      remainder = trimmed.replace(pattern, '').trim();
      break;
    }
  }

  // If no operation found, return null
  if (!operationType) return null;

  // Clean up the part name
  let partName = remainder
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .replace(/^\d+\.?\s*/, '')      // Remove leading line numbers
    .replace(/\s*\d+\.\d{2}\s*$/, '') // Remove trailing prices
    .replace(/\s*-?\s*labor\s*$/i, '') // Remove trailing "labor"
    .replace(/\s*-?\s*part[s]?\s*$/i, '') // Remove trailing "parts"
    .trim();

  // Normalize the part name to a standard category
  const normalizedPart = normalizePartName(partName);

  return {
    operationType,
    partName: partName || 'unknown',
    normalizedPart,
    rawLine: trimmed
  };
}

/**
 * Normalize part name to a standard component identifier
 * @param {string} partName - Raw part name from estimate
 * @returns {string} - Normalized part identifier
 */
function normalizePartName(partName) {
  if (!partName) return 'unknown';

  const lower = partName.toLowerCase();

  // Position/side detection
  let side = '';
  if (/\b(lh|left|l\/h|driver)\b/i.test(lower)) side = '_left';
  else if (/\b(rh|right|r\/h|passenger)\b/i.test(lower)) side = '_right';

  let position = '';
  if (/\bfront\b/i.test(lower)) position = 'front_';
  else if (/\brear\b/i.test(lower)) position = 'rear_';

  // Part type detection (order matters - more specific first)
  const partMappings = [
    // Bumper components
    { patterns: [/bumper\s*cover/, /bumper\s*fascia/, /fascia/], base: 'bumper' },
    { patterns: [/bumper\s*absorber/, /absorber/], base: 'bumper_absorber' },
    { patterns: [/bumper\s*reinforcement/, /rebar/, /reinforcement/], base: 'bumper_reinforcement' },
    { patterns: [/bumper/], base: 'bumper' },

    // Lighting
    { patterns: [/headl(?:amp|ight)\s*(?:assy|assembly)?/], base: 'headlamp' },
    { patterns: [/tail\s*l(?:amp|ight)/, /rear\s*l(?:amp|ight)/], base: 'tail_lamp' },
    { patterns: [/fog\s*l(?:amp|ight)/], base: 'fog_lamp' },
    { patterns: [/turn\s*signal/, /marker\s*l(?:amp|ight)/], base: 'signal_lamp' },

    // Glass
    { patterns: [/windshield/, /front\s*glass/, /laminated\s*glass/], base: 'windshield' },
    { patterns: [/back\s*glass/, /rear\s*window/, /backlight/], base: 'rear_glass' },
    { patterns: [/door\s*glass/, /side\s*glass/, /quarter\s*glass/], base: 'door_glass' },

    // Mirrors
    { patterns: [/(?:side|door|exterior)\s*mirror/, /mirror\s*(?:assy|assembly)/], base: 'mirror' },
    { patterns: [/mirror\s*glass/], base: 'mirror_glass' },
    { patterns: [/mirror\s*(?:cover|cap)/], base: 'mirror_cover' },

    // Body panels
    { patterns: [/fender/], base: 'fender' },
    { patterns: [/quarter\s*panel/, /rear\s*quarter/], base: 'quarter_panel' },
    { patterns: [/rocker\s*panel/, /rocker/], base: 'rocker' },
    { patterns: [/door\s*(?:shell|panel|skin)?/], base: 'door' },
    { patterns: [/hood/], base: 'hood' },
    { patterns: [/trunk\s*(?:lid)?/, /deck\s*lid/], base: 'trunk' },
    { patterns: [/liftgate/, /tailgate/, /hatch/], base: 'liftgate' },
    { patterns: [/roof\s*(?:panel)?/], base: 'roof' },

    // Grille and front end
    { patterns: [/grille/, /grill/], base: 'grille' },
    { patterns: [/header\s*panel/, /radiator\s*support/], base: 'header_panel' },
    { patterns: [/valance/], base: 'valance' },
    { patterns: [/splash\s*(?:shield|guard)/, /fender\s*liner/, /inner\s*fender/], base: 'fender_liner' },

    // ADAS components
    { patterns: [/(?:front|forward)\s*(?:radar|sensor)/, /acc\s*sensor/, /cruise\s*sensor/], base: 'front_radar' },
    { patterns: [/rear\s*(?:radar|sensor)/, /parking\s*sensor/, /ultrasonic/], base: 'rear_radar' },
    { patterns: [/(?:front|forward)\s*camera/, /windshield\s*camera/, /lane\s*(?:departure|keeping)\s*camera/], base: 'front_camera' },
    { patterns: [/(?:rear|backup)\s*camera/], base: 'rear_camera' },
    { patterns: [/blind\s*spot/, /bsm\s*sensor/, /side\s*radar/], base: 'blind_spot_sensor' },
    { patterns: [/surround\s*view/, /360\s*camera/], base: 'surround_camera' },

    // Suspension / steering
    { patterns: [/strut/, /shock\s*absorber/], base: 'strut' },
    { patterns: [/control\s*arm/, /a[\s-]?arm/], base: 'control_arm' },
    { patterns: [/tie\s*rod/], base: 'tie_rod' },
    { patterns: [/wheel\s*(?:alignment|align)/], base: 'wheel_alignment' },
    { patterns: [/knuckle/, /spindle/], base: 'knuckle' },

    // Modules / electrical
    { patterns: [/abs\s*(?:module|control|unit)/], base: 'abs_module' },
    { patterns: [/airbag\s*(?:module|sensor)/, /srs\s*(?:module|unit)/], base: 'airbag_module' },
    { patterns: [/bcm/, /body\s*control/], base: 'bcm' },
    { patterns: [/ecm/, /engine\s*control/, /pcm/, /powertrain/], base: 'ecm' },
    { patterns: [/steering\s*angle/, /sas/], base: 'steering_angle_sensor' },
    { patterns: [/eps/, /power\s*steering\s*(?:module|motor)/], base: 'eps_module' },

    // Wiring
    { patterns: [/wiring\s*(?:harness|assy)/, /wire\s*harness/], base: 'wiring_harness' },
    { patterns: [/connector/, /pigtail/], base: 'connector' }
  ];

  for (const { patterns, base } of partMappings) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        // Don't double-add position if already in base
        if (base.startsWith('front_') || base.startsWith('rear_')) {
          return base + side;
        }
        return position + base + side;
      }
    }
  }

  // Fallback: use cleaned part name
  const cleaned = lower
    .replace(/\b(assy|assembly|asm)\b/gi, '')
    .replace(/\b(lh|rh|left|right|l\/h|r\/h|driver|passenger)\b/gi, '')
    .replace(/\b(front|rear|frt|rr)\b/gi, '')
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim();

  return cleaned || 'unknown';
}

// Patterns to detect ADAS-related operations in estimate text
const OPERATION_PATTERNS = [
  // Front bumper operations
  { pattern: /r[&\/]i\s+(?:front\s+)?bumper\s*(?:cover|fascia)?/gi, category: OPERATION_CATEGORIES.FRONT_BUMPER },
  { pattern: /r[&\/]r\s+(?:front\s+)?bumper\s*(?:cover|fascia)?/gi, category: OPERATION_CATEGORIES.FRONT_BUMPER },
  { pattern: /(?:remove|replace|install)\s+(?:front\s+)?bumper/gi, category: OPERATION_CATEGORIES.FRONT_BUMPER },
  { pattern: /front\s+bumper\s+(?:cover|fascia|assembly)/gi, category: OPERATION_CATEGORIES.FRONT_BUMPER },

  // Rear bumper operations
  { pattern: /r[&\/]i\s+rear\s+bumper/gi, category: OPERATION_CATEGORIES.REAR_BUMPER },
  { pattern: /r[&\/]r\s+rear\s+bumper/gi, category: OPERATION_CATEGORIES.REAR_BUMPER },
  { pattern: /(?:remove|replace|install)\s+rear\s+bumper/gi, category: OPERATION_CATEGORIES.REAR_BUMPER },
  { pattern: /rear\s+bumper\s+(?:cover|fascia|assembly)/gi, category: OPERATION_CATEGORIES.REAR_BUMPER },

  // Windshield operations
  { pattern: /windshield\s+(?:replace|r[&\/]r|install|remove)/gi, category: OPERATION_CATEGORIES.WINDSHIELD },
  { pattern: /(?:replace|r[&\/]r|install|remove)\s+windshield/gi, category: OPERATION_CATEGORIES.WINDSHIELD },
  { pattern: /front\s+glass\s+(?:replace|install)/gi, category: OPERATION_CATEGORIES.WINDSHIELD },
  { pattern: /laminated\s+glass/gi, category: OPERATION_CATEGORIES.WINDSHIELD },

  // Front camera operations
  { pattern: /(?:front|forward|fwd)\s+camera/gi, category: OPERATION_CATEGORIES.FRONT_CAMERA },
  { pattern: /camera\s+(?:bracket|mount|assembly)/gi, category: OPERATION_CATEGORIES.FRONT_CAMERA },
  { pattern: /lane\s+(?:departure|keeping)\s+camera/gi, category: OPERATION_CATEGORIES.FRONT_CAMERA },
  { pattern: /eyesight\s+camera/gi, category: OPERATION_CATEGORIES.FRONT_CAMERA },
  { pattern: /adas\s+camera/gi, category: OPERATION_CATEGORIES.FRONT_CAMERA },

  // Front radar operations
  { pattern: /(?:front|forward|fwd)\s+radar/gi, category: OPERATION_CATEGORIES.FRONT_RADAR },
  { pattern: /radar\s+(?:sensor|unit|module|bracket)/gi, category: OPERATION_CATEGORIES.FRONT_RADAR },
  { pattern: /acc\s+(?:radar|sensor)/gi, category: OPERATION_CATEGORIES.FRONT_RADAR },
  { pattern: /adaptive\s+cruise\s+(?:control|radar)/gi, category: OPERATION_CATEGORIES.FRONT_RADAR },
  { pattern: /distance\s+sensor/gi, category: OPERATION_CATEGORIES.FRONT_RADAR },
  { pattern: /millimeter\s*wave\s*radar/gi, category: OPERATION_CATEGORIES.FRONT_RADAR },
  { pattern: /mm\s*wave\s*radar/gi, category: OPERATION_CATEGORIES.FRONT_RADAR },
  { pattern: /pre[\s-]?collision\s+(?:sensor|radar|system)/gi, category: OPERATION_CATEGORIES.FRONT_RADAR },
  { pattern: /toyota\s+safety\s+sense/gi, category: OPERATION_CATEGORIES.FRONT_RADAR },
  { pattern: /tss\s+(?:sensor|radar|system)/gi, category: OPERATION_CATEGORIES.FRONT_RADAR },

  // Rear radar / parking sensors
  { pattern: /rear\s+(?:radar|sensor)/gi, category: OPERATION_CATEGORIES.REAR_RADAR },
  { pattern: /parking\s+(?:sensor|aid|assist)/gi, category: OPERATION_CATEGORIES.REAR_RADAR },
  { pattern: /ultrasonic\s+sensor/gi, category: OPERATION_CATEGORIES.REAR_RADAR },
  { pattern: /backup\s+sensor/gi, category: OPERATION_CATEGORIES.REAR_RADAR },

  // Side mirror operations
  { pattern: /(?:side|door)\s+mirror/gi, category: OPERATION_CATEGORIES.SIDE_MIRROR },
  { pattern: /mirror\s+(?:assembly|housing|glass)/gi, category: OPERATION_CATEGORIES.SIDE_MIRROR },
  { pattern: /(?:left|right|lh|rh)\s+mirror/gi, category: OPERATION_CATEGORIES.SIDE_MIRROR },

  // Blind spot operations
  { pattern: /blind\s*spot/gi, category: OPERATION_CATEGORIES.BLIND_SPOT },
  { pattern: /bsm\s+(?:sensor|module)/gi, category: OPERATION_CATEGORIES.BLIND_SPOT },
  { pattern: /lane\s+change\s+(?:assist|warning)/gi, category: OPERATION_CATEGORIES.BLIND_SPOT },
  { pattern: /side\s+radar/gi, category: OPERATION_CATEGORIES.BLIND_SPOT },

  // Quarter panel operations
  { pattern: /quarter\s+panel/gi, category: OPERATION_CATEGORIES.QUARTER_PANEL },
  { pattern: /rear\s+(?:fender|quarter)/gi, category: OPERATION_CATEGORIES.QUARTER_PANEL },

  // Tail lamp operations (BSM related)
  { pattern: /tail\s*(?:lamp|light)/gi, category: OPERATION_CATEGORIES.TAIL_LAMP },
  { pattern: /rear\s+(?:lamp|light)/gi, category: OPERATION_CATEGORIES.TAIL_LAMP },

  // Grille operations
  { pattern: /(?:front\s+)?grille/gi, category: OPERATION_CATEGORIES.GRILLE },
  { pattern: /radiator\s+grille/gi, category: OPERATION_CATEGORIES.GRILLE },

  // Hood operations
  { pattern: /hood\s+(?:assembly|panel)/gi, category: OPERATION_CATEGORIES.HOOD },
  { pattern: /(?:replace|r[&\/]r)\s+hood/gi, category: OPERATION_CATEGORIES.HOOD },

  // Wiring operations
  { pattern: /wiring\s+(?:harness|repair)/gi, category: OPERATION_CATEGORIES.WIRING },
  { pattern: /electrical\s+(?:harness|connector)/gi, category: OPERATION_CATEGORIES.WIRING },

  // Suspension / alignment
  { pattern: /(?:suspension|strut|shock)\s+(?:replace|r[&\/]r)/gi, category: OPERATION_CATEGORIES.SUSPENSION },
  { pattern: /wheel\s+alignment/gi, category: OPERATION_CATEGORIES.ALIGNMENT },
  { pattern: /4[\s-]?wheel\s+align/gi, category: OPERATION_CATEGORIES.ALIGNMENT },

  // Module replacements
  { pattern: /abs\s+(?:module|control|unit)/gi, category: OPERATION_CATEGORIES.MODULE_ABS },
  { pattern: /(?:replace|r[&\/]r)\s+abs/gi, category: OPERATION_CATEGORIES.MODULE_ABS },
  { pattern: /bcm|body\s+control\s+module/gi, category: OPERATION_CATEGORIES.MODULE_BCM },
  { pattern: /ecm|engine\s+control\s+module/gi, category: OPERATION_CATEGORIES.MODULE_ECM },
  { pattern: /pcm|powertrain\s+control/gi, category: OPERATION_CATEGORIES.MODULE_ECM },
  { pattern: /sas|steering\s+angle\s+sensor/gi, category: OPERATION_CATEGORIES.MODULE_SAS },
  { pattern: /eps|electric\s+power\s+steering/gi, category: OPERATION_CATEGORIES.MODULE_EPS },
  { pattern: /hvac\s+(?:module|control)/gi, category: OPERATION_CATEGORIES.MODULE_HVAC },
  { pattern: /ipma|image\s+processing/gi, category: OPERATION_CATEGORIES.MODULE_IPMA },
  { pattern: /adas\s+(?:module|control|ecu)/gi, category: OPERATION_CATEGORIES.MODULE_ADAS },

  // Programming operations
  { pattern: /(?:module|ecu)\s+programming/gi, category: OPERATION_CATEGORIES.PROGRAMMING },
  { pattern: /flash\s+(?:program|reprogram)/gi, category: OPERATION_CATEGORIES.PROGRAMMING },
  { pattern: /software\s+update/gi, category: OPERATION_CATEGORIES.PROGRAMMING },

  // Calibration mentions
  { pattern: /(?:camera|radar|sensor)\s+calibration/gi, category: OPERATION_CATEGORIES.CALIBRATION },
  { pattern: /adas\s+calibration/gi, category: OPERATION_CATEGORIES.CALIBRATION },
  { pattern: /(?:static|dynamic)\s+calibration/gi, category: OPERATION_CATEGORIES.CALIBRATION },

  // Headlamp / AFS
  { pattern: /headl(?:amp|ight)\s+(?:assembly|aim|replace)/gi, category: OPERATION_CATEGORIES.HEADLAMP },
  { pattern: /adaptive\s+(?:headl|front\s+light)/gi, category: OPERATION_CATEGORIES.HEADLAMP },
  { pattern: /afs\s+(?:module|sensor|aim)/gi, category: OPERATION_CATEGORIES.HEADLAMP },

  // Lane assist
  { pattern: /lane\s+(?:keep|departure|assist)/gi, category: OPERATION_CATEGORIES.LANE_ASSIST },
  { pattern: /lkas|ldw/gi, category: OPERATION_CATEGORIES.LANE_ASSIST }
];

// Map categories to required calibrations
// Note: "Millimeter Wave Radar" is Toyota's term for front radar
const CATEGORY_TO_CALIBRATION = {
  [OPERATION_CATEGORIES.FRONT_BUMPER]: ['Front Radar Calibration', 'Front Camera Calibration', 'Millimeter Wave Radar Calibration'],
  [OPERATION_CATEGORIES.REAR_BUMPER]: ['Rear Radar Calibration', 'Parking Sensor Calibration'],
  [OPERATION_CATEGORIES.WINDSHIELD]: ['Front Camera Calibration (Static)', 'Rain/Light Sensor Calibration'],
  [OPERATION_CATEGORIES.FRONT_CAMERA]: ['Front Camera Calibration (Static)'],
  [OPERATION_CATEGORIES.FRONT_RADAR]: ['Front Radar Calibration', 'Millimeter Wave Radar Calibration'],
  [OPERATION_CATEGORIES.REAR_RADAR]: ['Rear Radar Calibration', 'Parking Sensor Calibration'],
  [OPERATION_CATEGORIES.SIDE_MIRROR]: ['Blind Spot Monitor Calibration'],
  [OPERATION_CATEGORIES.BLIND_SPOT]: ['Blind Spot Monitor Calibration'],
  [OPERATION_CATEGORIES.QUARTER_PANEL]: ['Blind Spot Monitor Calibration', 'Rear Radar Calibration'],
  [OPERATION_CATEGORIES.TAIL_LAMP]: ['Blind Spot Monitor Calibration'],
  [OPERATION_CATEGORIES.GRILLE]: ['Front Radar Calibration', 'Millimeter Wave Radar Calibration'],
  [OPERATION_CATEGORIES.HOOD]: ['Front Camera Calibration'],
  [OPERATION_CATEGORIES.WIRING]: ['ADAS System Check'],
  [OPERATION_CATEGORIES.SUSPENSION]: ['Wheel Alignment', 'ADAS Calibration Check'],
  [OPERATION_CATEGORIES.ALIGNMENT]: ['ADAS Calibration Check'],
  [OPERATION_CATEGORIES.MODULE_ABS]: ['ABS Module Initialization', 'Steering Angle Sensor Reset'],
  [OPERATION_CATEGORIES.MODULE_BCM]: ['BCM Programming', 'ADAS System Reset'],
  [OPERATION_CATEGORIES.MODULE_ECM]: ['ECM Programming'],
  [OPERATION_CATEGORIES.MODULE_SAS]: ['Steering Angle Sensor Calibration'],
  [OPERATION_CATEGORIES.MODULE_EPS]: ['EPS Calibration', 'Steering Angle Sensor Reset'],
  [OPERATION_CATEGORIES.MODULE_HVAC]: ['Climate Control Reset'],
  [OPERATION_CATEGORIES.MODULE_IPMA]: ['Front Camera Calibration', 'IPMA Module Setup'],
  [OPERATION_CATEGORIES.MODULE_ADAS]: ['ADAS Module Programming', 'Full ADAS Calibration'],
  [OPERATION_CATEGORIES.PROGRAMMING]: ['Module Programming'],
  [OPERATION_CATEGORIES.CALIBRATION]: ['ADAS Calibration'],
  [OPERATION_CATEGORIES.HEADLAMP]: ['Headlamp Aim', 'AFS Calibration'],
  [OPERATION_CATEGORIES.LANE_ASSIST]: ['Lane Departure Warning Calibration', 'Front Camera Calibration']
};

/**
 * Extract operations from estimate text
 * Uses both pattern matching AND line parsing for comprehensive extraction
 * @param {string} text - Estimate text
 * @returns {Array} - Array of found operations
 */
function extractOperations(text) {
  if (!text) return [];

  const operations = [];
  const lines = text.split('\n');

  for (const line of lines) {
    // Method 1: Try new line parser first (extracts operation type + part name)
    const parsed = parseEstimateLine(line);
    if (parsed && parsed.normalizedPart !== 'unknown') {
      // Map normalized part to category
      const category = mapPartToCategory(parsed.normalizedPart);
      operations.push({
        operationText: `${parsed.operationType} [${parsed.normalizedPart}]`,
        operationType: parsed.operationType,
        partName: parsed.partName,
        normalizedPart: parsed.normalizedPart,
        category,
        lineContext: line.trim().substring(0, 100)
      });
    }

    // Method 2: Also use pattern matching for ADAS-specific items
    for (const { pattern, category } of OPERATION_PATTERNS) {
      pattern.lastIndex = 0; // Reset regex
      const match = pattern.exec(line);
      if (match) {
        // Check if we already captured this line with the line parser
        const alreadyCaptured = operations.some(op =>
          op.lineContext === line.trim().substring(0, 100) &&
          op.category === category
        );

        if (!alreadyCaptured) {
          // Try to get operation type from line parser for better formatting
          const lineParsed = parseEstimateLine(line);
          const opType = lineParsed?.operationType || 'detected';
          const partName = lineParsed?.partName || match[0].trim();

          operations.push({
            operationText: `${opType} [${partName}]`,
            operationType: opType,
            partName: partName,
            normalizedPart: lineParsed?.normalizedPart || category,
            category,
            lineContext: line.trim().substring(0, 100)
          });
        }
      }
    }
  }

  // Deduplicate by category + normalized part
  const seen = new Set();
  return operations.filter(op => {
    const key = `${op.category}:${op.normalizedPart || op.operationText.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Map a normalized part name to an operation category
 * @param {string} normalizedPart - Normalized part identifier
 * @returns {string} - Category from OPERATION_CATEGORIES
 */
function mapPartToCategory(normalizedPart) {
  if (!normalizedPart) return OPERATION_CATEGORIES.UNKNOWN;

  const lower = normalizedPart.toLowerCase();

  // Bumpers
  if (lower.includes('front_bumper') || lower === 'front_bumper') return OPERATION_CATEGORIES.FRONT_BUMPER;
  if (lower.includes('rear_bumper') || lower === 'rear_bumper') return OPERATION_CATEGORIES.REAR_BUMPER;

  // Glass
  if (lower.includes('windshield')) return OPERATION_CATEGORIES.WINDSHIELD;

  // ADAS components
  if (lower.includes('front_camera')) return OPERATION_CATEGORIES.FRONT_CAMERA;
  if (lower.includes('front_radar')) return OPERATION_CATEGORIES.FRONT_RADAR;
  if (lower.includes('rear_radar') || lower.includes('parking')) return OPERATION_CATEGORIES.REAR_RADAR;
  if (lower.includes('blind_spot') || lower.includes('side_radar')) return OPERATION_CATEGORIES.BLIND_SPOT;

  // Mirrors
  if (lower.includes('mirror')) return OPERATION_CATEGORIES.SIDE_MIRROR;

  // Body panels
  if (lower.includes('grille')) return OPERATION_CATEGORIES.GRILLE;
  if (lower.includes('hood')) return OPERATION_CATEGORIES.HOOD;
  if (lower.includes('quarter_panel')) return OPERATION_CATEGORIES.QUARTER_PANEL;
  if (lower.includes('tail_lamp') || lower.includes('rear_lamp')) return OPERATION_CATEGORIES.TAIL_LAMP;
  if (lower.includes('headlamp')) return OPERATION_CATEGORIES.HEADLAMP;
  if (lower.includes('fender')) return OPERATION_CATEGORIES.FENDER;
  if (lower.includes('door')) return OPERATION_CATEGORIES.DOOR;
  if (lower.includes('roof')) return OPERATION_CATEGORIES.ROOF;
  if (lower.includes('trunk') || lower.includes('liftgate')) return OPERATION_CATEGORIES.LIFTGATE;

  // Suspension / alignment
  if (lower.includes('strut') || lower.includes('control_arm') || lower.includes('suspension')) return OPERATION_CATEGORIES.SUSPENSION;
  if (lower.includes('alignment') || lower.includes('wheel_align')) return OPERATION_CATEGORIES.ALIGNMENT;

  // Modules
  if (lower.includes('abs_module')) return OPERATION_CATEGORIES.MODULE_ABS;
  if (lower.includes('bcm')) return OPERATION_CATEGORIES.MODULE_BCM;
  if (lower.includes('ecm') || lower.includes('pcm')) return OPERATION_CATEGORIES.MODULE_ECM;
  if (lower.includes('steering_angle') || lower.includes('sas')) return OPERATION_CATEGORIES.MODULE_SAS;
  if (lower.includes('eps')) return OPERATION_CATEGORIES.MODULE_EPS;

  // Wiring
  if (lower.includes('wiring') || lower.includes('harness')) return OPERATION_CATEGORIES.WIRING;

  return OPERATION_CATEGORIES.UNKNOWN;
}

/**
 * Map found operations to required calibrations
 * @param {Array} operations - Array of found operations
 * @returns {Array} - Array of required calibration names
 */
function mapOperationsToCalibrations(operations) {
  const calibrations = new Set();

  for (const op of operations) {
    const cals = CATEGORY_TO_CALIBRATION[op.category] || [];
    cals.forEach(c => calibrations.add(c));
  }

  return Array.from(calibrations);
}

/**
 * Parse calibration text from sheet into array
 * @param {string} text - Calibration text (comma or semicolon separated)
 * @returns {Array} - Array of calibration names
 */
function parseCalibrations(text) {
  if (!text || typeof text !== 'string') return [];

  return text
    .split(/[;,\n]/)
    .map(c => c.trim())
    .filter(c => c.length > 0);
}

/**
 * Compare two calibration lists
 * @param {Array} fromEstimate - Calibrations required by estimate
 * @param {Array} fromRevv - Calibrations from RevvADAS
 * @returns {Object} - { missing: [], extra: [] }
 */
function compareCalibrations(fromEstimate, fromRevv) {
  const normalize = (arr) => arr.map(c =>
    c.toLowerCase()
      .replace(/calibration/g, '')
      .replace(/\(static\)/g, '')
      .replace(/\(dynamic\)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );

  const estNorm = normalize(fromEstimate);
  const revvNorm = normalize(fromRevv);

  const missing = fromEstimate.filter((_, i) =>
    !revvNorm.some(r => r.includes(estNorm[i]) || estNorm[i].includes(r))
  );

  const extra = fromRevv.filter((_, i) =>
    !estNorm.some(e => e.includes(revvNorm[i]) || revvNorm[i].includes(e))
  );

  return { missing, extra };
}

// VIN WMI to Brand mapping (3-char prefix)
const VIN_WMI_BRANDS = {
  // German manufacturers
  'WBA': 'BMW', 'WBS': 'BMW', 'WBY': 'BMW', '5UX': 'BMW', '5YM': 'BMW',
  'WAU': 'Audi', 'WUA': 'Audi', 'WA1': 'Audi', 'WAU': 'Audi',
  'WVW': 'Volkswagen', 'WV1': 'Volkswagen', 'WV2': 'Volkswagen', '3VW': 'Volkswagen',
  'WP0': 'Porsche', 'WP1': 'Porsche',
  // Mercedes-Benz
  'WDB': 'Mercedes-Benz', 'WDC': 'Mercedes-Benz', 'WDD': 'Mercedes-Benz',
  'WDF': 'Mercedes-Benz', 'W1K': 'Mercedes-Benz', 'W1N': 'Mercedes-Benz',
  'W1V': 'Mercedes-Benz', '4JG': 'Mercedes-Benz', '55S': 'Mercedes-Benz',
  // Japanese manufacturers
  'JT': 'Toyota', '2T1': 'Toyota', '4T1': 'Toyota', '5TD': 'Toyota',
  'JTD': 'Lexus', 'JTH': 'Lexus', 'JTJ': 'Lexus', '2T2': 'Lexus',
  // Honda / Acura
  'JHM': 'Honda', '1HG': 'Honda', '2HG': 'Honda', '5FN': 'Honda', '5J6': 'Honda',
  '19U': 'Acura', 'JH4': 'Acura', '19V': 'Acura',
  // Nissan / Infiniti
  'JN1': 'Nissan', 'JN8': 'Nissan', '1N4': 'Nissan', '3N1': 'Nissan', '5N1': 'Nissan',
  'JNK': 'Infiniti', '5N3': 'Infiniti',
  // Ford / Lincoln
  '1FA': 'Ford', '1FD': 'Ford', '1FM': 'Ford', '1FT': 'Ford', '2FM': 'Ford', '3FA': 'Ford',
  '1LN': 'Lincoln', '2LM': 'Lincoln', '3LN': 'Lincoln', '5LM': 'Lincoln',
  // General Motors
  '1G1': 'Chevrolet', '2G1': 'Chevrolet', '3G1': 'Chevrolet', '1GC': 'Chevrolet',
  '1G4': 'Buick', '2G4': 'Buick',
  '1G6': 'Cadillac', '1GY': 'Cadillac',
  '1GT': 'GMC', '2GT': 'GMC', '3GT': 'GMC',
  // Stellantis
  '1C3': 'Chrysler', '2C3': 'Chrysler', '3C4': 'Chrysler',
  '2B3': 'Dodge', '2C4': 'Dodge', '3D7': 'Dodge',
  '1C4': 'Jeep', '1J4': 'Jeep', '1J8': 'Jeep',
  '3C6': 'Ram',
  // Hyundai / Kia / Genesis
  'KM8': 'Hyundai', '5NP': 'Hyundai', 'KMH': 'Hyundai',
  'KNA': 'Kia', 'KND': 'Kia', '5XY': 'Kia',
  'KMT': 'Genesis', 'K5N': 'Genesis',
  // Subaru
  'JF1': 'Subaru', 'JF2': 'Subaru', '4S3': 'Subaru', '4S4': 'Subaru',
  // Mazda
  'JM1': 'Mazda', 'JM3': 'Mazda', '3MZ': 'Mazda',
  // Tesla
  '5YJ': 'Tesla', '7SA': 'Tesla',
  // Volvo
  'YV1': 'Volvo', 'YV4': 'Volvo',
};

/**
 * Extract VIN from text - Enhanced version with multiple patterns
 * @param {string} text - Text to search
 * @returns {string|null} - VIN or null
 */
function extractVINFromText(text) {
  if (!text) return null;

  // Pattern 1: Explicit "VIN:" label followed by VIN
  const vinLabelPatterns = [
    /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})\b/i,
    /V\.?I\.?N\.?\s*[:\s#]+\s*([A-HJ-NPR-Z0-9]{17})\b/i,
    /Vehicle\s+Identification\s+Number[:\s]+([A-HJ-NPR-Z0-9]{17})\b/i
  ];

  for (const pattern of vinLabelPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      console.log(`${LOG_TAG} Found VIN with label: ${match[1]}`);
      return match[1].toUpperCase();
    }
  }

  // Pattern 2: Standalone 17-character VIN (alphanumeric, excluding I, O, Q)
  const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  if (vinMatch) {
    // Validate it looks like a real VIN (has both letters and numbers)
    const candidate = vinMatch[1].toUpperCase();
    const hasLetters = /[A-HJ-NPR-Z]/.test(candidate);
    const hasNumbers = /[0-9]/.test(candidate);
    if (hasLetters && hasNumbers) {
      console.log(`${LOG_TAG} Found standalone VIN: ${candidate}`);
      return candidate;
    }
  }

  return null;
}

/**
 * Extract VIN from estimate - exported version
 * @param {string} estimateText - Full estimate text
 * @returns {string|null} - VIN or null
 */
export function extractVIN(estimateText) {
  return extractVINFromText(estimateText);
}

/**
 * Get vehicle brand from VIN using WMI lookup
 * @param {string} vin - Full or partial VIN
 * @returns {string|null} - Brand name or null
 */
function getBrandFromVIN(vin) {
  if (!vin || vin.length < 3) return null;

  const upperVin = vin.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Try 3-character WMI first
  const wmi3 = upperVin.substring(0, 3);
  if (VIN_WMI_BRANDS[wmi3]) {
    return VIN_WMI_BRANDS[wmi3];
  }

  // Try 2-character prefix for some manufacturers
  const wmi2 = upperVin.substring(0, 2);
  if (VIN_WMI_BRANDS[wmi2]) {
    return VIN_WMI_BRANDS[wmi2];
  }

  return null;
}

/**
 * Extract vehicle brand from vehicle string or estimate text
 * PRIORITY: Vehicle field > VIN > PDF text
 * @param {string} vehicleStr - Vehicle string (e.g., "2022 Mercedes-Benz GLC 300")
 * @param {string} vin - VIN if available
 * @param {string} pdfText - PDF text as fallback
 * @returns {string|null}
 */
function extractBrand(vehicleStr, vin, pdfText) {
  // PRIORITY 1: Extract from Vehicle field
  if (vehicleStr) {
    const brands = [
      'Mercedes-Benz', 'Mercedes', 'BMW', 'Audi', 'Volkswagen', 'VW', 'Porsche',
      'Toyota', 'Lexus', 'Honda', 'Acura', 'Nissan', 'Infiniti', 'Subaru', 'Mazda',
      'Chevrolet', 'Chevy', 'Buick', 'GMC', 'Cadillac', 'Ford', 'Lincoln',
      'Chrysler', 'Dodge', 'Jeep', 'Ram', 'Hyundai', 'Kia', 'Genesis',
      'Volvo', 'Tesla', 'Rivian', 'Mitsubishi'
    ];

    for (const brand of brands) {
      if (vehicleStr.toLowerCase().includes(brand.toLowerCase())) {
        // Normalize Mercedes variants
        if (brand.toLowerCase() === 'mercedes') return 'Mercedes-Benz';
        if (brand.toLowerCase() === 'chevy') return 'Chevrolet';
        if (brand.toLowerCase() === 'vw') return 'Volkswagen';
        return brand;
      }
    }
  }

  // PRIORITY 2: Use VIN-based detection
  if (vin) {
    const vinBrand = getBrandFromVIN(vin);
    if (vinBrand) {
      console.log(`${LOG_TAG} Brand detected from VIN ${vin.substring(0,3)}***: ${vinBrand}`);
      return vinBrand;
    }
  }

  // PRIORITY 3: Extract from PDF text
  if (pdfText) {
    const extractedVin = extractVINFromText(pdfText);
    if (extractedVin) {
      const vinBrand = getBrandFromVIN(extractedVin);
      if (vinBrand) return vinBrand;
    }
  }

  return null;
}

/**
 * Get OEM-specific prerequisites and quirks for a brand
 * @param {string} brand - Vehicle brand
 * @returns {Object}
 */
function getOEMRequirements(brand) {
  if (!brand) return null;

  try {
    const prerequisites = oem.getPrerequisites(brand);
    const quirks = oem.getQuirks(brand);
    const targetSpecs = oem.getTargetSpecs(brand);

    return {
      brand: oem.normalizeBrand(brand),
      prerequisites,
      quirks: quirks.slice(0, 5), // Limit for notes
      targetSpecs
    };
  } catch (err) {
    console.error(`${LOG_TAG} Error getting OEM requirements:`, err.message);
    return null;
  }
}

/**
 * Main function: Scrub an estimate PDF and identify required calibrations
 *
 * @param {string} pdfText - Raw text extracted from estimate PDF
 * @param {string} roPo - RO/PO number
 * @param {Object} options - Optional parameters
 * @param {string} options.vin - VIN for more accurate brand detection
 * @param {string} options.vehicle - Vehicle string from Column E
 * @param {string} options.requiredCalibrationsText - Raw text from Column J (RevvADAS calibrations)
 * @returns {Promise<Object>} - Scrub results
 */
export async function scrubEstimate(pdfText, roPo, options = {}) {
  console.log(`${LOG_TAG} Scrubbing estimate for RO: ${roPo}`);

  try {
    // Step 0: Extract shop name from estimate header
    const shopName = extractShopFromEstimate(pdfText);
    console.log(`${LOG_TAG} Shop name: ${shopName || 'Not found'}`);

    // Step 1: Extract operations from estimate
    const foundOperations = extractOperations(pdfText);
    console.log(`${LOG_TAG} Found ${foundOperations.length} operations in estimate`);

    // Step 2: CRITICAL - Map operations to required calibrations
    // This is where operations get converted to actual calibration requirements
    const requiredFromEstimate = mapOperationsToCalibrations(foundOperations);
    console.log(`${LOG_TAG} Mapped to ${requiredFromEstimate.length} calibrations from estimate operations`);

    // Step 3: Get existing calibrations from RevvADAS (from sheet)
    let requiredFromRevv = [];
    let vehicleBrand = null;
    let existingVin = options.vin || null;
    let vehicleStr = options.vehicle || '';
    let rawRevvText = options.requiredCalibrationsText || '';

    try {
      const scheduleRow = await sheetWriter.getScheduleRowByRO(roPo);
      if (scheduleRow) {
        rawRevvText = rawRevvText || scheduleRow.required_calibrations ||
                         scheduleRow.requiredCalibrations ||
                         scheduleRow.calibrations_required || '';
        requiredFromRevv = parseCalibrations(rawRevvText);

        // Get VIN from schedule row if not provided
        if (!existingVin) {
          existingVin = scheduleRow.vin || scheduleRow.VIN;
        }

        // Get Vehicle string from schedule row if not provided
        if (!vehicleStr) {
          vehicleStr = scheduleRow.vehicle || scheduleRow.vehicle_info || '';
        }
      }
    } catch (err) {
      console.error(`${LOG_TAG} Failed to get schedule row:`, err.message);
    }

    // Step 3b: Extract VIN from PDF if not already found
    if (!existingVin) {
      existingVin = extractVINFromText(pdfText);
      if (existingVin) {
        console.log(`${LOG_TAG} Extracted VIN from estimate: ${existingVin}`);
      }
    }

    // PRIORITY brand detection: Vehicle field > VIN > PDF text
    vehicleBrand = extractBrand(vehicleStr, existingVin, pdfText);

    // Fallback to VIN extraction from PDF if still no brand
    if (!vehicleBrand && existingVin) {
      vehicleBrand = getBrandFromVIN(existingVin);
    }

    // Calculate actual Revv count: if Column J has text, count semicolon-separated items
    // This ensures we show actual count even if parsing failed
    let actualRevvCount = requiredFromRevv.length;
    if (rawRevvText && rawRevvText.trim().length > 0) {
      // Count items by semicolons or commas (typical separators)
      const items = rawRevvText.split(/[;,]/).filter(s => s.trim().length > 0);
      if (items.length > 0) {
        actualRevvCount = items.length;
      }
    }

    console.log(`${LOG_TAG} Required from RevvADAS: ${actualRevvCount} calibrations (parsed: ${requiredFromRevv.length})`);
    console.log(`${LOG_TAG} Detected brand: ${vehicleBrand || 'Unknown'}`);

    // Step 4: Compare calibrations
    const { missing: missingCalibrations, extra: extraCalibrations } =
      compareCalibrations(requiredFromEstimate, requiredFromRevv);

    // Step 5: Determine status using the CORRECT logic
    // CRITICAL FIX: Use determineScrubStatus for proper status determination
    const statusResult = determineScrubStatus(requiredFromEstimate, requiredFromRevv);
    const needsAttention = statusResult.needsReview ||
                           missingCalibrations.length > 0 ||
                           (requiredFromEstimate.length === 0 && actualRevvCount > 0);

    console.log(`${LOG_TAG} Status: ${statusResult.status} - ${statusResult.message}`);

    // Step 6: Get OEM-specific requirements if brand is known
    const oemRequirements = vehicleBrand ? getOEMRequirements(vehicleBrand) : null;

    // Step 6b: Get OEM job aids if brand is known
    let oemJobAids = [];
    if (vehicleBrand) {
      try {
        const jobAids = await oemKnowledge.getJobAidsForBrand(vehicleBrand);
        if (jobAids.length > 0) {
          console.log(`${LOG_TAG} Found ${jobAids.length} OEM job aid(s) for ${vehicleBrand}`);
          oemJobAids = jobAids.map(aid => ({
            brand: aid.brand,
            fileName: aid.fileName
          }));
        }
      } catch (err) {
        console.error(`${LOG_TAG} Error loading OEM job aids:`, err.message);
      }
    }

    // Step 7: Generate compact notes for sheet - pass actualRevvCount
    const formattedNotes = buildCompactNotes({
      roPo,
      operationsFound: foundOperations,
      requiredFromEstimate,
      requiredFromRevv,
      missing: missingCalibrations,
      extra: extraCalibrations,
      actualRevvCount
    });

    const result = {
      roPo,
      shopName, // NEW: Include extracted shop name
      foundOperations: foundOperations.map(op => ({
        operation: op.operationText,
        category: op.category,
        context: op.lineContext
      })),
      requiredFromEstimate,
      requiredFromRevv,
      rawRevvText,
      actualRevvCount,
      missingCalibrations,
      extraCalibrations,
      needsAttention,
      status: statusResult.status, // NEW: Include status
      statusMessage: statusResult.message, // NEW: Include status message
      vehicleBrand: vehicleBrand ? oem.normalizeBrand(vehicleBrand) : null,
      vin: existingVin,
      oemRequirements,
      oemJobAids,
      formattedNotes,
      scrubTimestamp: new Date().toISOString()
    };

    console.log(`${LOG_TAG} Scrub complete. Needs attention: ${needsAttention}`);
    console.log(`${LOG_TAG} Estimate calibrations: ${requiredFromEstimate.length}`);
    console.log(`${LOG_TAG} RevvADAS calibrations: ${actualRevvCount}`);
    console.log(`${LOG_TAG} Missing calibrations: ${missingCalibrations.length}`);
    console.log(`${LOG_TAG} Extra calibrations: ${extraCalibrations.length}`);
    if (oemRequirements) {
      console.log(`${LOG_TAG} OEM requirements loaded for: ${oemRequirements.brand}`);
    }

    return result;
  } catch (err) {
    console.error(`${LOG_TAG} Scrub failed:`, err.message);
    return {
      roPo,
      shopName: null,
      error: err.message,
      foundOperations: [],
      requiredFromEstimate: [],
      requiredFromRevv: [],
      rawRevvText: '',
      actualRevvCount: 0,
      missingCalibrations: [],
      extraCalibrations: [],
      needsAttention: false,
      status: 'ERROR',
      statusMessage: err.message,
      vehicleBrand: null,
      vin: null,
      oemRequirements: null,
      oemJobAids: [],
      formattedNotes: `Error: ${err.message}`
    };
  }
}

/**
 * Check if PDF text looks like an estimate
 * @param {string} text - PDF text
 * @returns {boolean}
 */
export function isEstimatePDF(text) {
  if (!text || text.length < 100) return false;

  const estimateIndicators = [
    /estimate/i,
    /repair\s*order/i,
    /r[&\/]i/i,
    /r[&\/]r/i,
    /labor/i,
    /parts/i,
    /subtotal/i,
    /insurance/i,
    /collision/i,
    /body\s*shop/i,
    /paint/i,
    /refinish/i,
    /supplement/i
  ];

  let matchCount = 0;
  for (const pattern of estimateIndicators) {
    if (pattern.test(text)) matchCount++;
    if (matchCount >= 3) return true;
  }

  return false;
}

/**
 * Format scrub results as text for Notes field
 * @param {Object} scrubResult - Result from scrubEstimate
 * @returns {string}
 */
export function formatScrubResultsAsNotes(scrubResult) {
  if (!scrubResult || scrubResult.error) {
    return `ESTIMATE SCRUB ERROR: ${scrubResult?.error || 'Unknown error'}`;
  }

  const lines = [
    '--- ESTIMATE SCRUB RESULTS ---',
    `Scrubbed: ${scrubResult.scrubTimestamp}`,
    scrubResult.vehicleBrand ? `Brand: ${scrubResult.vehicleBrand}` : '',
    '',
    `Operations Found (${scrubResult.foundOperations.length}):`,
    ...scrubResult.foundOperations.slice(0, 10).map(op => `  - ${op.operation} [${op.category}]`),
    scrubResult.foundOperations.length > 10 ? `  ... and ${scrubResult.foundOperations.length - 10} more` : '',
    '',
    `Required from Estimate (${scrubResult.requiredFromEstimate.length}):`,
    ...scrubResult.requiredFromEstimate.map(c => `  - ${c}`),
    '',
    `Required from RevvADAS (${scrubResult.requiredFromRevv.length}):`,
    ...scrubResult.requiredFromRevv.map(c => `  - ${c}`),
    ''
  ];

  if (scrubResult.missingCalibrations.length > 0) {
    lines.push(`MISSING CALIBRATIONS (${scrubResult.missingCalibrations.length}):`);
    lines.push(...scrubResult.missingCalibrations.map(c => `  ! ${c}`));
    lines.push('');
  }

  if (scrubResult.extraCalibrations.length > 0) {
    lines.push(`Extra in RevvADAS (${scrubResult.extraCalibrations.length}):`);
    lines.push(...scrubResult.extraCalibrations.map(c => `  + ${c}`));
    lines.push('');
  }

  // Add OEM-specific requirements if available
  if (scrubResult.oemRequirements) {
    const oemReqs = scrubResult.oemRequirements;
    lines.push(`--- OEM REQUIREMENTS (${oemReqs.brand}) ---`);

    if (oemReqs.prerequisites) {
      const prereqs = oemReqs.prerequisites;
      if (prereqs.alignment) lines.push(`  Alignment: ${prereqs.alignment}`);
      if (prereqs.rideHeight) lines.push(`  Ride Height: ${prereqs.rideHeight}`);
      if (prereqs.battery) lines.push(`  Battery: ${prereqs.battery}`);
      if (prereqs.criticalNotes?.length > 0) {
        lines.push(`  Critical Notes:`);
        prereqs.criticalNotes.slice(0, 3).forEach(n => lines.push(`    - ${n}`));
      }
    }

    if (oemReqs.quirks?.length > 0) {
      lines.push(`  Quirks:`);
      oemReqs.quirks.forEach(q => lines.push(`    * ${q}`));
    }

    lines.push('');
  }

  if (scrubResult.needsAttention) {
    lines.push('*** ATTENTION REQUIRED: Estimate shows calibrations not in RevvADAS report ***');
  } else {
    lines.push('Estimate and RevvADAS calibrations aligned.');
  }

  lines.push('--- END ESTIMATE SCRUB ---');

  return lines.filter(l => l !== '').join('\n');
}

/**
 * Get summary of scrub results for voice assistant
 * @param {Object} scrubResult - Result from scrubEstimate
 * @returns {string}
 */
export function getScrubSummary(scrubResult) {
  if (!scrubResult) return 'No estimate scrub performed.';
  if (scrubResult.error) return `Estimate scrub failed: ${scrubResult.error}`;

  const parts = [];

  parts.push(`Found ${scrubResult.foundOperations.length} ADAS-related operations.`);

  if (scrubResult.missingCalibrations.length > 0) {
    parts.push(`WARNING: ${scrubResult.missingCalibrations.length} calibrations required by estimate are not in RevvADAS report.`);
    parts.push(`Missing: ${scrubResult.missingCalibrations.slice(0, 3).join(', ')}`);
    if (scrubResult.missingCalibrations.length > 3) {
      parts.push(`...and ${scrubResult.missingCalibrations.length - 3} more.`);
    }
  } else if (scrubResult.requiredFromEstimate.length > 0) {
    parts.push('All estimate calibrations are covered by RevvADAS report.');
  }

  if (scrubResult.needsAttention) {
    parts.push('This vehicle needs attention before calibration.');
  }

  return parts.join(' ');
}

/**
 * Format compact notes for Google Sheets Notes column
 * Provides a concise single-line summary suitable for sheet cells
 * @param {Object} params
 * @param {number} params.actualRevvCount - Override for revv count (from Column J text)
 * @returns {string}
 */
export function formatCompactNotes({
  roPo,
  operationsFound = [],
  requiredFromEstimate = [],
  requiredFromRevv = [],
  missing = [],
  extra = [],
  actualRevvCount = null
}) {
  const estCount = requiredFromEstimate.length;
  // Use actualRevvCount if provided, otherwise use array length
  const revvCount = actualRevvCount !== null ? actualRevvCount : requiredFromRevv.length;

  // If everything matches
  if (missing.length === 0 && extra.length === 0) {
    return `OK – Estimate matches RevvADAS (${estCount} calibrations). Ready to schedule.`;
  }

  // If RevvADAS returned nothing but estimate has calibrations
  if (revvCount === 0 && estCount > 0) {
    const mList = missing.slice(0, 2).join(", ");
    const more = missing.length > 2 ? `, +${missing.length - 2} more` : "";
    return `Estimate: ${estCount} ADAS ops, Revv: 0. Missing: ${mList}${more}. Needs review.`;
  }

  // If missing calibrations
  if (missing.length > 0) {
    const mList = missing.slice(0, 2).join(", ");
    const more = missing.length > 2 ? `, +${missing.length - 2} more` : "";
    return `Mismatch – Est: ${estCount}, Revv: ${revvCount}. Missing: ${mList}${more}.`;
  }

  // Extra calibrations not in Revv
  if (extra.length > 0) {
    const xList = extra.slice(0, 2).join(", ");
    const more = extra.length > 2 ? `, +${extra.length - 2} more` : "";
    return `Extra ops – Estimate includes: ${xList}${more}.`;
  }

  return "OK – Reviewed.";
}

/**
 * Format SHORT preview notes for Column S (single line, clean)
 * Example: "Estimate: 7 ADAS ops. Revv: 2. Missing: Rear Radar, SAS Reset. Needs review."
 * @param {Object} scrubResult - Result from scrubEstimate
 * @param {number} actualRevvCount - Override for Revv count (from Column J)
 * @returns {string}
 */
export function formatPreviewNotes(scrubResult, actualRevvCount = null) {
  if (!scrubResult) return 'No scrub data.';
  if (scrubResult.error) return `Error: ${scrubResult.error}`;

  const estCount = scrubResult.requiredFromEstimate?.length || 0;
  // Use actualRevvCount if provided, otherwise use from scrubResult, then array length
  const revvCount = actualRevvCount !== null
    ? actualRevvCount
    : (scrubResult.actualRevvCount !== null && scrubResult.actualRevvCount !== undefined)
      ? scrubResult.actualRevvCount
      : (scrubResult.requiredFromRevv?.length || 0);
  const missing = scrubResult.missingCalibrations || [];
  const extra = scrubResult.extraCalibrations || [];

  // Build the preview line
  let preview = `Estimate: ${estCount} ADAS ops. Revv: ${revvCount}.`;

  // Add missing calibrations (up to 2)
  if (missing.length > 0) {
    const missingShort = missing.slice(0, 2).map(m => {
      // Shorten calibration names for preview
      return m.replace(/Calibration/gi, '').replace(/\s*\([^)]*\)/g, '').trim();
    }).join(', ');
    const more = missing.length > 2 ? `, +${missing.length - 2}` : '';
    preview += ` Missing: ${missingShort}${more}.`;
  }

  // Add extra if no missing
  if (missing.length === 0 && extra.length > 0) {
    const extraShort = extra.slice(0, 2).map(e => {
      return e.replace(/Calibration/gi, '').replace(/\s*\([^)]*\)/g, '').trim();
    }).join(', ');
    preview += ` Extra: ${extraShort}.`;
  }

  // Add status flag
  if (scrubResult.needsAttention) {
    preview += ' Needs review.';
  } else if (missing.length === 0 && extra.length === 0 && estCount > 0) {
    preview += ' OK.';
  }

  return preview;
}

/**
 * Format FULL structured scrub text for Column T (hidden, sidebar view)
 * Contains complete analysis with all details
 * @param {Object} scrubResult - Result from scrubEstimate
 * @param {number} actualRevvCount - Override for Revv count (from Column J)
 * @param {string} rawRevvText - Raw text from Column J for display
 * @returns {string}
 */
export function formatFullScrub(scrubResult, actualRevvCount = null, rawRevvText = '') {
  if (!scrubResult) return 'No scrub data available.';
  if (scrubResult.error) return `SCRUB ERROR: ${scrubResult.error}`;

  const estCount = scrubResult.requiredFromEstimate?.length || 0;
  // Use actualRevvCount if provided, otherwise use from scrubResult, then array length
  const revvCount = actualRevvCount !== null
    ? actualRevvCount
    : (scrubResult.actualRevvCount !== null && scrubResult.actualRevvCount !== undefined)
      ? scrubResult.actualRevvCount
      : (scrubResult.requiredFromRevv?.length || 0);
  const missing = scrubResult.missingCalibrations || [];
  const extra = scrubResult.extraCalibrations || [];
  const operations = scrubResult.foundOperations || [];

  // Use rawRevvText from scrubResult if not provided
  const revvText = rawRevvText || scrubResult.rawRevvText || '';

  const lines = [];

  // Header summary block
  lines.push('--- ESTIMATE vs REVV SUMMARY ---');
  lines.push(`Estimate Ops: ${estCount}`);
  lines.push(`Revv Ops: ${revvCount}`);

  if (missing.length > 0) {
    lines.push(`MISSING: ${missing.join(', ')}`);
  } else {
    lines.push('MISSING: None');
  }

  if (extra.length > 0) {
    lines.push(`EXTRA: ${extra.join(', ')}`);
  }
  lines.push('--------------------------------');
  lines.push('');

  // OEM Requirements section
  if (scrubResult.oemRequirements) {
    const oemReqs = scrubResult.oemRequirements;
    lines.push(`--- OEM REQUIREMENTS (${oemReqs.brand || 'Unknown'}) ---`);

    if (oemReqs.prerequisites) {
      const prereqs = oemReqs.prerequisites;
      if (prereqs.alignment) lines.push(`Alignment: ${prereqs.alignment}`);
      if (prereqs.rideHeight) lines.push(`Ride Height: ${prereqs.rideHeight}`);
      if (prereqs.battery) lines.push(`Battery: ${prereqs.battery}`);
      if (prereqs.criticalNotes?.length > 0) {
        lines.push('Critical Notes:');
        prereqs.criticalNotes.forEach(n => lines.push(`  - ${n}`));
      }
    }

    if (oemReqs.quirks?.length > 0) {
      lines.push('Brand Quirks:');
      oemReqs.quirks.forEach(q => lines.push(`  * ${q}`));
    }
    lines.push('');
  }

  // Full Assistant Scrub section
  lines.push('--- ASSISTANT SCRUB ANALYSIS ---');
  lines.push(`Vehicle: ${scrubResult.vehicleBrand || 'Unknown'}`);
  lines.push(`VIN: ${scrubResult.vin || 'Not provided'}`);
  lines.push(`Scrubbed: ${scrubResult.scrubTimestamp || new Date().toISOString()}`);
  lines.push('');

  lines.push(`Operations Detected (${operations.length}):`);
  if (operations.length > 0) {
    operations.forEach(op => {
      lines.push(`  - ${op.operation || op.operationText} [${op.category}]`);
    });
  } else {
    lines.push('  None detected');
  }
  lines.push('');

  lines.push(`Estimate Required Calibrations (${estCount}):`);
  if (scrubResult.requiredFromEstimate?.length > 0) {
    scrubResult.requiredFromEstimate.forEach(c => lines.push(`  - ${c}`));
  } else {
    lines.push('  None');
  }
  lines.push('');

  // Full Revv Recommendations section
  lines.push(`--- REVV RECOMMENDATIONS (${revvCount}) ---`);
  // Use rawRevvText if provided (actual Column J content), otherwise use parsed array
  if (revvText && revvText.trim().length > 0) {
    // Split by semicolon or comma and display each
    const revvItems = revvText.split(/[;,]/).map(s => s.trim()).filter(s => s.length > 0);
    revvItems.forEach(c => lines.push(`  - ${c}`));
  } else if (scrubResult.requiredFromRevv?.length > 0) {
    scrubResult.requiredFromRevv.forEach(c => lines.push(`  - ${c}`));
  } else {
    lines.push('  None from RevvADAS');
  }
  lines.push('');

  // OEM Job Aids section (only if job aids exist)
  if (scrubResult.oemJobAids && scrubResult.oemJobAids.length > 0) {
    const brand = scrubResult.vehicleBrand || 'Unknown';
    lines.push(`--- OEM JOB AIDS (${brand}) ---`);
    scrubResult.oemJobAids.forEach(aid => {
      lines.push(`  - ${aid.fileName}`);
    });
    lines.push('(Internal reference only; see OEM_KNOWLEDGE folder for full procedure details.)');
    lines.push('');
  }

  // Final status
  if (scrubResult.needsAttention) {
    lines.push('*** STATUS: NEEDS ATTENTION ***');
    lines.push('Estimate shows calibrations not covered by RevvADAS report.');
  } else {
    lines.push('STATUS: OK - Estimate and RevvADAS aligned.');
  }

  lines.push('--- END FULL SCRUB ---');

  return lines.join('\n');
}

/**
 * NEW V2 SCRUB FUNCTION - Uses repair-line-based calibration triggering
 *
 * This is the CORRECTED scrub logic that ONLY flags calibrations when:
 * 1. A specific repair line in the estimate triggers it
 * 2. The vehicle is confirmed/likely to have that ADAS system
 *
 * @param {string} pdfText - Raw text extracted from estimate PDF
 * @param {string} roPo - RO/PO number
 * @param {Object} options - Optional parameters
 * @param {string} options.vin - VIN for equipment verification
 * @param {string} options.vehicle - Vehicle string from Column E
 * @param {string} options.requiredCalibrationsText - Raw text from Column J (RevvADAS calibrations)
 * @param {boolean} options.useV2 - Force V2 engine (default: true)
 * @returns {Promise<Object>} - Scrub results
 */
export async function scrubEstimateNew(pdfText, roPo, options = {}) {
  console.log(`${LOG_TAG} [V2] Scrubbing estimate for RO: ${roPo}`);

  try {
    // Get additional context from sheet if available
    let vehicleStr = options.vehicle || '';
    let existingVin = options.vin || null;
    let rawRevvText = options.requiredCalibrationsText || '';

    try {
      const scheduleRow = await sheetWriter.getScheduleRowByRO(roPo);
      if (scheduleRow) {
        rawRevvText = rawRevvText || scheduleRow.required_calibrations ||
                      scheduleRow.requiredCalibrations ||
                      scheduleRow.calibrations_required || '';
        if (!existingVin) {
          existingVin = scheduleRow.vin || scheduleRow.VIN;
        }
        if (!vehicleStr) {
          vehicleStr = scheduleRow.vehicle || scheduleRow.vehicle_info || '';
        }
      }
    } catch (err) {
      console.error(`${LOG_TAG} [V2] Failed to get schedule row:`, err.message);
    }

    // Call the new V2 scrub engine
    const v2Result = await scrubEstimateV2({
      estimateText: pdfText,
      vin: existingVin,
      vehicle: vehicleStr,
      revvText: rawRevvText
    });

    // Get OEM-specific requirements
    const vehicleBrand = v2Result.vehicle.brand;
    const oemRequirements = vehicleBrand ? getOEMRequirements(vehicleBrand) : null;

    // Get OEM job aids
    let oemJobAids = [];
    if (vehicleBrand) {
      try {
        const jobAids = await oemKnowledge.getJobAidsForBrand(vehicleBrand);
        if (jobAids.length > 0) {
          oemJobAids = jobAids.map(aid => ({
            brand: aid.brand,
            fileName: aid.fileName
          }));
        }
      } catch (err) {
        console.error(`${LOG_TAG} [V2] Error loading OEM job aids:`, err.message);
      }
    }

    // Build result in the expected format (backward compatible with V1 consumers)
    const result = {
      roPo,
      scrubVersion: '2.0',

      // V2 detailed results
      v2Result,

      // Backward-compatible fields
      foundOperations: v2Result.repairOperations.lines.map(op => ({
        operation: op.operation,
        category: op.category,
        context: op.description
      })),

      // Triggered calibrations (from repair operations)
      requiredFromEstimate: v2Result.triggeredCalibrations.map(tc => tc.calibration),

      // RevvADAS calibrations
      requiredFromRevv: v2Result.revvReconciliation?.details?.matched?.map(m => m.system) || [],
      rawRevvText,
      actualRevvCount: (v2Result.revvReconciliation?.matched || 0) +
                       (v2Result.revvReconciliation?.revvOnly || 0),

      // Comparison results
      missingCalibrations: v2Result.revvReconciliation?.details?.scrubOnly?.map(s => s.system) || [],
      extraCalibrations: v2Result.revvReconciliation?.details?.revvOnly?.map(r => r.rawText) || [],

      // Status
      needsAttention: v2Result.summary.needsAttention,

      // Vehicle info
      vehicleBrand: v2Result.vehicle.brand,
      vin: v2Result.vehicle.vin,

      // OEM data
      oemRequirements,
      oemJobAids,

      // Formatted notes using V2 formatters
      formattedNotes: formatCompactNotesV2(v2Result),
      previewNotes: formatPreviewNotesV2(v2Result),
      fullScrub: formatFullScrubV2(v2Result),
      voiceSummary: formatVoiceSummary(v2Result),

      // Timestamps
      scrubTimestamp: v2Result.scrubTimestamp,

      // NEW V2-specific fields
      calibrationsRequired: v2Result.calibrationsRequired,
      calibrationsNotTriggered: v2Result.calibrationsNotTriggered,
      calibrationsNeedingVerification: v2Result.calibrationsNeedingVerification,
      reconciliationStatus: v2Result.revvReconciliation?.status,

      // Summary for quick access
      summary: v2Result.summary
    };

    console.log(`${LOG_TAG} [V2] Scrub complete. Triggered: ${v2Result.summary.calibrationsTriggered}, Needs attention: ${v2Result.summary.needsAttention}`);
    return result;

  } catch (err) {
    console.error(`${LOG_TAG} [V2] Scrub failed:`, err.message);
    return {
      roPo,
      scrubVersion: '2.0',
      error: err.message,
      foundOperations: [],
      requiredFromEstimate: [],
      requiredFromRevv: [],
      rawRevvText: '',
      actualRevvCount: 0,
      missingCalibrations: [],
      extraCalibrations: [],
      needsAttention: true,
      vehicleBrand: null,
      vin: null,
      oemRequirements: null,
      oemJobAids: [],
      formattedNotes: `Error: ${err.message}`,
      scrubTimestamp: new Date().toISOString()
    };
  }
}

/**
 * Quick scan to check if estimate has ADAS-relevant repairs
 * @param {string} pdfText - Estimate text
 * @returns {Object} - Quick scan result
 */
export function quickEstimateScan(pdfText) {
  return quickScan(pdfText);
}

/**
 * LLM-Powered Estimate Scrub using GPT-4o Vision
 *
 * This is the RECOMMENDED scrub method as it:
 * 1. Actually reads and understands the estimate
 * 2. Distinguishes repair operations from vehicle features
 * 3. Cross-references intelligently with RevvADAS
 * 4. Excludes non-ADAS items (SRS, Seat Weight, etc.)
 *
 * @param {string|Buffer} estimateInput - Path to PDF, image path, or buffer
 * @param {string} roPo - RO/PO number
 * @param {object} options - Options including revvData, vehicleInfo, etc.
 * @returns {object} Scrub result
 */
export async function scrubEstimateLLM(estimateInput, roPo, options = {}) {
  const {
    revvData = null,
    vehicleInfo = {},
    estimateText = null,
    estimatePath = null
  } = options;

  console.log(`${LOG_TAG} Starting LLM scrub for RO ${roPo}`);

  // Determine which LLM method to use
  const inputPath = estimatePath || (typeof estimateInput === 'string' && estimateInput.includes('/') ? estimateInput : null);

  let llmResult;

  if (inputPath) {
    // Use vision-based scrub (preferred)
    console.log(`${LOG_TAG} Using GPT-4o Vision for ${inputPath}`);
    llmResult = await llmScrubEstimate(inputPath, revvData, vehicleInfo);
  } else if (estimateText || typeof estimateInput === 'string') {
    // Use text-based scrub
    const text = estimateText || estimateInput;
    console.log(`${LOG_TAG} Using GPT-4o Text analysis (${text.length} chars)`);
    llmResult = await llmScrubFromText(text, revvData, vehicleInfo);
  } else {
    return {
      success: false,
      error: 'No valid estimate input provided',
      roPo
    };
  }

  // Transform LLM result to match expected format
  if (llmResult.success) {
    const cals = llmResult.required_calibrations || [];
    const excluded = llmResult.excluded_items || [];

    return {
      success: true,
      source: llmResult.source || 'LLM',
      roPo,

      // Calibrations in standard format
      foundOperations: llmResult.repair_operations_found || [],
      requiredCalibrations: cals.map(c => ({
        system: c.name,
        calibrationType: c.type || 'Static',
        triggeredBy: c.triggered_by,
        inRevv: c.in_revv,
        confidence: c.confidence || 'MEDIUM',
        notes: c.notes
      })),

      // Summary counts
      requiredFromEstimate: cals.filter(c => !c.in_revv),
      requiredFromRevv: cals.filter(c => c.in_revv),
      excludedItems: excluded,
      missingCalibrations: llmResult.discrepancies || [],

      // Status
      needsAttention: llmResult.status !== 'VERIFIED',
      status: llmResult.status || 'UNKNOWN',
      summary: llmResult.summary,

      // Raw data
      vehicle: llmResult.vehicle,
      revvComparison: llmResult.revv_comparison,
      fullAnalysis: llmResult,

      // Formatted outputs
      notesText: formatLLMScrubAsNotes(llmResult),
      fullScrubText: formatLLMScrubFull(llmResult)
    };
  }

  // LLM failed - return error
  return {
    success: false,
    error: llmResult.error || 'LLM scrub failed',
    roPo,
    raw_response: llmResult.raw_response
  };
}

/**
 * Smart scrub - uses LLM if available and enabled, falls back to V2
 * @param {string} pdfText - Estimate text or path
 * @param {string} roPo - RO/PO number
 * @param {object} options - Scrub options
 */
export async function scrubEstimateSmart(pdfText, roPo, options = {}) {
  const useLLM = process.env.USE_LLM_SCRUB === 'true' && options.estimatePath;

  if (useLLM) {
    console.log(`${LOG_TAG} Using LLM scrub (USE_LLM_SCRUB=true)`);
    const llmResult = await scrubEstimateLLM(pdfText, roPo, options);

    if (llmResult.success) {
      return llmResult;
    }

    console.warn(`${LOG_TAG} LLM scrub failed, falling back to V2: ${llmResult.error}`);
  }

  // Fall back to V2 scrub
  console.log(`${LOG_TAG} Using V2 scrub engine`);
  return scrubEstimateNew(pdfText, roPo, options);
}

export default {
  // HYBRID Scrub (NEWEST - Recommended for best accuracy)
  // Combines Knowledge Base + LLM + RevvADAS with confidence levels
  hybridScrubEstimate,
  formatHybridNotes,
  formatHybridFullText,
  generateCalibrationCardsHTML,
  getCalibrationCardCSS,

  // LLM-Powered Functions
  scrubEstimateLLM,
  scrubEstimateSmart,
  formatLLMScrubAsNotes,
  formatLLMScrubFull,

  // V2 functions (Recommended when LLM not available)
  scrubEstimateNew,
  scrubEstimateV2,
  quickEstimateScan,
  quickScan,

  // V2 formatters
  formatCompactNotesV2,
  formatPreviewNotesV2,
  formatFullScrubV2,
  formatVoiceSummary,
  generateScrubSummary,

  // Legacy V1 functions (deprecated but maintained for backward compatibility)
  scrubEstimate,
  isEstimatePDF,
  formatScrubResultsAsNotes,
  formatCompactNotes,
  formatPreviewNotes,
  formatFullScrub,
  getScrubSummary,
  extractROFromText,
  convertSpanishNumbersToDigits,
  padRO,

  // Bug fixes: New helper functions
  extractShopFromEstimate,
  extractVIN,
  determineScrubStatus,
  normalizeCalibrationName,
  OPERATION_CATEGORIES
};
