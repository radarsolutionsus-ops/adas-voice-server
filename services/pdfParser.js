/**
 * pdfParser.js - PDF data extraction service using text extraction + LLM
 *
 * Extracts structured data from three PDF types:
 * 1. RevvADAS Required Calibrations Report
 * 2. Autel Pre/Post-Scan Report
 * 3. RevvADAS Invoice
 *
 * Uses pdf-parse for text extraction and OpenAI for structured data extraction.
 */

import pdf from 'pdf-parse';
import axios from 'axios';
import { isEstimatePDF } from './estimateScrubber.js';
import { scrubEstimateNew } from '../src/scrub/index.js';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

const LOG_TAG = '[PDF_PARSER]';

/**
 * VIN World Manufacturer Identifier (WMI) to Brand mapping
 * First 3 characters of VIN identify the manufacturer
 */
const VIN_WMI_BRANDS = {
  // Mercedes-Benz (Germany, USA, etc.)
  'WDB': 'Mercedes-Benz', 'WDC': 'Mercedes-Benz', 'WDD': 'Mercedes-Benz',
  'WDF': 'Mercedes-Benz', 'W1K': 'Mercedes-Benz', 'W1N': 'Mercedes-Benz',
  'W1V': 'Mercedes-Benz', '4JG': 'Mercedes-Benz', '55S': 'Mercedes-Benz',
  // BMW
  'WBA': 'BMW', 'WBS': 'BMW', 'WBY': 'BMW', '5UX': 'BMW', '5YM': 'BMW',
  // Audi
  'WAU': 'Audi', 'WA1': 'Audi', 'WUA': 'Audi', 'TRU': 'Audi',
  // Volkswagen
  'WVW': 'Volkswagen', 'WV1': 'Volkswagen', 'WV2': 'Volkswagen', '3VW': 'Volkswagen',
  // Porsche
  'WP0': 'Porsche', 'WP1': 'Porsche',
  // Toyota / Lexus
  'JT': 'Toyota', '1N4': 'Toyota', '2T1': 'Toyota', '4T1': 'Toyota', '5TD': 'Toyota',
  'JTD': 'Lexus', 'JTH': 'Lexus', 'JTJ': 'Lexus', '2T2': 'Lexus', '5TX': 'Lexus',
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
  '3C6': 'Ram', '3D7': 'Ram',
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
  // Jaguar / Land Rover
  'SAJ': 'Jaguar', 'SAD': 'Jaguar',
  'SAL': 'Land Rover', 'SAR': 'Land Rover',
};

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
 * List of strings that should NOT be extracted as shop names
 * These are common REVV report headers that are not actual shop names
 */
const INVALID_SHOP_NAMES = [
  'vehicle information',
  'customer information',
  'required calibrations',
  'adas operations',
  'calibration report',
  'estimate summary',
  'repair order',
  'service information',
  'inspection report',
  'diagnostic report'
];

/**
 * Check if a potential shop name is actually invalid
 * @param {string} name - Potential shop name
 * @returns {boolean} - True if invalid (should not use as shop name)
 */
function isInvalidShopName(name) {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  return INVALID_SHOP_NAMES.some(invalid => lower === invalid || lower.includes(invalid));
}

/**
 * Extract shop name from PDF text content
 * Looks for shop name patterns in header areas
 * @param {string} text - PDF text content
 * @param {string} pdfType - Type of PDF (to skip certain extractions for REVV reports)
 * @returns {string|null} - Shop name or null
 */
