/**
 * OEM Knowledge Base - Public API
 *
 * Clean, unified interface for accessing all OEM knowledge data.
 * This module provides the public API for the OEM Knowledge Engine.
 *
 * Usage:
 *   import oem from './utils/oem/index.js';
 *
 *   // Get OEM info
 *   const toyotaInfo = oem.getOEMInfo('Toyota');
 *
 *   // Get calibration requirements
 *   const cals = oem.getCalibrationRequirements({ brand: 'Honda', system: 'Camera' });
 *
 *   // Search across all datasets
 *   const results = oem.searchAllOEMs('EyeSight');
 */

import * as loader from './loader.js';
import * as parser from './parser.js';
import * as oemKnowledge from '../oemKnowledge.js';

const LOG_TAG = '[OEM_API]';

/**
 * Get list of all available OEMs in the knowledge base
 * @returns {string[]}
 */
export function getOEMList() {
  const oemData = loader.loadOEMMasterTable();
  if (!oemData?.oem_portals) return [];

  const brands = oemData.oem_portals.map(p => p.brand);
  return [...new Set(brands)].sort();
}

/**
 * Get comprehensive OEM information
 * @param {string} brand - Brand name
 * @returns {Object|null}
 */
export function getOEMInfo(brand) {
  const normalizedBrand = parser.normalizeBrand(brand);
  const oemData = loader.loadOEMMasterTable();

  if (!oemData?.oem_portals) return null;

  const portal = oemData.oem_portals.find(p =>
    parser.normalizeBrand(p.brand) === normalizedBrand
  );

  if (!portal) return null;

  // Enrich with additional data
  const legal = parser.extractLegalAccessRules()[normalizedBrand];
  const quirks = parser.extractQuirks()[normalizedBrand] || [];
  const prereqs = parser.extractPrerequisites()[normalizedBrand];

  return {
    brand: portal.brand,
    parentGroup: portal.parent_group,
    region: portal.region,
    portal: {
      name: portal.official_portal,
      url: portal.portal_url
    },
    adasCalibration: portal.adas_calibration,
    programming: portal.programming,
    security: portal.security,
    pricing: portal.pricing,
    knownGaps: portal.known_gaps || [],
    notes: portal.notes,
    lastVerified: portal.last_verified,
    legal: legal || null,
    quirks: quirks,
    prerequisites: prereqs || null
  };
}

/**
 * Get calibration requirements for a brand/system combination
 * @param {Object} params
 * @param {string} params.brand - Brand name
 * @param {string} [params.system] - Optional system type
 * @returns {Object}
 */
export function getCalibrationRequirements({ brand, system = null }) {
  return parser.buildCalibrationData(brand, system);
}

/**
 * Get all calibrations for a specific brand
 * @param {string} brand - Brand name
 * @returns {Array}
 */
export function getAllCalibrationsForBrand(brand) {
  const normalizedBrand = parser.normalizeBrand(brand);
  const byBrand = parser.extractCalibrationsByBrand();
  return byBrand[normalizedBrand] || [];
}

/**
 * Get detailed ADAS procedure information
 * @param {Object} params
 * @param {string} params.brand - Brand name
 * @param {string} params.procedure - Procedure type (e.g., 'camera', 'radar', 'bsm')
 * @returns {Object}
 */
export function getADASProcedureDetails({ brand, procedure }) {
  const normalizedBrand = parser.normalizeBrand(brand);
  const calibrations = loader.loadADASCalibrationDataset();

  // Find matching procedures
  const matches = calibrations.filter(cal => {
    const brandMatch = parser.normalizeBrand(cal.brand) === normalizedBrand;
    const procMatch =
      cal.system_type?.toLowerCase().includes(procedure.toLowerCase()) ||
      cal.system_code?.toLowerCase().includes(procedure.toLowerCase());
    return brandMatch && procMatch;
  });

  if (matches.length === 0) {
    return {
      brand: normalizedBrand,
      procedure,
      found: false,
      message: `No ${procedure} procedure found for ${normalizedBrand}`
    };
  }

  return {
    brand: normalizedBrand,
    procedure,
    found: true,
    systems: matches.map(m => ({
      system: m.system_type,
      code: m.system_code,
      staticCalibration: m.static_calibration,
      dynamicCalibration: m.dynamic_calibration,
      targetSpecs: m.target_specs,
      alignmentRequired: m.alignment_requirements,
      rideHeightRequired: m.ride_height_requirements,
      batteryRequired: m.battery_requirements,
      tools: m.required_tools?.split(';').map(t => t.trim()).filter(t => t) || [],
      triggers: m.calibration_triggers?.split(';').map(t => t.trim()).filter(t => t) || [],
      dtcBlockers: m.dtc_blockers,
      quirks: m.special_quirks,
      portalLink: m.direct_links
    }))
  };
}

