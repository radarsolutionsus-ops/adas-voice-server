/**
 * oemKnowledge.js - OEM Job Aid PDF Knowledge Loader
 *
 * Automatically discovers and indexes PDF job aids from the OEM_KNOWLEDGE folder.
 * Provides lazy loading and caching for efficient access.
 *
 * Usage:
 *   import * as oemKnowledge from '../utils/oemKnowledge.js';
 *
 *   const hondaAids = await oemKnowledge.getJobAidsForBrand('Honda');
 *   const allAids = await oemKnowledge.getAllJobAids();
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdf from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_TAG = '[OEM_KNOWLEDGE]';

// OEM_KNOWLEDGE directory at project root
const OEM_KNOWLEDGE_DIR = path.join(__dirname, '..', 'OEM_KNOWLEDGE');

// In-memory cache for job aid index and parsed text
let jobAidIndex = null;
let initialized = false;

/**
 * @typedef {Object} JobAid
 * @property {string} brand - Normalized brand name (e.g., "Honda")
 * @property {string} fileName - Original filename
 * @property {string} filePath - Absolute path to the PDF
 * @property {string|null} text - Parsed PDF text (lazy-loaded)
 * @property {boolean} textLoaded - Whether text has been loaded
 */

/**
 * Known OEM brand names for fallback matching
 */
const KNOWN_BRANDS = [
  'Acura', 'Alfa Romeo', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet',
  'Chrysler', 'Dodge', 'Ferrari', 'Fiat', 'Ford', 'Genesis', 'GMC',
  'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Lamborghini',
  'Land Rover', 'Lexus', 'Lincoln', 'Maserati', 'Mazda', 'Mercedes-Benz',
  'Mercedes', 'Mini', 'Mitsubishi', 'Nissan', 'Porsche', 'Ram', 'Rivian',
  'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'
];

/**
 * Extract brand from filename
 * Convention: "ADAS HONDA JOB AID.pdf" → "Honda"
 * @param {string} fileName - PDF filename
 * @returns {string|null} - Extracted brand or null
 */
function extractBrandFromFilename(fileName) {
  if (!fileName) return null;

  // Remove extension
  const baseName = fileName.replace(/\.pdf$/i, '');

  // Split by spaces
  const tokens = baseName.split(/\s+/);

  // Find the token immediately after "ADAS"
  const adasIndex = tokens.findIndex(t => t.toUpperCase() === 'ADAS');

  if (adasIndex !== -1 && adasIndex < tokens.length - 1) {
    const brandToken = tokens[adasIndex + 1];
    // Capitalize first letter, lowercase rest
    const normalizedBrand = brandToken.charAt(0).toUpperCase() +
                            brandToken.slice(1).toLowerCase();

    // Check if it matches a known brand (case-insensitive)
    const matchedBrand = KNOWN_BRANDS.find(b =>
      b.toLowerCase() === normalizedBrand.toLowerCase()
    );

    return matchedBrand || normalizedBrand;
  }

  // Fallback: look for any known brand in the filename
  const lowerFileName = fileName.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    if (lowerFileName.includes(brand.toLowerCase())) {
      return brand;
    }
  }

  // Last resort: first meaningful word (skip common words)
  const skipWords = ['adas', 'job', 'aid', 'guide', 'calibration', 'procedure', 'manual'];
  for (const token of tokens) {
    if (!skipWords.includes(token.toLowerCase()) && token.length > 2) {
      const normalized = token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
      console.warn(`${LOG_TAG} Could not reliably determine brand for "${fileName}", using: ${normalized}`);
      return normalized;
    }
  }

  console.warn(`${LOG_TAG} Could not determine brand from filename: ${fileName}`);
  return null;
}

/**
 * Normalize brand name for matching
 * @param {string} brand - Brand name
 * @returns {string} - Normalized brand
 */
function normalizeBrand(brand) {
  if (!brand) return '';

  const lower = brand.toLowerCase().trim();

  // Handle common aliases
  const aliases = {
    'mercedes': 'Mercedes-Benz',
    'mercedes-benz': 'Mercedes-Benz',
    'mercedesbenz': 'Mercedes-Benz',
    'mb': 'Mercedes-Benz',
    'vw': 'Volkswagen',
    'chevy': 'Chevrolet',
    'landrover': 'Land Rover',
    'land-rover': 'Land Rover'
  };

  if (aliases[lower]) {
    return aliases[lower];
  }

  // Capitalize first letter
  return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
}

/**
 * Scan OEM_KNOWLEDGE directory and build index
 * Only scans once, caches result
 */
async function scanDirectory() {
  if (initialized && jobAidIndex) {
    return;
  }

  jobAidIndex = [];

  try {
    // Check if directory exists
    if (!fs.existsSync(OEM_KNOWLEDGE_DIR)) {
      console.log(`${LOG_TAG} OEM_KNOWLEDGE directory not found: ${OEM_KNOWLEDGE_DIR}`);
      initialized = true;
      return;
    }

    // Read directory contents
    const files = fs.readdirSync(OEM_KNOWLEDGE_DIR);

    // Filter for PDF files
    const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      console.log(`${LOG_TAG} No PDF files found in OEM_KNOWLEDGE`);
      initialized = true;
      return;
    }

    // Build index
    const brandCounts = {};
    for (const fileName of pdfFiles) {
      const brand = extractBrandFromFilename(fileName);

      if (brand) {
        const normalizedBrand = normalizeBrand(brand);
        jobAidIndex.push({
          brand: normalizedBrand,
          fileName,
          filePath: path.join(OEM_KNOWLEDGE_DIR, fileName),
          text: null,
          textLoaded: false
        });

        brandCounts[normalizedBrand] = (brandCounts[normalizedBrand] || 0) + 1;
      }
    }

    // Log indexed files
    const summary = Object.entries(brandCounts)
      .map(([brand, count]) => `${brand}: ${count}`)
      .join(', ');

    console.log(`${LOG_TAG} Indexed ${jobAidIndex.length} job aids: ${summary}`);
    initialized = true;

  } catch (err) {
    console.error(`${LOG_TAG} Error scanning OEM_KNOWLEDGE directory:`, err.message);
    initialized = true;
  }
}

