/**
 * driveUpload.js - Google Drive upload service for PDF documents
 *
 * Account: radarsolutionsus@gmail.com
 * Root Folder ID: 1m--pyxHwJXk7PgKQPtc-VVplyyxaAsTz (ADAS_FIRST/Documents)
 *
 * Folder structure:
 * /ADAS_FIRST/Documents/
 *   /RevvReports/RO_<RO>/
 *   /PostScanReports/RO_<RO>/
 *   /Invoices/RO_<RO>/
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

const LOG_TAG = '[DRIVE]';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ADAS_FIRST/Documents folder ID (provided)
const DOCUMENTS_FOLDER_ID = '1m--pyxHwJXk7PgKQPtc-VVplyyxaAsTz';

// OAuth credentials paths (credentials now in /credentials/ folder)
const OAUTH_CREDENTIALS_PATH = process.env.GMAIL_OAUTH_CREDENTIALS_PATH ||
  path.join(__dirname, '../credentials/google-oauth-client.json');
const OAUTH_TOKEN_PATH = process.env.GMAIL_OAUTH_TOKEN_PATH ||
  path.join(__dirname, '../credentials/gmail_oauth_token.json');

// Subfolder names for each PDF type
const PDF_TYPE_FOLDERS = {
  'revv_report': 'RevvReports',
  'scan_report': 'PostScanReports',
  'invoice': 'Invoices',
  'document': 'Documents'
};

let driveClient = null;

// Cache for folder IDs to avoid repeated lookups
const folderCache = new Map();

/**
 * Initialize the Google Drive client using OAuth2 (same credentials as Gmail)
 */
