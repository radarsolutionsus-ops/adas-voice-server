/**
 * estimateParser.js - Structured Repair Line Extraction from Estimates
 *
 * CRITICAL: This module extracts ONLY actual repair operations from estimates.
 * It parses repair lines and categorizes them for calibration trigger analysis.
 *
 * The output is a structured representation of repair operations that can be
 * mapped to calibration requirements.
 */

import { REPAIR_CATEGORIES, OPERATION_TYPES } from './calibrationTriggers.js';

const LOG_TAG = '[ESTIMATE_PARSER]';

/**
 * Patterns to detect operation types from estimate text
 */
const OPERATION_TYPE_PATTERNS = [
  // Replace operations
  { pattern: /\bRepl(?:ace)?\b/gi, type: OPERATION_TYPES.REPLACE },
  { pattern: /\bR[\/&]R\b/gi, type: OPERATION_TYPES.R_AND_R },

  // Remove & Install operations
  { pattern: /\bR[\/&]I\b/gi, type: OPERATION_TYPES.R_AND_I },
  { pattern: /\bRemove\s*(?:and|&)\s*(?:Re)?Install\b/gi, type: OPERATION_TYPES.R_AND_I },

  // Repair operations
  { pattern: /\bRpr\b|\bRepair\b/gi, type: OPERATION_TYPES.REPAIR },

  // Refinish (paint)
  { pattern: /\bRefn\b|\bRefinish\b|\bPaint\b|\bBlend\b/gi, type: OPERATION_TYPES.REFINISH },

  // Aim/adjust
  { pattern: /\bAim\b|\bAdjust\b/gi, type: OPERATION_TYPES.AIM },

  // Alignment
  { pattern: /\b(?:4[\s-]?wheel\s*)?[Aa]lign(?:ment)?\b/gi, type: OPERATION_TYPES.ALIGNMENT },

  // Programming
  { pattern: /\bProgram\b|\bFlash\b|\bSetup\b/gi, type: OPERATION_TYPES.PROGRAM },

  // Sectioning
  { pattern: /\bSection(?:ing)?\b/gi, type: OPERATION_TYPES.SECTIONING }
];

/**
 * Patterns to detect component categories and locations
 */
