/**
 * vehicleEquipment.js - Vehicle Equipment Verification Module
 *
 * This module verifies what ADAS equipment a vehicle actually has.
 * Calibrations should ONLY be flagged if:
 * 1. A repair operation triggers it, AND
 * 2. The vehicle is confirmed to have that system
 *
 * Sources of equipment data:
 * - VIN decode (basic features)
 * - RevvADAS report (most accurate)
 * - Estimate notes (mentions of equipment)
 * - OEM knowledge base (standard/optional equipment by model)
 */

import { normalizeBrand } from '../../utils/oem/parser.js';
import { loadADASCalibrationDataset } from '../../utils/oem/loader.js';

const LOG_TAG = '[VEHICLE_EQUIPMENT]';

/**
 * VIN WMI (World Manufacturer Identifier) to Brand mapping
 * First 3 characters of VIN identify manufacturer
 */
const VIN_WMI_TO_BRAND = {
  // German manufacturers
  'WBA': 'BMW', 'WBS': 'BMW', 'WBY': 'BMW', '5UX': 'BMW', '5YM': 'BMW',
  'WAU': 'Audi', 'WUA': 'Audi', 'WA1': 'Audi',
  'WVW': 'Volkswagen', 'WV1': 'Volkswagen', 'WV2': 'Volkswagen', '3VW': 'Volkswagen',
  'WP0': 'Porsche', 'WP1': 'Porsche',

  // Mercedes-Benz
  'WDB': 'Mercedes-Benz', 'WDC': 'Mercedes-Benz', 'WDD': 'Mercedes-Benz',
  'WDF': 'Mercedes-Benz', 'W1K': 'Mercedes-Benz', 'W1N': 'Mercedes-Benz',
  'W1V': 'Mercedes-Benz', '4JG': 'Mercedes-Benz', '55S': 'Mercedes-Benz',

  // Japanese manufacturers - Toyota/Lexus
  'JTD': 'Lexus', 'JTH': 'Lexus', 'JTJ': 'Lexus', '2T2': 'Lexus',
  'JT': 'Toyota', '2T1': 'Toyota', '4T1': 'Toyota', '5TD': 'Toyota',
  'JTE': 'Toyota', 'JTN': 'Toyota', '3TM': 'Toyota', '5TF': 'Toyota',

  // Honda / Acura
  'JHM': 'Honda', '1HG': 'Honda', '2HG': 'Honda', '5FN': 'Honda', '5J6': 'Honda',
  '19U': 'Acura', 'JH4': 'Acura', '19V': 'Acura',

  // Nissan / Infiniti
  'JN1': 'Nissan', 'JN8': 'Nissan', '1N4': 'Nissan', '3N1': 'Nissan', '5N1': 'Nissan',
  'JNK': 'Infiniti', '5N3': 'Infiniti',

  // Subaru
  'JF1': 'Subaru', 'JF2': 'Subaru', '4S3': 'Subaru', '4S4': 'Subaru',

  // Mazda
  'JM1': 'Mazda', 'JM3': 'Mazda', '3MZ': 'Mazda',

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

  // Volvo
  'YV1': 'Volvo', 'YV4': 'Volvo',

  // Tesla
  '5YJ': 'Tesla', '7SA': 'Tesla',

  // Mitsubishi
  'JA3': 'Mitsubishi', 'JA4': 'Mitsubishi', '4A3': 'Mitsubishi',

  // Mini
  'WMW': 'MINI'
};

/**
 * VIN position 10 - Model Year codes
 */
const VIN_YEAR_CODES = {
  'A': 2010, 'B': 2011, 'C': 2012, 'D': 2013, 'E': 2014,
  'F': 2015, 'G': 2016, 'H': 2017, 'J': 2018, 'K': 2019,
  'L': 2020, 'M': 2021, 'N': 2022, 'P': 2023, 'R': 2024,
  'S': 2025, 'T': 2026, 'V': 2027, 'W': 2028, 'X': 2029,
  'Y': 2030,
  // Pre-2010 codes
  '1': 2001, '2': 2002, '3': 2003, '4': 2004, '5': 2005,
  '6': 2006, '7': 2007, '8': 2008, '9': 2009
};

/**
 * ADAS feature introduction years by brand
 * This helps determine what systems a vehicle COULD have based on year
 */
