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

// Helper to get tech name with fallbacks
function getTechName(user) {
  return user?.techName || user?.name || user?.username || 'Unknown';
}

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
    const techName = getTechName(user);

    console.log(`${LOG_TAG} Getting all vehicles for tech: ${techName}`);

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
      extraDocs: v.extraDocs || v.extra_docs || '',
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
    const techName = getTechName(user);

    console.log(`${LOG_TAG} Getting assigned vehicles for tech: ${techName}`);

    const result = await sheetWriter.getAllScheduleRows();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fetch vehicles'
      });
    }

    // Filter by technician
    let vehicles = filterByTechnician(result.rows || [], techName);

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
      extraDocs: v.extraDocs || v.extra_docs || '',
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
    const techName = getTechName(user);

    console.log(`${LOG_TAG} Getting today's schedule for tech: ${techName}`);

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
      vehicles = filterByTechnician(vehicles, techName);
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
      invoicePdf: v.invoicePdf || v.invoice_pdf || '',
      extraDocs: v.extraDocs || v.extra_docs || ''
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
    const techName = getTechName(user);

    console.log(`${LOG_TAG} Getting vehicle ${roPo} for tech: ${techName}`);

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
        extraDocs: row.extraDocs || row.extra_docs || '',
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
    const techName = getTechName(user);

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

    console.log(`${LOG_TAG} Updating status for RO ${roPo} to "${status}" by tech: ${techName}`);

    const timestamp = new Date().toISOString();
    let updatedNotes = row.notes || '';

    // Add status change note
    updatedNotes += `\n[${timestamp}] Status changed to "${status}" by ${techName}`;

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
    const techName = getTechName(user);

    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    console.log(`${LOG_TAG} Logging arrival for RO ${roPo} by tech: ${techName}`);

    const timestamp = new Date().toISOString();
    const arrivalNote = `[${timestamp}] Tech ${techName} arrived on site`;

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
    const techName = getTechName(user);

    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    console.log(`${LOG_TAG} Marking complete for RO ${roPo} by tech: ${techName}`);

    // Record completion time in Miami timezone
    const now = new Date();
    const timestamp = now.toISOString();
    const jobEndFormatted = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    let completionNotes = row.notes || '';
    completionNotes += `\n[${jobEndFormatted}] Job completed by ${techName}`;

    if (notes) {
      completionNotes += `\n[${jobEndFormatted}] Completion note: ${notes}`;
    }

    const updateData = {
      status: 'Completed',
      completionTime: timestamp,
      job_end: jobEndFormatted,  // Column Y - Job End timestamp
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

    // Send completion email to shop (async, don't block response)
    sendCompletionEmailToShop(roPo, row, completedCalibrations || row.requiredCalibrations).catch(err => {
      console.error(`${LOG_TAG} Background completion email failed for RO ${roPo}:`, err.message);
    });

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
    const techName = getTechName(user);

    if (!note || !note.trim()) {
      return res.status(400).json({ success: false, error: 'Note is required' });
    }

    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    const timestamp = new Date().toISOString();
    const techNote = `[${timestamp}] Tech ${techName}: ${note.trim()}`;

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
    const techName = getTechName(user);

    const result = await sheetWriter.getAllScheduleRows();
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fetch stats'
      });
    }

    const allVehicles = result.rows || [];
    const myVehicles = filterByTechnician(allVehicles, techName);
    const todayAll = filterTodaySchedule(allVehicles);
    const todayMine = filterByTechnician(todayAll, techName);

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
    const techName = getTechName(user);

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
    const validDocTypes = ['postScan', 'invoice', 'revvReport', 'extraDocs'];
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

    console.log(`${LOG_TAG} Uploading ${docType} for RO ${roPo} by tech: ${techName}`);

    // Import drive upload service dynamically
    const { uploadPDF } = await import('../services/driveUpload.js');

    // Map docType to drive folder type
    const folderTypeMap = {
      'postScan': 'scan_report',
      'invoice': 'invoice',
      'revvReport': 'revv_report',
      'extraDocs': 'extra_docs'
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
      'revvReport': 'revvReportPdf',
      'extraDocs': 'extraDocs'
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

    // Process RevvADAS report: parse PDF, update sheet with calibrations, send email
    let emailSent = false;
    let parsedCalibrations = [];
    if (docType === 'revvReport') {
      try {
        const { sendReadyToScheduleEmail } = await import('../services/emailSender.js');
        const { logRevvSubmitted } = await import('../services/learningLogger.js');
        const pdfParser = await import('../services/pdfParser.js');

        // Parse the RevvADAS PDF to extract calibrations
        console.log(`${LOG_TAG} Parsing RevvADAS PDF for calibrations...`);
        const parseResult = await pdfParser.default.parsePDF(req.file.buffer, req.file.originalname);

        if (parseResult.success && parseResult.data) {
          const revvData = parseResult.data;

          // Extract calibrations from parsed data
          if (revvData.requiredCalibrations && revvData.requiredCalibrations.length > 0) {
            parsedCalibrations = revvData.requiredCalibrations.map(cal =>
              typeof cal === 'string' ? cal : `${cal.system} (${cal.calibrationType || 'Static'})`
            );

            // Update the sheet with parsed calibrations
            const calibrationsText = parsedCalibrations.join(', ');
            console.log(`${LOG_TAG} Parsed calibrations from RevvADAS: ${calibrationsText}`);

            await sheetWriter.upsertScheduleRowByRO(roPo, {
              requiredCalibrations: calibrationsText,
              status: 'Ready' // Mark as ready for scheduling
            });
          } else {
            console.log(`${LOG_TAG} No calibrations found in RevvADAS PDF`);
            // Update status to No Cal if no calibrations required
            await sheetWriter.upsertScheduleRowByRO(roPo, {
              status: 'No Cal'
            });
          }
        }

        // Send "Ready to Schedule" email to shop
        const emailResult = await sendReadyToScheduleEmail({
          roPo,
          shopName: row.shopName || row.shop_name,
          vehicle: row.vehicle,
          vin: row.vin,
          calibrations: parsedCalibrations,
          revvPdfBuffer: req.file.buffer
        });

        emailSent = emailResult.success;

        if (emailResult.success) {
          console.log(`${LOG_TAG} Ready to Schedule email sent for RO ${roPo}`);
        } else {
          console.log(`${LOG_TAG} Could not send shop email for RO ${roPo}: ${emailResult.error}`);
        }

        // Log to learning system
        await logRevvSubmitted(roPo, {
          year: row.vehicle?.split(' ')[0],
          make: row.vehicle?.split(' ')[1],
          model: row.vehicle?.split(' ').slice(2).join(' '),
          full: row.vehicle
        }, parsedCalibrations, techName);

      } catch (emailErr) {
        console.error(`${LOG_TAG} Error in post-upload processing:`, emailErr.message);
        // Don't fail the upload if email/parse fails
      }
    }

    // Process Invoice: parse PDF, extract invoice number/amount/date
    let invoiceData = null;
    if (docType === 'invoice') {
      try {
        const pdfParser = await import('../services/pdfParser.js');

        console.log(`${LOG_TAG} Parsing Invoice PDF for data extraction...`);
        const parseResult = await pdfParser.default.parsePDF(req.file.buffer, req.file.originalname);

        if (parseResult.success && parseResult.data) {
          const parsedData = parseResult.data;

          invoiceData = {
            invoiceNumber: parsedData.invoiceNumber || '',
            invoiceAmount: parsedData.invoiceAmount || parsedData.totalAmount || '',
            invoiceDate: parsedData.invoiceDate || ''
          };

          // Update the sheet with parsed invoice data
          if (invoiceData.invoiceNumber || invoiceData.invoiceAmount || invoiceData.invoiceDate) {
            console.log(`${LOG_TAG} Extracted invoice data - Number: ${invoiceData.invoiceNumber}, Amount: ${invoiceData.invoiceAmount}, Date: ${invoiceData.invoiceDate}`);

            await sheetWriter.upsertScheduleRowByRO(roPo, {
              invoiceNumber: invoiceData.invoiceNumber,
              invoiceAmount: invoiceData.invoiceAmount,
              invoiceDate: invoiceData.invoiceDate
            });
          } else {
            console.log(`${LOG_TAG} No invoice data extracted from PDF`);
          }
        }
      } catch (parseErr) {
        console.error(`${LOG_TAG} Error parsing invoice PDF:`, parseErr.message);
        // Don't fail the upload if parsing fails
      }
    }

    res.json({
      success: true,
      message: `${docType} uploaded successfully`,
      url: fileUrl,
      emailSent: docType === 'revvReport' ? emailSent : undefined,
      invoiceData: docType === 'invoice' ? invoiceData : undefined
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
 * POST /api/tech/start-job
 * Start working on a job - sets status to "In Progress" and records start time
 * Updates scheduled date/time to NOW when job starts
 * Enforces one job at a time rule
 */
export async function startJob(req, res) {
  try {
    const { roPo, originalScheduledDate } = req.body;
    const user = req.user;

    if (!roPo) {
      return res.status(400).json({ success: false, error: 'RO/PO is required' });
    }

    console.log(`${LOG_TAG} ====== START JOB REQUEST ======`);
    const techName = getTechName(user);
    console.log(`${LOG_TAG} RO: ${roPo}, Tech: ${techName}`);

    // Check if tech already has an active job
    const allResult = await sheetWriter.getAllScheduleRows();
    if (!allResult.success) {
      return res.status(500).json({ success: false, error: 'Failed to check active jobs' });
    }

    const techNameLower = techName.toLowerCase().trim();
    const activeJob = (allResult.rows || []).find(row => {
      const rowTech = (row.technician || row.technicianAssigned || '').toLowerCase().trim();
      const status = (row.status || '').toLowerCase();
      return rowTech === techNameLower && status === 'in progress';
    });

    if (activeJob && activeJob.roPo !== roPo) {
      return res.status(400).json({
        success: false,
        error: 'You already have an active job in progress',
        activeJob: {
          roPo: activeJob.roPo,
          vehicle: activeJob.vehicle,
          shopName: activeJob.shopName || activeJob.shop_name
        }
      });
    }

    // Verify job exists
    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    // Get current date and time in Miami timezone (America/New_York = EST/EDT)
    const now = new Date();
    const miamiTimezone = 'America/New_York';

    // Format date as MM/DD/YYYY in Miami time
    const todayStr = now.toLocaleDateString('en-US', { timeZone: miamiTimezone });

    // Format time as h:mm AM/PM in Miami time
    const currentTime = now.toLocaleTimeString('en-US', {
      timeZone: miamiTimezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }); // e.g., "3:15 PM"

    // Job start timestamp - human readable in Miami time
    const jobStartFormatted = now.toLocaleString('en-US', {
      timeZone: miamiTimezone,
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }); // e.g., "12/12/2025, 3:15 PM"

    // Also keep ISO timestamp for notes
    const timestamp = now.toISOString();
    let startNote = `[${jobStartFormatted}] Job started by ${techName}`;

    // Check if schedule date is being changed
    const oldScheduledDate = row.scheduledDate || row.scheduled_date || '';
    if (originalScheduledDate && oldScheduledDate) {
      const originalDate = new Date(originalScheduledDate).toLocaleDateString('en-US', { timeZone: miamiTimezone });
      if (originalDate !== todayStr) {
        startNote += ` [SCHEDULE CHANGED: Originally scheduled for ${originalDate}]`;
        console.log(`${LOG_TAG} Schedule changed from ${originalDate} to ${todayStr}`);
      }
    }

    console.log(`${LOG_TAG} Miami time - Date: ${todayStr}, Time: ${currentTime}, JobStart: ${jobStartFormatted}`);
    console.log(`${LOG_TAG} Updating Google Sheets - Status: "In Progress", Technician: "${techName}"`);

    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      status: 'In Progress',
      technician: techName,
      scheduledDate: todayStr,
      scheduledTime: currentTime,
      job_start: jobStartFormatted,  // Column X - Job Start timestamp (human readable)
      notes: `${row.notes || ''}\n${startNote}`.trim()
    });

    console.log(`${LOG_TAG} Sheets update result:`, JSON.stringify(result));

    if (!result.success) {
      console.error(`${LOG_TAG} FAILED to update Sheets for RO ${roPo}:`, result.error);
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to start job'
      });
    }

    console.log(`${LOG_TAG} SUCCESS - Job ${roPo} status updated to "In Progress" in Google Sheets`);
    console.log(`${LOG_TAG} ====== START JOB COMPLETE ======`);

    res.json({
      success: true,
      message: 'Job started',
      roPo: roPo,
      startTime: timestamp,
      job: {
        roPo: row.roPo,
        vehicle: row.vehicle,
        shopName: row.shopName || row.shop_name,
        requiredCalibrations: row.requiredCalibrations,
        // Document URLs for completion validation
        postScanPdf: row.postScanPdf || row.postscan_pdf || '',
        invoicePdf: row.invoicePdf || row.invoice_pdf || ''
      }
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error starting job:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to start job'
    });
  }
}

