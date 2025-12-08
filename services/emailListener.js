/**
 * emailListener.js - Gmail API listener for radarsolutionsus@gmail.com
 *
 * CONFIGURATION:
 * - Gmail Account: radarsolutionsus@gmail.com
 * - Source Label: "ADAS FIRST" (only emails with this label are processed)
 * - Processed Label: "ADAS_FIRST_PROCESSED" (added after processing)
 * - Authentication: OAuth2 credentials for radarsolutionsus@gmail.com
 *
 * Monitors the "ADAS FIRST" label for new emails with PDF attachments.
 * Processes each email through the PDF → Drive → Sheets pipeline.
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Ensure environment variables are loaded before importing other modules
dotenv.config();

import driveUpload from './driveUpload.js';
import pdfParser from './pdfParser.js';
import sheetWriter, { getGmailTokenFromSheets, saveGmailTokenToSheets, getShopEmailByName } from './sheetWriter.js';
import billingMailer from './billingMailer.js';
// DEPRECATED: AI scrubbing removed - all estimate analysis done manually in RevvADAS
// import { formatScrubResultsAsNotes, getScrubSummary, formatPreviewNotes, formatFullScrub, analyzeEstimateWithLLM } from './estimateScrubber.js';
// import { reconcileCalibrations, normalizeToSystem, parseRevvCalibrations } from '../src/scrub/revvReconciler.js';
import jobState from '../data/jobState.js';
import shopNotifier from './shopNotifier.js';
import emailResponder from './emailResponder.js';
import { getESTTimestamp, getESTISOTimestamp, formatToEST } from '../utils/timezone.js';

const LOG_TAG = '[EMAIL_PIPELINE]';

/**
 * Make name mapping - convert abbreviated/truncated make names to full names
 * VIN decoders sometimes return abbreviated versions
 */
const MAKE_NAME_MAP = {
  'TOYO': 'Toyota', 'HOND': 'Honda', 'NISS': 'Nissan',
  'FORD': 'Ford', 'CHEV': 'Chevrolet', 'GMC': 'GMC',
  'GENE': 'Genesis', 'HYUN': 'Hyundai', 'KIA': 'Kia',
  'BMW': 'BMW', 'MERC': 'Mercedes-Benz', 'AUDI': 'Audi',
  'VOLK': 'Volkswagen', 'LEXU': 'Lexus', 'ACUR': 'Acura',
  'INFI': 'Infiniti', 'MAZD': 'Mazda', 'SUBA': 'Subaru',
  'DODG': 'Dodge', 'JEEP': 'Jeep', 'RAM': 'Ram',
  'CADI': 'Cadillac', 'BUIC': 'Buick', 'LINC': 'Lincoln',
  'CHRY': 'Chrysler', 'TESL': 'Tesla', 'PORS': 'Porsche',
  'VOLV': 'Volvo', 'JAGU': 'Jaguar', 'LAND': 'Land Rover'
};

/**
 * Clean make name - convert abbreviated names to full names
 * @param {string} rawMake - Raw make name (possibly abbreviated)
 * @returns {string} - Cleaned make name
 */
function cleanMakeName(rawMake) {
  if (!rawMake) return '';
  const firstWord = rawMake.split(/\s+/)[0].toUpperCase();
  // Check if it's an abbreviation
  if (MAKE_NAME_MAP[firstWord]) {
    return MAKE_NAME_MAP[firstWord];
  }
  // Check if it's already a full name (return as-is with proper casing)
  const values = Object.values(MAKE_NAME_MAP);
  const matchedFull = values.find(v => v.toUpperCase() === firstWord);
  if (matchedFull) {
    return matchedFull;
  }
  // Return first word with title case
  return rawMake.split(/\s+/)[0].charAt(0).toUpperCase() + rawMake.split(/\s+/)[0].slice(1).toLowerCase();
}

/**
 * OEM1Stop Portal Links - central hub for all OEM position statements
 * Used to populate Column U with clickable links
 */
const OEM1STOP_LINKS = {
  'toyota': 'https://www.oem1stop.com/content/toyota',
  'lexus': 'https://www.oem1stop.com/content/lexus',
  'scion': 'https://www.oem1stop.com/content/toyota',
  'honda': 'https://www.oem1stop.com/content/honda',
  'acura': 'https://www.oem1stop.com/content/acura',
  'nissan': 'https://www.oem1stop.com/content/nissan',
  'infiniti': 'https://www.oem1stop.com/content/infiniti',
  'subaru': 'https://www.oem1stop.com/content/subaru',
  'mazda': 'https://www.oem1stop.com/content/mazda',
  'mitsubishi': 'https://www.oem1stop.com/content/mitsubishi',
  'hyundai': 'https://www.oem1stop.com/content/hyundai',
  'kia': 'https://www.oem1stop.com/content/kia',
  'genesis': 'https://www.oem1stop.com/content/genesis',
  'bmw': 'https://www.oem1stop.com/content/bmw',
  'mini': 'https://www.oem1stop.com/content/mini',
  'mercedes-benz': 'https://www.oem1stop.com/content/mercedes-benz',
  'mercedes': 'https://www.oem1stop.com/content/mercedes-benz',
  'audi': 'https://www.oem1stop.com/content/audi',
  'volkswagen': 'https://www.oem1stop.com/content/volkswagen',
  'vw': 'https://www.oem1stop.com/content/volkswagen',
  'porsche': 'https://www.oem1stop.com/content/porsche',
  'ford': 'https://www.oem1stop.com/content/ford',
  'lincoln': 'https://www.oem1stop.com/content/lincoln',
  'chevrolet': 'https://www.oem1stop.com/content/chevrolet',
  'chevy': 'https://www.oem1stop.com/content/chevrolet',
  'gmc': 'https://www.oem1stop.com/content/gmc',
  'cadillac': 'https://www.oem1stop.com/content/cadillac',
  'buick': 'https://www.oem1stop.com/content/buick',
  'gm': 'https://www.oem1stop.com/content/gm',
  'chrysler': 'https://www.oem1stop.com/content/fca',
  'dodge': 'https://www.oem1stop.com/content/fca',
  'jeep': 'https://www.oem1stop.com/content/fca',
  'ram': 'https://www.oem1stop.com/content/fca',
  'fiat': 'https://www.oem1stop.com/content/fca',
  'alfa romeo': 'https://www.oem1stop.com/content/fca',
  'tesla': 'https://www.oem1stop.com/content/tesla',
  'volvo': 'https://www.oem1stop.com/content/volvo',
  'jaguar': 'https://www.oem1stop.com/content/jaguar',
  'land rover': 'https://www.oem1stop.com/content/land-rover',
  'range rover': 'https://www.oem1stop.com/content/land-rover'
};

/**
 * Get OEM1Stop portal link for a vehicle brand
 * @param {string} brand - Vehicle brand name
 * @returns {string|null} - OEM1Stop URL or null if not found
 */
function getOEM1StopLink(brand) {
  if (!brand) return null;
  const normalized = brand.toLowerCase().trim();
  return OEM1STOP_LINKS[normalized] || null;
}

/**
 * Format timestamp to MM/DD/YY h:mm AM/PM in EST
 * Example: "12/03/25 10:54 PM EST"
 * @param {string|Date} timestamp - ISO string or Date object
 * @returns {string} - Formatted timestamp in EST
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return getESTTimestamp();

  let date;
  if (typeof timestamp === 'string') {
    date = new Date(timestamp);
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else {
    return String(timestamp);
  }

  if (isNaN(date.getTime())) {
    return String(timestamp);
  }

  // Format in EST timezone
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gmail configuration - MUST use radarsolutionsus@gmail.com
const GMAIL_USER = 'radarsolutionsus@gmail.com';
const SOURCE_LABEL_NAME = 'ADAS FIRST';
const PROCESSED_LABEL_NAME = 'ADAS_FIRST_PROCESSED';
const POLL_INTERVAL_MS = parseInt(process.env.EMAIL_POLL_INTERVAL_MS) || 60000; // 1 minute default

// Paths for OAuth and tracking (credentials now in /credentials/ folder)
const OAUTH_CREDENTIALS_PATH = process.env.GMAIL_OAUTH_CREDENTIALS_PATH ||
  path.join(__dirname, '../credentials/google-oauth-client.json');
const OAUTH_TOKEN_PATH = process.env.GMAIL_OAUTH_TOKEN_PATH ||
  path.join(__dirname, '../credentials/gmail_oauth_token.json');
const PROCESSED_IDS_PATH = path.join(__dirname, '../data/processed_email_ids.json');

/**
 * Get OAuth credentials from env var (Railway) or file (local dev)
 * @returns {object} - Parsed credentials object
 */