/**
 * Get prerequisites for a brand
 * @param {string} brand - Brand name
 * @returns {Object}
 */
export function getPrerequisites(brand) {
  const normalizedBrand = parser.normalizeBrand(brand);
  const allPrereqs = parser.extractPrerequisites();
  return allPrereqs[normalizedBrand] || {
    alignment: null,
    rideHeight: null,
    battery: null,
    floor: null,
    criticalNotes: [],
    requiredTools: []
  };
}

/**
 * Get quirks for a brand
 * @param {string} brand - Brand name
 * @returns {string[]}
 */
export function getQuirks(brand) {
  const normalizedBrand = parser.normalizeBrand(brand);
  const allQuirks = parser.extractQuirks();
  return allQuirks[normalizedBrand] || [];
}

/**
 * Get target specs for a brand
 * @param {string} brand - Brand name
 * @returns {Object}
 */
export function getTargetSpecs(brand) {
  const normalizedBrand = parser.normalizeBrand(brand);
  const allSpecs = parser.extractTargetDimensions();
  return allSpecs[normalizedBrand] || {};
}

/**
 * Get programming requirements for a brand
 * @param {string} brand - Brand name
 * @returns {Object}
 */
export function getProgrammingRequirements(brand) {
  const normalizedBrand = parser.normalizeBrand(brand);
  const allReqs = parser.extractProgrammingRequirements();
  return allReqs[normalizedBrand] || {
    software: 'Contact OEM',
    accessMethod: 'Portal',
    j2534Compatible: false,
    nastfRequired: false,
    credentialType: '',
    additionalRequirements: []
  };
}

/**
 * Get legal access rules for a brand
 * @param {string} brand - Brand name
 * @returns {Object}
 */
export function getLegalAccessRules(brand) {
  const normalizedBrand = parser.normalizeBrand(brand);
  const allRules = parser.extractLegalAccessRules();
  return allRules[normalizedBrand] || {
    freeAccess: 'Unknown',
    paidAccess: 'Contact OEM',
    nastfRequired: false,
    nastfCredentialType: '',
    dealerOnlyRestrictions: 'Unknown',
    sgwSecurity: 'Unknown',
    regionLaws: 'Check local regulations'
  };
}

/**
 * Get third-party coverage for a brand
 * @param {string} brand - Brand name
 * @returns {Object}
 */
export function getThirdPartyCoverage(brand) {
  return parser.extractThirdPartyCoverage(brand);
}

/**
 * Compare OEM vs third-party tool for a brand
 * @param {string} brand - Brand name
 * @param {string} toolName - Third-party tool name
 * @returns {Object}
 */
export function compareOEMvsThirdParty(brand, toolName) {
  return parser.compareOEMvsThirdParty(brand, toolName);
}

/**
 * Get download plan section for a brand
 * @param {string} brand - Brand name
 * @returns {string|null}
 */
export function getDownloadPlanSection(brand) {
  const downloadPlan = loader.loadDownloadPlan();
  const normalizedBrand = parser.normalizeBrand(brand).toLowerCase();

  for (const [sectionName, content] of Object.entries(downloadPlan.sections)) {
    if (sectionName.toLowerCase().includes(normalizedBrand)) {
      return content;
    }
  }

  return null;
}

/**
 * Search across all OEM datasets
 * @param {string} keyword - Search keyword
 * @returns {Object}
 */
export function searchAllOEMs(keyword) {
  const results = parser.searchAllDatasets(keyword);

  // Rank and group results
  const grouped = {
    oem_portals: [],
    calibrations: [],
    legal: [],
    third_party: [],
    equipment: []
  };

  for (const result of results) {
    switch (result.source) {
      case 'oem_master':
        grouped.oem_portals.push(result);
        break;
      case 'adas_calibrations':
        grouped.calibrations.push(result);
        break;
      case 'legal':
        grouped.legal.push(result);
        break;
      case 'third_party':
        grouped.third_party.push(result);
        break;
      case 'equipment':
        grouped.equipment.push(result);
        break;
    }
  }

  return {
    keyword,
    totalResults: results.length,
    results: grouped,
    summary: `Found ${results.length} matches across ${Object.values(grouped).filter(g => g.length > 0).length} categories`
  };
}

/**
 * Unified OEM lookup for tool integration
 * Returns a comprehensive object for a brand/system query
 * @param {Object} params
 * @param {string} params.brand - Brand name
 * @param {string} [params.system] - Optional system type
 * @param {string} [params.query] - Optional search query
 * @returns {Object}
 */