/**
 * POST /api/tech/complete-job
 * Complete a job with calibrations performed and notes
 */
export async function completeJob(req, res) {
  try {
    const { roPo, completedCalibrations, notes } = req.body;
    const user = req.user;

    if (!roPo) {
      return res.status(400).json({ success: false, error: 'RO/PO is required' });
    }

    const techName = getTechName(user);
    console.log(`${LOG_TAG} Complete job request for RO ${roPo} by tech: ${techName}`);

    // Verify job exists
    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }

    // Record completion time in Miami timezone
    const now = new Date();
    const timestamp = now.toISOString();
    const jobEndFormatted = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }); // e.g., "12/12/2025, 3:15 PM"

    let completionNotes = row.notes || '';
    completionNotes += `\n[${jobEndFormatted}] Job completed by ${techName}`;

    if (completedCalibrations) {
      completionNotes += `\nCalibrations performed: ${completedCalibrations}`;
    }

    if (notes) {
      completionNotes += `\nCompletion notes: ${notes}`;
    }

    const updateData = {
      status: 'Completed',
      completionTime: timestamp,
      job_end: jobEndFormatted,  // Column Y - Job End timestamp
      notes: completionNotes.trim()
    };

    if (completedCalibrations) {
      updateData.completedCalibrations = completedCalibrations;
    }

    const result = await sheetWriter.upsertScheduleRowByRO(roPo, updateData);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to complete job'
      });
    }

    // Send completion email to shop (async, don't block response)
    sendCompletionEmailToShop(roPo, row, completedCalibrations).catch(err => {
      console.error(`${LOG_TAG} Background completion email failed for RO ${roPo}:`, err.message);
    });

    res.json({
      success: true,
      message: 'Job completed',
      roPo: roPo,
      completionTime: timestamp
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error completing job:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to complete job'
    });
  }
}