const ADAS_FEATURE_YEARS = {
  'Toyota': {
    'front_camera': 2015,     // TSS-P/TSS-C
    'front_radar': 2015,
    'blind_spot_monitor': 2011,
    'rear_camera': 2012,      // Mandatory US 2018+
    'parking_sensors': 2010
  },
  'Honda': {
    'front_camera': 2015,     // Honda Sensing
    'front_radar': 2015,
    'blind_spot_monitor': 2013,
    'lanewatch': 2014,        // Honda LaneWatch (passenger mirror camera)
    'rear_camera': 2012,
    'parking_sensors': 2010
  },
  'Nissan': {
    'front_camera': 2017,     // ProPilot Assist
    'front_radar': 2017,
    'around_view': 2008,      // Around View Monitor
    'blind_spot_monitor': 2011,
    'rear_camera': 2012
  },
  'Subaru': {
    'eyesight': 2013,         // EyeSight cameras
    'front_radar': 2019,      // Added to some models
    'blind_spot_monitor': 2015,
    'rear_camera': 2012
  },
  'BMW': {
    'front_camera': 2014,     // KAFAS
    'front_radar': 2009,      // ACC
    'surround_view': 2012,
    'blind_spot_monitor': 2010,
    'parking_sensors': 2005
  },
  'Mercedes-Benz': {
    'front_camera': 2013,
    'front_radar': 2006,      // DISTRONIC
    'surround_view': 2011,    // 360 camera
    'blind_spot_monitor': 2007,
    'parking_sensors': 2000,
    'airmatic': 2000          // Air suspension
  },
  'Ford': {
    'front_camera': 2017,     // Co-Pilot360
    'front_radar': 2017,
    'surround_view': 2015,    // 360 camera
    'blind_spot_monitor': 2010,
    'parking_sensors': 2008
  },
  'default': {
    'front_camera': 2016,
    'front_radar': 2016,
    'blind_spot_monitor': 2013,
    'rear_camera': 2014,      // Mandatory US May 2018
    'parking_sensors': 2012
  }
};

/**
 * Decode VIN to extract basic vehicle information
 * @param {string} vin - 17-character VIN
 * @returns {Object} - Decoded vehicle info
 */
export function decodeVIN(vin) {
  if (!vin || vin.length !== 17) {
    return null;
  }

  const upperVin = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  if (upperVin.length !== 17) {
    return null;
  }

  // Get WMI (first 3 characters)
  const wmi3 = upperVin.substring(0, 3);
  const wmi2 = upperVin.substring(0, 2);

  // Determine brand
  let brand = VIN_WMI_TO_BRAND[wmi3] || VIN_WMI_TO_BRAND[wmi2] || null;

  // Get model year from position 10
  const yearCode = upperVin.charAt(9);
  const year = VIN_YEAR_CODES[yearCode] || null;

  return {
    vin: upperVin,
    brand,
    year,
    wmi: wmi3,
    vds: upperVin.substring(3, 9),  // Vehicle Descriptor Section
    vis: upperVin.substring(9)       // Vehicle Identifier Section
  };
}

/**
 * Get standard ADAS systems for a brand/year combination
 * Based on when features became standard or common
 * @param {string} brand - Vehicle brand
 * @param {number} year - Model year
 * @returns {Object} - Standard and optional ADAS systems
 */
export function getExpectedADASByBrandYear(brand, year) {
  const normalizedBrand = normalizeBrand(brand);
  const featureYears = ADAS_FEATURE_YEARS[normalizedBrand] || ADAS_FEATURE_YEARS['default'];

  const systems = {
    standard: [],
    likely: [],
    optional: [],
    impossible: []
  };

  // Check each feature against introduction year
  for (const [feature, introYear] of Object.entries(featureYears)) {
    if (year < introYear) {
      systems.impossible.push(feature);
    } else if (year >= introYear + 3) {
      // Features typically become standard ~3 years after introduction
      systems.likely.push(feature);
    } else {
      systems.optional.push(feature);
    }
  }

  // Rear camera is mandatory in US for vehicles manufactured after May 1, 2018
  if (year >= 2019) {
    if (!systems.standard.includes('rear_camera')) {
      systems.standard.push('rear_camera');
    }
  }

  return systems;
}

/**
 * Parse equipment list from RevvADAS report text
 * @param {string} revvText - Raw RevvADAS report text
 * @returns {Array} - Array of detected ADAS systems
 */
