/**
 * Instructions Loader
 *
 * Centralized module for loading assistant instructions.
 * Uses lazy loading to minimize memory footprint.
 *
 * Usage:
 *   import instructions from './config/instructions/index.js';
 *
 *   // Get OPS instructions
 *   const opsPrompt = instructions.getOps();
 *
 *   // Get TECH instructions
 *   const techPrompt = instructions.getTech();
 *
 *   // Get system config
 *   const systemConfig = instructions.getSystem();
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache for lazy loading
const _cache = {
  ops: null,
  tech: null,
  system: null,
  transfer: null
};

/**
 * Load a file from the instructions directory
 * @param {string} filename - File name (with extension)
 * @returns {string|null} File content or null on error
 */
function _loadFile(filename) {
  const filePath = path.join(__dirname, filename);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error(`[instructions] Error loading ${filename}:`, err.message);
    return null;
  }
}

/**
 * Get OPS assistant instructions
 * @returns {string} OPS instructions content
 */
function getOps() {
  if (_cache.ops === null) {
    _cache.ops = _loadFile('ops.md');
  }
  return _cache.ops;
}

/**
 * Get TECH assistant instructions
 * @returns {string} TECH instructions content
 */
function getTech() {
  if (_cache.tech === null) {
    _cache.tech = _loadFile('tech.md');
  }
  return _cache.tech;
}

/**
 * Get system configuration
 * @returns {string} System config content
 */
function getSystem() {
  if (_cache.system === null) {
    _cache.system = _loadFile('system.md');
  }
  return _cache.system;
}

/**
 * Get transfer protocol
 * @returns {string} Transfer instructions content
 */
function getTransfer() {
  if (_cache.transfer === null) {
    _cache.transfer = _loadFile('transfer.md');
  }
  return _cache.transfer;
}

/**
 * Get combined instructions for an assistant type
 * @param {'ops'|'tech'} type - Assistant type
 * @returns {string} Combined instructions
 */
function getInstructionsFor(type) {
  if (type === 'ops') {
    return getOps();
  } else if (type === 'tech') {
    return getTech();
  }
  throw new Error(`Unknown assistant type: ${type}`);
}

/**
 * Clear cache (useful for hot reload during development)
 */
function clearCache() {
  _cache.ops = null;
  _cache.tech = null;
  _cache.system = null;
  _cache.transfer = null;
}

/**
 * Get all instruction file paths
 * @returns {Object} Map of type to file path
 */
function getPaths() {
  return {
    ops: path.join(__dirname, 'ops.md'),
    tech: path.join(__dirname, 'tech.md'),
    system: path.join(__dirname, 'system.md'),
    transfer: path.join(__dirname, 'transfer.md')
  };
}

export default {
  getOps,
  getTech,
  getSystem,
  getTransfer,
  getInstructionsFor,
  clearCache,
  getPaths
};

// Also export individual functions for direct import
export { getOps, getTech, getSystem, getTransfer, getInstructionsFor, clearCache, getPaths };
