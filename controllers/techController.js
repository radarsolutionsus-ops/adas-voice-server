/**
 * techController.js - Controller for tech-specific portal actions
 *
 * Techs can:
 *   - View ALL vehicles
 *   - View their assigned vehicles
 *   - View today's schedule
 *   - Change status
 *   - Add tech notes
 *   - Log arrival time
 *   - Mark job complete
 *   - View documents
 *
 * Techs have full status control
 */

import sheetWriter from '../services/sheetWriter.js';
import {
  filterByTechnician,
  filterTodaySchedule,
  filterByStatus,
  canAccessVehicle
} from '../middleware/dataFilter.js';

const LOG_TAG = '[TECH_CTRL]';

// Valid status values for techs
const VALID_STATUSES = [
  'New',
  'Ready',
  'Scheduled',
  'Rescheduled',
  'En Route',
  'On Site',
  'In Progress',
  'Completed',
  'Cancelled',
  'No Cal',
  'On Hold'
];

/**
 * GET /api/tech/vehicles
 * Get all vehicles (tech sees everything)
 */
export async function getAllVehicles(req, res) {
  try {
    const { status, search, shop } = req.query;
    const user = req.user;

    console.log(`${LOG_TAG} Getting all vehicles for tech: ${user.techName}`);

    const result = await sheetWriter.getAllScheduleRows();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fetch vehicles'
      });
    }

    let vehicles = result.rows || [];

    // Filter by status if provided
    if (status && status !== 'all') {
      vehicles = filterByStatus(vehicles, status);
    }

    // Filter by shop if provided
    if (shop) {
      const shopLower = shop.toLowerCase().trim();
      vehicles = vehicles.filter(v => {
        const vShop = (v.shopName || v.shop_name || '').toLowerCase().trim();
        return vShop.includes(shopLower);
      });
    }

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      vehicles = vehicles.filter(v => {
        const ro = (v.roPo || '').toLowerCase();
        const vin = (v.vin || '').toLowerCase();
        const vehicle = (v.vehicle || '').toLowerCase();
        const shopName = (v.shopName || v.shop_name || '').toLowerCase();
        return ro.includes(searchLower) ||
               vin.includes(searchLower) ||
               vehicle.includes(searchLower) ||
               shopName.includes(searchLower);
      });
    }

    // Sort by scheduled date (most recent first), then by timestamp
    vehicles.sort((a, b) => {
      const dateA = new Date(a.scheduledDate || a.timestampCreated || 0);
      const dateB = new Date(b.scheduledDate || b.timestampCreated || 0);
      return dateB - dateA;
    });

    // Map to clean response format
    const cleanVehicles = vehicles.map(v => ({
      roPo: v.roPo || '',
      vin: v.vin || '',
      vehicle: v.vehicle || '',
      shopName: v.shopName || v.shop_name || '',
      status: v.status || 'New',
      scheduledDate: v.scheduledDate || '',
      scheduledTime: v.scheduledTime || '',
      technician: v.technician || v.technicianAssigned || '',
      requiredCalibrations: v.requiredCalibrations || '',
      notes: v.notes || '',
      dtcs: v.dtcs || '',
      estimatePdf: v.estimatePdf || v.estimate_pdf || '',
      prescanPdf: v.prescanPdf || v.preScanPdf || v.prescan_pdf || '',
      revvReportPdf: v.revvReportPdf || v.revv_report_pdf || '',
      postScanPdf: v.postScanPdf || v.postscan_pdf || '',
      invoicePdf: v.invoicePdf || v.invoice_pdf || '',
      lastUpdated: v.timestampCreated || ''
    }));

    res.json({
      success: true,
      count: cleanVehicles.length,
      vehicles: cleanVehicles
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error getting vehicles:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vehicles'
    });
  }
}

/**
 * GET /api/tech/vehicles/mine
 * Get vehicles assigned to the current tech
 */
