/**
 * vehicleController.js - Vehicle/RO controller for shop portal
 *
 * Handles vehicle listing, details, filtering (shop-scoped)
 */

import sheetWriter from '../services/sheetWriter.js';
import { filterRowsByShop, validateShopAccess } from '../middleware/shopFilter.js';

const LOG_TAG = '[VEHICLE_CTRL]';

/**
 * GET /api/portal/vehicles
 * Get all vehicles for the authenticated shop
 * Query params: status, search
 */
export async function getVehicles(req, res) {
  try {
    const { status, search } = req.query;
    const shopName = req.shopFilter.shopName;

    console.log(`${LOG_TAG} Getting vehicles for shop: ${shopName}, status: ${status || 'all'}, search: ${search || 'none'}`);

    // Get all schedule rows via GAS
    const result = await sheetWriter.getAllScheduleRows();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fetch vehicles'
      });
    }

    // Filter by shop
    let vehicles = filterRowsByShop(result.rows || [], shopName);

    // Filter by status if provided
    if (status && status !== 'all') {
      vehicles = vehicles.filter(v => {
        const rowStatus = (v.status || '').toLowerCase();
        return rowStatus === status.toLowerCase();
      });
    }

    // Search filter (RO or VIN)
    if (search) {
      const searchLower = search.toLowerCase();
      vehicles = vehicles.filter(v => {
        const ro = (v.roPo || v.ro_po || '').toLowerCase();
        const vin = (v.vin || '').toLowerCase();
        const vehicle = (v.vehicle || '').toLowerCase();
        return ro.includes(searchLower) ||
               vin.includes(searchLower) ||
               vehicle.includes(searchLower);
      });
    }

    // Sort by timestamp descending (newest first)
    vehicles.sort((a, b) => {
      const dateA = new Date(a.timestampCreated || a.timestamp_created || 0);
      const dateB = new Date(b.timestampCreated || b.timestamp_created || 0);
      return dateB - dateA;
    });

    // Map to clean response format
    const cleanVehicles = vehicles.map(v => ({
      roPo: v.roPo || v.ro_po || '',
      vin: v.vin || '',
      vehicle: v.vehicle || '',
      status: v.status || 'New',
      scheduledDate: v.scheduledDate || v.scheduled_date || '',
      scheduledTime: v.scheduledTime || v.scheduled_time || '',
      technician: v.technicianAssigned || v.technician_assigned || v.technician || '',
      requiredCalibrations: v.requiredCalibrations || v.required_calibrations || '',
      completedCalibrations: v.completedCalibrations || v.completed_calibrations || '',
      dtcs: v.dtcs || '',
      notes: v.notes || '',
      revvReportPdf: v.revvReportPdf || v.revv_report_pdf || '',
      lastUpdated: v.timestampCreated || v.timestamp_created || ''
    }));

    console.log(`${LOG_TAG} Returning ${cleanVehicles.length} vehicles for ${shopName}`);

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
 * GET /api/portal/vehicles/:roPo
 * Get single vehicle details
 */
