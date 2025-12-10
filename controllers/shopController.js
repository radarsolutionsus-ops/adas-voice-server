/**
 * shopController.js - Controller for shop-specific portal actions
 *
 * Shops can:
 *   - View their own vehicles (filtered by sheetName)
 *   - Submit new vehicles with PDFs
 *   - Schedule/reschedule appointments
 *   - Cancel appointments (with required reason)
 *   - View documents
 *   - Add shop notes
 *
 * Shops CANNOT change status
 */

import sheetWriter from '../services/sheetWriter.js';
import { filterVehiclesByUser, canAccessVehicle } from '../middleware/dataFilter.js';

const LOG_TAG = '[SHOP_CTRL]';

/**
 * GET /api/shop/vehicles
 * Get all vehicles for the authenticated shop
 */
export async function getShopVehicles(req, res) {
  try {
    const user = req.user;
    const { status, search } = req.query;

    console.log(`${LOG_TAG} Getting vehicles for shop: ${user.shopName}`);

    // Get all schedule rows
    const result = await sheetWriter.getAllScheduleRows();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fetch vehicles'
      });
    }

    // Filter by shop
    let vehicles = filterVehiclesByUser(result.rows || [], user);

    // Filter by status if provided
    if (status && status !== 'all') {
      vehicles = vehicles.filter(v => {
        const rowStatus = (v.status || '').toLowerCase();
        return rowStatus === status.toLowerCase();
      });
    }

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      vehicles = vehicles.filter(v => {
        const ro = (v.roPo || '').toLowerCase();
        const vin = (v.vin || '').toLowerCase();
        const vehicle = (v.vehicle || '').toLowerCase();
        return ro.includes(searchLower) ||
               vin.includes(searchLower) ||
               vehicle.includes(searchLower);
      });
    }

    // Sort by timestamp descending
    vehicles.sort((a, b) => {
      const dateA = new Date(a.timestampCreated || 0);
      const dateB = new Date(b.timestampCreated || 0);
      return dateB - dateA;
    });

    // Map to clean response format
    const cleanVehicles = vehicles.map(v => ({
      roPo: v.roPo || '',
      vin: v.vin || '',
      vehicle: v.vehicle || '',
      status: v.status || 'New',
      scheduledDate: v.scheduledDate || '',
      scheduledTime: v.scheduledTime || '',
      requiredCalibrations: v.requiredCalibrations || '',
      notes: v.notes || '',
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
 * GET /api/shop/vehicles/:roPo
 * Get single vehicle details
 */
export async function getVehicleDetail(req, res) {
  try {
    const { roPo } = req.params;
    const user = req.user;

    console.log(`${LOG_TAG} Getting vehicle ${roPo} for shop: ${user.shopName}`);

    // Get the vehicle
    const row = await sheetWriter.getScheduleRowByRO(roPo);

    if (!row) {
      return res.status(404).json({
        success: false,
        error: `Vehicle with RO ${roPo} not found`
      });
    }

    // Check access
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
        status: row.status || 'New',
        scheduledDate: row.scheduledDate || '',
        scheduledTime: row.scheduledTime || '',
        requiredCalibrations: row.requiredCalibrations || '',
        completedCalibrations: row.completedCalibrations || '',
        dtcs: row.dtcs || '',
        notes: row.notes || '',
        estimatePdf: row.estimatePdf || '',
        preScanPdf: row.postScanPdf || '',  // Pre-scan stored in postScan column
        revvReportPdf: row.revvReportPdf || '',
        postScanPdf: row.postScanPdf || '',
        invoicePdf: row.invoicePdf || '',
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
 * POST /api/shop/vehicles
 * Submit a new vehicle
 */
export async function submitVehicle(req, res) {
  try {
    const {
      roPo,
      vin,
      year,
      make,
      model,
      notes,
      estimatePdfUrl,
      prescanPdfUrl,
      noPrescanConfirmed
    } = req.body;
    const user = req.user;

    // Validate required fields
    if (!roPo) {
      return res.status(400).json({ success: false, error: 'RO/PO number is required' });
    }
    if (!vin || vin.length !== 17) {
      return res.status(400).json({ success: false, error: 'Full 17-character VIN is required' });
    }
    if (!year || !make || !model) {
      return res.status(400).json({ success: false, error: 'Year, make, and model are required' });
    }
    if (!estimatePdfUrl) {
      return res.status(400).json({ success: false, error: 'Estimate PDF is required' });
    }
    if (!prescanPdfUrl && !noPrescanConfirmed) {
      return res.status(400).json({ success: false, error: 'Pre-scan PDF or DTC confirmation required' });
    }

    console.log(`${LOG_TAG} Submitting vehicle: RO ${roPo} for shop ${user.shopName}`);

    // Build vehicle string
    const vehicleStr = [year, make, model].filter(Boolean).join(' ');

    // Build notes
    let fullNotes = notes || '';
    if (noPrescanConfirmed && !prescanPdfUrl) {
      const timestamp = new Date().toISOString();
      fullNotes = `[${timestamp}] Shop confirmed no active DTC codes\n${fullNotes}`;
    }

    // Create the schedule entry
    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      shopName: user.sheetName,
      vin: vin,
      vehicle: vehicleStr,
      notes: fullNotes,
      status: 'New',
      estimatePdf: estimatePdfUrl || '',
      postScanPdf: prescanPdfUrl || ''
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to submit vehicle'
      });
    }

    console.log(`${LOG_TAG} Vehicle submitted: RO ${roPo}`);

    res.json({
      success: true,
      message: 'Vehicle submitted successfully',
      roPo: roPo
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error submitting vehicle:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to submit vehicle'
    });
  }
}

/**
 * POST /api/shop/vehicles/:roPo/schedule
 * Schedule or reschedule an appointment
 */
export async function scheduleVehicle(req, res) {
  try {
    const { roPo } = req.params;
    const { date, time, notes } = req.body;
    const user = req.user;

    if (!date) {
      return res.status(400).json({ success: false, error: 'Date is required' });
    }

    // Verify access
    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }
    if (!canAccessVehicle(row, user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    console.log(`${LOG_TAG} Scheduling RO ${roPo} for ${date} ${time || ''}`);

    // Determine if reschedule
    const isReschedule = row.scheduledDate && row.status !== 'New';
    const newStatus = isReschedule ? 'Rescheduled' : 'Scheduled';

    // Update the schedule
    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      scheduledDate: date,
      scheduledTime: time || '',
      status: newStatus,
      notes: notes ? `${row.notes || ''}\n[Schedule] ${notes}` : row.notes
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to schedule'
      });
    }

    res.json({
      success: true,
      message: isReschedule ? 'Appointment rescheduled' : 'Appointment scheduled',
      roPo: roPo
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error scheduling:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to schedule appointment'
    });
  }
}