/**
 * Parse PDF text for a job aid (lazy loading with caching)
 * @param {JobAid} jobAid - Job aid object
 * @returns {Promise<string>} - Parsed text
 */
async function loadJobAidText(jobAid) {
  if (jobAid.textLoaded) {
    return jobAid.text;
  }

  try {
    const dataBuffer = fs.readFileSync(jobAid.filePath);
    const pdfData = await pdf(dataBuffer);
    jobAid.text = pdfData.text || '';
    jobAid.textLoaded = true;
    return jobAid.text;
  } catch (err) {
    console.error(`${LOG_TAG} Error parsing PDF ${jobAid.fileName}:`, err.message);
    jobAid.text = '';
    jobAid.textLoaded = true;
    return '';
  }
}

/**
 * Initialize if needed (internal)
 * @returns {Promise<void>}
 */
export async function initIfNeeded() {
  if (!initialized) {
    await scanDirectory();
  }
}

/**
 * Get job aids for a specific brand
 * @param {string} brand - Brand name (case-insensitive)
 * @returns {Promise<JobAid[]>} - Array of job aid objects with text loaded
 */
export async function getJobAidsForBrand(brand) {
  await initIfNeeded();

  if (!brand || !jobAidIndex) {
    return [];
  }

  const normalizedBrand = normalizeBrand(brand);

  // Filter job aids by brand
  const matches = jobAidIndex.filter(aid =>
    aid.brand.toLowerCase() === normalizedBrand.toLowerCase()
  );

  if (matches.length === 0) {
    return [];
  }

  // Load text for each matching job aid (if not already loaded)
  for (const aid of matches) {
    if (!aid.textLoaded) {
      await loadJobAidText(aid);
    }
  }

  console.log(`${LOG_TAG} Loaded job aids for brand ${normalizedBrand}: ${matches.length} document(s)`);

  return matches;
}

/**
 * Get all job aids
 * @returns {Promise<JobAid[]>} - Array of all job aid objects
 */
export async function getAllJobAids() {
  await initIfNeeded();

  if (!jobAidIndex) {
    return [];
  }

  // Load text for all job aids (if not already loaded)
  for (const aid of jobAidIndex) {
    if (!aid.textLoaded) {
      await loadJobAidText(aid);
    }
  }

  return jobAidIndex;
}

/**
 * Get list of brands with job aids (without loading text)
 * @returns {Promise<string[]>} - Array of brand names
 */
export async function getBrandsWithJobAids() {
  await initIfNeeded();

  if (!jobAidIndex) {
    return [];
  }

  const brands = [...new Set(jobAidIndex.map(aid => aid.brand))];
  return brands.sort();
}

/**
 * Check if job aids exist for a brand (without loading text)
 * @param {string} brand - Brand name
 * @returns {Promise<boolean>}
 */
export async function hasJobAidsForBrand(brand) {
  await initIfNeeded();

  if (!brand || !jobAidIndex) {
    return false;
  }

  const normalizedBrand = normalizeBrand(brand);
  return jobAidIndex.some(aid =>
    aid.brand.toLowerCase() === normalizedBrand.toLowerCase()
  );
}

/**
 * Get job aid metadata only (no text loading)
 * Useful for quick checks without parsing PDFs
 * @param {string} brand - Brand name (optional, returns all if not specified)
 * @returns {Promise<Array<{brand: string, fileName: string}>>}
 */
export async function getJobAidMetadata(brand = null) {
  await initIfNeeded();

  if (!jobAidIndex) {
    return [];
  }

  let aids = jobAidIndex;

  if (brand) {
    const normalizedBrand = normalizeBrand(brand);
    aids = jobAidIndex.filter(aid =>
      aid.brand.toLowerCase() === normalizedBrand.toLowerCase()
    );
  }

  return aids.map(aid => ({
    brand: aid.brand,
    fileName: aid.fileName
  }));
}

/**
 * Force re-scan of OEM_KNOWLEDGE directory
 * Use this if new PDFs were added at runtime
 * @returns {Promise<void>}
 */
export async function rescan() {
  initialized = false;
  jobAidIndex = null;
  await scanDirectory();
}

/**
 * Get summary of indexed job aids
 * @returns {Promise<Object>}
 */
export async function getSummary() {
  await initIfNeeded();

  if (!jobAidIndex) {
    return {
      totalJobAids: 0,
      brands: [],
      directory: OEM_KNOWLEDGE_DIR,
      exists: fs.existsSync(OEM_KNOWLEDGE_DIR)
    };
  }

  const brandCounts = {};
  for (const aid of jobAidIndex) {
    brandCounts[aid.brand] = (brandCounts[aid.brand] || 0) + 1;
  }

  return {
    totalJobAids: jobAidIndex.length,
    brands: Object.keys(brandCounts).sort(),
    brandCounts,
    directory: OEM_KNOWLEDGE_DIR,
    exists: true
  };
}

export default {
  initIfNeeded,
  getJobAidsForBrand,
  getAllJobAids,
  getBrandsWithJobAids,
  hasJobAidsForBrand,
  getJobAidMetadata,
  rescan,
  getSummary
};
