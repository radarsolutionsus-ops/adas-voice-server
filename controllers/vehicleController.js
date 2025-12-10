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
        oemPosition: row.oemPosition || row.oem_position || '',
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
 */
export async function submitVehicle(req, res) {
  try {
    const { roPo, vin, year, make, model, notes } = req.body;
    const shopName = req.shopFilter.shopName;

    if (!roPo) {
      return res.status(400).json({
        success: false,
        error: 'RO/PO number is required'
      });
    }

    console.log(`${LOG_TAG} Submitting new vehicle: RO ${roPo} for shop ${shopName}`);

    // Build vehicle string
    const vehicleParts = [year, make, model].filter(p => p && p.trim());
    const vehicleStr = vehicleParts.join(' ');

    // Create the schedule entry
    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      shopName: shopName,
      vin: vin || '',
      vehicleYear: year || '',
      vehicleMake: make || '',
      vehicleModel: model || '',
      vehicle: vehicleStr,
      notes: notes || '',
      status: 'New'
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
