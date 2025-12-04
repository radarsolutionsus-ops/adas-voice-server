/**
 * OEM Knowledge Base - Lazy Loader
 *
 * Provides on-demand loading of OEM datasets with caching.
 * All data is loaded lazily to minimize startup time and memory usage.
 *
 * Supports:
 * - JSON files (parsed directly)
 * - CSV files (parsed to objects)
 * - Markdown files (extracted sections)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_TAG = '[OEM_LOADER]';

// Base paths for knowledge files
const DOCS_BASE = path.join(__dirname, '..', '..', 'docs', 'oem_knowledge');
const OEM_KNOWLEDGE_BASE = path.join(__dirname, '..', '..', 'OEM_KNOWLEDGE');

// File paths
const PATHS = {
  oemMasterJSON: path.join(DOCS_BASE, 'OEM_Master', 'oem_master_table.json'),
  oemMasterCSV: path.join(DOCS_BASE, 'OEM_Master', 'oem_master_table.csv'),
  adasCalibrationCSV: path.join(DOCS_BASE, 'ADAS', 'adas_calibration_dataset.csv'),
  equipmentCSV: path.join(DOCS_BASE, 'Equipment', 'adas_equipment_providers.csv'),
  thirdPartyJSON: path.join(DOCS_BASE, 'Third_Party', 'third_party_platforms.json'),
  thirdPartyCSV: path.join(DOCS_BASE, 'Third_Party', 'third_party_platforms.csv'),
  legalCSV: path.join(DOCS_BASE, 'Legal', 'legal_access_dataset.csv'),
  downloadPlanMD: path.join(DOCS_BASE, 'OEM_Master', 'DOWNLOAD_PLAN.md'),
  readmeADAS: path.join(DOCS_BASE, 'ADAS', 'README_ADAS.md'),
  readmeReference: path.join(DOCS_BASE, 'ADAS', 'README_REFERENCE.md'),
  readmeLegal: path.join(DOCS_BASE, 'Legal', 'README_LEGAL.md'),
  readmeThirdParty: path.join(DOCS_BASE, 'Third_Party', 'README_THIRD_PARTY.md'),
  // Fallback to original OEM_KNOWLEDGE if organized folder doesn't exist
  oemMasterJSONFallback: path.join(OEM_KNOWLEDGE_BASE, 'oem_master_table.json'),
  adasCalibrationCSVFallback: path.join(OEM_KNOWLEDGE_BASE, 'adas_calibration_dataset.csv'),
  equipmentCSVFallback: path.join(OEM_KNOWLEDGE_BASE, 'adas_equipment_providers.csv'),
  thirdPartyJSONFallback: path.join(OEM_KNOWLEDGE_BASE, 'third_party_platforms.json'),
  legalCSVFallback: path.join(OEM_KNOWLEDGE_BASE, 'legal_access_dataset.csv'),
  downloadPlanMDFallback: path.join(OEM_KNOWLEDGE_BASE, 'DOWNLOAD_PLAN.md')
};

// Single cache object for all datasets
const cache = {
  oemMaster: null,
  adasCalibrations: null,
  equipment: null,
  thirdParty: null,
  legal: null,
  brandFiles: {},
  downloadPlan: null,
  readmeADAS: null,
  readmeReference: null,
  readmeLegal: null,
  readmeThirdParty: null
};

/**
 * Try to get file path, with fallback to original location
 * @param {string} primaryPath - Primary path
 * @param {string} fallbackPath - Fallback path
 * @returns {string|null}
 */
function getFilePath(primaryPath, fallbackPath = null) {
  if (fs.existsSync(primaryPath)) {
    return primaryPath;
  }
  if (fallbackPath && fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }
  return null;
}

/**
 * Parse CSV file to array of objects
 * @param {string} filePath - Path to CSV file
 * @returns {Array<Object>}
 */
function parseCSV(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    if (lines.length < 2) return [];

    // Parse header line
    const headers = lines[0].split(',').map(h => h.trim());

    // Parse data lines
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      // Handle quoted fields with commas
      const values = [];
      let current = '';
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      // Create object from values
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = values[j] || '';
      }
      data.push(obj);
    }

    return data;
  } catch (err) {
    console.error(`${LOG_TAG} Error parsing CSV ${filePath}:`, err.message);
    return [];
  }
}

/**
 * Parse markdown file and extract sections
 * @param {string} filePath - Path to markdown file
 * @returns {Object} - { title, sections: {name: content}, bullets: [] }
 */