export function oemLookup({ brand, system = null, query = null }) {
  // If just a query, search all
  if (query && !brand) {
    return searchAllOEMs(query);
  }

  const normalizedBrand = parser.normalizeBrand(brand);

  // Get OEM info
  const oemInfo = getOEMInfo(normalizedBrand);
  if (!oemInfo) {
    return {
      brand: normalizedBrand,
      found: false,
      message: `No information found for brand: ${brand}`
    };
  }

  // Get calibration data
  const calibrationData = getCalibrationRequirements({ brand: normalizedBrand, system });

  // Get additional data
  const allCalibrations = getAllCalibrationsForBrand(normalizedBrand);
  const prerequisites = getPrerequisites(normalizedBrand);
  const quirks = getQuirks(normalizedBrand);
  const targetSpecs = getTargetSpecs(normalizedBrand);
  const programming = getProgrammingRequirements(normalizedBrand);
  const legal = getLegalAccessRules(normalizedBrand);
  const thirdParty = getThirdPartyCoverage(normalizedBrand);
  const downloadPlan = getDownloadPlanSection(normalizedBrand);

  // Extract unique systems
  const availableSystems = [...new Set(allCalibrations.map(c => c.system))];

  // Extract calibration methods
  const calibrationMethods = {};
  for (const cal of allCalibrations) {
    calibrationMethods[cal.system] = {
      static: cal.staticCalibration,
      dynamic: cal.dynamicCalibration
    };
  }

  // Extract triggers
  const triggers = [...new Set(allCalibrations.flatMap(c => c.triggers || []))];

  // Extract DTC blockers
  const dtcBlockers = [...new Set(allCalibrations.map(c => c.dtcBlockers).filter(d => d && d !== 'None'))];

  return {
    brand: normalizedBrand,
    found: true,
    system: system || 'All',
    portal: {
      name: oemInfo.portal.name,
      url: oemInfo.portal.url
    },
    availableSystems,
    calibrationMethods,
    triggers,
    prerequisites: {
      alignment: prerequisites.alignment,
      rideHeight: prerequisites.rideHeight,
      battery: prerequisites.battery,
      criticalNotes: prerequisites.criticalNotes,
      requiredTools: prerequisites.requiredTools
    },
    dtcBlockers,
    targetSpecs,
    quirks,
    programmingRequirements: programming,
    legalAccess: legal,
    thirdPartyCoverage: Object.keys(thirdParty).length > 0 ? {
      platforms: Object.keys(thirdParty).filter(k =>
        thirdParty[k].category === 'Repair Information' ||
        thirdParty[k].category === 'ADAS Calibration Equipment'
      ),
      oemApprovedTools: Object.entries(thirdParty)
        .filter(([, v]) => v.approvedForBrand)
        .map(([k]) => k)
    } : null,
    downloadPlan: downloadPlan ? 'Available' : null,
    calibrations: calibrationData.calibrations
  };
}

/**
 * Get equipment providers list
 * @returns {Array}
 */
export function getEquipmentProviders() {
  return loader.loadADAS_EquipmentProviders();
}

/**
 * Get all third-party platforms
 * @returns {Object}
 */
export function getThirdPartyPlatforms() {
  return loader.loadThirdPartyPlatforms();
}

/**
 * Check if knowledge base files exist
 * @returns {Object}
 */
export function checkKnowledgeBaseStatus() {
  return loader.checkFilesExist();
}

/**
 * Clear all cached data
 */
export function clearCache() {
  loader.clearCache();
}

/**
 * Get list of all calibration triggers
 * @returns {Object}
 */
export function getAllCalibrationTriggers() {
  return parser.extractTriggers();
}

/**
 * Get PDF job aids for a specific brand
 * These are job aids placed in the OEM_KNOWLEDGE folder
 * @param {string} brand - Brand name (e.g., "Honda", "Toyota")
 * @returns {Promise<Array>} - Array of job aid objects with { brand, fileName, filePath, summary }
 */
export async function getJobAidsForBrand(brand) {
  try {
    const jobAids = await oemKnowledge.getJobAidsForBrand(brand);
    // Return simplified objects for the assistant (no full text, just summary)
    return jobAids.map(aid => ({
      brand: aid.brand,
      fileName: aid.fileName,
      summary: aid.text ? aid.text.substring(0, 500) + '...' : 'PDF job aid available'
    }));
  } catch (err) {
    console.error(`${LOG_TAG} Failed to get job aids for ${brand}:`, err);
    return [];
  }
}

/**
 * Get all available PDF job aids
 * @returns {Promise<Array>} - Array of job aid objects
 */
export async function getAllJobAids() {
  try {
    const jobAids = await oemKnowledge.getAllJobAids();
    // Return simplified list (brands and filenames only)
    return jobAids.map(aid => ({
      brand: aid.brand,
      fileName: aid.fileName
    }));
  } catch (err) {
    console.error(`${LOG_TAG} Failed to get all job aids:`, err);
    return [];
  }
}

/**
 * Search job aids by keyword
 * @param {string} query - Search query
 * @returns {Promise<Array>} - Matching job aids with context
 */
