/**
 * OEM Knowledge Base - Parser & Normalizer
 *
 * Provides data transformation, normalization, and extraction
 * utilities for OEM knowledge data.
 */

import {
  loadOEMMasterTable,
  loadADASCalibrationDataset,
  loadLegalDataset,
  loadThirdPartyPlatforms,
  loadADAS_EquipmentProviders,
  loadDownloadPlan
} from './loader.js';

const LOG_TAG = '[OEM_PARSER]';

// Brand name aliases for normalization
const BRAND_ALIASES = {
  // Toyota group
  'toyota': 'Toyota',
  'lexus': 'Lexus',
  'scion': 'Toyota',

  // Honda group
  'honda': 'Honda',
  'acura': 'Acura',

  // Nissan group
  'nissan': 'Nissan',
  'infiniti': 'Infiniti',

  // Subaru
  'subaru': 'Subaru',

  // Mazda
  'mazda': 'Mazda',

  // Mitsubishi
  'mitsubishi': 'Mitsubishi',

  // VW group
  'volkswagen': 'Volkswagen',
  'vw': 'Volkswagen',
  'audi': 'Audi',
  'porsche': 'Porsche',
  'bentley': 'Bentley',
  'lamborghini': 'Lamborghini',

  // BMW group
  'bmw': 'BMW',
  'mini': 'MINI',
  'rolls-royce': 'Rolls-Royce',
  'rolls royce': 'Rolls-Royce',

  // Mercedes
  'mercedes-benz': 'Mercedes-Benz',
  'mercedes': 'Mercedes-Benz',
  'mb': 'Mercedes-Benz',

  // GM group
  'gm': 'GM',
  'general motors': 'GM',
  'chevrolet': 'Chevrolet',
  'chevy': 'Chevrolet',
  'buick': 'Buick',
  'gmc': 'GMC',
  'cadillac': 'Cadillac',

  // Ford group
  'ford': 'Ford',
  'lincoln': 'Lincoln',

  // Stellantis
  'stellantis': 'Stellantis',
  'chrysler': 'Chrysler',
  'dodge': 'Dodge',
  'jeep': 'Jeep',
  'ram': 'Ram',
  'alfa romeo': 'Alfa Romeo',
  'alfa': 'Alfa Romeo',
  'fiat': 'Fiat',
  'maserati': 'Maserati',

  // Hyundai group
  'hyundai': 'Hyundai',
  'kia': 'Kia',
  'genesis': 'Genesis',

  // Volvo
  'volvo': 'Volvo',
  'polestar': 'Polestar',

  // JLR
  'jaguar': 'Jaguar',
  'land rover': 'Land Rover',
  'landrover': 'Land Rover',
  'jlr': 'Jaguar Land Rover',
  'jaguar land rover': 'Jaguar Land Rover',

  // EV makers
  'tesla': 'Tesla',
  'rivian': 'Rivian',
  'lucid': 'Lucid',
  'vinfast': 'VinFast',

  // European
  'renault': 'Renault',
  'peugeot': 'Peugeot',
  'citroen': 'Citroen',
  'ferrari': 'Ferrari',
  'mclaren': 'McLaren',
  'aston martin': 'Aston Martin',
  'lotus': 'Lotus'
};

// System type codes
const SYSTEM_CODES = {
  'FCAM': 'Forward Camera',
  'FRR': 'Front Radar',
  'RRR': 'Rear Radar',
  'BSM': 'Blind Spot Monitor',
  'MWR': 'Millimeter Wave Radar',
  'AVM': 'Around View Monitor',
  'SAS': 'Steering Angle Sensor',
  'ESC': 'EyeSight Camera',
  'ACC': 'Adaptive Cruise Control',
  'DTR': 'DISTRONIC Radar',
  'LIDAR': 'LiDAR',
  'MPC': 'Multipurpose Camera',
  'BSI': 'BSI Radar',
  'LWC': 'LaneWatch Camera',
  'KAFAS-M': 'KAFAS Camera MID',
  'KAFAS-H': 'KAFAS Camera HIGH',
  'FVC': 'Frontview Camera',
  'LRR': 'Long-Range Radar',
  'SRR': 'Short-Range Radar',
  'SOS': 'Side Object Sensors',
  'SVC': 'Surround Vision Cameras',
  'WSC': 'Windshield Camera',
  '360C': '360 Cameras',
  'PARK': 'Parking Sensors',
  'ASDM': 'ASDM Radar',
  'APC': 'Autopilot Cameras',
  'RADAR': 'Radar'
};