function getOAuthCredentials() {
  // Try env var first (Railway deployment)
  if (process.env.GMAIL_OAUTH_CREDENTIALS_JSON) {
    console.log(`${LOG_TAG} Loading OAuth credentials from environment variable`);
    return JSON.parse(process.env.GMAIL_OAUTH_CREDENTIALS_JSON);
  }
  // Fall back to file (local development)
  if (fs.existsSync(OAUTH_CREDENTIALS_PATH)) {
    console.log(`${LOG_TAG} Loading OAuth credentials from file: ${OAUTH_CREDENTIALS_PATH}`);
    return JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_PATH, 'utf8'));
  }
  throw new Error(`No Gmail OAuth credentials found. Set GMAIL_OAUTH_CREDENTIALS_JSON env var or provide file at ${OAUTH_CREDENTIALS_PATH}`);
}

/**
 * Get OAuth token from Google Sheets (Railway), env var, or file (local dev)
 * Priority: 1. Google Sheets Config tab, 2. Env var, 3. Local file
 * @returns {Promise<object>} - Parsed token object
 */
async function getOAuthToken() {
  // Try Google Sheets first (Railway - persists refreshed tokens)
  try {
    const sheetsToken = await getGmailTokenFromSheets();
    if (sheetsToken) {
      console.log(`${LOG_TAG} Loading OAuth token from Google Sheets Config tab`);
      return sheetsToken;
    }
  } catch (err) {
    console.log(`${LOG_TAG} Could not read token from Sheets: ${err.message}`);
  }

  // Try env var second (Railway fallback)
  if (process.env.GMAIL_OAUTH_TOKEN_JSON) {
    console.log(`${LOG_TAG} Loading OAuth token from environment variable`);
    return JSON.parse(process.env.GMAIL_OAUTH_TOKEN_JSON);
  }

  // Fall back to file (local development)
  if (fs.existsSync(OAUTH_TOKEN_PATH)) {
    console.log(`${LOG_TAG} Loading OAuth token from file: ${OAUTH_TOKEN_PATH}`);
    return JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH, 'utf8'));
  }

  throw new Error(`No Gmail OAuth token found. Set GMAIL_OAUTH_TOKEN_JSON env var or provide file at ${OAUTH_TOKEN_PATH}. Run: node scripts/gmail-auth.js`);
}

/**
 * Save OAuth token to Google Sheets (Railway) or file (local dev)
 * @param {object} token - Token object to save
 */
async function saveOAuthToken(token) {
  // For Railway deployment: save to Google Sheets Config tab
  // This persists the refreshed token so Railway can access it on next restart
  if (process.env.GMAIL_OAUTH_TOKEN_JSON || process.env.RAILWAY_ENVIRONMENT) {
    console.log(`${LOG_TAG} Saving refreshed token to Google Sheets Config tab...`);
    try {
      const result = await saveGmailTokenToSheets(token);
      if (result.success) {
        console.log(`${LOG_TAG} Token saved to Google Sheets Config tab successfully`);
        return;
      } else {
        console.error(`${LOG_TAG} Failed to save token to Sheets: ${result.error}`);
      }
    } catch (err) {
      console.error(`${LOG_TAG} Error saving token to Sheets: ${err.message}`);
    }
    // Log the token as fallback so it can be manually updated if needed
    console.log(`${LOG_TAG} Token (for manual backup): ${JSON.stringify(token)}`);
    return;
  }

  // For local development: save to file
  const dir = path.dirname(OAUTH_TOKEN_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(token, null, 2));
  console.log(`${LOG_TAG} Token saved to ${OAUTH_TOKEN_PATH}`);
}

let gmailClient = null;
let sourceLabelId = null;
let processedLabelId = null;
let isListening = false;
let pollIntervalId = null;

// Track processed message IDs locally as backup
let processedMessageIds = new Set();

/**
 * Load processed message IDs from local JSON file
 */
function loadProcessedIds() {
  try {
    if (fs.existsSync(PROCESSED_IDS_PATH)) {
      const data = JSON.parse(fs.readFileSync(PROCESSED_IDS_PATH, 'utf8'));
      processedMessageIds = new Set(data.messageIds || []);
      console.log(`${LOG_TAG} Loaded ${processedMessageIds.size} processed message IDs`);
    }
  } catch (err) {
    console.error(`${LOG_TAG} Failed to load processed IDs:`, err.message);
    processedMessageIds = new Set();
  }
}

/**
 * Save processed message IDs to local JSON file
 */
function saveProcessedIds() {
  try {
    const dir = path.dirname(PROCESSED_IDS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PROCESSED_IDS_PATH, JSON.stringify({
      messageIds: Array.from(processedMessageIds),
      lastUpdated: getESTISOTimestamp()
    }, null, 2));
  } catch (err) {
    console.error(`${LOG_TAG} Failed to save processed IDs:`, err.message);
  }
}

/**
 * Clear all processed message IDs - allows reprocessing of emails
 */
function clearProcessedIds() {
  processedMessageIds.clear();
  saveProcessedIds();
  console.log(`${LOG_TAG} Cleared all processed message IDs - starting fresh`);
  return true;
}

/**
 * Initialize Gmail client with OAuth2 credentials for radarsolutionsus@gmail.com
 * Supports both environment variables (Railway) and file-based credentials (local dev)
 */