function extractShopNameFromPDF(text, pdfType = null) {
  if (!text) return null;

  // Get first 1500 chars (header area)
  const header = text.substring(0, 1500);
  const lines = header.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Pattern 1: Look for common shop/business name patterns in first 10 lines
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i];

    // Skip very short or very long lines
    if (line.length < 3 || line.length > 60) continue;

    // Skip lines that are just numbers, dates, or common headers
    if (/^[\d\s\-\/\.]+$/.test(line)) continue;
    if (/^(date|invoice|estimate|repair|vin|year|make|model|customer|owner)/i.test(line)) continue;
    if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(line)) continue; // Dates

    // Check for patterns that suggest a business name
    // - Contains "Auto", "Body", "Collision", "Shop", "Motors", "Service", "Paint", "Max"
    // - Or is a capitalized phrase in the first few lines
    if (/\b(auto|body|collision|shop|motors?|service|repair|garage|center|centre|paint|max|express|pro|precision)\b/i.test(line)) {
      // Clean up the name
      const cleaned = line
        .replace(/\s+/g, ' ')
        .replace(/[<>]/g, '')
        .trim();

      // CRITICAL: Skip invalid shop names like "Vehicle Information"
      if (isInvalidShopName(cleaned)) {
        console.log(`${LOG_TAG} Skipping invalid shop name: ${cleaned}`);
        continue;
      }

      if (cleaned.length >= 3 && cleaned.length <= 50) {
        console.log(`${LOG_TAG} Extracted shop name from PDF: ${cleaned}`);
        return cleaned;
      }
    }

    // First capitalized line that looks like a company name (2+ words, proper case)
    // Also match names like "Paint Max 1" with numbers
    if (i < 5 && /^[A-Z][a-zA-Z]+(\s+[A-Z0-9][a-zA-Z0-9]*)+$/.test(line) && line.length >= 5) {
      // CRITICAL: Skip invalid shop names like "Vehicle Information"
      if (isInvalidShopName(line)) {
        console.log(`${LOG_TAG} Skipping invalid shop name from header: ${line}`);
        continue;
      }
      console.log(`${LOG_TAG} Extracted shop name from header: ${line}`);
      return line;
    }
  }

  // Pattern 1b: Check first line specifically - many estimates start with shop name
  if (lines.length > 0) {
    const firstLine = lines[0];
    // Match patterns like "Paint Max 1", "ABC Auto Body", etc.
    if (/^[A-Za-z][A-Za-z0-9\s&'\.]+$/i.test(firstLine) &&
        firstLine.length >= 5 && firstLine.length <= 40 &&
        !isInvalidShopName(firstLine) &&
        !/^(estimate|invoice|repair|vehicle|customer|date|vin)/i.test(firstLine)) {
      console.log(`${LOG_TAG} Extracted shop name from first line: ${firstLine}`);
      return firstLine;
    }
  }

  // Pattern 2: Look for "From:" or "Prepared by:" patterns
  const fromMatch = header.match(/(?:from|prepared\s+by|submitted\s+by|shop)[:\s]+([A-Za-z][A-Za-z\s&'\.]+?)(?:\n|,|\||$)/i);
  if (fromMatch && fromMatch[1].length >= 3 && fromMatch[1].length <= 50) {
    const name = fromMatch[1].trim();
    // CRITICAL: Skip invalid shop names
    if (isInvalidShopName(name)) {
      console.log(`${LOG_TAG} Skipping invalid shop name from 'from' pattern: ${name}`);
      return null;
    }
    console.log(`${LOG_TAG} Extracted shop name from 'from' pattern: ${name}`);
    return name;
  }

  return null;
}

// Get OpenAI API key from environment (loaded via dotenv)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';

// Validate API key on module load
if (!OPENAI_API_KEY) {
  console.warn(`${LOG_TAG} WARNING: OPENAI_API_KEY not configured - LLM extraction will fail`);
}

/**
 * PDF type detection based on filename and content
 *
 * CRITICAL: Only ADAS_INVOICE type should populate billing fields.
 * Shop estimates, Revv reports, and other documents should NOT set invoice data.
 */
const PDF_TYPES = {
  ADAS_INVOICE: 'adas_invoice',    // ADAS First invoices - ONLY type for billing data
  SHOP_ESTIMATE: 'shop_estimate',  // Shop repair estimates - reference only, NO billing
  SCAN_REPORT: 'scan_report',      // Pre/Post scan reports
  REVV_REPORT: 'revv_report',      // RevvADAS calibration reports - NOT billing
  ESTIMATE: 'estimate',            // Legacy estimate type
  UNKNOWN: 'unknown',
  // Legacy alias for backward compatibility
  INVOICE: 'adas_invoice'
};

/**
 * Detect PDF type from filename and content
 *
 * CRITICAL DISTINCTION:
 * - ADAS_INVOICE: Documents FROM "ADAS F1RST SERVICE" with invoice number - ONLY type for billing
 * - SHOP_ESTIMATE: Body shop repair orders/estimates (Caliber, AutoSport, etc.) - NOT billing
 * - REVV_REPORT: RevvADAS calibration reports with "Estimated Price" - NOT billing (just quotes)
 * - SCAN_REPORT: Pre/Post scan diagnostic reports
 *
 * @param {string} filename - Original filename
 * @param {string} textContent - Extracted text content
 * @returns {string} - PDF type from PDF_TYPES
 */
function detectPDFType(filename, textContent) {
  const filenameLower = filename.toLowerCase();
  const contentLower = textContent.toLowerCase();

  // ========== STEP 1: Check for ADAS First Invoice (MOST SPECIFIC - check first) ==========
  // ADAS First invoices have specific markers that distinguish them from shop documents
  const isAdasFirst = contentLower.includes('adas f1rst') ||
                      contentLower.includes('adasf1rst') ||
                      contentLower.includes('adas first service') ||
                      contentLower.includes('15021 sw 169th ln') ||  // ADAS First address
                      contentLower.includes('miami, fl 33187');

  const hasInvoiceNumber = contentLower.includes('invoice number') ||
                           contentLower.includes('invoice #') ||
                           contentLower.includes('invoice:');

  const hasBillTo = contentLower.includes('bill to') ||
                    contentLower.includes('billed to');

  // Check it's NOT a scan report (ADAS First header appears on scan reports too)
  const isScanReport = contentLower.includes('pre-scan report') ||
                       contentLower.includes('post-scan report') ||
                       contentLower.includes('pre-scan') && contentLower.includes('post-scan');

  if (isAdasFirst && hasInvoiceNumber && hasBillTo && !isScanReport) {
    console.log(`${LOG_TAG} Detected ADAS First invoice (has ADAS header + invoice number + bill to)`);
    return PDF_TYPES.ADAS_INVOICE;
  }

  // ========== STEP 2: Check for Scan Reports (Pre/Post scan) ==========
  if (isScanReport ||
      contentLower.includes('diagnostic trouble code') ||
      (contentLower.includes('autel') && contentLower.includes('maxisys')) ||
      filenameLower.includes('scan') ||
      filenameLower.includes('autel')) {
    console.log(`${LOG_TAG} Detected scan report`);
    return PDF_TYPES.SCAN_REPORT;
  }

  // ========== STEP 3: Check for RevvADAS Reports ==========
  // These have "Estimated Price" but are NOT invoices - just calibration quotes
  if (contentLower.includes('revv') ||
      (contentLower.includes('adas operations') && contentLower.includes('required')) ||
      contentLower.includes('required calibrations') ||
      filenameLower.includes('revv')) {
    console.log(`${LOG_TAG} Detected RevvADAS report (NOT billing - just calibration requirements)`);
    return PDF_TYPES.REVV_REPORT;
  }

  // ========== STEP 4: Check for Shop Repair Estimates ==========
  // These are body shop documents, NOT ADAS billing
  const isShopEstimate =
    filenameLower.includes('supplement') ||
    filenameLower.includes('estimate') ||
    filenameLower.includes('repair order') ||
    contentLower.includes('supplement of record') ||
    contentLower.includes('estimate totals') ||
    contentLower.includes('body labor') ||
    contentLower.includes('paint labor') ||
    contentLower.includes('paint materials') ||
    contentLower.includes('refinish labor') ||
    contentLower.includes('structural labor') ||
    contentLower.includes('frame labor') ||
    contentLower.includes('parts total') ||
    contentLower.includes('labor total') ||
    (contentLower.includes('repair order') && contentLower.includes('grand total')) ||
    (contentLower.includes('ro number') && contentLower.includes('insurance'));

  if (isShopEstimate) {
    console.log(`${LOG_TAG} Detected SHOP ESTIMATE (NOT ADAS billing - body shop document)`);
    return PDF_TYPES.SHOP_ESTIMATE;
  }

  // ========== STEP 5: Legacy estimate detection ==========
  if (isEstimatePDF(textContent)) {
    console.log(`${LOG_TAG} Detected estimate via scrubber`);
    return PDF_TYPES.ESTIMATE;
  }

  // ========== STEP 6: Generic document with invoice-like fields ==========
  // IMPORTANT: Do NOT treat as ADAS invoice just because it has "invoice number" or "total"
  // Shop estimates also have these fields
  if (hasInvoiceNumber && !isAdasFirst) {
    console.log(`${LOG_TAG} Document has invoice fields but NOT from ADAS First - treating as SHOP_ESTIMATE`);
    return PDF_TYPES.SHOP_ESTIMATE;
  }

  console.log(`${LOG_TAG} Could not determine PDF type - returning UNKNOWN`);
  return PDF_TYPES.UNKNOWN;
}

/**
 * Extract text content from a PDF buffer
 *
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromPDF(pdfBuffer) {
  try {
    const data = await pdf(pdfBuffer);
    return data.text;
  } catch (err) {
    console.error(`${LOG_TAG} Text extraction failed:`, err.message);
    throw err;
  }
}

/**
 * Use OpenAI to extract structured data from PDF text
 *
 * @param {string} textContent - Extracted text content
 * @param {string} pdfType - Type of PDF
 * @returns {Promise<Object>} - Structured data object
 */
async function extractStructuredDataWithLLM(textContent, pdfType) {
  if (!OPENAI_API_KEY) {
    console.error(`${LOG_TAG} OpenAI API key not configured`);
    return null;
  }

  let systemPrompt = '';
  let userPrompt = '';

  switch (pdfType) {
    case PDF_TYPES.ADAS_INVOICE:
      // This prompt is ONLY used for verified ADAS First invoices
      systemPrompt = `You are a data extraction assistant for ADAS F1RST SERVICE invoices.

IMPORTANT: This document should be FROM "ADAS F1RST SERVICE" or "ADAS FIRST" company.
The address should be: 15021 SW 169TH LN, Miami, FL 33187

Extract structured invoice data. Return a JSON object with these fields (use null for missing values):
{
  "invoiceNumber": "string - the ADAS First invoice number (e.g., 101735)",
  "invoiceDate": "string (YYYY-MM-DD format)",
  "invoiceAmount": number - the total amount billed by ADAS First,
  "shopName": "string - the shop being billed (from 'Bill To' section)",
  "roPo": "string (RO or PO number from the job)",
  "vin": "string (17 chars or last 4-8)",
  "vehicleYear": "string",
  "vehicleMake": "string",
  "vehicleModel": "string",
  "calibrationsPerformed": ["array of ADAS calibration services - radar, camera, BSM, etc."],
  "lineItems": [{"description": "string", "amount": number}]
}

DO NOT extract billing data if this is a shop repair estimate or RevvADAS quote.
Only extract invoice data if this is a genuine ADAS First invoice.`;
      userPrompt = `Extract ADAS First invoice data from this text:\n\n${textContent.substring(0, 8000)}`;
      break;

    case PDF_TYPES.SHOP_ESTIMATE:
      // Shop estimates - extract reference info only, NO billing data
      systemPrompt = `You are a data extraction assistant for body shop repair estimates.

IMPORTANT: This is a SHOP REPAIR ESTIMATE, NOT an ADAS billing invoice.
Extract reference information ONLY. Do NOT extract invoice/billing amounts.

Return a JSON object with these fields (use null for missing values):
{
  "documentType": "shop_estimate",
  "shopName": "string - the body shop name",
  "roPo": "string (RO or PO number)",
  "vin": "string (17 chars or partial)",
  "vehicleYear": "string",
  "vehicleMake": "string",
  "vehicleModel": "string",
  "insuranceCompany": "string (if present)",
  "estimateTotal": number - the shop's repair estimate total (for reference only, NOT ADAS billing),
  "repairDescription": "string - brief summary of collision repairs"
}

NOTE: estimateTotal is the SHOP'S repair cost, NOT ADAS billing.`;
      userPrompt = `Extract shop estimate reference data from this text:\n\n${textContent.substring(0, 8000)}`;
      break;

    case PDF_TYPES.SCAN_REPORT:
      systemPrompt = `You are a data extraction assistant. Extract DTC and scan data from an Autel Maxisys scan report.
Return a JSON object with these fields (use null for missing values):
{
  "roPo": "string (if present)",
  "vin": "string (17 chars or partial)",
  "vehicleYear": "string",
  "vehicleMake": "string",
  "vehicleModel": "string",
  "scanType": "pre-scan or post-scan",
  "dtcs": [
    {
      "module": "string (e.g., 'ECM', 'BCM', 'ADAS')",
      "code": "string (e.g., 'U0415')",
      "description": "string",
      "status": "string (active, pending, stored, etc.)"
    }
  ],
  "modulesScanned": ["array of module names"],
  "scanDate": "string (YYYY-MM-DD format if present)"
}`;
      userPrompt = `Extract scan report data from this text:\n\n${textContent.substring(0, 8000)}`;
      break;

    case PDF_TYPES.REVV_REPORT:
      systemPrompt = `You are a data extraction assistant specializing in ADAS calibration reports.
Extract ALL calibration requirements from a RevvADAS report. This is CRITICAL - do NOT return 0 calibrations unless the document truly has none.

COMMON CALIBRATIONS TO LOOK FOR (include ANY that appear):
- Forward/Front Camera calibration (static and/or dynamic)
- Front Radar / ACC Radar calibration
- Rear Radar calibration
- Blind Spot Monitor (BSM) calibration - left and/or right
- Lane Change Assist / Lane Departure Warning calibration
- Steering Angle Sensor (SAS) reset/calibration
- Parking Sensor calibration (front and/or rear)
- Surround View / 360 Camera calibration
- Rear Cross Traffic Alert (RCTA) calibration
- Adaptive Headlight / AFS calibration
- Night Vision camera calibration
- ANY line item showing "calibration", "cal", "reset", "initialization", or "aiming"

EXTRACTION RULES:
1. Count EVERY calibration mentioned, even if listed multiple times (e.g., BSM Left + BSM Right = 2)
2. If a PDF mentions "X operations required", the calibrationCount MUST match X
3. Look for tables, bullet points, and line items - each line may be a separate calibration
4. Extract the calibration type (Static, Dynamic, Both) if mentioned
5. If you see "ADAS Operations: X" or similar header, extract all X items

Return a JSON object with these fields (use null for missing values):
{
  "roPo": "string (if present)",
  "vin": "string (17 chars or partial)",
  "vehicleYear": "string",
  "vehicleMake": "string",
  "vehicleModel": "string",
  "shopName": "string (shop or business name if visible in header)",
  "requiredCalibrations": [
    {
      "system": "string (e.g., 'Front Radar', 'Front Camera', 'BSM Left')",
      "calibrationType": "string (Static, Dynamic, Both, or Reset)",
      "description": "string",
      "reason": "string (why calibration is needed)"
    }
  ],
  "completedCalibrations": [
    {
      "system": "string",
      "calibrationType": "string",
      "status": "string (Pass, Fail, etc.)"
    }
  ],
  "reportType": "string (initial assessment or final report)",
  "technician": "string (if present)",
  "calibrationCount": "number - MUST equal the length of requiredCalibrations array"
}

CRITICAL: Be THOROUGH. If the document shows "7 ADAS Operations Required", you MUST return 7 items in requiredCalibrations.
Do NOT return 0 unless the document explicitly states no calibrations are needed.`;
      userPrompt = `Extract ALL calibration data from this RevvADAS report. Be THOROUGH - count EVERY calibration mentioned. If it says "X operations", return X items:\n\n${textContent.substring(0, 12000)}`;
      break;

    default:
      systemPrompt = `You are a data extraction assistant. Extract any relevant automotive/calibration data from the provided text.
Return a JSON object with whatever fields you can identify:
{
  "roPo": "string (RO or PO number if present)",
  "vin": "string (VIN if present)",
  "vehicleYear": "string",
  "vehicleMake": "string",
  "vehicleModel": "string",
  "documentType": "string (best guess at document type)",
  "keyInformation": "string (summary of key info)"
}`;
      userPrompt = `Extract automotive data from this text:\n\n${textContent.substring(0, 8000)}`;
  }

  try {
    // Double-check API key is available
    if (!OPENAI_API_KEY) {
      console.error(`${LOG_TAG} Cannot call OpenAI API - OPENAI_API_KEY not configured`);
      return null;
    }

    console.log(`${LOG_TAG} Calling OpenAI API with model: ${OPENAI_MODEL}`);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const content = response.data.choices[0].message.content;
    console.log(`${LOG_TAG} OpenAI extraction successful`);
    return JSON.parse(content);
  } catch (err) {
    // Provide detailed error info
    if (err.response) {
      console.error(`${LOG_TAG} LLM extraction failed: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
      if (err.response.status === 401) {
        console.error(`${LOG_TAG} 401 Unauthorized - Check that OPENAI_API_KEY is valid and has sufficient permissions`);
      }
    } else {
      console.error(`${LOG_TAG} LLM extraction failed:`, err.message);
    }
    return null;
  }
}

/**
 * Parse a PDF and extract structured data
 *
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} filename - Original filename
 * @returns {Promise<Object>} - Parsed data object
 */
export async function parsePDF(pdfBuffer, filename, roPo = null) {
  console.log(`${LOG_TAG} Parsing PDF: ${filename}`);

  try {
    // Step 1: Extract text
    const textContent = await extractTextFromPDF(pdfBuffer);
    console.log(`${LOG_TAG} Extracted ${textContent.length} characters of text`);

    // Step 2: Detect PDF type
    const pdfType = detectPDFType(filename, textContent);
    console.log(`${LOG_TAG} Detected PDF type: ${pdfType}`);

    // Step 2b: Try to extract shop name from PDF text
    const extractedShopName = extractShopNameFromPDF(textContent);

    // Step 3: Handle estimate PDFs with scrubber
    // Run scrubber for both ESTIMATE and SHOP_ESTIMATE types
    if (pdfType === PDF_TYPES.ESTIMATE || pdfType === PDF_TYPES.SHOP_ESTIMATE) {
      console.log(`${LOG_TAG} Estimate detected (${pdfType}), running scrubber`);
      // Extract VIN from text for better brand detection
      const vinMatch = textContent.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
      const extractedVin = vinMatch ? vinMatch[1].toUpperCase() : null;

      // Pass VIN to scrubber for accurate brand detection
      const scrubResult = await scrubEstimateNew(textContent, roPo, { vin: extractedVin });

      // Get brand from VIN if possible
      let extractedBrand = null;
      if (extractedVin) {
        extractedBrand = getBrandFromVIN(extractedVin);
        if (extractedBrand) {
          console.log(`${LOG_TAG} Brand from estimate VIN ${extractedVin.substring(0,3)}***: ${extractedBrand}`);
        }
      }

      return {
        success: true,
        pdfType,
        data: {
          documentType: pdfType === PDF_TYPES.SHOP_ESTIMATE ? 'shop_estimate' : 'estimate',
          shopName: extractedShopName,
          vin: extractedVin,
          vehicleMake: extractedBrand, // Use VIN-based brand
          rawText: textContent.substring(0, 2000)
        },
        scrubResult,
        filename,
        extractedAt: new Date().toISOString()
      };
    }

    // Step 4: Extract structured data with LLM for other types
    const structuredData = await extractStructuredDataWithLLM(textContent, pdfType);

    if (!structuredData) {
      return {
        success: false,
        error: 'Failed to extract structured data',
        pdfType,
        rawText: textContent.substring(0, 2000)
      };
    }

    // Merge extracted shop name if LLM didn't find one
    if (!structuredData.shopName && extractedShopName) {
      structuredData.shopName = extractedShopName;
    }

    return {
      success: true,
      pdfType,
      data: structuredData,
      filename,
      extractedAt: new Date().toISOString()
    };
  } catch (err) {
    console.error(`${LOG_TAG} PDF parsing failed:`, err.message);
    return {
      success: false,
      error: err.message,
      filename
    };
  }
}

/**
 * Parse multiple PDFs and merge into a single RO data object
 *
 * @param {Array<{buffer: Buffer, filename: string}>} pdfs - Array of PDF objects
 * @returns {Promise<Object>} - Merged RO data
 */
export async function parseAndMergePDFs(pdfs, roPo = null) {
  console.log(`${LOG_TAG} Parsing and merging ${pdfs.length} PDFs`);

  const parsedResults = [];

  for (const pdfDoc of pdfs) {
    const result = await parsePDF(pdfDoc.buffer, pdfDoc.filename, roPo);
    parsedResults.push(result);
  }

  // Merge results into a single RO object
  // Field names match new column structure from spec
  const mergedData = {
    roPo: roPo,
    vin: null,
    shopName: null,
    vehicle: null,  // Combined Year Make Model
    vehicleYear: null,
    vehicleMake: null,
    vehicleModel: null,
    requiredCalibrationsText: '',  // Maps to Required Calibrations column
    completedCalibrationsText: '', // Maps to Completed Calibrations column
    preScanDTCsText: '',           // Will be combined into DTCs column
    postScanDTCsText: '',          // Will be combined into DTCs column
    invoiceNumber: null,
    invoiceDate: null,
    invoiceAmount: null,
    notes: '',
    parsedPDFs: [],
    estimateScrubResult: null,     // Scrub result if estimate was found
    hasEstimate: false             // Flag if estimate PDF was detected
  };

  // Track shop names by source for priority-based selection
  // Priority: shop_estimate > adas_invoice > revv_report
  const shopNameSources = {
    shopEstimate: null,
    adasInvoice: null,
    revvReport: null,
    other: null
  };

  for (const result of parsedResults) {
    if (!result.success) {
      mergedData.notes += `Failed to parse: ${result.filename}. `;
      continue;
    }

    mergedData.parsedPDFs.push({
      filename: result.filename,
      type: result.pdfType
    });

    const data = result.data;

    // Merge common fields (prefer non-null values)
    if (data.roPo && !mergedData.roPo) mergedData.roPo = data.roPo;
    if (data.vin && !mergedData.vin) mergedData.vin = data.vin;

    // Track shop name by source (don't set mergedData.shopName yet)
    if (data.shopName && !isInvalidShopName(data.shopName)) {
      switch (result.pdfType) {
        case PDF_TYPES.SHOP_ESTIMATE:
        case PDF_TYPES.ESTIMATE:
          shopNameSources.shopEstimate = data.shopName;
          console.log(`${LOG_TAG} Shop name from SHOP_ESTIMATE: ${data.shopName}`);
          break;
        case PDF_TYPES.ADAS_INVOICE:
          shopNameSources.adasInvoice = data.shopName;
          console.log(`${LOG_TAG} Shop name from ADAS_INVOICE: ${data.shopName}`);
          break;
        case PDF_TYPES.REVV_REPORT:
          shopNameSources.revvReport = data.shopName;
          console.log(`${LOG_TAG} Shop name from REVV_REPORT: ${data.shopName}`);
          break;
        default:
          if (!shopNameSources.other) {
            shopNameSources.other = data.shopName;
            console.log(`${LOG_TAG} Shop name from OTHER: ${data.shopName}`);
          }
      }
    }

    if (data.vehicleYear && !mergedData.vehicleYear) mergedData.vehicleYear = data.vehicleYear;
    if (data.vehicleModel && !mergedData.vehicleModel) mergedData.vehicleModel = data.vehicleModel;

    // CRITICAL FIX: Use VIN-based brand detection FIRST, ALWAYS
    // This ensures the correct brand is used regardless of LLM extraction
    // VIN detection is authoritative - once set from VIN, don't override
    if (mergedData.vin && !mergedData._vinBrandSet) {
      const vinBrand = getBrandFromVIN(mergedData.vin);
      if (vinBrand) {
        mergedData.vehicleMake = vinBrand;
        mergedData._vinBrandSet = true; // Flag to prevent overwriting
        console.log(`${LOG_TAG} Brand LOCKED from VIN ${mergedData.vin.substring(0,3)}***: ${vinBrand}`);
      }
    }

    // Only use LLM-extracted make if VIN-based detection didn't work
    if (!mergedData.vehicleMake && data.vehicleMake) {
      // Double-check: if we now have a VIN, use that instead of LLM make
      if (mergedData.vin) {
        const vinBrand = getBrandFromVIN(mergedData.vin);
        if (vinBrand) {
          mergedData.vehicleMake = vinBrand;
          mergedData._vinBrandSet = true;
          console.log(`${LOG_TAG} Brand LOCKED from VIN (override LLM): ${vinBrand}`);
        } else {
          mergedData.vehicleMake = data.vehicleMake;
        }
      } else {
        mergedData.vehicleMake = data.vehicleMake;
      }
    }

    // Build combined vehicle string if we have components
    if (!mergedData.vehicle && (mergedData.vehicleYear || mergedData.vehicleMake || mergedData.vehicleModel)) {
      mergedData.vehicle = `${mergedData.vehicleYear || ''} ${mergedData.vehicleMake || ''} ${mergedData.vehicleModel || ''}`.trim();
    }

    // Merge type-specific data
    switch (result.pdfType) {
      case PDF_TYPES.ADAS_INVOICE:
        // ONLY extract billing data from verified ADAS First invoices
        console.log(`${LOG_TAG} Extracting billing data from ADAS First invoice`);
        mergedData.invoiceNumber = data.invoiceNumber;
        mergedData.invoiceDate = data.invoiceDate;
        mergedData.invoiceAmount = data.invoiceAmount;
        if (data.calibrationsPerformed && data.calibrationsPerformed.length > 0) {
          mergedData.completedCalibrationsText = data.calibrationsPerformed.join('; ');
        }
        break;

      case PDF_TYPES.SHOP_ESTIMATE:
        // Shop estimates - store as reference, do NOT populate billing fields
        console.log(`${LOG_TAG} Shop estimate detected - NOT extracting billing data`);
        mergedData.hasShopEstimate = true;
        mergedData.hasEstimate = true;  // Flag for scrub processing in emailListener

        // Process scrub result if present (now run for SHOP_ESTIMATE too)
        if (result.scrubResult) {
          mergedData.estimateScrubResult = result.scrubResult;
          console.log(`${LOG_TAG} Scrub result attached from SHOP_ESTIMATE`);
          // Update RO from scrub result if not already set
          if (result.scrubResult.roPo && !mergedData.roPo) {
            mergedData.roPo = result.scrubResult.roPo;
          }
          // Update VIN if not already set
          if (result.scrubResult.vin && !mergedData.vin) {
            mergedData.vin = result.scrubResult.vin;
          }
        }

        if (data.estimateTotal) {
          // Add to notes as reference only
          const shopNote = `Shop estimate: $${data.estimateTotal.toLocaleString()} (${data.shopName || 'Unknown shop'})`;
          if (mergedData.notes) {
            mergedData.notes += ` | ${shopNote}`;
          } else {
            mergedData.notes = shopNote;
          }
        }
        // Do NOT set invoiceNumber, invoiceAmount, or invoiceDate from shop estimates
        break;

      case PDF_TYPES.SCAN_REPORT:
        if (data.dtcs && data.dtcs.length > 0) {
          const dtcSummary = data.dtcs
            .map(dtc => `${dtc.module || 'Unknown'}: ${dtc.code} - ${dtc.description || 'No description'}`)
            .join('; ');

          if (data.scanType === 'pre-scan' || data.scanType?.toLowerCase().includes('pre')) {
            mergedData.preScanDTCsText = dtcSummary;
          } else {
            mergedData.postScanDTCsText = dtcSummary;
          }
        }
        break;

      case PDF_TYPES.REVV_REPORT:
        if (data.requiredCalibrations && data.requiredCalibrations.length > 0) {
          mergedData.requiredCalibrationsText = data.requiredCalibrations
            .map(cal => `${cal.system} (${cal.calibrationType})`)
            .join('; ');
        }
        if (data.completedCalibrations && data.completedCalibrations.length > 0) {
          const completedSummary = data.completedCalibrations
            .map(cal => `${cal.system} (${cal.calibrationType}): ${cal.status}`)
            .join('; ');
          if (mergedData.completedCalibrationsText) {
            mergedData.completedCalibrationsText += '; ' + completedSummary;
          } else {
            mergedData.completedCalibrationsText = completedSummary;
          }
        }
        break;

      case PDF_TYPES.ESTIMATE:
        // Estimate detected - store scrub result
        mergedData.hasEstimate = true;
        if (result.scrubResult) {
          mergedData.estimateScrubResult = result.scrubResult;
          // Update RO from scrub result if not already set
          if (result.scrubResult.roPo && !mergedData.roPo) {
            mergedData.roPo = result.scrubResult.roPo;
          }
          // Update VIN if not already set
          if (result.scrubResult.vin && !mergedData.vin) {
            mergedData.vin = result.scrubResult.vin;
          }
          // DON'T set notes here - let emailListener handle it ONCE
          // to prevent duplication. Notes are in estimateScrubResult.formattedNotes
        }
        break;
    }
  }

  // SHOP NAME PRIORITY SELECTION
  // Priority: shop_estimate > adas_invoice > revv_report > other
  // This ensures we use the shop name from the most reliable source
  if (shopNameSources.shopEstimate) {
    mergedData.shopName = shopNameSources.shopEstimate;
    console.log(`${LOG_TAG} Using shop name from SHOP_ESTIMATE (priority 1): ${mergedData.shopName}`);
  } else if (shopNameSources.adasInvoice) {
    mergedData.shopName = shopNameSources.adasInvoice;
    console.log(`${LOG_TAG} Using shop name from ADAS_INVOICE (priority 2): ${mergedData.shopName}`);
  } else if (shopNameSources.revvReport) {
    mergedData.shopName = shopNameSources.revvReport;
    console.log(`${LOG_TAG} Using shop name from REVV_REPORT (priority 3): ${mergedData.shopName}`);
  } else if (shopNameSources.other) {
    mergedData.shopName = shopNameSources.other;
    console.log(`${LOG_TAG} Using shop name from OTHER source (priority 4): ${mergedData.shopName}`);
  }

  console.log(`${LOG_TAG} Merged data for RO: ${mergedData.roPo}`);
  return mergedData;
}

/**
 * Format DTCs array into readable text
 *
 * @param {Array} dtcs - Array of DTC objects
 * @returns {string} - Formatted DTC text
 */
export function formatDTCsText(dtcs) {
  if (!dtcs || dtcs.length === 0) return 'No DTCs';

  return dtcs
    .map(dtc => {
      const parts = [];
      if (dtc.module) parts.push(dtc.module);
      if (dtc.code) parts.push(dtc.code);
      if (dtc.description) parts.push(dtc.description);
      if (dtc.status) parts.push(`(${dtc.status})`);
      return parts.join(' - ');
    })
    .join('; ');
}

/**
 * Format calibrations array into readable text
 *
 * @param {Array} calibrations - Array of calibration objects
 * @returns {string} - Formatted calibrations text
 */
export function formatCalibrationsText(calibrations) {
  if (!calibrations || calibrations.length === 0) return 'None';

  return calibrations
    .map(cal => {
      const parts = [cal.system];
      if (cal.calibrationType) parts.push(`(${cal.calibrationType})`);
      if (cal.status) parts.push(`- ${cal.status}`);
      return parts.join(' ');
    })
    .join('; ');
}

export default {
  parsePDF,
  parseAndMergePDFs,
  formatDTCsText,
  formatCalibrationsText,
  PDF_TYPES
};