/**
 * Normalize brand name to standard format
 * @param {string} name - Brand name in any format
 * @returns {string} - Normalized brand name
 */
export function normalizeBrand(name) {
  if (!name) return '';

  const lower = name.toLowerCase().trim();
  return BRAND_ALIASES[lower] || name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/**
 * Get all valid brand names
 * @returns {string[]}
 */
export function getAllBrandNames() {
  return [...new Set(Object.values(BRAND_ALIASES))].sort();
}

/**
 * Expand system code to full name
 * @param {string} code - System code like 'FCAM'
 * @returns {string}
 */
export function expandSystemCode(code) {
  return SYSTEM_CODES[code?.toUpperCase()] || code;
}

/**
 * Extract calibrations by brand from ADAS dataset
 * @returns {Object} - { brandName: [calibration records] }
 */
export function extractCalibrationsByBrand() {
  const calibrations = loadADASCalibrationDataset();
  const byBrand = {};

  for (const cal of calibrations) {
    const brand = normalizeBrand(cal.brand);
    if (!byBrand[brand]) {
      byBrand[brand] = [];
    }
    byBrand[brand].push({
      system: cal.system_type,
      systemCode: cal.system_code,
      staticCalibration: cal.static_calibration?.toLowerCase() === 'yes',
      dynamicCalibration: cal.dynamic_calibration?.toLowerCase() === 'yes',
      targetSpecs: cal.target_specs,
      alignmentRequirements: cal.alignment_requirements,
      rideHeightRequirements: cal.ride_height_requirements,
      batteryRequirements: cal.battery_requirements,
      requiredTools: cal.required_tools?.split(';').map(t => t.trim()).filter(t => t),
      triggers: cal.calibration_triggers?.split(';').map(t => t.trim()).filter(t => t),
      dtcBlockers: cal.dtc_blockers,
      quirks: cal.special_quirks
    });
  }

  return byBrand;
}

/**
 * Extract all calibration triggers across brands
 * @returns {Object} - { trigger: [brands that require it] }
 */
export function extractTriggers() {
  const calibrations = loadADASCalibrationDataset();
  const triggers = {};

  for (const cal of calibrations) {
    const brand = normalizeBrand(cal.brand);
    const calTriggers = cal.calibration_triggers?.split(';').map(t => t.trim()).filter(t => t) || [];

    for (const trigger of calTriggers) {
      if (!triggers[trigger]) {
        triggers[trigger] = [];
      }
      if (!triggers[trigger].includes(brand)) {
        triggers[trigger].push(brand);
      }
    }
  }

  return triggers;
}

/**
 * Extract target dimensions/specs by brand
 * @returns {Object} - { brandName: { system: specs } }
 */
export function extractTargetDimensions() {
  const calibrations = loadADASCalibrationDataset();
  const specs = {};

  for (const cal of calibrations) {
    const brand = normalizeBrand(cal.brand);
    if (!specs[brand]) {
      specs[brand] = {};
    }

    if (cal.target_specs && cal.target_specs !== 'N/A') {
      specs[brand][cal.system_type] = {
        specs: cal.target_specs,
        alignment: cal.alignment_requirements,
        rideHeight: cal.ride_height_requirements
      };
    }
  }

  return specs;
}

/**
 * Extract prerequisites by brand
 * @returns {Object} - { brandName: { prerequisites: [], critical: [] } }
 */
export function extractPrerequisites() {
  const calibrations = loadADASCalibrationDataset();
  const prereqs = {};

  for (const cal of calibrations) {
    const brand = normalizeBrand(cal.brand);
    if (!prereqs[brand]) {
      prereqs[brand] = {
        alignment: null,
        rideHeight: null,
        battery: null,
        floor: null,
        criticalNotes: [],
        requiredTools: new Set()
      };
    }

    // Track alignment requirements
    if (cal.alignment_requirements && cal.alignment_requirements !== 'N/A') {
      prereqs[brand].alignment = cal.alignment_requirements;
    }

    // Track ride height
    if (cal.ride_height_requirements && cal.ride_height_requirements !== 'Standard ride height') {
      prereqs[brand].rideHeight = cal.ride_height_requirements;
    }

    // Track battery
    if (cal.battery_requirements && !cal.battery_requirements.includes('Standard')) {
      prereqs[brand].battery = cal.battery_requirements;
    }

    // Track critical quirks
    if (cal.special_quirks && cal.special_quirks !== 'None noted') {
      prereqs[brand].criticalNotes.push(cal.special_quirks);
    }

    // Track tools
    if (cal.required_tools) {
      const tools = cal.required_tools.split(';').map(t => t.trim()).filter(t => t);
      for (const tool of tools) {
        prereqs[brand].requiredTools.add(tool);
      }
    }
  }

  // Convert Sets to arrays
  for (const brand in prereqs) {
    prereqs[brand].requiredTools = Array.from(prereqs[brand].requiredTools);
    prereqs[brand].criticalNotes = [...new Set(prereqs[brand].criticalNotes)];
  }

  return prereqs;
}

/**
 * Extract quirks by brand
 * @returns {Object} - { brandName: [quirks] }
 */
export function extractQuirks() {
  const calibrations = loadADASCalibrationDataset();
  const oemData = loadOEMMasterTable();
  const quirks = {};

  // From calibration dataset
  for (const cal of calibrations) {
    const brand = normalizeBrand(cal.brand);
    if (!quirks[brand]) {
      quirks[brand] = [];
    }

    if (cal.special_quirks && cal.special_quirks !== 'None noted') {
      if (!quirks[brand].includes(cal.special_quirks)) {
        quirks[brand].push(cal.special_quirks);
      }
    }
  }

  // From OEM master table
  if (oemData?.oem_portals) {
    for (const portal of oemData.oem_portals) {
      const brand = normalizeBrand(portal.brand);
      if (!quirks[brand]) {
        quirks[brand] = [];
      }

      if (portal.notes && !quirks[brand].includes(portal.notes)) {
        quirks[brand].push(portal.notes);
      }

      if (portal.known_gaps?.length > 0) {
        for (const gap of portal.known_gaps) {
          if (!quirks[brand].includes(gap)) {
            quirks[brand].push(gap);
          }
        }
      }
    }
  }

  return quirks;
}

/**
 * Extract programming requirements by brand
 * @returns {Object} - { brandName: { software, access, j2534, security } }
 */
export function extractProgrammingRequirements() {
  const oemData = loadOEMMasterTable();
  const reqs = {};

  if (oemData?.oem_portals) {
    for (const portal of oemData.oem_portals) {
      const brand = normalizeBrand(portal.brand);
      reqs[brand] = {
        software: portal.programming?.software || 'Contact OEM',
        accessMethod: portal.programming?.access_method || 'Portal',
        j2534Compatible: portal.programming?.j2534_compatible || false,
        nastfRequired: portal.security?.nastf_required || false,
        credentialType: portal.security?.credential_type || '',
        additionalRequirements: portal.security?.additional_requirements || [],
        portalUrl: portal.portal_url
      };
    }
  }

  return reqs;
}

/**
 * Extract legal access rules by brand
 * @returns {Object} - { brandName: { freeAccess, paidAccess, nastf, sgw, regionLaws } }
 */
export function extractLegalAccessRules() {
  const legalData = loadLegalDataset();
  const rules = {};

  for (const row of legalData) {
    const brand = normalizeBrand(row.oem);
    rules[brand] = {
      freeAccess: row.free_access || 'None',
      paidAccess: row.paid_access || 'Contact OEM',
      nastfRequired: row.nastf_required?.toLowerCase() === 'yes',
      nastfCredentialType: row.nastf_credential_type || '',
      dealerOnlyRestrictions: row.dealer_only_restrictions || 'None',
      sgwSecurity: row.sgw_security || 'No',
      regionLaws: row.region_laws || 'US state laws apply',
      rightToRepairNotes: row.right_to_repair_notes || ''
    };
  }

  return rules;
}

/**
 * Extract third-party platform coverage for a brand
 * @param {string} brand - Brand name
 * @returns {Object} - { platform: coverage info }
 */
export function extractThirdPartyCoverage(brand) {
  const thirdPartyData = loadThirdPartyPlatforms();
  const normalizedBrand = normalizeBrand(brand);
  const coverage = {};

  if (thirdPartyData?.platforms) {
    for (const platform of thirdPartyData.platforms) {
      coverage[platform.name] = {
        code: platform.code,
        category: platform.category,
        adasQuality: platform.adas_quality,
        adasFeatures: platform.adas_features || [],
        strengths: platform.strengths || [],
        weaknesses: platform.weaknesses || [],
        gapsVsOEM: platform.gaps_vs_oem,
        pricing: platform.pricing,
        url: platform.url
      };
    }
  }

  if (thirdPartyData?.adas_equipment_platforms) {
    for (const equip of thirdPartyData.adas_equipment_platforms) {
      const coversBrand = equip.oem_approvals?.some(a =>
        a.toLowerCase().includes(normalizedBrand.toLowerCase())
      );

      coverage[equip.name] = {
        code: equip.code,
        category: equip.category,
        entryCost: equip.entry_cost,
        fullSystemCost: equip.full_system_cost,
        oemApprovals: equip.oem_approvals || [],
        approvedForBrand: coversBrand || false,
        strengths: equip.strengths || [],
        url: equip.url
      };
    }
  }

  return coverage;
}

/**
 * Compare OEM requirements vs third-party tool capabilities
 * @param {string} brand - Brand name
 * @param {string} toolName - Third-party tool name
 * @returns {Object}
 */
export function compareOEMvsThirdParty(brand, toolName) {
  const normalizedBrand = normalizeBrand(brand);
  const oemData = loadOEMMasterTable();
  const thirdPartyData = loadThirdPartyPlatforms();
  const equipment = loadADAS_EquipmentProviders();

  // Find OEM info
  let oemInfo = null;
  if (oemData?.oem_portals) {
    oemInfo = oemData.oem_portals.find(p =>
      normalizeBrand(p.brand) === normalizedBrand
    );
  }

  // Find third-party info
  let toolInfo = null;
  if (thirdPartyData?.platforms) {
    toolInfo = thirdPartyData.platforms.find(p =>
      p.name.toLowerCase() === toolName.toLowerCase() ||
      p.code?.toLowerCase() === toolName.toLowerCase()
    );
  }

  // Check equipment
  if (!toolInfo && thirdPartyData?.adas_equipment_platforms) {
    toolInfo = thirdPartyData.adas_equipment_platforms.find(e =>
      e.name.toLowerCase().includes(toolName.toLowerCase()) ||
      e.code?.toLowerCase() === toolName.toLowerCase()
    );
  }

  // Check equipment CSV
  if (!toolInfo) {
    const equipMatch = equipment.find(e =>
      e.manufacturer?.toLowerCase().includes(toolName.toLowerCase()) ||
      e.equipment_code?.toLowerCase() === toolName.toLowerCase()
    );
    if (equipMatch) {
      toolInfo = {
        name: equipMatch.manufacturer,
        code: equipMatch.equipment_code,
        coverage: equipMatch.coverage_percent,
        oem_approvals: equipMatch.oem_approvals?.split(';').map(a => a.trim()) || [],
        strengths: equipMatch.strengths?.split(';').map(s => s.trim()) || []
      };
    }
  }

  return {
    brand: normalizedBrand,
    tool: toolName,
    oem: oemInfo ? {
      portal: oemInfo.official_portal,
      software: oemInfo.programming?.software,
      j2534: oemInfo.programming?.j2534_compatible,
      pricing: oemInfo.pricing,
      notes: oemInfo.notes
    } : null,
    thirdParty: toolInfo ? {
      name: toolInfo.name,
      code: toolInfo.code,
      coverage: toolInfo.coverage,
      approvedForBrand: toolInfo.oem_approvals?.some(a =>
        a.toLowerCase().includes(normalizedBrand.toLowerCase())
      ) || false,
      strengths: toolInfo.strengths,
      gapsVsOEM: toolInfo.gaps_vs_oem || toolInfo.weaknesses?.[0] || 'Check tool documentation'
    } : null,
    recommendation: oemInfo && toolInfo ?
      (toolInfo.oem_approvals?.some(a => a.toLowerCase().includes(normalizedBrand.toLowerCase())) ?
        `${toolInfo.name} is OEM-approved for ${normalizedBrand}` :
        `Consider using OEM ${oemInfo.programming?.software} for ${normalizedBrand} procedures`) :
      'Check OEM and tool documentation'
  };
}

/**
 * Build structured calibration data for a specific brand/system
 * @param {string} brand
 * @param {string} system - Optional system type
 * @returns {Object}
 */
export function buildCalibrationData(brand, system = null) {
  const normalizedBrand = normalizeBrand(brand);
  const calibrations = loadADASCalibrationDataset();
  const oemData = loadOEMMasterTable();

  // Find matching calibration records
  const matches = calibrations.filter(cal => {
    const brandMatch = normalizeBrand(cal.brand) === normalizedBrand;
    if (!system) return brandMatch;

    const systemMatch =
      cal.system_type?.toLowerCase().includes(system.toLowerCase()) ||
      cal.system_code?.toLowerCase() === system.toLowerCase() ||
      expandSystemCode(cal.system_code)?.toLowerCase().includes(system.toLowerCase());

    return brandMatch && systemMatch;
  });

  // Find OEM portal info
  let portalInfo = null;
  if (oemData?.oem_portals) {
    portalInfo = oemData.oem_portals.find(p =>
      normalizeBrand(p.brand) === normalizedBrand
    );
  }

  return {
    brand: normalizedBrand,
    system: system || 'All Systems',
    systemsFound: matches.map(m => m.system_type),
    calibrations: matches.map(m => ({
      system: m.system_type,
      code: m.system_code,
      staticRequired: m.static_calibration?.toLowerCase() === 'yes',
      dynamicRequired: m.dynamic_calibration?.toLowerCase() === 'yes',
      targetSpecs: m.target_specs,
      triggers: m.calibration_triggers?.split(';').map(t => t.trim()).filter(t => t) || [],
      dtcBlockers: m.dtc_blockers,
      tools: m.required_tools?.split(';').map(t => t.trim()).filter(t => t) || [],
      quirks: m.special_quirks
    })),
    prerequisites: {
      alignment: matches.find(m => m.alignment_requirements)?.alignment_requirements,
      rideHeight: matches.find(m => m.ride_height_requirements)?.ride_height_requirements,
      battery: matches.find(m => m.battery_requirements)?.battery_requirements
    },
    oemPortal: portalInfo ? {
      url: portalInfo.portal_url,
      software: portalInfo.programming?.software,
      pricing: portalInfo.pricing
    } : null
  };
}

/**
 * Search across all datasets for a keyword
 * @param {string} keyword
 * @returns {Array}
 */
export function searchAllDatasets(keyword) {
  const results = [];
  const lowerKeyword = keyword.toLowerCase();

  // Search OEM Master
  const oemData = loadOEMMasterTable();
  if (oemData?.oem_portals) {
    for (const portal of oemData.oem_portals) {
      const searchStr = JSON.stringify(portal).toLowerCase();
      if (searchStr.includes(lowerKeyword)) {
        results.push({
          source: 'oem_master',
          type: 'OEM Portal',
          brand: portal.brand,
          match: portal.notes || portal.official_portal,
          data: portal
        });
      }
    }
  }

  // Search ADAS Calibrations
  const calibrations = loadADASCalibrationDataset();
  for (const cal of calibrations) {
    const searchStr = JSON.stringify(cal).toLowerCase();
    if (searchStr.includes(lowerKeyword)) {
      results.push({
        source: 'adas_calibrations',
        type: 'Calibration Procedure',
        brand: cal.brand,
        system: cal.system_type,
        match: cal.special_quirks || cal.calibration_triggers,
        data: cal
      });
    }
  }

  // Search Legal
  const legalData = loadLegalDataset();
  for (const row of legalData) {
    const searchStr = JSON.stringify(row).toLowerCase();
    if (searchStr.includes(lowerKeyword)) {
      results.push({
        source: 'legal',
        type: 'Legal Access',
        brand: row.oem,
        match: row.right_to_repair_notes || row.paid_access,
        data: row
      });
    }
  }

  // Search Third Party
  const thirdPartyData = loadThirdPartyPlatforms();
  if (thirdPartyData?.platforms) {
    for (const platform of thirdPartyData.platforms) {
      const searchStr = JSON.stringify(platform).toLowerCase();
      if (searchStr.includes(lowerKeyword)) {
        results.push({
          source: 'third_party',
          type: 'Third-Party Platform',
          name: platform.name,
          match: platform.best_for || platform.name,
          data: platform
        });
      }
    }
  }

  // Search Equipment
  const equipment = loadADAS_EquipmentProviders();
  for (const equip of equipment) {
    const searchStr = JSON.stringify(equip).toLowerCase();
    if (searchStr.includes(lowerKeyword)) {
      results.push({
        source: 'equipment',
        type: 'Equipment Provider',
        name: equip.manufacturer,
        match: equip.notes || equip.strengths,
        data: equip
      });
    }
  }

  return results;
}

export default {
  normalizeBrand,
  getAllBrandNames,
  expandSystemCode,
  extractCalibrationsByBrand,
  extractTriggers,
  extractTargetDimensions,
  extractPrerequisites,
  extractQuirks,
  extractProgrammingRequirements,
  extractLegalAccessRules,
  extractThirdPartyCoverage,
  compareOEMvsThirdParty,
  buildCalibrationData,
  searchAllDatasets,
  SYSTEM_CODES
};