async function initializeDriveClient() {
  if (driveClient) return driveClient;

  try {
    // Load OAuth credentials
    if (!fs.existsSync(OAUTH_CREDENTIALS_PATH)) {
      throw new Error(`OAuth credentials not found at ${OAUTH_CREDENTIALS_PATH}`);
    }

    if (!fs.existsSync(OAUTH_TOKEN_PATH)) {
      throw new Error(`OAuth token not found at ${OAUTH_TOKEN_PATH}. Run: node scripts/gmail-auth.js`);
    }

    const credentials = JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_PATH, 'utf8'));
    const { client_id, client_secret } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      'urn:ietf:wg:oauth:2.0:oob'
    );

    const token = JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(token);

    // Check if token needs refresh
    if (token.expiry_date && token.expiry_date < Date.now()) {
      console.log(`${LOG_TAG} Token expired, refreshing...`);
      const { credentials: newCredentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(newCredentials);
      fs.writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(newCredentials, null, 2));
    }

    driveClient = google.drive({ version: 'v3', auth: oauth2Client });
    console.log(`${LOG_TAG} Google Drive client initialized (radarsolutionsus@gmail.com)`);
    return driveClient;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to initialize Drive client:`, err.message);
    throw err;
  }
}

/**
 * Get or create a folder by name within a parent folder
 */
async function getOrCreateFolder(folderName, parentId) {
  const cacheKey = `${parentId}/${folderName}`;
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  const drive = await initializeDriveClient();

  // Search for existing folder
  const query = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    spaces: 'drive'
  });

  if (response.data.files && response.data.files.length > 0) {
    const folderId = response.data.files[0].id;
    folderCache.set(cacheKey, folderId);
    console.log(`${LOG_TAG} Found existing folder: ${folderName}`);
    return folderId;
  }

  // Create new folder
  const fileMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  };

  const folder = await drive.files.create({
    resource: fileMetadata,
    fields: 'id'
  });

  const folderId = folder.data.id;
  folderCache.set(cacheKey, folderId);
  console.log(`${LOG_TAG} Created folder: ${folderName} (${folderId})`);
  return folderId;
}

/**
 * Get the folder for a specific PDF type and RO
 * Structure: /Documents/<TypeFolder>/RO_<RO>/
 *
 * @param {string} pdfType - 'revv_report', 'scan_report', 'invoice', or 'document'
 * @param {string} roPo - RO or PO number
 * @returns {Promise<string>} - Folder ID
 */
async function getTypeFolderForRO(pdfType, roPo) {
  // Get the type folder name
  const typeFolderName = PDF_TYPE_FOLDERS[pdfType] || PDF_TYPE_FOLDERS['document'];

  // Get or create the type folder under Documents
  const typeFolderId = await getOrCreateFolder(typeFolderName, DOCUMENTS_FOLDER_ID);

  // Get or create the RO-specific folder under the type folder
  const roFolderName = `RO_${roPo.replace(/[^A-Za-z0-9\-]/g, '_')}`;
  const roFolderId = await getOrCreateFolder(roFolderName, typeFolderId);

  return roFolderId;
}

/**
 * Upload a PDF buffer to Google Drive
 *
 * @param {Buffer} buffer - PDF file buffer
 * @param {string} filename - Original filename
 * @param {string} roPo - RO or PO number for folder organization
 * @param {string} pdfType - Type of PDF: 'revv_report', 'scan_report', 'invoice'
 * @returns {Promise<{success: boolean, fileId?: string, webViewLink?: string, error?: string}>}
 */
export async function uploadPDF(buffer, filename, roPo, pdfType = 'document') {
  console.log(`${LOG_TAG} Uploading PDF: ${filename} for RO: ${roPo} (type: ${pdfType})`);

  try {
    const drive = await initializeDriveClient();
    const folderId = await getTypeFolderForRO(pdfType, roPo);

    // Generate a standardized filename
    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedFilename = filename.replace(/[^A-Za-z0-9\-_.]/g, '_');
    const standardName = `${roPo}_${pdfType}_${timestamp}_${sanitizedFilename}`;

    // Convert buffer to readable stream
    const stream = Readable.from(buffer);

    const fileMetadata = {
      name: standardName,
      parents: [folderId]
    };

    const media = {
      mimeType: 'application/pdf',
      body: stream
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink'
    });

    // Make the file viewable by anyone with the link
    await drive.permissions.create({
      fileId: file.data.id,
      resource: {
        role: 'reader',
        type: 'anyone'
      }
    });

    console.log(`${LOG_TAG} Uploaded successfully: ${standardName}`);
    console.log(`${LOG_TAG} File ID: ${file.data.id}`);
    console.log(`${LOG_TAG} View Link: ${file.data.webViewLink}`);

    return {
      success: true,
      fileId: file.data.id,
      webViewLink: file.data.webViewLink,
      webContentLink: file.data.webContentLink,
      filename: standardName,
      pdfType
    };
  } catch (err) {
    console.error(`${LOG_TAG} Upload failed:`, err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Upload multiple PDFs for an RO
 *
 * @param {Array<{buffer: Buffer, filename: string, type: string}>} files - Array of file objects
 * @param {string} roPo - RO or PO number
 * @returns {Promise<{success: boolean, uploads: Array, errors: Array}>}
 */
export async function uploadMultiplePDFs(files, roPo) {
  console.log(`${LOG_TAG} Uploading ${files.length} PDFs for RO: ${roPo}`);

  const uploads = [];
  const errors = [];

  for (const file of files) {
    const result = await uploadPDF(file.buffer, file.filename, roPo, file.type);

    if (result.success) {
      uploads.push({
        filename: file.filename,
        type: file.type,
        fileId: result.fileId,
        webViewLink: result.webViewLink
      });
    } else {
      errors.push({
        filename: file.filename,
        type: file.type,
        error: result.error
      });
    }
  }

  return {
    success: errors.length === 0,
    uploads,
    errors
  };
}

/**
 * List all files in the Documents folder for an RO (across all type folders)
 *
 * @param {string} roPo - RO or PO number
 * @returns {Promise<Array<{id: string, name: string, webViewLink: string, type: string}>>}
 */
export async function listROFiles(roPo) {
  console.log(`${LOG_TAG} Listing files for RO: ${roPo}`);

  const allFiles = [];

  try {
    const drive = await initializeDriveClient();

    for (const [pdfType, typeFolderName] of Object.entries(PDF_TYPE_FOLDERS)) {
      try {
        const folderId = await getTypeFolderForRO(pdfType, roPo);

        const response = await drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: 'files(id, name, webViewLink, webContentLink, mimeType, createdTime)',
          orderBy: 'createdTime desc'
        });

        const files = (response.data.files || []).map(f => ({
          ...f,
          type: pdfType
        }));

        allFiles.push(...files);
      } catch (err) {
        // Folder may not exist, that's okay
      }
    }

    return allFiles;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to list files:`, err.message);
    return [];
  }
}

/**
 * Delete a file from Google Drive
 *
 * @param {string} fileId - The file ID to delete
 * @returns {Promise<boolean>}
 */
export async function deleteFile(fileId) {
  console.log(`${LOG_TAG} Deleting file: ${fileId}`);

  try {
    const drive = await initializeDriveClient();
    await drive.files.delete({ fileId });
    console.log(`${LOG_TAG} File deleted successfully`);
    return true;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to delete file:`, err.message);
    return false;
  }
}

/**
 * Get direct download link for a file
 *
 * @param {string} fileId - The file ID
 * @returns {Promise<string|null>}
 */
export async function getDownloadLink(fileId) {
  try {
    const drive = await initializeDriveClient();
    const response = await drive.files.get({
      fileId,
      fields: 'webContentLink'
    });
    return response.data.webContentLink;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to get download link:`, err.message);
    return null;
  }
}

export default {
  uploadPDF,
  uploadMultiplePDFs,
  listROFiles,
  deleteFile,
  getDownloadLink
};
