/**
 * DOWNLOAD_PLAN.md Lazy Loader
 *
 * Provides on-demand access to OEM download plan sections
 * without loading the entire file into memory at startup.
 *
 * Usage:
 *   import downloadPlan from './utils/downloadPlan.js';
 *
 *   // Get specific OEM section
 *   const toyotaInfo = downloadPlan.getOEMSection('Toyota');
 *
 *   // Get priority level info
 *   const criticalDocs = downloadPlan.getPrioritySection(1);
 *
 *   // Get full content (only when needed)
 *   const fullPlan = downloadPlan.getFullContent();
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to DOWNLOAD_PLAN.md in docs folder
const PLAN_PATH = path.join(__dirname, '..', 'docs', 'DOWNLOAD_PLAN.md');

// Cache for loaded content (lazy loaded)
let _cachedContent = null;
let _cachedSections = null;

/**
 * Get full content of DOWNLOAD_PLAN.md
 * Loads file only when first called, then caches
 * @returns {string} Full markdown content
 */
function getFullContent() {
  if (_cachedContent === null) {
    try {
      _cachedContent = fs.readFileSync(PLAN_PATH, 'utf-8');
    } catch (err) {
      console.error('[downloadPlan] Error loading DOWNLOAD_PLAN.md:', err.message);
      return null;
    }
  }
  return _cachedContent;
}

/**
 * Parse content into sections by OEM/heading
 * @returns {Object} Map of section names to content
 */
function _parseSections() {
  if (_cachedSections !== null) {
    return _cachedSections;
  }

  const content = getFullContent();
  if (!content) {
    _cachedSections = {};
    return _cachedSections;
  }

  _cachedSections = {};

  // Split by ## and ### headers
  const lines = content.split('\n');
  let currentSection = 'intro';
  let currentContent = [];

  for (const line of lines) {
    // Match ## or ### headers
    const headerMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headerMatch) {
      // Save previous section
      if (currentContent.length > 0) {
        _cachedSections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
      }
      // Start new section
      currentSection = headerMatch[1].trim();
      currentContent = [line];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentContent.length > 0) {
    _cachedSections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
  }

  return _cachedSections;
}

/**
 * Get section for a specific OEM
 * @param {string} oem - OEM name (e.g., 'Toyota', 'Honda', 'BMW')
 * @returns {string|null} Section content or null if not found
 */
function getOEMSection(oem) {
  const sections = _parseSections();
  const oemLower = oem.toLowerCase();

  // Try exact match first
  for (const [key, content] of Object.entries(sections)) {
    if (key.includes(oemLower)) {
      return content;
    }
  }

  // Try partial match for combined OEMs (e.g., "Toyota / Lexus")
  for (const [key, content] of Object.entries(sections)) {
    const normalizedKey = key.replace(/\s+/g, ' ').toLowerCase();
    if (normalizedKey.includes(oemLower)) {
      return content;
    }
  }

  return null;
}

/**
 * Get documents by priority level
 * @param {number} priority - Priority level (1-4)
 * @returns {string|null} Priority description or null
 */
function getPrioritySection(priority) {
  const sections = _parseSections();

  // Look for priority-related section
  const prioritySection = sections['download priority levels'];
  if (prioritySection) {
    // Extract specific priority info
    const priorityRegex = new RegExp(`\\*\\*Priority ${priority}[^*]+\\*\\*:?\\s*([^\\n]+)`, 'i');
    const match = prioritySection.match(priorityRegex);
    if (match) {
      return `Priority ${priority}: ${match[1].trim()}`;
    }
  }

  return null;
}

/**
 * Get update schedule information
 * @returns {string|null} Update schedule section
 */
function getUpdateSchedule() {
  const sections = _parseSections();
  return sections['update schedule summary'] || null;
}

/**
 * Get list of all OEMs covered in the plan
 * @returns {string[]} Array of OEM names
 */
function getOEMList() {
  const sections = _parseSections();
  const oems = [];

  // OEMs have sections with specific portal info
  const oemPatterns = [
    'toyota', 'lexus', 'honda', 'acura', 'nissan', 'infiniti', 'subaru',
    'volkswagen', 'audi', 'bmw', 'mercedes', 'gm', 'chevrolet', 'buick',
    'gmc', 'cadillac', 'ford', 'lincoln', 'stellantis', 'hyundai', 'kia',
    'genesis', 'tesla'
  ];

  for (const key of Object.keys(sections)) {
    for (const oem of oemPatterns) {
      if (key.includes(oem) && !oems.includes(key)) {
        oems.push(key);
        break;
      }
    }
  }

  return oems;
}

/**
 * Check if DOWNLOAD_PLAN.md exists
 * @returns {boolean}
 */
function exists() {
  try {
    fs.accessSync(PLAN_PATH, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear cached content (useful for hot reload)
 */
function clearCache() {
  _cachedContent = null;
  _cachedSections = null;
}

export default {
  getFullContent,
  getOEMSection,
  getPrioritySection,
  getUpdateSchedule,
  getOEMList,
  exists,
  clearCache,
  // Path exposed for reference
  filePath: PLAN_PATH
};