/**
 * Download PDF from Google Drive URL
 * Extracts file ID and downloads content as buffer
 * @param {string} driveUrl - Google Drive URL
 * @returns {Promise<Buffer|null>} - PDF buffer or null if failed
 */
async function downloadPdfFromDrive(driveUrl) {
  if (!driveUrl || !driveUrl.startsWith('http')) {
    return null;
  }

  try {
    // Extract file ID from various Google Drive URL formats
    // Format 1: https://drive.google.com/file/d/FILE_ID/view
    // Format 2: https://drive.google.com/open?id=FILE_ID
    // Format 3: https://docs.google.com/document/d/FILE_ID/edit
    let fileId = null;

    const idFromPath = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (idFromPath) {
      fileId = idFromPath[1];
    } else {
      const idFromQuery = driveUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (idFromQuery) {
        fileId = idFromQuery[1];
      }
    }

    if (!fileId) {
      console.log(`${LOG_TAG} Could not extract file ID from Drive URL: ${driveUrl}`);
      return null;
    }

    // Use Google Drive API to download the file
    // Import the drive service
    const driveUpload = await import('../services/driveUpload.js');

    // Try to get the file content
    const buffer = await driveUpload.default.downloadFile(fileId);
    if (buffer) {
      console.log(`${LOG_TAG} Downloaded PDF from Drive: ${fileId} (${buffer.length} bytes)`);
      return buffer;
    }

    return null;
  } catch (err) {
    console.error(`${LOG_TAG} Failed to download PDF from Drive:`, err.message);
    return null;
  }
}