export async function getMyVehicles(req, res) {
  try {
    const user = req.user;
    const { status } = req.query;

    console.log(`${LOG_TAG} Getting assigned vehicles for tech: ${user.techName}`);

    const result = await sheetWriter.getAllScheduleRows();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fetch vehicles'
      });
    }

    // Filter by technician
    let vehicles = filterByTechnician(result.rows || [], user.techName);

    // Filter by status if provided
    if (status && status !== 'all') {
      vehicles = filterByStatus(vehicles, status);
    }

    // Sort by scheduled date
    vehicles.sort((a, b) => {
      const dateA = new Date(a.scheduledDate || a.timestampCreated || 0);
      const dateB = new Date(b.scheduledDate || b.timestampCreated || 0);
      return dateB - dateA;
    });

    const cleanVehicles = vehicles.map(v => ({
      roPo: v.roPo || '',
      vin: v.vin || '',
      vehicle: v.vehicle || '',
      shopName: v.shopName || v.shop_name || '',
      status: v.status || 'New',
      scheduledDate: v.scheduledDate || '',
      scheduledTime: v.scheduledTime || '',
      requiredCalibrations: v.requiredCalibrations || '',
      notes: v.notes || '',
      dtcs: v.dtcs || '',
      estimatePdf: v.estimatePdf || v.estimate_pdf || '',
      prescanPdf: v.prescanPdf || v.preScanPdf || v.prescan_pdf || '',
      revvReportPdf: v.revvReportPdf || v.revv_report_pdf || '',
      postScanPdf: v.postScanPdf || v.postscan_pdf || '',
      invoicePdf: v.invoicePdf || v.invoice_pdf || '',
      lastUpdated: v.timestampCreated || ''
    }));

    res.json({
      success: true,
      count: cleanVehicles.length,
      vehicles: cleanVehicles
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error getting assigned vehicles:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vehicles'
    });
  }
}

/**
 * GET /api/tech/today
 * Get today's schedule for the tech
 */
export async function getTodaySchedule(req, res) {
  try {
    const user = req.user;
    const { mine } = req.query;

    console.log(`${LOG_TAG} Getting today's schedule for tech: ${user.techName}`);

    const result = await sheetWriter.getAllScheduleRows();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fetch schedule'
      });
    }

    // Filter by today's date
    let vehicles = filterTodaySchedule(result.rows || []);

    // Optionally filter by assigned tech
    if (mine === 'true' || mine === '1') {
      vehicles = filterByTechnician(vehicles, user.techName);
    }

    // Exclude cancelled
    vehicles = vehicles.filter(v => {
      const status = (v.status || '').toLowerCase();
      return status !== 'cancelled';
    });

    // Sort by scheduled time
    vehicles.sort((a, b) => {
      const timeA = a.scheduledTime || '';
      const timeB = b.scheduledTime || '';
      return timeA.localeCompare(timeB);
    });

    const cleanVehicles = vehicles.map(v => ({
      roPo: v.roPo || '',
      vin: v.vin || '',
      vehicle: v.vehicle || '',
      shopName: v.shopName || v.shop_name || '',
      status: v.status || 'Scheduled',
      scheduledDate: v.scheduledDate || '',
      scheduledTime: v.scheduledTime || '',
      technician: v.technician || v.technicianAssigned || '',
      requiredCalibrations: v.requiredCalibrations || '',
      notes: v.notes || '',
      dtcs: v.dtcs || '',
      estimatePdf: v.estimatePdf || v.estimate_pdf || '',
      prescanPdf: v.prescanPdf || v.preScanPdf || v.prescan_pdf || '',
      revvReportPdf: v.revvReportPdf || v.revv_report_pdf || '',
      postScanPdf: v.postScanPdf || v.postscan_pdf || '',
      invoicePdf: v.invoicePdf || v.invoice_pdf || ''
    }));

    res.json({
      success: true,
      date: new Date().toISOString().split('T')[0],
      count: cleanVehicles.length,
      vehicles: cleanVehicles
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error getting today's schedule:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch schedule'
    });
  }
}

/**
 * GET /api/tech/vehicles/:roPo
 * Get single vehicle details
 */