export function parseRevvEquipment(revvText) {
  if (!revvText || typeof revvText !== 'string') {
    return [];
  }

  const equipment = [];

  // Patterns to detect ADAS systems from RevvADAS output
  const patterns = [
    { pattern: /(?:front|forward)\s*camera/gi, system: 'front_camera' },
    { pattern: /windshield\s*camera/gi, system: 'front_camera' },
    { pattern: /lane\s*(?:departure|keep)/gi, system: 'front_camera' },
    { pattern: /(?:adaptive|acc)\s*(?:cruise|radar)/gi, system: 'front_radar' },
    { pattern: /(?:front|forward)\s*radar/gi, system: 'front_radar' },
    { pattern: /millimeter[\s-]?wave/gi, system: 'front_radar' },
    { pattern: /distronic/gi, system: 'front_radar' },
    { pattern: /blind\s*spot/gi, system: 'blind_spot_monitor' },
    { pattern: /bsm|blis/gi, system: 'blind_spot_monitor' },
    { pattern: /rear\s*(?:cross[\s-]?traffic|radar)/gi, system: 'rear_radar' },
    { pattern: /rcta/gi, system: 'rear_radar' },
    { pattern: /(?:surround|360|around)\s*view/gi, system: 'surround_view' },
    { pattern: /(?:rear|backup|reverse)\s*camera/gi, system: 'rear_camera' },
    { pattern: /(?:front|rear)\s*(?:parking|park)\s*(?:sensor|aid)/gi, system: 'parking_sensors' },
    { pattern: /ultrasonic\s*sensor/gi, system: 'parking_sensors' },
    { pattern: /eyesight/gi, system: 'eyesight' },
    { pattern: /lanewatch/gi, system: 'lanewatch' },
    { pattern: /steering\s*angle\s*sensor|sas\b/gi, system: 'steering_angle_sensor' },
    { pattern: /(?:adaptive|auto[\s-]?leveling)\s*headl/gi, system: 'adaptive_headlamps' },
    { pattern: /afs\b/gi, system: 'adaptive_headlamps' },
    { pattern: /air(?:matic)?\s*(?:suspension|ride)/gi, system: 'air_suspension' }
  ];

  const found = new Set();

  for (const { pattern, system } of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(revvText)) {
      found.add(system);
    }
  }

  return Array.from(found);
}

/**
 * Merge equipment from multiple sources
 * @param {Object} sources - Equipment from different sources
 * @returns {Object} - Merged equipment with confidence levels
 */
export function mergeEquipmentSources(sources) {
  const {
    fromVIN = [],           // From VIN decode (lowest confidence)
    fromRevv = [],          // From RevvADAS report (highest confidence)
    fromEstimate = [],      // From estimate notes
    fromBrandYear = null    // From getExpectedADASByBrandYear
  } = sources;

  const equipment = {
    confirmed: [],          // Confirmed by RevvADAS or explicit mention
    likely: [],             // Likely based on brand/year
    possible: [],           // Possible but unconfirmed
    verificationNeeded: []  // Triggers calibration but unverified
  };

  // RevvADAS is the gold standard
  for (const sys of fromRevv) {
    if (!equipment.confirmed.includes(sys)) {
      equipment.confirmed.push(sys);
    }
  }

  // Estimate notes are high confidence
  for (const sys of fromEstimate) {
    if (!equipment.confirmed.includes(sys)) {
      equipment.confirmed.push(sys);
    }
  }

  // Brand/year expectations
  if (fromBrandYear) {
    for (const sys of fromBrandYear.standard || []) {
      if (!equipment.confirmed.includes(sys) && !equipment.likely.includes(sys)) {
        equipment.likely.push(sys);
      }
    }
    for (const sys of fromBrandYear.likely || []) {
      if (!equipment.confirmed.includes(sys) && !equipment.likely.includes(sys)) {
        equipment.likely.push(sys);
      }
    }
    for (const sys of fromBrandYear.optional || []) {
      if (!equipment.confirmed.includes(sys) &&
          !equipment.likely.includes(sys) &&
          !equipment.possible.includes(sys)) {
        equipment.possible.push(sys);
      }
    }
  }

  return equipment;
}

/**
 * Check if vehicle has a specific ADAS system
 * @param {Object} equipment - Equipment object from mergeEquipmentSources
 * @param {string} system - System to check
 * @returns {Object} - { hasSystem: boolean, confidence: string, source: string }
 */