/**
 * Send completion email to shop (background task)
 */
async function sendCompletionEmailToShop(roPo, row, completedCalibrations) {
  try {
    // Get shop email
    const shopName = row.shopName || row.shop_name;
    if (!shopName) {
      console.log(`${LOG_TAG} No shop name for RO ${roPo}, skipping completion email`);
      return;
    }

    const shopEmail = await sheetWriter.getShopEmailByName(shopName);
    if (!shopEmail) {
      console.log(`${LOG_TAG} No email found for shop "${shopName}", skipping completion email`);
      return;
    }

    // Get document URLs
    const postScanLink = row.postScanPdf || row.postscan_pdf || row.post_scan_pdf || '';
    const invoiceLink = row.invoicePdf || row.invoice_pdf || '';
    const revvPdfLink = row.revvReportPdf || row.revv_report_pdf || '';

    console.log(`${LOG_TAG} Completion email docs - PostScan: ${postScanLink ? 'YES' : 'NO'}, Invoice: ${invoiceLink ? 'YES' : 'NO'}, Revv: ${revvPdfLink ? 'YES' : 'NO'}`);

    // Download PDFs from Drive URLs to attach to email
    let postScanPdfBuffer = null;
    let invoicePdfBuffer = null;
    let revvPdfBuffer = null;

    // Download PDFs in parallel
    const downloadPromises = [];

    if (postScanLink) {
      downloadPromises.push(
        downloadPdfFromDrive(postScanLink)
          .then(buf => { postScanPdfBuffer = buf; })
          .catch(err => console.error(`${LOG_TAG} PostScan download failed:`, err.message))
      );
    }

    if (invoiceLink) {
      downloadPromises.push(
        downloadPdfFromDrive(invoiceLink)
          .then(buf => { invoicePdfBuffer = buf; })
          .catch(err => console.error(`${LOG_TAG} Invoice download failed:`, err.message))
      );
    }

    if (revvPdfLink) {
      downloadPromises.push(
        downloadPdfFromDrive(revvPdfLink)
          .then(buf => { revvPdfBuffer = buf; })
          .catch(err => console.error(`${LOG_TAG} Revv PDF download failed:`, err.message))
      );
    }

    // Wait for all downloads to complete (with timeout)
    if (downloadPromises.length > 0) {
      console.log(`${LOG_TAG} Downloading ${downloadPromises.length} PDFs from Drive...`);
      await Promise.race([
        Promise.all(downloadPromises),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Download timeout')), 30000))
      ]).catch(err => {
        console.error(`${LOG_TAG} PDF download error:`, err.message);
      });
    }

    console.log(`${LOG_TAG} PDF downloads complete - PostScan: ${postScanPdfBuffer ? 'OK' : 'NONE'}, Invoice: ${invoicePdfBuffer ? 'OK' : 'NONE'}, Revv: ${revvPdfBuffer ? 'OK' : 'NONE'}`);

    // Import email service
    const { sendJobCompletionEmail } = await import('../services/emailResponder.js');

    // Send completion email with PDF buffers attached
    const emailResult = await sendJobCompletionEmail({
      shopEmail: shopEmail,
      shopName: shopName,
      roPo: roPo,
      vehicle: row.vehicle,
      vin: row.vin,
      calibrationsPerformed: completedCalibrations || row.requiredCalibrations || '',
      invoiceNumber: row.invoiceNumber || row.invoice_number || '',
      invoiceAmount: row.invoiceAmount || row.invoice_amount || '',
      // Include PDF buffers for attachments
      postScanPdfBuffer: postScanPdfBuffer,
      invoicePdfBuffer: invoicePdfBuffer,
      revvPdfBuffer: revvPdfBuffer,
      // Also include links as fallback
      postScanLink: postScanLink,
      invoiceLink: invoiceLink,
      revvPdfLink: revvPdfLink
    });

    if (emailResult.success) {
      console.log(`${LOG_TAG} ✅ Completion email sent to ${shopEmail} for RO ${roPo}`);
      console.log(`${LOG_TAG}    Attachments: PostScan=${postScanPdfBuffer ? 'YES' : 'NO'}, Invoice=${invoicePdfBuffer ? 'YES' : 'NO'}, Revv=${revvPdfBuffer ? 'YES' : 'NO'}`);
    } else {
      console.error(`${LOG_TAG} Failed to send completion email: ${emailResult.error}`);
    }
  } catch (err) {
    console.error(`${LOG_TAG} Error sending completion email for RO ${roPo}:`, err.message);
  }
}