export async function searchJobAids(query) {
  try {
    return await oemKnowledge.searchJobAids(query);
  } catch (err) {
    console.error(`${LOG_TAG} Failed to search job aids:`, err);
    return [];
  }
}

/**
 * Get summary statistics about the knowledge base
 * @returns {Object}
 */
export function getKnowledgeBaseSummary() {
  const oemData = loader.loadOEMMasterTable();
  const calibrations = loader.loadADASCalibrationDataset();
  const equipment = loader.loadADAS_EquipmentProviders();
  const thirdParty = loader.loadThirdPartyPlatforms();
  const legal = loader.loadLegalDataset();

  return {
    oemPortals: oemData?.oem_portals?.length || 0,
    calibrationProcedures: calibrations.length,
    equipmentProviders: equipment.length,
    thirdPartyPlatforms: thirdParty?.platforms?.length || 0,
    legalRecords: legal.length,
    brandsWithCalibrations: Object.keys(parser.extractCalibrationsByBrand()).length,
    uniqueSystems: [...new Set(calibrations.map(c => c.system_type))].length,
    lastUpdated: oemData?.metadata?.created_date || 'Unknown'
  };
}

/**
 * Get OEM rules formatted for hybrid scrub engine
 * Returns calibration triggers, methods, prerequisites, quirks in a format
 * suitable for LLM prompts and reconciliation
 * @param {string} brand - Brand name
 * @returns {Object} - OEM rules object
 */
export function getOEMRules(brand) {
  const normalizedBrand = parser.normalizeBrand(brand);

  // Get all calibrations for brand
  const calibrations = getAllCalibrationsForBrand(normalizedBrand);
  const prerequisites = getPrerequisites(normalizedBrand);
  const quirks = getQuirks(normalizedBrand);
  const targetSpecs = getTargetSpecs(normalizedBrand);

  // Build calibration triggers array
  const calibrationTriggers = [];
  for (const cal of calibrations) {
    if (cal.triggers && cal.triggers.length > 0) {
      for (const trigger of cal.triggers) {
        calibrationTriggers.push({
          component: trigger,
          operation: 'R&R/Replace',
          calibration: cal.system,
          type: cal.dynamicCalibration ? 'Dynamic' : 'Static'
        });
      }
    }
  }

  // Build calibration methods map
  const calibrationMethods = {};
  for (const cal of calibrations) {
    const methods = [];
    if (cal.staticCalibration) methods.push('Static');
    if (cal.dynamicCalibration) methods.push('Dynamic');
    if (methods.length > 0) {
      calibrationMethods[cal.system] = methods.join('/');
    }
  }

  // Non-ADAS items that should always be excluded from calibration list
  const nonAdasItems = [
    'SRS Unit',
    'Seat Weight Sensor',
    'Occupant Classification',
    'TPMS',
    'Tire Pressure Monitoring',
    'Battery Registration',
    'Key Fob Programming',
    'Window Initialization',
    'Sunroof Reset',
    'Climate Control Reset'
  ];

  return {
    brand: normalizedBrand,
    calibrationTriggers,
    calibrationMethods,
    prerequisites: {
      alignment: prerequisites.alignment,
      rideHeight: prerequisites.rideHeight,
      battery: prerequisites.battery,
      criticalNotes: prerequisites.criticalNotes || []
    },
    quirks: quirks.slice(0, 10), // Limit for context window
    targetSpecs,
    nonAdasItems,
    availableSystems: calibrations.map(c => c.system)
  };
}

// Export all functions as default object
export default {
  // Core OEM functions
  getOEMList,
  getOEMInfo,

  // Calibration functions
  getCalibrationRequirements,
  getAllCalibrationsForBrand,
  getADASProcedureDetails,

  // Brand-specific data
  getPrerequisites,
  getQuirks,
  getTargetSpecs,
  getProgrammingRequirements,

  // Legal and access
  getLegalAccessRules,
  getThirdPartyCoverage,
  compareOEMvsThirdParty,

  // Download plan
  getDownloadPlanSection,

  // Search
  searchAllOEMs,

  // Unified lookup (for server tool)
  oemLookup,

  // Lists
  getEquipmentProviders,
  getThirdPartyPlatforms,
  getAllCalibrationTriggers,

  // Utilities
  checkKnowledgeBaseStatus,
  clearCache,
  getKnowledgeBaseSummary,

  // PDF Job Aids (from OEM_KNOWLEDGE folder)
  getJobAidsForBrand,
  getAllJobAids,
  searchJobAids,

  // Hybrid scrub support
  getOEMRules,

  // Re-export parser utilities
  normalizeBrand: parser.normalizeBrand,
  getAllBrandNames: parser.getAllBrandNames,
  expandSystemCode: parser.expandSystemCode
};