export async function getVehicleDetail(req, res) {
  try {
    const { roPo } = req.params;
    const user = req.user;

    console.log(`${LOG_TAG} Getting vehicle ${roPo} for tech: ${user.techName}`);

    const row = await sheetWriter.getScheduleRowByRO(roPo);

    if (!row) {
      return res.status(404).json({
        success: false,
        error: `Vehicle with RO ${roPo} not found`
      });
    }

    // Techs can access any vehicle
    if (!canAccessVehicle(row, user)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    res.json({
      success: true,
      vehicle: {
        roPo: row.roPo || roPo,
        vin: row.vin || '',
        vehicle: row.vehicle || '',
        shopName: row.shopName || row.shop_name || '',
        status: row.status || 'New',
        scheduledDate: row.scheduledDate || '',
        scheduledTime: row.scheduledTime || '',
        technician: row.technician || row.technicianAssigned || '',
        requiredCalibrations: row.requiredCalibrations || '',
        completedCalibrations: row.completedCalibrations || '',
        dtcs: row.dtcs || '',
        notes: row.notes || '',
        estimatePdf: row.estimatePdf || row.estimate_pdf || '',
        prescanPdf: row.prescanPdf || row.preScanPdf || row.prescan_pdf || '',
        revvReportPdf: row.revvReportPdf || row.revv_report_pdf || '',
        postScanPdf: row.postScanPdf || row.postscan_pdf || '',
        invoicePdf: row.invoicePdf || row.invoice_pdf || '',
        arrivalTime: row.arrivalTime || '',
        completionTime: row.completionTime || '',
        timestampCreated: row.timestampCreated || ''
      }
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error getting vehicle:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vehicle'
    });
  }
}

/**
 * PUT /api/tech/vehicles/:roPo/status
 * Change vehicle status
 */
export async function updateStatus(req, res) {
  try {
    const { roPo } = req.params;
    const { status, notes } = req.body;
    const user = req.user;

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required' });
    }

    // Validate status value
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }

    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    console.log(`${LOG_TAG} Updating status for RO ${roPo} to "${status}" by tech: ${user.techName}`);

    const timestamp = new Date().toISOString();
    let updatedNotes = row.notes || '';

    // Add status change note
    updatedNotes += `\n[${timestamp}] Status changed to "${status}" by ${user.techName}`;

    // Add optional note if provided
    if (notes) {
      updatedNotes += `\n[${timestamp}] Tech note: ${notes}`;
    }

    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      status: status,
      notes: updatedNotes.trim()
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to update status'
      });
    }

    res.json({
      success: true,
      message: `Status updated to ${status}`,
      roPo: roPo
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error updating status:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update status'
    });
  }
}

/**
 * POST /api/tech/vehicles/:roPo/arrive
 * Log arrival at shop
 */
export async function markArrival(req, res) {
  try {
    const { roPo } = req.params;
    const user = req.user;

    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    console.log(`${LOG_TAG} Logging arrival for RO ${roPo} by tech: ${user.techName}`);

    const timestamp = new Date().toISOString();
    const arrivalNote = `[${timestamp}] Tech ${user.techName} arrived on site`;

    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      status: 'On Site',
      arrivalTime: timestamp,
      notes: `${row.notes || ''}\n${arrivalNote}`.trim()
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to log arrival'
      });
    }

    res.json({
      success: true,
      message: 'Arrival logged',
      roPo: roPo,
      arrivalTime: timestamp
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error logging arrival:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to log arrival'
    });
  }
}

/**
 * POST /api/tech/vehicles/:roPo/complete
 * Mark job as complete
 */