/**
 * GET /api/tech/active-job
 * Get the currently active (In Progress) job for this tech
 */
export async function getActiveJob(req, res) {
  try {
    const user = req.user;
    const techName = getTechName(user);
    console.log(`${LOG_TAG} Getting active job for tech: ${techName}`);

    const result = await sheetWriter.getAllScheduleRows();
    if (!result.success) {
      return res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
    }

    const techNameLower = techName.toLowerCase().trim();

    // Log all "In Progress" jobs to debug
    const inProgressJobs = (result.rows || []).filter(row => {
      const status = (row.status || '').toLowerCase();
      return status === 'in progress';
    });
    console.log(`${LOG_TAG} Found ${inProgressJobs.length} jobs with "In Progress" status`);
    inProgressJobs.forEach(job => {
      console.log(`${LOG_TAG}   - RO: ${job.roPo}, Tech: "${job.technician || job.technicianAssigned || 'NONE'}", Status: "${job.status}"`);
    });

    const activeJob = (result.rows || []).find(row => {
      const rowTech = (row.technician || row.technicianAssigned || '').toLowerCase().trim();
      const status = (row.status || '').toLowerCase();
      return rowTech === techNameLower && status === 'in progress';
    });

    if (!activeJob) {
      console.log(`${LOG_TAG} No active job found for tech "${techName}" - returning null`);
      return res.json({ success: true, activeJob: null });
    }

    console.log(`${LOG_TAG} Found active job: RO ${activeJob.roPo} for tech ${techName}`);

    res.json({
      success: true,
      activeJob: {
        roPo: activeJob.roPo,
        vehicle: activeJob.vehicle,
        shopName: activeJob.shopName || activeJob.shop_name,
        requiredCalibrations: activeJob.requiredCalibrations,
        scheduledDate: activeJob.scheduledDate,
        scheduledTime: activeJob.scheduledTime,
        // Document URLs for completion validation
        postScanPdf: activeJob.postScanPdf || activeJob.postscan_pdf || '',
        invoicePdf: activeJob.invoicePdf || activeJob.invoice_pdf || ''
      }
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error getting active job:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get active job'
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

    const techName = requestingTech || getTechName(user);
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

/**
 * POST /api/tech/check-email
 * Trigger immediate email check (useful when waiting for Post-Scan to arrive)
 */
export async function triggerEmailCheck(req, res) {
  try {
    const user = req.user;
    const techName = getTechName(user);
    console.log(`${LOG_TAG} Manual email check triggered by: ${techName}`);

    // Import email listener
    const emailListener = await import('../services/emailListener.js');

    // Trigger immediate check
    if (emailListener.default.isRunning()) {
      await emailListener.default.checkNewEmails();
      console.log(`${LOG_TAG} Email check completed`);
      res.json({
        success: true,
        message: 'Email check completed'
      });
    } else {
      console.log(`${LOG_TAG} Email listener not running`);
      res.status(503).json({
        success: false,
        error: 'Email listener is not running'
      });
    }
  } catch (err) {
    console.error(`${LOG_TAG} Error triggering email check:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger email check'
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
  requestAssignment,
  startJob,
  completeJob,
  getActiveJob,
  triggerEmailCheck
};