async function initializeGmailClient() {
  if (gmailClient) return gmailClient;

  try {
    // Load OAuth credentials (from env var or file)
    const credentials = getOAuthCredentials();
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
    );

    // Load existing token (from Sheets, env var, or file - in that priority)
    const token = await getOAuthToken();
    oauth2Client.setCredentials(token);

    // Check if token needs refresh
    if (token.expiry_date && token.expiry_date < Date.now()) {
      console.log(`${LOG_TAG} Token expired, refreshing...`);
      const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newCredentials);
      await saveOAuthToken(newCredentials);
    }

    gmailClient = google.gmail({ version: 'v1', auth: oauth2Client });
    console.log(`${LOG_TAG} Gmail client initialized for ${GMAIL_USER}`);

    // Load processed IDs
    loadProcessedIds();

    // Get or create labels
    await ensureLabels();

    return gmailClient;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to initialize Gmail client:`, err.message);
    throw err;
  }
}

/**
 * Ensure the source and processed labels exist
 */
async function ensureLabels() {
  const gmail = gmailClient;

  try {
    const response = await gmail.users.labels.list({ userId: 'me' });
    const labels = response.data.labels || [];

    // Find source label "ADAS FIRST"
    const sourceLabel = labels.find(l => l.name === SOURCE_LABEL_NAME);
    if (sourceLabel) {
      sourceLabelId = sourceLabel.id;
      console.log(`${LOG_TAG} Found source label: ${SOURCE_LABEL_NAME} (${sourceLabelId})`);
    } else {
      console.error(`${LOG_TAG} SOURCE LABEL "${SOURCE_LABEL_NAME}" NOT FOUND!`);
      console.error(`${LOG_TAG} Please create the label "${SOURCE_LABEL_NAME}" in Gmail first.`);
      throw new Error(`Label "${SOURCE_LABEL_NAME}" not found in ${GMAIL_USER}`);
    }

    // Find or create processed label
    const processedLabel = labels.find(l => l.name === PROCESSED_LABEL_NAME);
    if (processedLabel) {
      processedLabelId = processedLabel.id;
      console.log(`${LOG_TAG} Found processed label: ${PROCESSED_LABEL_NAME}`);
    } else {
      // Create the processed label
      const createResponse = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: PROCESSED_LABEL_NAME,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        }
      });
      processedLabelId = createResponse.data.id;
      console.log(`${LOG_TAG} Created processed label: ${PROCESSED_LABEL_NAME}`);
    }
  } catch (err) {
    console.error(`${LOG_TAG} Failed to ensure labels:`, err.message);
    throw err;
  }
}

/**
 * Extract RO/PO from text using multiple patterns
 * @param {string} text - Text to search
 * @returns {string|null} - Extracted RO/PO or null
 */
function extractRoFromText(text) {
  if (!text) return null;

  // Pattern 1: Explicit RO/PO prefixes
  const explicitMatch = text.match(/(?:RO|R\.O\.|PO|P\.O\.|Repair\s*Order|Estimate)[\s#\-:]*([A-Z0-9\-]{3,})/i);
  if (explicitMatch) return explicitMatch[1].toUpperCase();

  // Pattern 2: Invoice/Work Order numbers
  const invoiceMatch = text.match(/(?:Invoice|Work\s*Order|WO)[\s#\-:]*([A-Z0-9\-]{3,})/i);
  if (invoiceMatch) return invoiceMatch[1].toUpperCase();

  // Pattern 3: Standalone 4-6 digit number at start of text or on its own line
  const standaloneMatch = text.match(/(?:^|\n)\s*(\d{4,6})\s*(?:\n|$|[,.\s])/);
  if (standaloneMatch) return standaloneMatch[1];

  return null;
}

/**
 * Extract RO/PO from PDF filename
 * @param {string} filename - PDF filename
 * @returns {string|null} - Extracted RO/PO or null
 */
function extractRoFromFilename(filename) {
  if (!filename) return null;

  // Remove extension
  const name = filename.replace(/\.pdf$/i, '');

  // Pattern 1: Filename is just a number (e.g., "3045.pdf")
  if (/^\d{3,6}$/.test(name)) {
    return name;
  }

  // Pattern 2: RO/PO prefix in filename
  const prefixMatch = name.match(/(?:RO|PO|WO)[\s_\-]*(\d{3,})/i);
  if (prefixMatch) return prefixMatch[1];

  // Pattern 3: Number at start or end of filename
  const numberMatch = name.match(/(?:^|[\s_\-])(\d{4,6})(?:[\s_\-]|$)/);
  if (numberMatch) return numberMatch[1];

  return null;
}

/**
 * Extract vehicle information (year, make, model, VIN) from estimate PDF text
 * @param {string} estimateText - Full extracted PDF text
 * @returns {object} - { year, make, model, vin, vehicle }
 */
function extractVehicleFromEstimate(estimateText) {
  if (!estimateText) return {};

  const result = {};

  // VIN patterns - 17 character alphanumeric (excluding I, O, Q)
  const vinPatterns = [
    /VIN[\s:]*([A-HJ-NPR-Z0-9]{17})/i,
    /V\.I\.N\.[\s:]*([A-HJ-NPR-Z0-9]{17})/i,
    /Vehicle\s*ID[\s:]*([A-HJ-NPR-Z0-9]{17})/i,
    // Standalone 17-char VIN pattern
    /\b([A-HJ-NPR-Z0-9]{17})\b/
  ];

  for (const pattern of vinPatterns) {
    const match = estimateText.match(pattern);
    if (match && match[1]) {
      result.vin = match[1].toUpperCase();
      console.log(`${LOG_TAG} Extracted VIN from estimate: ${result.vin}`);
      break;
    }
  }

  // Year/Make/Model patterns
  const vehiclePatterns = [
    // "2024 Toyota Camry" or "2024 TOYOTA CAMRY"
    /\b(20[0-2]\d|19\d\d)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+([A-Za-z0-9\-]+(?:\s+[A-Za-z0-9\-]+)?)/,
    // "Year: 2024  Make: Toyota  Model: Camry"
    /Year[\s:]+(\d{4})[\s,;]+Make[\s:]+([A-Za-z]+)[\s,;]+Model[\s:]+([A-Za-z0-9\-\s]+)/i,
    // "Vehicle: 2024 Toyota Camry"
    /Vehicle[\s:]+(\d{4})\s+([A-Za-z]+)\s+([A-Za-z0-9\-\s]+)/i
  ];

  for (const pattern of vehiclePatterns) {
    const match = estimateText.match(pattern);
    if (match) {
      result.year = match[1];
      result.make = match[2].trim();
      result.model = match[3].trim();
      result.vehicle = `${result.year} ${result.make} ${result.model}`;
      console.log(`${LOG_TAG} Extracted vehicle from estimate: ${result.vehicle}`);
      break;
    }
  }

  // If VIN found but no vehicle info, try to decode make from VIN
  if (result.vin && !result.make) {
    const vinMake = getVinMake(result.vin);
    if (vinMake) {
      result.make = vinMake;
      console.log(`${LOG_TAG} Decoded make from VIN: ${vinMake}`);
    }
  }

  return result;
}

/**
 * Get vehicle make from VIN using WMI (first 3 chars)
 * @param {string} vin - 17-character VIN
 * @returns {string|null} - Make name or null
 */
function getVinMake(vin) {
  if (!vin || vin.length < 3) return null;

  const wmi = vin.substring(0, 3).toUpperCase();
  const wmi2 = vin.substring(0, 2).toUpperCase();

  // Common WMI codes
  const wmiCodes = {
    // Toyota/Lexus
    'JT': 'Toyota', '4T': 'Toyota', '5T': 'Toyota',
    '2T': 'Lexus', 'JTH': 'Lexus',
    // Honda/Acura
    'JH': 'Honda', '1H': 'Honda', '2H': 'Honda', '5J': 'Honda',
    '19U': 'Acura', 'JH4': 'Acura',
    // Nissan/Infiniti
    'JN': 'Nissan', '1N': 'Nissan', '5N': 'Nissan',
    'JNK': 'Infiniti',
    // Ford/Lincoln
    '1F': 'Ford', '3F': 'Ford',
    '5L': 'Lincoln',
    // GM brands
    '1G': 'GM', '2G': 'GM', '3G': 'GM',
    '1G1': 'Chevrolet', '2G1': 'Chevrolet', '3G1': 'Chevrolet',
    '1GC': 'Chevrolet', '3GC': 'Chevrolet',
    '1GT': 'GMC', '2GT': 'GMC', '3GT': 'GMC',
    '1G6': 'Cadillac', '1GY': 'Cadillac',
    '1G4': 'Buick',
    // Stellantis
    '1C': 'Chrysler', '2C': 'Chrysler', '3C': 'Chrysler',
    '2D': 'Dodge', '3D': 'Dodge',
    '1J': 'Jeep', '1C4': 'Jeep',
    // BMW/Mini
    'WB': 'BMW', '5U': 'BMW',
    'WMW': 'MINI',
    // Mercedes
    'WD': 'Mercedes-Benz', '4J': 'Mercedes-Benz', '55': 'Mercedes-Benz',
    // VW/Audi/Porsche
    'WV': 'Volkswagen', '3V': 'Volkswagen',
    'WAU': 'Audi', 'WA1': 'Audi',
    'WP0': 'Porsche', 'WP1': 'Porsche',
    // Hyundai/Kia/Genesis
    'KM': 'Hyundai', '5N': 'Hyundai',
    'KNA': 'Kia', 'KND': 'Kia', '5X': 'Kia',
    'KMH': 'Genesis',
    // Subaru
    'JF': 'Subaru', '4S': 'Subaru',
    // Mazda
    'JM': 'Mazda', '1YV': 'Mazda',
    // Tesla
    '5YJ': 'Tesla',
    // Volvo
    'YV': 'Volvo'
  };

  // Check 3-char WMI first, then 2-char
  return wmiCodes[wmi] || wmiCodes[wmi2] || null;
}

/**
 * Extract RO/PO from estimate document content
 * Enhanced patterns for estimates: RO#, Work Order, PO#, Claim#, File#
 * @param {string} estimateText - Full extracted PDF text
 * @returns {string|null} - Extracted RO/PO or null
 */
function extractRoFromEstimate(estimateText) {
  if (!estimateText) return null;

  // RO patterns in PRIORITY ORDER - RO Number MUST come FIRST!
  // NOTE: Claim/File/Reference patterns are EXCLUDED - these are insurance IDs, not RO numbers
  const patterns = [
    // HIGHEST PRIORITY: "RO Number: 12313-1" (allows alphanumeric with hyphens)
    /RO\s*Number[\s:]+([A-Za-z0-9]+-?[A-Za-z0-9]*)/i,
    // "RO #12345" or "RO: 12345" format
    /(?:^|\s)RO[\s#:\-]+([A-Za-z0-9]+-?[A-Za-z0-9]*)/i,
    // "R.O. 12345" format
    /R\.O\.[\s#:\-]*([A-Za-z0-9]+-?[A-Za-z0-9]*)/i,
    // "Repair Order: 12345" format
    /Repair\s*Order[\s#:\-]*([A-Za-z0-9]+-?[A-Za-z0-9]*)/i,
    // "Work Order: 12345" format
    /Work\s*Order[\s#:\-]*([A-Za-z0-9]+-?[A-Za-z0-9]*)/i,
    // "WO: 12345" format
    /(?:^|\s)WO[\s#:\-]+([A-Za-z0-9]+-?[A-Za-z0-9]*)/i,
    // PO patterns: "PO#12345", "PO: 12345"
    /(?:^|\s)PO[\s#:\-]+([A-Za-z0-9]+-?[A-Za-z0-9]*)/i,
    /P\.O\.[\s#:\-]*([A-Za-z0-9]+-?[A-Za-z0-9]*)/i,
    // Order patterns: "Order #12345"
    /Order[\s#:\-]*(\d{4,10})/i,
    // Estimate number patterns: "Estimate #12345"
    /Estimate[\s#:\-]*(\d{4,10})/i
    // NOTE: Claim/File/Reference patterns REMOVED - these are NOT RO numbers!
  ];

  for (const pattern of patterns) {
    const match = estimateText.match(pattern);
    if (match) {
      const ro = match[1].trim();
      // Skip if it looks like a claim number (too long or has multiple dashes like X-X-X)
      if (ro.length > 15 || /^\d+-\d+-\d+/.test(ro) || /^\d{10,}$/.test(ro)) {
        console.log(`${LOG_TAG} Skipping potential claim/insurance number: ${ro}`);
        continue;
      }
      console.log(`${LOG_TAG} Extracted RO from estimate content: ${ro} (pattern: ${pattern.toString().substring(0, 40)}...)`);
      return ro;
    }
  }

  return null;
}

/**
 * Extract RO/PO from PDF text content
 * @param {string} pdfText - Extracted PDF text
 * @returns {string|null} - Extracted RO/PO or null
 */
function extractRoFromPdfText(pdfText) {
  if (!pdfText) return null;

  // Try estimate-specific patterns first (more comprehensive)
  const fromEstimate = extractRoFromEstimate(pdfText);
  if (fromEstimate) return fromEstimate;

  // Try explicit patterns
  const explicit = extractRoFromText(pdfText);
  if (explicit) return explicit;

  // Look for RO in common estimate/invoice headers (first 500 chars)
  const header = pdfText.substring(0, 500);

  // Pattern: Number near keywords like "Estimate", "Invoice", "Repair"
  const nearKeyword = header.match(/(?:estimate|invoice|repair|work\s*order)[^\d]*(\d{4,6})/i);
  if (nearKeyword) return nearKeyword[1];

  return null;
}

/**
 * Generate a synthetic RO for emails without identifiable RO/PO
 * @param {string} messageId - Gmail message ID
 * @returns {string} - Synthetic RO in format "NO-RO-<timestamp>"
 */
function generateSyntheticRo(messageId) {
  // Use timestamp + last 4 chars of messageId for uniqueness
  const timestamp = Date.now();
  const suffix = messageId ? messageId.slice(-4) : Math.random().toString(36).slice(-4);
  return `NO-RO-${timestamp}-${suffix}`;
}

/**
 * Parse email subject to extract RO/PO number
 */
function parseEmailSubject(subject) {
  if (!subject) return { roPo: null, subjectType: 'unknown' };

  // Match patterns like "RO 11977", "RO 11977-PM", "PO 12345", etc.
  const roMatch = subject.match(/(?:RO|R\.O\.|PO|P\.O\.)[\s#\-:]*([A-Z0-9\-]+)/i);

  if (roMatch) {
    return {
      roPo: roMatch[1].toUpperCase(),
      subjectType: 'calibration_documents'
    };
  }

  return { roPo: null, subjectType: 'unknown' };
}

/**
 * Parse email body for additional information
 */
function parseEmailBody(body) {
  if (!body) return {};

  const info = {};

  // Try to extract VIN
  const vinMatch = body.match(/VIN[\s:]*([A-HJ-NPR-Z0-9]{17})/i);
  if (vinMatch) info.vin = vinMatch[1];

  // Try to extract shop name - improved patterns
  const shopPatterns = [
    /(?:shop|taller|from|sender)[:\s]+([A-Za-z][A-Za-z\s&'\.]+?)(?:\n|,|\||$)/i,
    /(?:body\s*shop|collision\s*center|auto\s*body)[:\s]*([A-Za-z][A-Za-z\s&'\.]+?)(?:\n|,|\||$)/i,
    /^([A-Za-z][A-Za-z\s&'\.]+(?:auto|body|collision|shop|motors|service)[A-Za-z\s]*)/im
  ];

  for (const pattern of shopPatterns) {
    const match = body.match(pattern);
    if (match && match[1] && match[1].trim().length >= 3 && match[1].trim().length <= 50) {
      info.shopName = match[1].trim();
      break;
    }
  }

  // Try to extract technician name
  const techMatch = body.match(/(?:technician|tech|técnico)[\s:]*([A-Za-z]+)/i);
  if (techMatch) info.technician = techMatch[1].trim();

  // Don't add body as notes - it causes duplication issues
  // Only capture explicit notes if specifically labeled
  const notesMatch = body.match(/(?:notes?|comments?)[:\s]+(.+?)(?:\n\n|$)/is);
  if (notesMatch && notesMatch[1].trim().length > 0) {
    info.notes = notesMatch[1].trim().substring(0, 300);
  }

  return info;
}

/**
 * Get PDF attachments from a Gmail message
 * ONLY extracts application/pdf attachments
 */
async function getPDFAttachments(message) {
  const gmail = gmailClient;
  const attachments = [];

  function findPDFParts(parts) {
    if (!parts) return;

    for (const part of parts) {
      // ONLY process application/pdf attachments
      if (part.mimeType === 'application/pdf' && part.body.attachmentId) {
        attachments.push({
          filename: part.filename,
          attachmentId: part.body.attachmentId
        });
      }

      if (part.parts) {
        findPDFParts(part.parts);
      }
    }
  }

  findPDFParts(message.payload.parts);

  // Also check main body if no parts (rare for emails with attachments)
  if (message.payload.mimeType === 'application/pdf' && message.payload.body?.attachmentId) {
    attachments.push({
      filename: message.payload.filename || 'document.pdf',
      attachmentId: message.payload.body.attachmentId
    });
  }

  console.log(`${LOG_TAG} Found ${attachments.length} PDF attachment(s)`);

  // Download attachment data
  const results = [];
  for (const att of attachments) {
    try {
      const response = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: message.id,
        id: att.attachmentId
      });

      // Gmail returns base64url encoded data
      const buffer = Buffer.from(response.data.data, 'base64');
      results.push({
        buffer,
        filename: att.filename
      });
      console.log(`${LOG_TAG} Downloaded: ${att.filename} (${buffer.length} bytes)`);
    } catch (err) {
      console.error(`${LOG_TAG} Failed to download attachment ${att.filename}:`, err.message);
    }
  }

  return results;
}

/**
 * Get plain text body from message
 */
function getEmailBody(message) {
  function findTextPart(parts) {
    if (!parts) return null;

    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf8');
      }
      if (part.parts) {
        const found = findTextPart(part.parts);
        if (found) return found;
      }
    }
    return null;
  }

  // Check for simple body
  if (message.payload.body?.data) {
    return Buffer.from(message.payload.body.data, 'base64').toString('utf8');
  }

  // Check parts
  return findTextPart(message.payload.parts) || '';
}

/**
 * Mark an email as processed:
 * 1. Add ADAS_FIRST_PROCESSED label
 * 2. Track messageId in local JSON file
 */
async function markAsProcessed(messageId) {
  const gmail = gmailClient;

  try {
    // Add processed label
    if (processedLabelId) {
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: [processedLabelId]
        }
      });
      console.log(`${LOG_TAG} Added ${PROCESSED_LABEL_NAME} label to message ${messageId}`);
    }

    // Track in local file as backup
    processedMessageIds.add(messageId);
    saveProcessedIds();

  } catch (err) {
    console.error(`${LOG_TAG} Failed to mark as processed:`, err.message);
    // Still track locally even if Gmail label fails
    processedMessageIds.add(messageId);
    saveProcessedIds();
  }
}

/**
 * Check if a message has already been processed
 */
function isAlreadyProcessed(messageId, labelIds) {
  // Check if it has the processed label
  if (labelIds && processedLabelId && labelIds.includes(processedLabelId)) {
    return true;
  }
  // Check local tracking
  return processedMessageIds.has(messageId);
}

/**
 * Process a single email through the pipeline
 */
async function processEmail(message) {
  console.log(`${LOG_TAG} Processing email: ${message.id}`);

  try {
    const gmail = gmailClient;

    // Get full message details
    const fullMessage = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'full'
    });

    // Double-check it hasn't been processed
    if (isAlreadyProcessed(message.id, fullMessage.data.labelIds)) {
      console.log(`${LOG_TAG} Message ${message.id} already processed, skipping`);
      return { success: false, error: 'Already processed' };
    }

    // Verify it has the source label
    if (!fullMessage.data.labelIds?.includes(sourceLabelId)) {
      console.log(`${LOG_TAG} Message ${message.id} missing ${SOURCE_LABEL_NAME} label, skipping`);
      return { success: false, error: 'Missing source label' };
    }

    // Extract headers
    const headers = fullMessage.data.payload.headers;
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
    const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';

    console.log(`${LOG_TAG} Subject: ${subject}`);
    console.log(`${LOG_TAG} From: ${from}`);
    console.log(`${LOG_TAG} Date: ${date}`);

    // Get email body for notes
    const body = getEmailBody(fullMessage.data);
    const bodyInfo = parseEmailBody(body);

    // Try to extract shop name from "From" header if not in body
    if (!bodyInfo.shopName && from) {
      // Pattern: "Shop Name <email@domain.com>" or just email
      const fromNameMatch = from.match(/^([^<]+)\s*</);
      if (fromNameMatch && fromNameMatch[1].trim().length >= 3) {
        const fromName = fromNameMatch[1].trim().replace(/"/g, '');
        // Check if it looks like a business name (not a person's name)
        if (/\b(auto|body|collision|shop|motors?|service|repair|garage|center)\b/i.test(fromName)) {
          bodyInfo.shopName = fromName;
          console.log(`${LOG_TAG} Shop name extracted from email From header: ${fromName}`);
        }
      }
    }

    // Get PDF attachments ONLY
    const pdfs = await getPDFAttachments(fullMessage.data);
    if (pdfs.length === 0) {
      console.log(`${LOG_TAG} No PDF attachments found, marking as processed`);
      await markAsProcessed(message.id);
      return { success: false, error: 'No PDF attachments', messageId: message.id };
    }

    // === RO/PO EXTRACTION CHAIN ===
    // Priority: PDF content > Email subject > Email body > Filename > Synthetic
    // This ensures RO from estimate/RevvADAS PDFs takes precedence over subject line
    let roPo = null;
    let roSource = null;
    let isSyntheticRo = false;

    // 1. Try PDF text content FIRST (primary source - from estimate or RevvADAS)
    if (pdfs.length > 0) {
      try {
        const pdfParse = await import('pdf-parse');
        // Check all PDFs for RO, prioritizing estimates
        for (const pdf of pdfs) {
          const pdfData = await pdfParse.default(pdf.buffer);
          const pdfText = pdfData.text || '';

          const pdfRo = extractRoFromPdfText(pdfText);
          if (pdfRo) {
            roPo = pdfRo;
            roSource = `pdf_content:${pdf.filename}`;
            console.log(`${LOG_TAG} Extracted RO from PDF content: ${roPo} (${pdf.filename})`);
            break;
          }
        }
      } catch (pdfErr) {
        console.log(`${LOG_TAG} Could not extract RO from PDF content: ${pdfErr.message}`);
      }
    }

    // 2. Try email subject as fallback
    if (!roPo) {
      const subjectResult = parseEmailSubject(subject);
      if (subjectResult.roPo) {
        roPo = subjectResult.roPo;
        roSource = 'subject';
        console.log(`${LOG_TAG} Found RO in subject (fallback): ${roPo}`);
      }
    }

    // 3. If not in subject, try email body
    if (!roPo) {
      console.log(`${LOG_TAG} No RO found in subject — attempting extraction from body`);
      const bodyRo = extractRoFromText(body);
      if (bodyRo) {
        roPo = bodyRo;
        roSource = 'email_body';
        console.log(`${LOG_TAG} Extracted RO from email body: ${roPo}`);
      }
    }

    // 4. Try PDF filenames
    if (!roPo) {
      for (const pdf of pdfs) {
        const filenameRo = extractRoFromFilename(pdf.filename);
        if (filenameRo) {
          roPo = filenameRo;
          roSource = `filename:${pdf.filename}`;
          console.log(`${LOG_TAG} Extracted RO from PDF filename: ${roPo}`);
          break;
        }
      }
    }

    // 5. Generate synthetic RO if nothing found
    if (!roPo) {
      roPo = generateSyntheticRo(message.id);
      roSource = 'synthetic';
      isSyntheticRo = true;
      console.log(`${LOG_TAG} No RO found anywhere — using synthetic RO: ${roPo}`);
    }

    console.log(`${LOG_TAG} Processing RO: ${roPo} (source: ${roSource})`);
    console.log(`${LOG_TAG} Found ${pdfs.length} PDF attachments for RO ${roPo}`);

    // Step 1: Upload PDFs to Drive
    const uploadResults = await driveUpload.uploadMultiplePDFs(
      pdfs.map(pdf => ({
        buffer: pdf.buffer,
        filename: pdf.filename,
        type: detectPDFType(pdf.filename)
      })),
      roPo
    );

    console.log(`${LOG_TAG} Uploaded ${uploadResults.uploads.length} files to Drive`);

    // Step 2: Parse PDFs for data (pass roPo for estimate scrubbing)
    const mergedData = await pdfParser.parseAndMergePDFs(pdfs, roPo);

    // Add RO from email subject if not found in PDFs
    if (!mergedData.roPo) {
      mergedData.roPo = roPo;
    }

    // Step 2-EXTRA: Extract vehicle info from estimate PDFs if not already set
    // This ensures we capture vehicle/VIN from estimates even when no Revv Report yet
    if (!mergedData.vehicle || !mergedData.vin) {
      for (const pdf of pdfs) {
        const pdfType = detectPDFType(pdf.filename);
        if (pdfType === 'estimate' || pdfType === 'shop_estimate' || pdfType === 'document') {
          try {
            const pdfParse = await import('pdf-parse');
            const pdfData = await pdfParse.default(pdf.buffer);
            const vehicleInfo = extractVehicleFromEstimate(pdfData.text);

            if (vehicleInfo.vin && !mergedData.vin) {
              mergedData.vin = vehicleInfo.vin;
              console.log(`${LOG_TAG} Set VIN from estimate: ${vehicleInfo.vin}`);
            }
            if (vehicleInfo.vehicle && !mergedData.vehicle) {
              // Clean the make name to full form (e.g., "TOYO" -> "Toyota")
              const cleanedMake = cleanMakeName(vehicleInfo.make);
              mergedData.vehicle = vehicleInfo.vehicle;
              mergedData.vehicleYear = vehicleInfo.year;
              mergedData.vehicleMake = cleanedMake;
              mergedData.vehicleModel = vehicleInfo.model;
              console.log(`${LOG_TAG} Set vehicle from estimate: ${vehicleInfo.vehicle} (make cleaned: ${vehicleInfo.make} -> ${cleanedMake})`);
            }
            if (vehicleInfo.make && !mergedData.vehicleMake) {
              mergedData.vehicleMake = cleanMakeName(vehicleInfo.make);
              console.log(`${LOG_TAG} Set make from estimate VIN: ${vehicleInfo.make} -> ${mergedData.vehicleMake}`);
            }
          } catch (parseErr) {
            console.log(`${LOG_TAG} Could not parse estimate for vehicle info: ${parseErr.message}`);
          }
        }
      }
    }

    // Step 2a: CRITICAL - Fetch existing data from Google Sheets
    // This ensures we have RevvADAS calibrations even if they came in a previous email
    try {
      console.log(`${LOG_TAG} Checking for existing sheet data for RO: ${roPo}`);
      const existingRow = await sheetWriter.getScheduleRowByRO(roPo);

      if (existingRow) {
        console.log(`${LOG_TAG} Found existing sheet data for RO: ${roPo}`);

        // Merge existing Required Calibrations (Column J) if not in current email
        if (!mergedData.requiredCalibrationsText && existingRow.required_calibrations) {
          mergedData.requiredCalibrationsText = existingRow.required_calibrations;
          console.log(`${LOG_TAG} Loaded existing RevvADAS calibrations: ${existingRow.required_calibrations}`);
        }

        // Merge existing VIN if not in current email
        if (!mergedData.vin && existingRow.vin) {
          mergedData.vin = existingRow.vin;
          console.log(`${LOG_TAG} Loaded existing VIN: ${existingRow.vin}`);
        }

        // Merge existing vehicle info if not in current email
        if (!mergedData.vehicle && existingRow.vehicle) {
          mergedData.vehicle = existingRow.vehicle;
          console.log(`${LOG_TAG} Loaded existing vehicle: ${existingRow.vehicle}`);
        }

        // CRITICAL: ALWAYS preserve existing shop name from the sheet
        // Revv Reports often extract garbage names like "Provided Instruments"
        // The original estimate has the correct shop name
        const invalidShopNames = [
          'provided instruments', 'revvadas', 'revv', 'calibration',
          'adas', 'unknown', 'n/a', 'na', 'none', 'test'
        ];
        const currentShopLower = (mergedData.shopName || '').toLowerCase().trim();
        const existingShopName = existingRow.shop_name || '';

        // Preserve existing shop name if:
        // 1. Existing row has a shop name AND
        // 2. Current mergedData has no shop name OR has an invalid/suspicious name
        if (existingShopName) {
          const isCurrentInvalid = !mergedData.shopName ||
            invalidShopNames.some(inv => currentShopLower.includes(inv)) ||
            currentShopLower.length < 3;

          if (isCurrentInvalid) {
            console.log(`${LOG_TAG} PRESERVING existing shop name: "${existingShopName}" (current was: "${mergedData.shopName || 'empty'}")`);
            mergedData.shopName = existingShopName;
          }
        }
      } else {
        console.log(`${LOG_TAG} No existing sheet data found for RO: ${roPo}`);
      }
    } catch (sheetErr) {
      console.log(`${LOG_TAG} Could not fetch existing sheet data: ${sheetErr.message}`);
    }

    // Step 2b: Build simple notes (NO SCRUBBING)
    // All calibration analysis is done manually in RevvADAS
    // Notes are simple: vehicle info + document type received
    let previewNotes = '';

    // Build vehicle string for notes
    const vehicleString = mergedData.vehicle ||
      `${mergedData.vehicleYear || ''} ${mergedData.vehicleMake || ''} ${mergedData.vehicleModel || ''}`.trim();

    // Build simple notes based on what documents we received
    const docTypes = [];
    if (mergedData.hasEstimate) docTypes.push('Estimate');
    if (mergedData.revvReportPdf || uploadResults.uploads.some(u => u.type === 'revv_report')) docTypes.push('Revv Report');
    if (mergedData.postScanPdf) docTypes.push('Post-Scan');
    if (mergedData.invoiceNumber) docTypes.push('Invoice');

    if (docTypes.length > 0) {
      previewNotes = `Received: ${docTypes.join(', ')}`;
      if (vehicleString) {
        previewNotes += ` | ${vehicleString}`;
      }
    }

    // Add OEM Position Statement links (Column U) based on vehicle brand
    // Store just the URL so sidebar can make it clickable
    if (mergedData.vehicleMake && !mergedData.oemPosition) {
      const oemPortalUrl = getOEM1StopLink(mergedData.vehicleMake);
      if (oemPortalUrl) {
        mergedData.oemPosition = oemPortalUrl;  // Just the URL, not "Make Position Statements: URL"
        console.log(`${LOG_TAG} OEM1Stop link added for ${mergedData.vehicleMake}: ${oemPortalUrl}`);
      }
    }

    // Add info from email body - ONLY set if not already set to avoid overwriting
    // Also guard against suspicious shop names from Revv PDF metadata
    const suspiciousShopNames = [
      'provided instruments', 'revvadas', 'revv', 'vehicle information',
      'calibration', 'adas', 'unknown', 'n/a', 'test', 'sample'
    ];

    const isSuspiciousShopName = (name) => {
      if (!name || name.length < 3) return true;
      const lower = name.toLowerCase().trim();
      return suspiciousShopNames.some(s => lower.includes(s));
    };

    if (bodyInfo.shopName && !mergedData.shopName) {
      if (isSuspiciousShopName(bodyInfo.shopName)) {
        console.log(`${LOG_TAG} Ignoring suspicious shop name from email body: "${bodyInfo.shopName}"`);
      } else {
        mergedData.shopName = bodyInfo.shopName;
      }
    }

    // Also check if mergedData.shopName from PDF parsing is suspicious
    if (mergedData.shopName && isSuspiciousShopName(mergedData.shopName)) {
      console.log(`${LOG_TAG} Clearing suspicious shop name from PDF: "${mergedData.shopName}"`);
      mergedData.shopName = '';
    }
    if (bodyInfo.vin && !mergedData.vin) {
      mergedData.vin = bodyInfo.vin;
    }
    if (bodyInfo.technician && !mergedData.technician) {
      mergedData.technician = bodyInfo.technician;
    }

    // Handle synthetic RO - only if we don't have notes from scrub
    if (isSyntheticRo && !previewNotes) {
      previewNotes = `[AUTO-GENERATED] No RO/PO found. Please confirm RO number.`;
    }

    // FINAL: Set notes ONCE to avoid any duplication
    // Column S = preview notes (short, single line)
    // Column T = full scrub text (full structured text for sidebar)
    mergedData.notes = previewNotes;
    // fullScrubText already set above if estimate was present

    // Add Drive links (using new column names from spec)
    // Also record documents in job state for tracking
    // CRITICAL FIX: Use content-detected type from parsedPDFs when available
    // Filename-based detection may miss RevvADAS PDFs with unusual names
    for (const upload of uploadResults.uploads) {
      const docInfo = {
        driveFileId: upload.fileId,
        fileName: upload.filename,
        webViewLink: upload.webViewLink
      };

      // Check if parser detected a more specific type for this file
      const parsedPdf = mergedData.parsedPDFs?.find(p => p.filename === upload.filename);
      const contentType = parsedPdf?.type; // Type detected from content by pdfParser
      const uploadType = upload.type; // Type detected from filename

      // Use content-detected type if available, otherwise fall back to filename-detected
      const effectiveType = contentType || uploadType;
      console.log(`${LOG_TAG} PDF type: ${upload.filename} → filename: ${uploadType}, content: ${contentType}, using: ${effectiveType}`);

      switch (effectiveType) {
        case 'revv_report':
          mergedData.revvReportPdf = upload.webViewLink;
          console.log(`${LOG_TAG} *** SET mergedData.revvReportPdf = ${upload.webViewLink}`);
          jobState.recordDocument(roPo, jobState.DOC_TYPES.REVV_REPORT, docInfo);
          break;
        case 'scan_report':
          // Detect if it's pre-scan or post-scan based on filename or context
          const isPostScan = upload.filename?.toLowerCase().includes('post') ||
                            upload.filename?.toLowerCase().includes('final');
          if (isPostScan) {
            mergedData.postScanPdf = upload.webViewLink;
            jobState.recordDocument(roPo, jobState.DOC_TYPES.POST_SCAN, docInfo);
          } else {
            jobState.recordDocument(roPo, jobState.DOC_TYPES.PRE_SCAN, docInfo);
          }
          break;
        case 'adas_invoice':
        case 'invoice':
          mergedData.invoicePdf = upload.webViewLink;
          jobState.recordDocument(roPo, jobState.DOC_TYPES.INVOICE, docInfo);
          break;
        case 'shop_estimate':
        case 'estimate':
          mergedData.estimatePdf = upload.webViewLink;
          jobState.recordDocument(roPo, jobState.DOC_TYPES.ESTIMATE, docInfo);
          break;
      }
    }

    // CRITICAL FIX: If pdfParser detected calibrations, we have a Revv Report
    // This catches Revv PDFs even when filename detection fails
    if (mergedData.requiredCalibrationsText && !mergedData.revvReportPdf) {
      console.log(`${LOG_TAG} Calibrations detected but no Revv PDF link - searching uploads...`);

      for (const upload of uploadResults.uploads) {
        const nameWithoutExt = upload.filename.replace(/\.pdf$/i, '');
        const isVinFilename = /^[A-HJ-NPR-Z0-9]{17}$/i.test(nameWithoutExt);

        // Match by type or VIN filename
        if (upload.type === 'revv_report' || isVinFilename) {
          mergedData.revvReportPdf = upload.webViewLink;
          console.log(`${LOG_TAG} *** MATCHED Revv PDF: ${upload.webViewLink}`);
          break;
        }
      }

      // Fallback: first non-estimate/invoice/scan if still not found
      if (!mergedData.revvReportPdf) {
        const fallback = uploadResults.uploads.find(u =>
          !['estimate', 'shop_estimate', 'invoice', 'scan_report'].includes(u.type)
        );
        if (fallback) {
          mergedData.revvReportPdf = fallback.webViewLink;
          console.log(`${LOG_TAG} *** FALLBACK Revv PDF: ${fallback.webViewLink}`);
        }
      }
    }

    // Step 3: Update Google Sheets
    // Determine appropriate status based on document types received
    // SIMPLIFIED STATUS LOGIC (6 statuses only):
    // - shop_estimate only = "New" (waiting for tech to review in RevvADAS)
    // - revv_report = "Ready" (tech has reviewed, ready for calibration)
    // - adas_invoice = "Completed" (job is billed)

    // Check what document types we have
    // DEBUG: Log all upload types to trace the issue
    console.log(`${LOG_TAG} === DOCUMENT TYPE DETECTION ===`);
    console.log(`${LOG_TAG} mergedData.revvReportPdf: ${mergedData.revvReportPdf || 'NOT SET'}`);
    console.log(`${LOG_TAG} uploadResults.uploads:`, JSON.stringify(uploadResults.uploads.map(u => ({ filename: u.filename, type: u.type })), null, 2));

    const hasRevvReport = mergedData.revvReportPdf ||
      mergedData.requiredCalibrationsText ||  // Calibrations = Revv was parsed
      uploadResults.uploads.some(u => u.type === 'revv_report');
    const hasEstimateOnly = (mergedData.estimatePdf || uploadResults.uploads.some(u =>
      u.type === 'shop_estimate' || u.type === 'estimate'
    )) && !hasRevvReport;
    const hasAdasInvoice = mergedData.invoiceNumber && mergedData.invoiceAmount;
    const hasPostScan = mergedData.postScanPdf || uploadResults.uploads.some(u =>
      u.type === 'scan_report' && (u.filename?.toLowerCase().includes('post') || u.filename?.toLowerCase().includes('final'))
    );

    console.log(`${LOG_TAG} hasRevvReport: ${hasRevvReport}, hasEstimateOnly: ${hasEstimateOnly}, hasAdasInvoice: ${hasAdasInvoice}`);

    // Determine status and statusChangeNote based on document type hierarchy
    let status = 'New';  // Default for new estimates
    let statusChangeNote = 'Document received';

    if (hasAdasInvoice) {
      status = 'Completed';  // Invoice received means job is billed and complete
      statusChangeNote = 'Invoice received';
    } else if (hasRevvReport) {
      status = 'Ready';  // Revv Report means tech has reviewed, ready for calibration
      const calCount = mergedData.requiredCalibrationsText ?
        mergedData.requiredCalibrationsText.split(/[,;]/).filter(c => c.trim()).length : 0;
      statusChangeNote = `Revv Report received (${calCount} calibrations)`;
    } else if (hasEstimateOnly) {
      status = 'New';  // Estimate only - waiting for tech review in RevvADAS
      statusChangeNote = 'Estimate received';
    }

    console.log(`${LOG_TAG} === STATUS DECISION: ${status} (${statusChangeNote}) ===`);

    // Note: "Needs Attention" and "Needs Review" are deprecated
    // Synthetic ROs still need manual handling but stay as "New"
    if (isSyntheticRo) {
      console.log(`${LOG_TAG} Synthetic RO detected - leaving as "New" for manual review`);
      statusChangeNote += ' (synthetic RO)';
    }

    // First upsert the row with all data (creates row if not exists)
    // DEBUG: Log key fields being sent to sheet writer
    console.log(`${LOG_TAG} === SENDING TO SHEET WRITER ===`);
    console.log(`${LOG_TAG} status: ${status}`);
    console.log(`${LOG_TAG} revvReportPdf: ${mergedData.revvReportPdf || 'NOT SET'}`);
    console.log(`${LOG_TAG} requiredCalibrationsText: ${mergedData.requiredCalibrationsText || 'NONE'}`);
    console.log(`${LOG_TAG} oemPosition: ${mergedData.oemPosition || 'NONE'}`);

    const scheduleResult = await sheetWriter.upsertScheduleRowByRO(roPo, {
      ...mergedData,
      status,
      // Format timestamp to MM/DD/YYYY HH:mm
      timestampCreated: formatTimestamp(new Date())
    });

    // Then update with full notes summary to track flow history
    if (scheduleResult.success) {
      await sheetWriter.updateScheduleRowWithFullNotes(roPo, {
        status,
        statusChangeNote
      });
    }

    if (!scheduleResult.success) {
      console.error(`${LOG_TAG} Failed to update schedule:`, scheduleResult.error);
    }

    // Step 4: Create billing row if invoice data present
    if (mergedData.invoiceNumber && mergedData.invoiceAmount) {
      const billingResult = await sheetWriter.appendBillingRow({
        roPo,
        shopName: mergedData.shopName,
        vin: mergedData.vin,
        vehicle: mergedData.vehicle || `${mergedData.vehicleYear || ''} ${mergedData.vehicleMake || ''} ${mergedData.vehicleModel || ''}`.trim(),
        calibrationDescription: mergedData.completedCalibrationsText || mergedData.requiredCalibrationsText,
        amount: mergedData.invoiceAmount,
        invoiceNumber: mergedData.invoiceNumber,
        invoiceDate: mergedData.invoiceDate,
        invoicePdf: mergedData.invoicePdf,
        status: 'Ready to Bill'  // New status per spec
      });

      if (!billingResult.success) {
        console.error(`${LOG_TAG} Failed to create billing row:`, billingResult.error);
      } else {
        // Step 5: Auto-send billing email if configured
        console.log(`${LOG_TAG} Attempting auto-billing email for RO: ${roPo}`);
        const autoBillingResult = await billingMailer.maybeSendAutoBilling(roPo);
        if (autoBillingResult.sent) {
          console.log(`${LOG_TAG} Auto-billing email sent for RO: ${roPo}`);
        } else {
          console.log(`${LOG_TAG} Auto-billing not sent: ${autoBillingResult.reason}`);
        }
      }
    }

    // === SHOP NOTIFICATIONS ===
    // Step 6: Check if we should send initial notice (calibration required / not required)
    const docStatus = jobState.getDocumentStatus(roPo);

    // Determine if calibration is needed based on Revv report
    // (No AI scrubbing - calibration requirements come from RevvADAS only)
    const hasRevvCalibrations = mergedData.requiredCalibrationsText &&
                                 mergedData.requiredCalibrationsText.trim().length > 0;
    const needsCalibration = hasRevvCalibrations;

    // Find PDF buffers from original attachments (for email attachments)
    let revvPdfBuffer = null;
    let postScanPdfBuffer = null;
    let invoicePdfBuffer = null;

    for (const pdf of pdfs) {
      const pdfType = detectPDFType(pdf.filename);
      switch (pdfType) {
        case 'revv_report':
          revvPdfBuffer = pdf.buffer;
          console.log(`${LOG_TAG} Found RevvADAS PDF buffer: ${pdf.filename}`);
          break;
        case 'scan_report':
          // Check if it's a post-scan
          if (pdf.filename?.toLowerCase().includes('post') || pdf.filename?.toLowerCase().includes('final')) {
            postScanPdfBuffer = pdf.buffer;
            console.log(`${LOG_TAG} Found Post-Scan PDF buffer: ${pdf.filename}`);
          }
          break;
        case 'invoice':
          invoicePdfBuffer = pdf.buffer;
          console.log(`${LOG_TAG} Found Invoice PDF buffer: ${pdf.filename}`);
          break;
      }
    }

    // === AUTOMATED EMAIL WORKFLOW (SIMPLIFIED - NO AI SCRUBBING) ===
    //
    // WORKFLOW:
    // 1. Shop sends estimate → Status: "New" (waiting for tech to review in RevvADAS)
    // 2. Tech completes Revv Report → Status: "Ready" (ready for calibration)
    // 3. Tech sends post-scan + invoice → Status: "Completed"
    //
    // TWO EMAIL TYPES:
    // - COMPLETION: Has post-scan + invoice → Send job completion to SHOP
    // - INITIAL: Has RevvADAS report → Send confirmation to SHOP (Ready status)

    const hasCompletionDocs = postScanPdfBuffer && invoicePdfBuffer;
    const hasRevvReportForNotification = revvPdfBuffer && mergedData.shopName;

    // Step 6a: COMPLETION EMAIL - Send when technician provides final docs
    // (Completion emails always go to shop - no verification needed)
    if (hasCompletionDocs && mergedData.shopName && !isSyntheticRo) {
      console.log(`${LOG_TAG} Sending job completion email for RO: ${roPo}`);

      const completionResult = await emailResponder.sendAutoCompletionResponse({
        shopName: mergedData.shopName,
        roPo,
        vehicle: mergedData.vehicle || `${mergedData.vehicleYear || ''} ${mergedData.vehicleMake || ''} ${mergedData.vehicleModel || ''}`.trim(),
        vin: mergedData.vin,
        calibrationsPerformed: mergedData.requiredCalibrationsText || '',
        invoiceNumber: mergedData.invoiceNumber || '',
        invoiceAmount: mergedData.invoiceAmount || '',
        postScanPdfBuffer,
        invoicePdfBuffer,
        revvPdfBuffer,
        postScanLink: mergedData.postScanPdf,
        invoiceLink: mergedData.invoicePdf,
        revvPdfLink: mergedData.revvReportPdf
      });

      if (completionResult.sent) {
        console.log(`${LOG_TAG} Job completion email sent for RO ${roPo} → ${completionResult.shopEmail}`);
        const emailSentNote = `Completion email sent to ${completionResult.shopEmail} on ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`;
        mergedData.notes = mergedData.notes ? `${mergedData.notes} | ${emailSentNote}` : emailSentNote;
      } else if (completionResult.error) {
        console.log(`${LOG_TAG} Completion email not sent: ${completionResult.error}`);
      }
    }
    // Step 6b: INITIAL EMAIL - Send "Ready" notification when Revv Report is received
    // (No scrub verification - just notify shop that the job is ready)
    else if (hasRevvReportForNotification && !isSyntheticRo) {
      console.log(`${LOG_TAG} Revv Report received for RO: ${roPo} - sending Ready notification`);

      // Build info for shop notification
      const vehicleStr = mergedData.vehicle ||
        `${mergedData.vehicleYear || ''} ${mergedData.vehicleMake || ''} ${mergedData.vehicleModel || ''}`.trim();

      // Parse calibrations from Revv Report text into array format for email
      const calibrationsText = mergedData.requiredCalibrationsText || '';
      const calibrationsList = calibrationsText
        .split(/[;,]/)
        .filter(s => s.trim().length > 0)
        .map(cal => ({ name: cal.trim(), type: 'Static' }));

      // Try to send shop notification that job is ready
      const shopEmail = await getShopEmailByName(mergedData.shopName);
      if (shopEmail) {
        const notifyResult = await emailResponder.sendCalibrationConfirmation({
          shopName: mergedData.shopName,
          shopEmail,
          roPo,
          vehicle: vehicleStr,
          vin: mergedData.vin,
          calibrations: calibrationsList,
          revvPdfBuffer
        });

        if (notifyResult?.sent) {
          console.log(`${LOG_TAG} ✅ RO ${roPo}: Ready notification sent to ${shopEmail}`);
          const emailSentNote = `Ready notification sent to ${shopEmail} on ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`;
          mergedData.notes = mergedData.notes ? `${mergedData.notes} | ${emailSentNote}` : emailSentNote;
        }
      } else {
        console.log(`${LOG_TAG} No email found for shop: ${mergedData.shopName} - skipping notification`);
      }
    }

    // Step 7: Check if all final docs are present for auto-close
    const updatedDocStatus = jobState.getDocumentStatus(roPo);

    if (updatedDocStatus.allFinalDocsPresent && mergedData.shopName) {
      console.log(`${LOG_TAG} All final docs present for RO ${roPo}, attempting auto-close`);

      const autoCloseResult = await shopNotifier.autoCloseJob(roPo);

      if (autoCloseResult.closed) {
        console.log(`${LOG_TAG} Auto-closed RO ${roPo} (Completed)`);
        if (autoCloseResult.notificationSent) {
          console.log(`${LOG_TAG} Final completion email sent for RO ${roPo} (post_scan + revv_report + invoice)`);
        }
      }
    }

    // Mark email as processed
    await markAsProcessed(message.id);

    console.log(`${LOG_TAG} Successfully processed email for RO: ${roPo}`);
    return { success: true, roPo, messageId: message.id };
  } catch (err) {
    console.error(`${LOG_TAG} Failed to process email:`, err.message);
    return { success: false, error: err.message, messageId: message.id };
  }
}

/**
 * PDF type detection from filename
 *
 * KNOWN PATTERNS:
 * - Revv Report: VIN.pdf (17 alphanumeric chars, no I/O/Q)
 * - Invoice: VIN_invoice.pdf
 * - Scan Report: Contains "scan" or "autel"
 * - Estimate: Contains "estimate", "quote", or "repair order"
 */
function detectPDFType(filename) {
  if (!filename) return 'document';

  const lower = filename.toLowerCase();
  const nameWithoutExt = filename.replace(/\.pdf$/i, '');

  // VIN pattern: exactly 17 alphanumeric characters, no I/O/Q
  const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/i;

  // INVOICE: VIN_invoice.pdf pattern (check FIRST - more specific)
  if (lower.includes('_invoice') || lower.includes('-invoice')) {
    console.log(`${LOG_TAG} Detected Invoice PDF: ${filename}`);
    return 'invoice';
  }

  // INVOICE: General invoice detection
  if (lower.includes('invoice') || lower.includes('inv_') || lower.includes('inv-')) {
    console.log(`${LOG_TAG} Detected Invoice PDF: ${filename}`);
    return 'invoice';
  }

  // SCAN REPORT: Autel or scan in filename
  if (lower.includes('scan') || lower.includes('autel') || lower.includes('postscan') || lower.includes('post-scan')) {
    const isPostScan = lower.includes('post') || lower.includes('final') || lower.includes('after');
    console.log(`${LOG_TAG} Detected ${isPostScan ? 'Post-' : ''}Scan Report: ${filename}`);
    return 'scan_report';
  }

  // REVV REPORT: Pure VIN filename (most common RevvADAS pattern)
  if (vinPattern.test(nameWithoutExt)) {
    console.log(`${LOG_TAG} Detected RevvADAS PDF by VIN filename: ${filename}`);
    return 'revv_report';
  }

  // REVV REPORT: Other RevvADAS patterns
  if (lower.includes('revv') ||
      lower.includes('calibration') ||
      lower.startsWith('vehid') ||
      /^vehid[_-]?\w/i.test(lower) ||
      /^veh[_-]?\d+/i.test(lower) ||
      lower.includes('adas operations') ||
      lower.includes('adas report') ||
      lower.includes('adas_') ||
      lower.includes('_adas')) {
    console.log(`${LOG_TAG} Detected RevvADAS PDF: ${filename}`);
    return 'revv_report';
  }

  // ESTIMATE: Estimate/quote patterns
  if (lower.includes('estimate') || lower.includes('quote') || lower.includes('repair order') || lower.includes('repair_order')) {
    console.log(`${LOG_TAG} Detected Estimate PDF: ${filename}`);
    return 'estimate';
  }

  // DEFAULT: Unknown document type
  console.log(`${LOG_TAG} Unknown PDF type, defaulting to 'document': ${filename}`);
  return 'document';
}

/**
 * Check for new unprocessed emails in "ADAS FIRST" label
 */
async function checkNewEmails() {
  console.log(`${LOG_TAG} Checking for new emails in "${SOURCE_LABEL_NAME}" label...`);

  try {
    const gmail = await initializeGmailClient();

    if (!sourceLabelId) {
      console.error(`${LOG_TAG} Source label ID not set, cannot check emails`);
      return;
    }

    // Query for emails in "ADAS FIRST" label that don't have "ADAS_FIRST_PROCESSED" label
    // Also check for PDF attachments
    const query = `label:${SOURCE_LABEL_NAME.replace(/ /g, '-')} -label:${PROCESSED_LABEL_NAME} has:attachment filename:pdf`;

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10
    });

    const messages = response.data.messages || [];
    console.log(`${LOG_TAG} Found ${messages.length} unprocessed emails with PDFs`);

    for (const message of messages) {
      // Skip if already processed locally
      if (processedMessageIds.has(message.id)) {
        console.log(`${LOG_TAG} Skipping ${message.id} - already in local tracking`);
        continue;
      }
      await processEmail(message);
    }
  } catch (err) {
    console.error(`${LOG_TAG} Error checking emails:`, err.message);
  }
}

/**
 * Start the email listener polling loop
 */
export async function startListener() {
  if (isListening) {
    console.log(`${LOG_TAG} Listener already running`);
    return { success: false, error: 'Already running' };
  }

  try {
    console.log(`${LOG_TAG} Starting email listener for ${GMAIL_USER}`);
    console.log(`${LOG_TAG} Source label: "${SOURCE_LABEL_NAME}"`);
    console.log(`${LOG_TAG} Poll interval: ${POLL_INTERVAL_MS}ms`);

    // Initialize client and verify setup
    await initializeGmailClient();

    isListening = true;

    // Initial check
    await checkNewEmails();

    // Set up polling
    pollIntervalId = setInterval(checkNewEmails, POLL_INTERVAL_MS);

    console.log(`${LOG_TAG} Email listener started successfully`);
    return { success: true, message: 'Listener started' };
  } catch (err) {
    console.error(`${LOG_TAG} Failed to start listener:`, err.message);
    isListening = false;
    return { success: false, error: err.message };
  }
}

/**
 * Stop the email listener
 */
export function stopListener() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  isListening = false;
  console.log(`${LOG_TAG} Email listener stopped`);
  return { success: true, message: 'Listener stopped' };
}

/**
 * Process a single email manually by message ID
 */
export async function processMessageById(messageId) {
  await initializeGmailClient();
  return processEmail({ id: messageId });
}

/**
 * Check if listener is running
 */
export function isRunning() {
  return isListening;
}

/**
 * Get listener status
 */
export function getStatus() {
  return {
    running: isListening,
    gmailUser: GMAIL_USER,
    sourceLabel: SOURCE_LABEL_NAME,
    processedLabel: PROCESSED_LABEL_NAME,
    processedCount: processedMessageIds.size,
    pollIntervalMs: POLL_INTERVAL_MS
  };
}

/**
 * Generate OAuth authorization URL (for initial setup)
 */
export function getAuthUrl() {
  try {
    const credentials = getOAuthCredentials();
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify'
      ]
    });

    return { authUrl, note: `Login as ${GMAIL_USER} and authorize the app` };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Exchange authorization code for token (for initial setup)
 */
export async function exchangeCodeForToken(code) {
  try {
    const credentials = getOAuthCredentials();
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob'
    );

    const { tokens } = await oauth2Client.getToken(code);

    // Save the token using helper (handles env var vs file)
    saveOAuthToken(tokens);

    return { success: true, message: 'Token saved successfully', token: tokens };
  } catch (err) {
    return { error: err.message };
  }
}

export default {
  startListener,
  stopListener,
  processMessageById,
  isRunning,
  getStatus,
  checkNewEmails,
  getAuthUrl,
  exchangeCodeForToken,
  clearProcessedIds
};