export async function markComplete(req, res) {
  try {
    const { roPo } = req.params;
    const { completedCalibrations, notes, postScanPdfUrl } = req.body;
    const user = req.user;

    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    console.log(`${LOG_TAG} Marking complete for RO ${roPo} by tech: ${user.techName}`);

    const timestamp = new Date().toISOString();
    let completionNotes = row.notes || '';
    completionNotes += `\n[${timestamp}] Job completed by ${user.techName}`;

    if (notes) {
      completionNotes += `\n[${timestamp}] Completion note: ${notes}`;
    }

    const updateData = {
      status: 'Completed',
      completionTime: timestamp,
      notes: completionNotes.trim()
    };

    // Add completed calibrations if provided
    if (completedCalibrations) {
      updateData.completedCalibrations = completedCalibrations;
    }

    // Add post-scan PDF if provided
    if (postScanPdfUrl) {
      updateData.postScanPdf = postScanPdfUrl;
    }

    const result = await sheetWriter.upsertScheduleRowByRO(roPo, updateData);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to mark complete'
      });
    }

    res.json({
      success: true,
      message: 'Job marked as complete',
      roPo: roPo,
      completionTime: timestamp
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error marking complete:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to mark complete'
    });
  }
}

/**
 * POST /api/tech/vehicles/:roPo/notes
 * Add a tech note to a vehicle
 */
export async function addTechNote(req, res) {
  try {
    const { roPo } = req.params;
    const { note } = req.body;
    const user = req.user;

    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, error: 'Note is required' });
    }

    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    const timestamp = new Date().toISOString();
    const techNote = `[${timestamp}] Tech ${user.techName}: ${note.trim()}`;

    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      notes: `${row.notes || ''}\n${techNote}`.trim()
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to add note'
      });
    }

    res.json({
      success: true,
      message: 'Note added'
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error adding note:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to add note'
    });
  }
}

/**
 * GET /api/tech/vehicles/:roPo/documents
 * Get document links for a vehicle
 */
export async function getDocuments(req, res) {
  try {
    const { roPo } = req.params;
    const user = req.user;

    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    if (!canAccessVehicle(row, user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    res.json({
      success: true,
      documents: {
        estimate: row.estimatePdf || row.estimate_pdf || null,
        preScan: row.prescanPdf || row.preScanPdf || row.prescan_pdf || null,
        revvReport: row.revvReportPdf || row.revv_report_pdf || null,
        postScan: row.postScanPdf || row.postscan_pdf || null,
        invoice: row.invoicePdf || row.invoice_pdf || null
      }
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error getting documents:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch documents'
    });
  }
}

/**
 * GET /api/tech/stats
 * Get dashboard statistics for the tech
 */
export async function getStats(req, res) {
  try {
    const user = req.user;

    const result = await sheetWriter.getAllScheduleRows();
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fetch stats'
      });
    }

    const allVehicles = result.rows || [];
    const myVehicles = filterByTechnician(allVehicles, user.techName);
    const todayAll = filterTodaySchedule(allVehicles);
    const todayMine = filterByTechnician(todayAll, user.techName);

    // Count by status for all vehicles
    const statsByStatus = {
      new: 0,
      ready: 0,
      scheduled: 0,
      enRoute: 0,
      onSite: 0,
      inProgress: 0,
      completed: 0,
      noCal: 0
    };

    allVehicles.forEach(v => {
      const status = (v.status || '').toLowerCase();
      switch (status) {
        case 'new': statsByStatus.new++; break;
        case 'ready': statsByStatus.ready++; break;
        case 'scheduled':
        case 'rescheduled': statsByStatus.scheduled++; break;
        case 'en route': statsByStatus.enRoute++; break;
        case 'on site': statsByStatus.onSite++; break;
        case 'in progress': statsByStatus.inProgress++; break;
        case 'completed': statsByStatus.completed++; break;
        case 'no cal': statsByStatus.noCal++; break;
      }
    });

    res.json({
      success: true,
      stats: {
        total: allVehicles.length,
        byStatus: statsByStatus,
        myAssigned: myVehicles.length,
        todayTotal: todayAll.length,
        todayMine: todayMine.length
      }
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error getting stats:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats'
    });
  }
}

/**
 * POST /api/tech/vehicles/:roPo/upload
 * Upload a document (postScan, invoice, revvReport) for a vehicle
 */