/**
 * POST /api/shop/vehicles/:roPo/cancel
 * Cancel an appointment (requires reason)
 */
export async function cancelVehicle(req, res) {
  try {
    const { roPo } = req.params;
    const { reason } = req.body;
    const user = req.user;

    // Reason is required
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Cancellation reason is required (minimum 10 characters)'
      });
    }

    // Verify access
    const row = await sheetWriter.getScheduleRowByRO(roPo);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }
    if (!canAccessVehicle(row, user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    console.log(`${LOG_TAG} Cancelling RO ${roPo} by shop ${user.shopName}: ${reason}`);

    const timestamp = new Date().toISOString();
    const cancelNote = `[${timestamp}] Cancelled by ${user.shopName}: ${reason}`;

    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      status: 'Cancelled',
      notes: `${row.notes || ''}\n${cancelNote}`
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to cancel'
      });
    }

    res.json({
      success: true,
      message: 'Appointment cancelled',
      roPo: roPo
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error cancelling:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel appointment'
    });
  }
}

/**
 * GET /api/shop/vehicles/:roPo/documents
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
        estimate: row.estimatePdf || null,
        preScan: row.postScanPdf || null,
        revvReport: row.revvReportPdf || null,
        postScan: row.postScanPdf || null,
        invoice: row.invoicePdf || null
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
 * POST /api/shop/vehicles/:roPo/notes
 * Add a shop note to a vehicle
 */
export async function addShopNote(req, res) {
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
    if (!canAccessVehicle(row, user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const timestamp = new Date().toISOString();
    const shopNote = `[${timestamp}] Shop note: ${note.trim()}`;

    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      notes: `${row.notes || ''}\n${shopNote}`
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
 * GET /api/shop/stats
 * Get dashboard statistics for the shop
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

    const vehicles = filterVehiclesByUser(result.rows || [], user);

    const stats = {
      total: vehicles.length,
      new: 0,
      ready: 0,
      scheduled: 0,
      inProgress: 0,
      completed: 0
    };

    vehicles.forEach(v => {
      const status = (v.status || '').toLowerCase();
      switch (status) {
        case 'new': stats.new++; break;
        case 'ready': stats.ready++; break;
        case 'scheduled':
        case 'rescheduled': stats.scheduled++; break;
        case 'in progress': stats.inProgress++; break;
        case 'completed': stats.completed++; break;
      }
    });

    res.json({ success: true, stats });
  } catch (err) {
    console.error(`${LOG_TAG} Error getting stats:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats'
    });
  }
}

export default {
  getShopVehicles,
  getVehicleDetail,
  submitVehicle,
  scheduleVehicle,
  cancelVehicle,
  getDocuments,
  addShopNote,
  getStats
};