export async function getVehicleByRO(req, res) {
  try {
    const { roPo } = req.params;
    const shopName = req.shopFilter.shopName;

    console.log(`${LOG_TAG} Getting vehicle ${roPo} for shop: ${shopName}`);

    // Look up the RO
    const row = await sheetWriter.getScheduleRowByRO(roPo);

    if (!row) {
      return res.status(404).json({
        success: false,
        error: `Vehicle with RO ${roPo} not found`
      });
    }

    // Validate shop access
    const rowShop = row.shopName || row.shop_name || row.shop || '';
    if (!validateShopAccess(rowShop, shopName)) {
      console.log(`${LOG_TAG} Access denied: ${shopName} tried to access ${rowShop}'s vehicle`);
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Return clean vehicle data
    res.json({
      success: true,
      vehicle: {
        roPo: row.roPo || row.ro_po || roPo,
        vin: row.vin || '',
        vehicle: row.vehicle || '',
        status: row.status || 'New',
        scheduledDate: row.scheduledDate || row.scheduled_date || '',
        scheduledTime: row.scheduledTime || row.scheduled_time || '',
        technician: row.technicianAssigned || row.technician_assigned || row.technician || '',
        requiredCalibrations: row.requiredCalibrations || row.required_calibrations || '',
        completedCalibrations: row.completedCalibrations || row.completed_calibrations || '',
        dtcs: row.dtcs || '',
        notes: row.notes || '',
        revvReportPdf: row.revvReportPdf || row.revv_report_pdf || '',
        postScanPdf: row.postScanPdf || row.post_scan_pdf || '',
        invoicePdf: row.invoicePdf || row.invoice_pdf || '',
        extraDocs: row.extraDocs || row.extra_docs || '',
        oemPosition: row.oemPosition || row.oem_position || row.extraDocs || row.extra_docs || '',  // Legacy alias
        flowHistory: row.flowHistory || row.flow_history || '',
        timestampCreated: row.timestampCreated || row.timestamp_created || ''
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
 * POST /api/portal/vehicles
 * Submit a new vehicle for calibration
 *
 * Body:
 *   - roPo: RO/PO number (required)
 *   - vin: Full 17-char VIN (required)
 *   - year, make, model: Vehicle info (required)
 *   - notes: Additional notes
 *   - estimatePdfUrl: Google Drive link to estimate PDF
 *   - prescanPdfUrl: Google Drive link to pre-scan PDF (optional)
 *   - noPrescanConfirmed: Boolean if user confirmed no DTCs
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
    const shopName = req.shopFilter.shopName;

    // Validate required fields
    if (!roPo) {
      return res.status(400).json({
        success: false,
        error: 'RO/PO number is required'
      });
    }

    if (!vin || vin.length !== 17) {
      return res.status(400).json({
        success: false,
        error: 'Full 17-character VIN is required'
      });
    }

    if (!year || !make || !model) {
      return res.status(400).json({
        success: false,
        error: 'Year, make, and model are required'
      });
    }

    if (!estimatePdfUrl) {
      return res.status(400).json({
        success: false,
        error: 'Estimate PDF is required'
      });
    }

    // Validate pre-scan requirement
    if (!prescanPdfUrl && !noPrescanConfirmed) {
      return res.status(400).json({
        success: false,
        error: 'Pre-scan PDF is required, or confirm there are no active DTC codes'
      });
    }

    console.log(`${LOG_TAG} Submitting new vehicle: RO ${roPo} for shop ${shopName}`);

    // Build vehicle string
    const vehicleParts = [year, make, model].filter(p => p && p.trim());
    const vehicleStr = vehicleParts.join(' ');

    // Build notes with DTC confirmation if applicable
    let fullNotes = notes || '';
    if (noPrescanConfirmed && !prescanPdfUrl) {
      const timestamp = new Date().toISOString();
      fullNotes = `[${timestamp}] Shop confirmed no active DTC codes (no pre-scan provided)\n${fullNotes}`;
    }

    // Create the schedule entry with PDF links
    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      shopName: shopName,
      vin: vin || '',
      vehicleYear: year || '',
      vehicleMake: make || '',
      vehicleModel: model || '',
      vehicle: vehicleStr,
      notes: fullNotes,
      status: 'New',
      // PDF links - estimate goes to the new estimate column, pre-scan to post_scan
      estimatePdf: estimatePdfUrl || '',
      postScanPdf: prescanPdfUrl || ''
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to submit vehicle'
      });
    }

    console.log(`${LOG_TAG} Vehicle submitted: RO ${roPo} (estimate: ${estimatePdfUrl ? 'yes' : 'no'}, prescan: ${prescanPdfUrl ? 'yes' : 'no'})`);

    res.json({
      success: true,
      message: `Vehicle submitted successfully`,
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
 * GET /api/portal/stats
 * Get dashboard statistics for the shop
 */
export async function getStats(req, res) {
  try {
    const shopName = req.shopFilter.shopName;

    console.log(`${LOG_TAG} Getting stats for shop: ${shopName}`);

    // Get all schedule rows
    const result = await sheetWriter.getAllScheduleRows();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fetch stats'
      });
    }

    // Filter by shop
    const vehicles = filterRowsByShop(result.rows || [], shopName);

    // Calculate stats
    const stats = {
      total: vehicles.length,
      new: 0,
      ready: 0,
      scheduled: 0,
      inProgress: 0,
      completed: 0,
      needsAttention: 0
    };

    vehicles.forEach(v => {
      const status = (v.status || '').toLowerCase();
      switch (status) {
        case 'new':
          stats.new++;
          break;
        case 'ready':
          stats.ready++;
          break;
        case 'scheduled':
        case 'rescheduled':
          stats.scheduled++;
          break;
        case 'in progress':
          stats.inProgress++;
          break;
        case 'completed':
          stats.completed++;
          break;
        case 'needs attention':
        case 'blocked':
          stats.needsAttention++;
          break;
      }
    });

    res.json({
      success: true,
      stats
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error getting stats:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats'
    });
  }
}

export default {
  getVehicles,
  getVehicleByRO,
  submitVehicle,
  getStats
};
