/**
 * uploadController.js - Handle PDF file uploads to Google Drive
 */

import { uploadPDF } from '../services/driveUpload.js';

const LOG_TAG = '[UPLOAD_CTRL]';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Valid PDF types that map to driveUpload folder structure
const VALID_PDF_TYPES = ['estimate', 'scan_report', 'revv_report', 'invoice', 'document'];

/**
 * POST /api/portal/upload
 * Upload a PDF file to Google Drive
 *
 * Request: multipart/form-data with:
 *   - file: PDF file
 *   - roPo: RO/PO number
 *   - pdfType: Type of PDF (estimate, scan_report, etc.)
 */
export async function uploadFile(req, res) {
  try {
    const { roPo, pdfType } = req.body;
    const file = req.file;

    // Validate required fields
    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    if (!roPo) {
      return res.status(400).json({
        success: false,
        error: 'RO/PO number is required'
      });
    }

    // Validate PDF type
    const type = pdfType || 'document';
    if (!VALID_PDF_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid PDF type. Must be one of: ${VALID_PDF_TYPES.join(', ')}`
      });
    }

    // Validate file type
    if (file.mimetype !== 'application/pdf') {
      return res.status(400).json({
        success: false,
        error: 'Only PDF files are allowed'
      });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        error: 'File size must be less than 10MB'
      });
    }

    console.log(`${LOG_TAG} Uploading ${type} PDF for RO ${roPo}: ${file.originalname} (${file.size} bytes)`);

    // Upload to Google Drive
    const result = await uploadPDF(file.buffer, file.originalname, roPo, type);

    if (!result.success) {
      console.error(`${LOG_TAG} Upload failed:`, result.error);
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to upload file to Google Drive'
      });
    }

    console.log(`${LOG_TAG} Upload successful: ${result.webViewLink}`);

    res.json({
      success: true,
      fileId: result.fileId,
      webViewLink: result.webViewLink,
      filename: result.filename,
      pdfType: type
    });
  } catch (err) {
    console.error(`${LOG_TAG} Upload error:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to upload file'
    });
  }
}

export default {
  uploadFile
};