function parseMarkdown(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const result = {
      title: '',
      sections: {},
      bullets: [],
      tables: []
    };

    let currentSection = 'intro';
    let currentContent = [];

    for (const line of lines) {
      // Extract title (# heading)
      if (line.startsWith('# ') && !result.title) {
        result.title = line.replace(/^# /, '').trim();
        continue;
      }

      // Section headers (## or ###)
      const headerMatch = line.match(/^#{2,3}\s+(.+)$/);
      if (headerMatch) {
        // Save previous section
        if (currentContent.length > 0) {
          result.sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
        }
        currentSection = headerMatch[1].trim();
        currentContent = [];
        continue;
      }

      // Bullet points
      const bulletMatch = line.match(/^[-*]\s+(.+)$/);
      if (bulletMatch) {
        result.bullets.push(bulletMatch[1].trim());
      }

      // Table rows
      if (line.includes('|') && !line.startsWith('|---')) {
        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
        if (cells.length > 1) {
          result.tables.push(cells);
        }
      }

      currentContent.push(line);
    }

    // Save last section
    if (currentContent.length > 0) {
      result.sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
    }

    return result;
  } catch (err) {
    console.error(`${LOG_TAG} Error parsing markdown ${filePath}:`, err.message);
    return { title: '', sections: {}, bullets: [], tables: [] };
  }
}

/**
 * Load OEM Master Table (JSON)
 * @returns {Object|null}
 */
export function loadOEMMasterTable() {
  if (cache.oemMaster !== null) {
    return cache.oemMaster;
  }

  const filePath = getFilePath(PATHS.oemMasterJSON, PATHS.oemMasterJSONFallback);
  if (!filePath) {
    console.error(`${LOG_TAG} OEM Master Table JSON not found`);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    cache.oemMaster = JSON.parse(content);
    console.log(`${LOG_TAG} Loaded OEM Master Table: ${cache.oemMaster.oem_portals?.length || 0} portals`);
    return cache.oemMaster;
  } catch (err) {
    console.error(`${LOG_TAG} Error loading OEM Master Table:`, err.message);
    return null;
  }
}

/**
 * Load ADAS Calibration Dataset (CSV)
 * @returns {Array<Object>}
 */
export function loadADASCalibrationDataset() {
  if (cache.adasCalibrations !== null) {
    return cache.adasCalibrations;
  }

  const filePath = getFilePath(PATHS.adasCalibrationCSV, PATHS.adasCalibrationCSVFallback);
  if (!filePath) {
    console.error(`${LOG_TAG} ADAS Calibration Dataset not found`);
    return [];
  }

  cache.adasCalibrations = parseCSV(filePath);
  console.log(`${LOG_TAG} Loaded ADAS Calibration Dataset: ${cache.adasCalibrations.length} records`);
  return cache.adasCalibrations;
}

/**
 * Load ADAS Equipment Providers (CSV)
 * @returns {Array<Object>}
 */
export function loadADAS_EquipmentProviders() {
  if (cache.equipment !== null) {
    return cache.equipment;
  }

  const filePath = getFilePath(PATHS.equipmentCSV, PATHS.equipmentCSVFallback);
  if (!filePath) {
    console.error(`${LOG_TAG} Equipment Providers not found`);
    return [];
  }

  cache.equipment = parseCSV(filePath);
  console.log(`${LOG_TAG} Loaded Equipment Providers: ${cache.equipment.length} records`);
  return cache.equipment;
}

/**
 * Load Third Party Platforms (JSON)
 * @returns {Object|null}
 */
export function loadThirdPartyPlatforms() {
  if (cache.thirdParty !== null) {
    return cache.thirdParty;
  }

  const filePath = getFilePath(PATHS.thirdPartyJSON, PATHS.thirdPartyJSONFallback);
  if (!filePath) {
    console.error(`${LOG_TAG} Third Party Platforms JSON not found`);
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    cache.thirdParty = JSON.parse(content);
    console.log(`${LOG_TAG} Loaded Third Party Platforms: ${cache.thirdParty.platforms?.length || 0} platforms`);
    return cache.thirdParty;
  } catch (err) {
    console.error(`${LOG_TAG} Error loading Third Party Platforms:`, err.message);
    return null;
  }
}

/**
 * Load Legal Access Dataset (CSV)
 * @returns {Array<Object>}
 */
export function loadLegalDataset() {
  if (cache.legal !== null) {
    return cache.legal;
  }

  const filePath = getFilePath(PATHS.legalCSV, PATHS.legalCSVFallback);
  if (!filePath) {
    console.error(`${LOG_TAG} Legal Dataset not found`);
    return [];
  }

  cache.legal = parseCSV(filePath);
  console.log(`${LOG_TAG} Loaded Legal Dataset: ${cache.legal.length} records`);
  return cache.legal;
}

/**
 * Load Download Plan (Markdown)
 * @returns {Object}
 */
export function loadDownloadPlan() {
  if (cache.downloadPlan !== null) {
    return cache.downloadPlan;
  }

  const filePath = getFilePath(PATHS.downloadPlanMD, PATHS.downloadPlanMDFallback);
  if (!filePath) {
    console.error(`${LOG_TAG} Download Plan not found`);
    return { title: '', sections: {}, bullets: [], tables: [] };
  }

  cache.downloadPlan = parseMarkdown(filePath);
  console.log(`${LOG_TAG} Loaded Download Plan: ${Object.keys(cache.downloadPlan.sections).length} sections`);
  return cache.downloadPlan;
}

/**
 * Load Brand Reference Files (Markdown)
 * @param {string} brand - Brand name to load
 * @returns {Object}
 */
export function loadBrandReferenceFiles(brand) {
  const normalizedBrand = brand.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (cache.brandFiles[normalizedBrand]) {
    return cache.brandFiles[normalizedBrand];
  }

  const result = {
    brand: brand,
    downloadPlan: null,
    adas: null,
    reference: null
  };

  // Get brand-specific section from download plan
  const downloadPlan = loadDownloadPlan();
  for (const [sectionName, content] of Object.entries(downloadPlan.sections)) {
    if (sectionName.toLowerCase().includes(normalizedBrand)) {
      result.downloadPlan = content;
      break;
    }
  }

  // Load ADAS readme if not cached
  if (cache.readmeADAS === null) {
    const adasPath = getFilePath(PATHS.readmeADAS);
    if (adasPath) {
      cache.readmeADAS = parseMarkdown(adasPath);
    }
  }
  result.adas = cache.readmeADAS;

  // Load Reference readme if not cached
  if (cache.readmeReference === null) {
    const refPath = getFilePath(PATHS.readmeReference);
    if (refPath) {
      cache.readmeReference = parseMarkdown(refPath);
    }
  }
  result.reference = cache.readmeReference;

  cache.brandFiles[normalizedBrand] = result;
  return result;
}

/**
 * Load Legal README (Markdown)
 * @returns {Object}
 */
export function loadLegalReadme() {
  if (cache.readmeLegal !== null) {
    return cache.readmeLegal;
  }

  const filePath = getFilePath(PATHS.readmeLegal);
  if (!filePath) {
    return { title: '', sections: {}, bullets: [], tables: [] };
  }

  cache.readmeLegal = parseMarkdown(filePath);
  return cache.readmeLegal;
}

/**
 * Load Third Party README (Markdown)
 * @returns {Object}
 */
export function loadThirdPartyReadme() {
  if (cache.readmeThirdParty !== null) {
    return cache.readmeThirdParty;
  }

  const filePath = getFilePath(PATHS.readmeThirdParty);
  if (!filePath) {
    return { title: '', sections: {}, bullets: [], tables: [] };
  }

  cache.readmeThirdParty = parseMarkdown(filePath);
  return cache.readmeThirdParty;
}

/**
 * Clear all cached data
 */
export function clearCache() {
  cache.oemMaster = null;
  cache.adasCalibrations = null;
  cache.equipment = null;
  cache.thirdParty = null;
  cache.legal = null;
  cache.brandFiles = {};
  cache.downloadPlan = null;
  cache.readmeADAS = null;
  cache.readmeReference = null;
  cache.readmeLegal = null;
  cache.readmeThirdParty = null;
  console.log(`${LOG_TAG} Cache cleared`);
}

/**
 * Check if knowledge base files exist
 * @returns {Object} - Status of each file type
 */
export function checkFilesExist() {
  return {
    oemMaster: !!getFilePath(PATHS.oemMasterJSON, PATHS.oemMasterJSONFallback),
    adasCalibrations: !!getFilePath(PATHS.adasCalibrationCSV, PATHS.adasCalibrationCSVFallback),
    equipment: !!getFilePath(PATHS.equipmentCSV, PATHS.equipmentCSVFallback),
    thirdParty: !!getFilePath(PATHS.thirdPartyJSON, PATHS.thirdPartyJSONFallback),
    legal: !!getFilePath(PATHS.legalCSV, PATHS.legalCSVFallback),
    downloadPlan: !!getFilePath(PATHS.downloadPlanMD, PATHS.downloadPlanMDFallback)
  };
}

/**
 * Get raw file content for full-text search
 * @param {string} fileType - Type of file to get
 * @returns {string}
 */
export function getRawContent(fileType) {
  const pathMap = {
    oemMaster: [PATHS.oemMasterJSON, PATHS.oemMasterJSONFallback],
    adasCalibrations: [PATHS.adasCalibrationCSV, PATHS.adasCalibrationCSVFallback],
    equipment: [PATHS.equipmentCSV, PATHS.equipmentCSVFallback],
    thirdParty: [PATHS.thirdPartyJSON, PATHS.thirdPartyJSONFallback],
    legal: [PATHS.legalCSV, PATHS.legalCSVFallback],
    downloadPlan: [PATHS.downloadPlanMD, PATHS.downloadPlanMDFallback]
  };

  const paths = pathMap[fileType];
  if (!paths) return '';

  const filePath = getFilePath(paths[0], paths[1]);
  if (!filePath) return '';

  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return '';
  }
}

export default {
  loadOEMMasterTable,
  loadADASCalibrationDataset,
  loadADAS_EquipmentProviders,
  loadThirdPartyPlatforms,
  loadLegalDataset,
  loadDownloadPlan,
  loadBrandReferenceFiles,
  loadLegalReadme,
  loadThirdPartyReadme,
  clearCache,
  checkFilesExist,
  getRawContent,
  parseCSV,
  parseMarkdown
};