const COMPONENT_PATTERNS = [
  // Windshield
  {
    patterns: [
      /windshield/gi,
      /front\s*glass/gi,
      /laminated\s*(?:front\s*)?glass/gi,
      /w\/s(?:\s|$)/gi
    ],
    category: REPAIR_CATEGORIES.WINDSHIELD
  },

  // Rear glass
  {
    patterns: [
      /rear\s*(?:window|glass)/gi,
      /back\s*(?:window|glass)/gi,
      /liftgate\s*glass/gi,
      /tailgate\s*glass/gi
    ],
    category: REPAIR_CATEGORIES.REAR_GLASS
  },

  // Front bumper - must check for "front" or absence of "rear"
  {
    patterns: [
      /(?:front|fr|frt)\s*bumper/gi,
      /bumper\s*(?:cover|fascia|assembly)\s*(?:front|fr)/gi,
      // Generic "bumper" without "rear" - need context check
    ],
    category: REPAIR_CATEGORIES.FRONT_BUMPER,
    contextCheck: (line) => !/(rear|rr|back)/i.test(line)
  },

  // Rear bumper - must have "rear" indicator
  {
    patterns: [
      /(?:rear|rr|back)\s*bumper/gi,
      /bumper\s*(?:cover|fascia|assembly)\s*(?:rear|rr)/gi
    ],
    category: REPAIR_CATEGORIES.REAR_BUMPER
  },

  // Grille
  {
    patterns: [
      /(?:front\s*)?grille/gi,
      /radiator\s*grille/gi,
      /upper\s*grille/gi,
      /lower\s*grille/gi
    ],
    category: REPAIR_CATEGORIES.GRILLE
  },

  // Left side mirror
  {
    patterns: [
      /(?:left|lt|lh|driver)\s*(?:side\s*)?mirror/gi,
      /mirror\s*(?:assy|assembly)?\s*(?:left|lt|lh|driver)/gi,
      /(?:left|lt|lh|driver)\s*(?:door\s*)?mirror/gi
    ],
    category: REPAIR_CATEGORIES.SIDE_MIRROR_LEFT
  },

  // Right side mirror
  {
    patterns: [
      /(?:right|rt|rh|passenger)\s*(?:side\s*)?mirror/gi,
      /mirror\s*(?:assy|assembly)?\s*(?:right|rt|rh|passenger)/gi,
      /(?:right|rt|rh|passenger)\s*(?:door\s*)?mirror/gi
    ],
    category: REPAIR_CATEGORIES.SIDE_MIRROR_RIGHT
  },

  // Generic side mirror (side not specified)
  {
    patterns: [
      /(?:side|door|exterior)\s*mirror/gi,
      /mirror\s*(?:base|housing|glass|cap)/gi
    ],
    category: REPAIR_CATEGORIES.SIDE_MIRROR_EITHER,
    // Only use if no left/right detected
    fallbackOnly: true
  },

  // Liftgate
  {
    patterns: [
      /liftgate/gi,
      /lift\s*gate/gi,
      /rear\s*hatch/gi,
      /hatchback\s*(?:door|panel)/gi
    ],
    category: REPAIR_CATEGORIES.LIFTGATE
  },

  // Tailgate
  {
    patterns: [
      /tailgate/gi,
      /tail\s*gate/gi,
      /pickup\s*(?:bed\s*)?gate/gi
    ],
    category: REPAIR_CATEGORIES.TAILGATE
  },

  // Hood
  {
    patterns: [
      /\bhood\b/gi,
      /hood\s*(?:panel|assy|assembly)/gi,
      /engine\s*hood/gi
    ],
    category: REPAIR_CATEGORIES.HOOD
  },

  // Left quarter panel
  {
    patterns: [
      /(?:left|lt|lh)\s*(?:rear\s*)?quarter\s*panel/gi,
      /quarter\s*panel\s*(?:left|lt|lh)/gi
    ],
    category: REPAIR_CATEGORIES.QUARTER_PANEL_LEFT
  },

  // Right quarter panel
  {
    patterns: [
      /(?:right|rt|rh)\s*(?:rear\s*)?quarter\s*panel/gi,
      /quarter\s*panel\s*(?:right|rt|rh)/gi
    ],
    category: REPAIR_CATEGORIES.QUARTER_PANEL_RIGHT
  },

  // Left headlamp
  {
    patterns: [
      /(?:left|lt|lh)\s*headl(?:amp|ight)/gi,
      /headl(?:amp|ight)\s*(?:assy)?\s*(?:left|lt|lh)/gi
    ],
    category: REPAIR_CATEGORIES.HEADLAMP_LEFT
  },

  // Right headlamp
  {
    patterns: [
      /(?:right|rt|rh)\s*headl(?:amp|ight)/gi,
      /headl(?:amp|ight)\s*(?:assy)?\s*(?:right|rt|rh)/gi
    ],
    category: REPAIR_CATEGORIES.HEADLAMP_RIGHT
  },

  // Generic headlamp
  {
    patterns: [
      /headl(?:amp|ight)/gi
    ],
    category: REPAIR_CATEGORIES.HEADLAMP_EITHER,
    fallbackOnly: true
  },

  // Left tail lamp
  {
    patterns: [
      /(?:left|lt|lh)\s*tail\s*l(?:amp|ight)/gi,
      /tail\s*l(?:amp|ight)\s*(?:left|lt|lh)/gi
    ],
    category: REPAIR_CATEGORIES.TAIL_LAMP_LEFT
  },

  // Right tail lamp
  {
    patterns: [
      /(?:right|rt|rh)\s*tail\s*l(?:amp|ight)/gi,
      /tail\s*l(?:amp|ight)\s*(?:right|rt|rh)/gi
    ],
    category: REPAIR_CATEGORIES.TAIL_LAMP_RIGHT
  },

  // Front camera (direct sensor reference)
  {
    patterns: [
      /(?:front|forward|fwd)\s*camera/gi,
      /(?:adas|sensing|eyesight|sensing)\s*camera/gi,
      /windshield\s*camera/gi,
      /lane\s*(?:departure|keep)\s*camera/gi,
      /camera\s*(?:bracket|mount)\s*(?:front|windshield)/gi
    ],
    category: REPAIR_CATEGORIES.FRONT_CAMERA
  },

  // Rear camera
  {
    patterns: [
      /(?:rear|back(?:up)?|reverse)\s*camera/gi,
      /camera\s*(?:rear|back)/gi
    ],
    category: REPAIR_CATEGORIES.REAR_CAMERA
  },

  // Surround view camera
  {
    patterns: [
      /surround\s*(?:view)?\s*camera/gi,
      /360\s*(?:degree)?\s*camera/gi,
      /around\s*view\s*(?:monitor)?\s*camera/gi,
      /bird(?:'?s?)?\s*eye\s*camera/gi
    ],
    category: REPAIR_CATEGORIES.SURROUND_CAMERA
  },

  // Front radar
  {
    patterns: [
      /(?:front|forward|fwd)\s*radar/gi,
      /(?:acc|adaptive\s*cruise)\s*(?:radar|sensor)/gi,
      /radar\s*(?:sensor|unit|module)\s*(?:front)?/gi,
      /distance\s*sensor\s*(?:front)?/gi,
      /millimeter\s*wave\s*radar/gi
    ],
    category: REPAIR_CATEGORIES.FRONT_RADAR
  },

  // Rear radar
  {
    patterns: [
      /(?:rear|back)\s*radar/gi,
      /rear\s*(?:cross[\s-]?traffic|rcta)\s*(?:radar|sensor)/gi
    ],
    category: REPAIR_CATEGORIES.REAR_RADAR
  },

  // BSM sensor
  {
    patterns: [
      /blind\s*spot\s*(?:monitor|sensor|radar|module)/gi,
      /bsm\s*(?:sensor|module|radar)/gi,
      /blis\s*(?:sensor|module)/gi,
      /side\s*(?:object\s*)?(?:radar|sensor)/gi,
      /lane\s*change\s*(?:assist|warning)\s*sensor/gi
    ],
    category: REPAIR_CATEGORIES.BSM_SENSOR
  },

  // Front parking sensors
  {
    patterns: [
      /(?:front|fr)\s*(?:parking|park)\s*(?:sensor|aid)/gi,
      /(?:front|fr)\s*ultrasonic\s*sensor/gi,
      /(?:front|fr)\s*(?:sonar|proximity)\s*sensor/gi
    ],
    category: REPAIR_CATEGORIES.PARKING_SENSOR_FRONT
  },

  // Rear parking sensors
  {
    patterns: [
      /(?:rear|rr|back)\s*(?:parking|park)\s*(?:sensor|aid)/gi,
      /(?:rear|rr|back)\s*ultrasonic\s*sensor/gi,
      /(?:rear|rr|back)\s*(?:sonar|proximity)\s*sensor/gi,
      /back(?:up)?\s*(?:sonar|sensor)/gi
    ],
    category: REPAIR_CATEGORIES.PARKING_SENSOR_REAR
  },

  // Steering column
  {
    patterns: [
      /steering\s*column/gi,
      /column\s*(?:assy|assembly)/gi
    ],
    category: REPAIR_CATEGORIES.STEERING_COLUMN
  },

  // Steering gear
  {
    patterns: [
      /steering\s*(?:gear|rack)/gi,
      /power\s*steering\s*(?:gear|rack|unit)/gi,
      /eps\s*(?:unit|module)/gi
    ],
    category: REPAIR_CATEGORIES.STEERING_GEAR
  },

  // Steering wheel
  {
    patterns: [
      /steering\s*wheel/gi
    ],
    category: REPAIR_CATEGORIES.STEERING_WHEEL
  },

  // Wheel alignment
  {
    patterns: [
      /(?:4[\s-]?wheel\s*)?align(?:ment)?/gi,
      /wheel\s*align/gi,
      /front\s*(?:end\s*)?align/gi
    ],
    category: REPAIR_CATEGORIES.WHEEL_ALIGNMENT
  },

  // Suspension components
  {
    patterns: [
      /(?:front\s*)?strut/gi,
      /(?:front\s*)?shock\s*(?:absorber)?/gi,
      /(?:front\s*)?spring/gi,
      /(?:front\s*)?(?:control|suspension)\s*arm/gi,
      /(?:front\s*)?knuckle/gi
    ],
    category: REPAIR_CATEGORIES.SUSPENSION_FRONT,
    contextCheck: (line) => !/(rear|rr|back)/i.test(line)
  },

  {
    patterns: [
      /(?:rear|rr)\s*strut/gi,
      /(?:rear|rr)\s*shock/gi,
      /(?:rear|rr)\s*spring/gi,
      /(?:rear|rr)\s*(?:control|suspension)\s*arm/gi,
      /(?:rear|rr)\s*knuckle/gi
    ],
    category: REPAIR_CATEGORIES.SUSPENSION_REAR
  },

  // Subframe
  {
    patterns: [
      /subframe/gi,
      /sub[\s-]?frame/gi,
      /crossmember/gi,
      /engine\s*cradle/gi
    ],
    category: REPAIR_CATEGORIES.SUBFRAME
  },

  // Modules
  {
    patterns: [
      /adas\s*(?:module|control|ecu)/gi,
      /sensing\s*(?:module|control)/gi
    ],
    category: REPAIR_CATEGORIES.MODULE_ADAS
  },

  {
    patterns: [
      /abs\s*(?:module|control|unit)/gi,
      /anti[\s-]?lock\s*(?:brake\s*)?(?:module|unit)/gi
    ],
    category: REPAIR_CATEGORIES.MODULE_ABS
  },

  {
    patterns: [
      /(?:sas|steering\s*angle)\s*(?:sensor|module)/gi
    ],
    category: REPAIR_CATEGORIES.MODULE_SAS
  },

  {
    patterns: [
      /(?:eps|electric\s*power\s*steering)\s*(?:module|unit)/gi
    ],
    category: REPAIR_CATEGORIES.MODULE_EPS
  },

  {
    patterns: [
      /ipma\s*(?:module)?/gi,
      /image\s*processing\s*module/gi
    ],
    category: REPAIR_CATEGORIES.MODULE_IPMA
  },

  {
    patterns: [
      /bcm\s*(?:module)?/gi,
      /body\s*control\s*module/gi
    ],
    category: REPAIR_CATEGORIES.MODULE_BCM
  },

  // Airbag deployment indicator
  {
    patterns: [
      /airbag\s*(?:deployed|deployment|module)/gi,
      /srs\s*(?:deployed|module)/gi,
      /restraint\s*(?:deployed|module)/gi,
      /inflat(?:or|ed)/gi
    ],
    category: REPAIR_CATEGORIES.AIRBAG_DEPLOYMENT
  }
];

/**
 * Lines to IGNORE - these are not physical repair operations
 */
const IGNORE_PATTERNS = [
  // Diagnostic/scan lines
  /(?:pre|post)[\s-]?scan/gi,
  /diagnostic\s*(?:scan|check|test)/gi,
  /scan\s*(?:tool|system)/gi,
  /dtc\s*(?:check|clear|read)/gi,
  /health\s*check/gi,

  // Labor-only lines
  /labor\s*(?:only|charge)/gi,
  /misc(?:ellaneous)?\s*(?:labor|charge)/gi,

  // Notes/disclaimers
  /^note[:\s]/gi,
  /^disclaimer/gi,
  /^caution/gi,
  /^warning/gi,
  /customer\s*(?:states|says)/gi,

  // Estimates metadata
  /estimate\s*(?:date|total|subtotal)/gi,
  /repair\s*order/gi,
  /claim\s*(?:number|#)/gi,
  /insur(?:ance|er)/gi,
  /deductible/gi,

  // Shop info
  /body\s*shop/gi,
  /shop\s*(?:name|address)/gi,
  /technician/gi,

  // Totals
  /^total/gi,
  /^subtotal/gi,
  /^parts\s*total/gi,
  /^labor\s*total/gi,

  // Calibration lines (these are output, not triggers)
  /calibration\s*(?:required|needed|recommended)/gi,
  /needs?\s*calibration/gi
];

/**
 * Extract location indicator from line (left/right/front/rear)
 * @param {string} line - Estimate line
 * @returns {Object} - { side: 'left'|'right'|null, position: 'front'|'rear'|null }
 */
function extractLocation(line) {
  const location = {
    side: null,
    position: null
  };

  // Check for left/right
  if (/(?:left|lt|lh|driver)/i.test(line)) {
    location.side = 'left';
  } else if (/(?:right|rt|rh|passenger)/i.test(line)) {
    location.side = 'right';
  }

  // Check for front/rear
  if (/(?:front|fr|frt|fwd)/i.test(line)) {
    location.position = 'front';
  } else if (/(?:rear|rr|back)/i.test(line)) {
    location.position = 'rear';
  }

  return location;
}

/**
 * Extract line number from estimate line
 * @param {string} line - Estimate line
 * @returns {number|null} - Line number or null
 */
function extractLineNumber(line) {
  // Common formats: "Line 2", "#2", "(2)", "2.", "2)"
  const patterns = [
    /^(?:line\s*)?#?(\d+)[.:)\s]/i,
    /^\s*(\d+)\s*[.):]/,
    /\bline\s*(\d+)\b/i
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * Extract part number from estimate line
 * @param {string} line - Estimate line
 * @returns {string|null} - Part number or null
 */
function extractPartNumber(line) {
  // Common part number formats
  const patterns = [
    /(?:part|p\/n|pn)[:\s#]*([A-Z0-9][\w\-]{4,})/i,
    /\b([A-Z]{1,3}[\d]{4,}[\w\-]*)\b/,
    /\b(\d{8,})\b/ // Long numeric part numbers
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Check if a line should be ignored
 * @param {string} line - Estimate line
 * @returns {boolean}
 */
function shouldIgnoreLine(line) {
  if (!line || line.trim().length < 3) {
    return true;
  }

  for (const pattern of IGNORE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(line)) {
      return true;
    }
  }

  return false;
}

/**
 * Detect operation type from estimate line
 * @param {string} line - Estimate line
 * @returns {string} - Operation type from OPERATION_TYPES
 */
function detectOperationType(line) {
  for (const { pattern, type } of OPERATION_TYPE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(line)) {
      return type;
    }
  }

  // Default to unknown if no operation type detected
  return null;
}

/**
 * Detect component category from estimate line
 * @param {string} line - Estimate line
 * @returns {Object} - { category: string, matchedPattern: string }
 */
function detectComponentCategory(line) {
  // First pass: specific patterns (non-fallback)
  for (const componentDef of COMPONENT_PATTERNS) {
    if (componentDef.fallbackOnly) continue;

    for (const pattern of componentDef.patterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        // Check context if required
        if (componentDef.contextCheck && !componentDef.contextCheck(line)) {
          continue;
        }
        return {
          category: componentDef.category,
          matchedText: match[0]
        };
      }
    }
  }

  // Second pass: fallback patterns
  for (const componentDef of COMPONENT_PATTERNS) {
    if (!componentDef.fallbackOnly) continue;

    for (const pattern of componentDef.patterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        return {
          category: componentDef.category,
          matchedText: match[0]
        };
      }
    }
  }

  return {
    category: REPAIR_CATEGORIES.UNKNOWN,
    matchedText: null
  };
}

/**
 * Parse a single estimate line into structured repair operation
 * @param {string} line - Raw estimate line
 * @param {number} lineIndex - Index in the estimate
 * @returns {Object|null} - Parsed repair line or null if should be ignored
 */
export function parseEstimateLine(line, lineIndex = 0) {
  if (shouldIgnoreLine(line)) {
    return null;
  }

  const operationType = detectOperationType(line);
  const { category, matchedText } = detectComponentCategory(line);

  // Skip if we can't identify either the operation or the component
  if (!operationType && category === REPAIR_CATEGORIES.UNKNOWN) {
    return null;
  }

  const location = extractLocation(line);
  const lineNumber = extractLineNumber(line) || lineIndex + 1;
  const partNumber = extractPartNumber(line);

  return {
    lineNumber,
    rawText: line.trim(),
    operation: operationType || OPERATION_TYPES.REPAIR, // Default to repair if not specified
    component: {
      category,
      matchedText,
      rawDescription: line.replace(/^[\d\s.):]+/, '').trim().substring(0, 80)
    },
    location,
    partNumber,
    estimateIndex: lineIndex
  };
}

/**
 * Parse entire estimate text into structured repair operations
 * @param {string} estimateText - Full estimate text
 * @returns {Object} - Parsed estimate with repair lines
 */
export function parseEstimate(estimateText) {
  if (!estimateText || typeof estimateText !== 'string') {
    return {
      repairLines: [],
      ignoredLines: [],
      metadata: {
        parseTimestamp: new Date().toISOString(),
        totalLines: 0,
        parsedLines: 0,
        ignoredLines: 0
      }
    };
  }

  const lines = estimateText.split('\n');
  const repairLines = [];
  const ignoredLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseEstimateLine(line, i);

    if (parsed) {
      repairLines.push(parsed);
    } else if (line.trim().length > 0) {
      // Track ignored lines for debugging
      ignoredLines.push({
        lineIndex: i,
        content: line.trim().substring(0, 100)
      });
    }
  }

  // Deduplicate by category + operation type
  const seen = new Set();
  const deduplicatedLines = repairLines.filter(line => {
    const key = `${line.component.category}:${line.operation}:${line.location.side || ''}:${line.location.position || ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return {
    repairLines: deduplicatedLines,
    ignoredLines,
    metadata: {
      parseTimestamp: new Date().toISOString(),
      totalLines: lines.length,
      parsedLines: deduplicatedLines.length,
      ignoredLines: ignoredLines.length
    }
  };
}

/**
 * Extract vehicle information from estimate text
 * @param {string} estimateText - Full estimate text
 * @returns {Object} - Vehicle information
 */
export function extractVehicleInfo(estimateText) {
  if (!estimateText) return null;

  const vehicle = {
    year: null,
    make: null,
    model: null,
    vin: null
  };

  // Extract VIN (17 characters, alphanumeric except I, O, Q)
  const vinMatch = estimateText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  if (vinMatch) {
    vehicle.vin = vinMatch[1].toUpperCase();
  }

  // Extract year (4 digit number between 1990 and current year + 2)
  const currentYear = new Date().getFullYear();
  const yearMatch = estimateText.match(/\b(19[9][0-9]|20[0-2][0-9]|203[0-5])\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 1990 && year <= currentYear + 2) {
      vehicle.year = year;
    }
  }

  // Common makes to look for
  const makes = [
    'Toyota', 'Lexus', 'Honda', 'Acura', 'Nissan', 'Infiniti', 'Subaru', 'Mazda',
    'BMW', 'Mercedes-Benz', 'Mercedes', 'Audi', 'Volkswagen', 'Porsche',
    'Ford', 'Lincoln', 'Chevrolet', 'GMC', 'Buick', 'Cadillac',
    'Chrysler', 'Dodge', 'Jeep', 'Ram',
    'Hyundai', 'Kia', 'Genesis',
    'Volvo', 'Tesla', 'Rivian',
    'Mitsubishi', 'Mini', 'Land Rover', 'Jaguar'
  ];

  for (const make of makes) {
    const makePattern = new RegExp(`\\b${make}\\b`, 'i');
    if (makePattern.test(estimateText)) {
      vehicle.make = make === 'Mercedes' ? 'Mercedes-Benz' : make;
      break;
    }
  }

  return vehicle;
}

/**
 * Check if estimate mentions any specific ADAS features in notes
 * @param {string} estimateText - Full estimate text
 * @returns {Array} - Array of mentioned ADAS features
 */
export function extractMentionedADASFeatures(estimateText) {
  if (!estimateText) return [];

  const features = [];
  const featurePatterns = [
    { pattern: /(?:with|w\/|has|equipped)\s*(?:surround|360)\s*view/gi, feature: 'surround_view' },
    { pattern: /(?:with|w\/|has|equipped)\s*(?:blind\s*spot|bsm|blis)/gi, feature: 'blind_spot_monitor' },
    { pattern: /(?:with|w\/|has|equipped)\s*(?:front|forward)\s*(?:camera|sensing)/gi, feature: 'front_camera' },
    { pattern: /(?:with|w\/|has|equipped)\s*(?:adaptive\s*cruise|acc|radar)/gi, feature: 'front_radar' },
    { pattern: /(?:with|w\/|has|equipped)\s*(?:lane\s*(?:keep|departure)|lka|ldw)/gi, feature: 'lane_assist' },
    { pattern: /(?:with|w\/|has|equipped)\s*(?:parking\s*(?:sensor|aid|assist))/gi, feature: 'parking_sensors' },
    { pattern: /(?:with|w\/|has|equipped)\s*(?:backup|rear|reverse)\s*camera/gi, feature: 'rear_camera' },
    { pattern: /eyesight/gi, feature: 'eyesight' },
    { pattern: /honda\s*sensing/gi, feature: 'honda_sensing' },
    { pattern: /toyota\s*safety\s*sense|tss/gi, feature: 'toyota_safety_sense' },
    { pattern: /nissan\s*(?:safety\s*shield|intelligent\s*mobility)/gi, feature: 'nissan_safety' },
    { pattern: /lanewatch/gi, feature: 'lanewatch' },
    { pattern: /distronic/gi, feature: 'distronic' },
    { pattern: /co[\s-]?pilot\s*360/gi, feature: 'copilot360' }
  ];

  for (const { pattern, feature } of featurePatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(estimateText)) {
      if (!features.includes(feature)) {
        features.push(feature);
      }
    }
  }

  return features;
}

/**
 * Get summary of repair categories found in estimate
 * @param {Object} parsedEstimate - Output from parseEstimate()
 * @returns {Object} - Summary by category
 */
export function getRepairSummary(parsedEstimate) {
  const summary = {
    totalOperations: parsedEstimate.repairLines.length,
    byCategory: {},
    byOperation: {},
    locations: {
      front: 0,
      rear: 0,
      left: 0,
      right: 0
    }
  };

  for (const line of parsedEstimate.repairLines) {
    // Count by category
    const cat = line.component.category;
    summary.byCategory[cat] = (summary.byCategory[cat] || 0) + 1;

    // Count by operation type
    const op = line.operation;
    summary.byOperation[op] = (summary.byOperation[op] || 0) + 1;

    // Count by location
    if (line.location.position === 'front') summary.locations.front++;
    if (line.location.position === 'rear') summary.locations.rear++;
    if (line.location.side === 'left') summary.locations.left++;
    if (line.location.side === 'right') summary.locations.right++;
  }

  return summary;
}

export default {
  parseEstimate,
  parseEstimateLine,
  extractVehicleInfo,
  extractMentionedADASFeatures,
  getRepairSummary,
  REPAIR_CATEGORIES,
  OPERATION_TYPES
};