export async function uploadDocument(req, res) {
  try {
    const { roPo } = req.params;
    const user = req.user;

    // Debug logging for form data - log everything
    console.log(`${LOG_TAG} Upload request for RO: ${roPo}`);
    console.log(`${LOG_TAG} req.body keys:`, Object.keys(req.body || {}));
    console.log(`${LOG_TAG} req.body:`, JSON.stringify(req.body));
    console.log(`${LOG_TAG} req.file:`, req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'no file');

    // Get docType from body (multer parses multipart form fields into req.body)
    const docType = req.body?.docType || req.body?.type;

    // Validate docType
    const validDocTypes = ['postScan', 'invoice', 'revvReport'];
    if (!validDocTypes.includes(docType)) {
      console.log(`${LOG_TAG} Invalid docType received: "${docType}"`);
      return res.status(400).json({
        success: false,
        error: `Invalid document type. Must be one of: ${validDocTypes.join(', ')}. Received: "${docType}"`
      });
    }

    // Check file exists
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    // Verify vehicle exists
    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    console.log(`${LOG_TAG} Uploading ${docType} for RO ${roPo} by tech: ${user.techName}`);

    // Import drive upload service dynamically
    const { uploadPDF } = await import('../services/driveUpload.js');

    // Map docType to drive folder type
    const folderTypeMap = {
      'postScan': 'scan_report',
      'invoice': 'invoice',
      'revvReport': 'revv_report'
    };

    // Upload to Drive
    const uploadResult = await uploadPDF(
      req.file.buffer,
      req.file.originalname,
      roPo,
      folderTypeMap[docType]
    );

    if (!uploadResult.success) {
      console.error(`${LOG_TAG} Failed to upload ${docType}:`, uploadResult.error);
      return res.status(500).json({ success: false, error: 'Failed to upload file' });
    }

    const fileUrl = uploadResult.webViewLink;
    console.log(`${LOG_TAG} ${docType} uploaded: ${fileUrl}`);

    // Map docType to sheet column
    const columnMap = {
      'postScan': 'postScanPdf',
      'invoice': 'invoicePdf',
      'revvReport': 'revvReportPdf'
    };

    // Update sheet with URL
    const updateData = {};
    updateData[columnMap[docType]] = fileUrl;

    const result = await sheetWriter.upsertScheduleRowByRO(roPo, updateData);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to update document URL'
      });
    }

    res.json({
      success: true,
      message: `${docType} uploaded successfully`,
      url: fileUrl
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error uploading document:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to upload document'
    });
  }
}

/**
 * POST /api/tech/request-assignment
 * Request to be assigned to a job
 */
export async function requestAssignment(req, res) {
  try {
    const { roPo, requestingTech, reason } = req.body;
    const user = req.user;

    if (!roPo) {
      return res.status(400).json({ success: false, error: 'RO/PO is required' });
    }

    // Verify vehicle exists
    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    const techName = requestingTech || user.techName;
    const currentTech = row.technician || row.technicianAssigned || '';

    console.log(`${LOG_TAG} Assignment request for RO ${roPo} by ${techName} (current: ${currentTech})`);

    // Forward to Google Apps Script for processing
    const { callGAS } = await import('../services/sheetWriter.js');

    const gasResult = await callGAS('request_assignment', {
      roPo: roPo,
      requestingTech: techName,
      currentTech: currentTech,
      shopName: row.shopName || row.shop_name || '',
      reason: reason || ''
    });

    if (!gasResult.success) {
      return res.status(500).json({
        success: false,
        error: gasResult.error || 'Failed to submit request'
      });
    }

    res.json({
      success: true,
      message: 'Assignment request submitted',
      requestId: gasResult.requestId
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error requesting assignment:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to submit assignment request'
    });
  }
}

export default {
  getAllVehicles,
  getMyVehicles,
  getTodaySchedule,
  getVehicleDetail,
  updateStatus,
  markArrival,
  markComplete,
  addTechNote,
  getDocuments,
  getStats,
  uploadDocument,
  requestAssignment
};