export function checkVehicleHasSystem(equipment, system) {
  // Normalize system name for matching
  const normalizedSystem = system.toLowerCase().replace(/[\s\-_]/g, '');

  // Check confirmed systems
  if (equipment.confirmed?.some(s =>
      s.toLowerCase().replace(/[\s\-_]/g, '').includes(normalizedSystem) ||
      normalizedSystem.includes(s.toLowerCase().replace(/[\s\-_]/g, '')))) {
    return {
      hasSystem: true,
      confidence: 'HIGH',
      source: 'RevvADAS/Estimate'
    };
  }

  // Check likely systems
  if (equipment.likely?.some(s =>
      s.toLowerCase().replace(/[\s\-_]/g, '').includes(normalizedSystem) ||
      normalizedSystem.includes(s.toLowerCase().replace(/[\s\-_]/g, '')))) {
    return {
      hasSystem: true,
      confidence: 'MEDIUM',
      source: 'Brand/Year Standard'
    };
  }

  // Check possible systems
  if (equipment.possible?.some(s =>
      s.toLowerCase().replace(/[\s\-_]/g, '').includes(normalizedSystem) ||
      normalizedSystem.includes(s.toLowerCase().replace(/[\s\-_]/g, '')))) {
    return {
      hasSystem: null, // Unknown
      confidence: 'LOW',
      source: 'Optional Equipment'
    };
  }

  return {
    hasSystem: false,
    confidence: 'HIGH',
    source: 'Not Listed'
  };
}

/**
 * Build complete vehicle equipment profile
 * @param {Object} params
 * @param {string} params.vin - Vehicle VIN
 * @param {string} params.brand - Vehicle brand (if known)
 * @param {number} params.year - Model year (if known)
 * @param {string} params.revvText - RevvADAS report text
 * @param {Array} params.estimateFeatures - ADAS features from estimate notes
 * @returns {Object} - Complete equipment profile
 */
export function buildEquipmentProfile({
  vin,
  brand,
  year,
  revvText,
  estimateFeatures = []
}) {
  // Decode VIN if provided
  const vinDecode = vin ? decodeVIN(vin) : null;

  // Use VIN-derived info as fallback
  const effectiveBrand = brand || vinDecode?.brand;
  const effectiveYear = year || vinDecode?.year;

  // Get expected equipment by brand/year
  const brandYearEquipment = (effectiveBrand && effectiveYear)
    ? getExpectedADASByBrandYear(effectiveBrand, effectiveYear)
    : null;

  // Parse RevvADAS equipment
  const revvEquipment = parseRevvEquipment(revvText);

  // Merge all sources
  const mergedEquipment = mergeEquipmentSources({
    fromVIN: [],
    fromRevv: revvEquipment,
    fromEstimate: estimateFeatures,
    fromBrandYear: brandYearEquipment
  });

  return {
    vehicle: {
      vin: vin || null,
      brand: effectiveBrand,
      year: effectiveYear,
      decoded: vinDecode
    },
    equipment: mergedEquipment,
    summary: {
      confirmedSystems: mergedEquipment.confirmed.length,
      likelySystems: mergedEquipment.likely.length,
      possibleSystems: mergedEquipment.possible.length
    },
    sources: {
      hasVIN: !!vin,
      hasRevvData: revvEquipment.length > 0,
      hasEstimateNotes: estimateFeatures.length > 0,
      hasBrandYearData: !!brandYearEquipment
    }
  };
}

/**
 * Verify if a calibration should be flagged based on equipment
 * @param {Object} equipmentProfile - From buildEquipmentProfile
 * @param {string} calibrationSystem - System that needs calibration
 * @returns {Object} - Verification result
 */
export function verifyCalibrationNeeded(equipmentProfile, calibrationSystem) {
  const systemCheck = checkVehicleHasSystem(equipmentProfile.equipment, calibrationSystem);

  return {
    calibrationSystem,
    shouldFlag: systemCheck.hasSystem === true,
    needsVerification: systemCheck.hasSystem === null,
    confidence: systemCheck.confidence,
    source: systemCheck.source,
    reason: systemCheck.hasSystem === true
      ? `Vehicle confirmed to have ${calibrationSystem}`
      : systemCheck.hasSystem === null
        ? `Vehicle MAY have ${calibrationSystem} - verify before billing`
        : `Vehicle does NOT appear to have ${calibrationSystem}`
  };
}

export default {
  decodeVIN,
  getExpectedADASByBrandYear,
  parseRevvEquipment,
  mergeEquipmentSources,
  checkVehicleHasSystem,
  buildEquipmentProfile,
  verifyCalibrationNeeded
};
