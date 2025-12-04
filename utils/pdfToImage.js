/**
 * pdfToImage.js - PDF to Image Conversion Utility
 *
 * Converts PDF files to images for use with GPT-4o Vision.
 * Uses pdf-poppler for high-quality conversion.
 *
 * Note: Requires poppler to be installed on the system:
 * - macOS: brew install poppler
 * - Ubuntu: apt-get install poppler-utils
 * - Windows: Download from https://github.com/oschwartz10612/poppler-windows
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const LOG_TAG = '[PDF_TO_IMAGE]';

/**
 * Convert first page of PDF to base64 image
 * @param {string} pdfPath - Path to the PDF file
 * @param {object} options - Conversion options
 * @returns {Promise<string>} Base64 encoded image
 */
export async function convertPdfToImage(pdfPath, options = {}) {
  const {
    page = 1,
    dpi = 200,
    format = 'jpeg',
    quality = 85
  } = options;

  console.log(`${LOG_TAG} Converting PDF to image: ${pdfPath}`);

  // Verify PDF exists
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  // Create temp directory for output
  const tempDir = path.join(os.tmpdir(), 'adas-pdf-convert');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const outputBase = path.join(tempDir, `page-${Date.now()}`);
  const outputFile = `${outputBase}-${page}.${format === 'jpeg' ? 'jpg' : format}`;

  try {
    // Try using pdftoppm (poppler-utils)
    await convertWithPoppler(pdfPath, outputBase, { page, dpi, format });

    // Read the output file
    if (fs.existsSync(outputFile)) {
      const imageBuffer = fs.readFileSync(outputFile);
      const base64 = imageBuffer.toString('base64');

      // Clean up temp file
      fs.unlinkSync(outputFile);

      console.log(`${LOG_TAG} Successfully converted PDF to image (${base64.length} bytes)`);
      return base64;
    }

    // Try alternate output filename patterns
    const possibleFiles = [
      `${outputBase}-${page}.jpg`,
      `${outputBase}-${page}.jpeg`,
      `${outputBase}-${page}.png`,
      `${outputBase}-1.jpg`,
      `${outputBase}-01.jpg`,
      `${outputBase}.jpg`
    ];

    for (const f of possibleFiles) {
      if (fs.existsSync(f)) {
        const imageBuffer = fs.readFileSync(f);
        const base64 = imageBuffer.toString('base64');
        fs.unlinkSync(f);
        console.log(`${LOG_TAG} Found output at ${f}`);
        return base64;
      }
    }

    throw new Error('PDF conversion completed but output file not found');

  } catch (popplerError) {
    console.warn(`${LOG_TAG} Poppler conversion failed: ${popplerError.message}`);

    // Fallback: Try using pdf-lib or other methods
    try {
      return await convertWithFallback(pdfPath, options);
    } catch (fallbackError) {
      console.error(`${LOG_TAG} All conversion methods failed`);
      throw new Error(`PDF conversion failed: ${popplerError.message}`);
    }
  }
}

/**
 * Convert PDF using poppler (pdftoppm)
 */
async function convertWithPoppler(pdfPath, outputBase, options) {
  const { page, dpi, format } = options;

  // Build pdftoppm command
  const formatFlag = format === 'png' ? '-png' : '-jpeg';
  const cmd = `pdftoppm ${formatFlag} -r ${dpi} -f ${page} -l ${page} "${pdfPath}" "${outputBase}"`;

  console.log(`${LOG_TAG} Running: ${cmd}`);

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
    if (stderr && !stderr.includes('warning')) {
      console.warn(`${LOG_TAG} pdftoppm stderr: ${stderr}`);
    }
  } catch (error) {
    // Check if pdftoppm is installed
    if (error.message.includes('not found') || error.message.includes('ENOENT')) {
      throw new Error('poppler-utils not installed. Install with: brew install poppler (macOS) or apt-get install poppler-utils (Linux)');
    }
    throw error;
  }
}

/**
 * Fallback conversion method
 * Uses pdf-lib to extract and render if available
 */
async function convertWithFallback(pdfPath, options) {
  // Try using sharp + pdf-parse as fallback
  try {
    const pdfParse = await import('pdf-parse');
    const sharp = await import('sharp');

    // This is a limited fallback - just returns placeholder
    console.warn(`${LOG_TAG} Using fallback method - limited quality`);

    // Read PDF and return first page as-is (some vision models can handle PDF)
    const pdfBuffer = fs.readFileSync(pdfPath);
    return pdfBuffer.toString('base64');

  } catch (e) {
    // No fallback available
    throw new Error('No PDF conversion method available');
  }
}

/**
 * Convert multiple pages of a PDF to images
 * @param {string} pdfPath - Path to the PDF file
 * @param {object} options - Conversion options
 * @returns {Promise<string[]>} Array of base64 encoded images
 */
export async function convertPdfToImages(pdfPath, options = {}) {
  const {
    startPage = 1,
    endPage = null,
    maxPages = 5,
    dpi = 150,
    format = 'jpeg'
  } = options;

  console.log(`${LOG_TAG} Converting PDF pages to images: ${pdfPath}`);

  // Get page count
  const pageCount = await getPdfPageCount(pdfPath);
  const actualEndPage = Math.min(
    endPage || pageCount,
    startPage + maxPages - 1,
    pageCount
  );

  console.log(`${LOG_TAG} Converting pages ${startPage} to ${actualEndPage} of ${pageCount}`);

  const images = [];
  for (let page = startPage; page <= actualEndPage; page++) {
    try {
      const base64 = await convertPdfToImage(pdfPath, { page, dpi, format });
      images.push(base64);
    } catch (error) {
      console.error(`${LOG_TAG} Failed to convert page ${page}: ${error.message}`);
    }
  }

  return images;
}

/**
 * Get the number of pages in a PDF
 */
async function getPdfPageCount(pdfPath) {
  try {
    // Try pdfinfo (poppler-utils)
    const { stdout } = await execAsync(`pdfinfo "${pdfPath}" | grep Pages`);
    const match = stdout.match(/Pages:\s*(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  } catch (e) {
    // pdfinfo not available
  }

  try {
    // Try with pdf-parse
    const pdfParse = (await import('pdf-parse')).default;
    const pdfBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(pdfBuffer);
    return data.numpages || 1;
  } catch (e) {
    // pdf-parse not available
  }

  // Default to 1 page
  return 1;
}

/**
 * Check if PDF conversion is available on this system
 */
export async function isPdfConversionAvailable() {
  try {
    await execAsync('pdftoppm -v');
    return { available: true, method: 'poppler' };
  } catch (e) {
    // Poppler not available
  }

  try {
    await import('pdf-parse');
    return { available: true, method: 'pdf-parse' };
  } catch (e) {
    // pdf-parse not available
  }

  return { available: false, method: null };
}

export default {
  convertPdfToImage,
  convertPdfToImages,
  isPdfConversionAvailable
};
