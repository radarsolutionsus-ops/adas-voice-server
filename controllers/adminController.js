/**
 * adminController.js - Controller for admin/owner portal actions
 *
 * Admin has full access to:
 *   - All vehicles (unfiltered)
 *   - All shops
 *   - All techs
 *   - Billing overview
 *   - Reports
 *   - System settings
 */

import sheetWriter from '../services/sheetWriter.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_TAG = '[ADMIN_CTRL]';

/**
 * GET /api/admin/dashboard
 * Get dashboard overview with stats
 */
export async function getDashboard(req, res) {
  try {
    const result = await sheetWriter.getAllScheduleRows();
    const vehicles = result.rows || [];

    // Calculate stats
    const stats = {
      total: vehicles.length,
      new: vehicles.filter(v => (v.status || '').toLowerCase() === 'new').length,
      ready: vehicles.filter(v => (v.status || '').toLowerCase() === 'ready').length,
      scheduled: vehicles.filter(v => ['scheduled', 'rescheduled'].includes((v.status || '').toLowerCase())).length,
      inProgress: vehicles.filter(v => (v.status || '').toLowerCase() === 'in progress').length,
      completed: vehicles.filter(v => (v.status || '').toLowerCase() === 'completed').length,
      needsAttention: vehicles.filter(v => (v.status || '').toLowerCase() === 'needs attention').length
    };

    // Today's schedule
    const today = new Date().toISOString().split('T')[0];
    const todayJobs = vehicles.filter(v => {
      const schedDate = v.scheduledDate || '';
      if (!schedDate) return false;
      // Handle various date formats
      if (schedDate.includes(today)) return true;
      // Handle MM/DD/YYYY format
      const parts = schedDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (parts) {
        const formatted = `${parts[3]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        return formatted === today;
      }
      return false;
    });

    // By shop breakdown
    const byShop = {};
    vehicles.forEach(v => {
      const shop = v.shopName || 'Unknown';
      byShop[shop] = (byShop[shop] || 0) + 1;
    });

    // By tech breakdown
    const byTech = {};
    vehicles.forEach(v => {
      const tech = v.technician || v.technicianAssigned || 'Unassigned';
      byTech[tech] = (byTech[tech] || 0) + 1;
    });

    console.log(`${LOG_TAG} Dashboard loaded: ${stats.total} total vehicles`);

    res.json({
      success: true,
      stats,
      todayJobs: todayJobs.map(v => ({
        roPo: v.roPo,
        vehicle: v.vehicle,
        shopName: v.shopName,
        status: v.status,
        scheduledTime: v.scheduledTime || 'TBD'
      })),
      byShop,
      byTech
    });
  } catch (err) {
    console.error(`${LOG_TAG} Dashboard error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/admin/vehicles
 * Get all vehicles (unfiltered)
 */
export async function getAllVehicles(req, res) {
  try {
    const { status, search, shop } = req.query;

    const result = await sheetWriter.getAllScheduleRows();
    let vehicles = result.rows || [];

    // Filter by status if provided
    if (status && status !== 'all') {
      vehicles = vehicles.filter(v =>
        (v.status || '').toLowerCase() === status.toLowerCase()
      );
    }

    // Filter by shop if provided
    if (shop) {
      vehicles = vehicles.filter(v =>
        (v.shopName || '').toLowerCase().includes(shop.toLowerCase())
      );
    }

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      vehicles = vehicles.filter(v => {
        const ro = (v.roPo || '').toLowerCase();
        const vin = (v.vin || '').toLowerCase();
        const vehicle = (v.vehicle || '').toLowerCase();
        const shopName = (v.shopName || '').toLowerCase();
        return ro.includes(searchLower) ||
               vin.includes(searchLower) ||
               vehicle.includes(searchLower) ||
               shopName.includes(searchLower);
      });
    }

    // Sort by timestamp descending
    vehicles.sort((a, b) => {
      const dateA = new Date(a.timestampCreated || 0);
      const dateB = new Date(b.timestampCreated || 0);
      return dateB - dateA;
    });

    console.log(`${LOG_TAG} getAllVehicles: returning ${vehicles.length} vehicles`);

    res.json({
      success: true,
      count: vehicles.length,
      rows: vehicles
    });
  } catch (err) {
    console.error(`${LOG_TAG} getAllVehicles error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/admin/vehicles/:roPo
 * Get single vehicle detail
 */
export async function getVehicleDetail(req, res) {
  try {
    const { roPo } = req.params;
    const row = await sheetWriter.getScheduleRowByRO(roPo);

    if (!row) {
      return res.status(404).json({
        success: false,
        error: `Vehicle with RO ${roPo} not found`
      });
    }

    res.json({ success: true, vehicle: row });
  } catch (err) {
    console.error(`${LOG_TAG} getVehicleDetail error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * PUT /api/admin/vehicles/:roPo
 * Update vehicle (any field)
 */
export async function updateVehicle(req, res) {
  try {
    const { roPo } = req.params;
    const updates = req.body;

    console.log(`${LOG_TAG} Updating vehicle ${roPo}:`, Object.keys(updates));

    const result = await sheetWriter.updateScheduleRow(roPo, updates);
    res.json(result);
  } catch (err) {
    console.error(`${LOG_TAG} updateVehicle error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * PUT /api/admin/vehicles/:roPo/status
 * Update status only
 */
export async function updateStatus(req, res) {
  try {
    const { roPo } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required' });
    }

    console.log(`${LOG_TAG} Updating status for ${roPo} to ${status}`);

    const updates = { status };
    if (notes) updates.notes = notes;

    const result = await sheetWriter.updateScheduleRow(roPo, updates);
    res.json(result);
  } catch (err) {
    console.error(`${LOG_TAG} updateStatus error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * DELETE /api/admin/vehicles/:roPo
 * Delete a vehicle (mark as deleted)
 */
export async function deleteVehicle(req, res) {
  try {
    const { roPo } = req.params;

    // For safety, we mark as deleted rather than actually deleting
    console.log(`${LOG_TAG} Marking vehicle ${roPo} as deleted`);

    const result = await sheetWriter.updateScheduleRow(roPo, {
      status: 'Deleted',
      notes: `[${new Date().toISOString()}] Deleted by admin`
    });

    res.json({ success: true, message: 'Vehicle marked as deleted' });
  } catch (err) {
    console.error(`${LOG_TAG} deleteVehicle error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/admin/shops
 * Get all shops from config
 */
export async function getAllShops(req, res) {
  try {
    const configPath = path.join(__dirname, '../config/users.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const shops = config.users
      .filter(u => u.role === 'shop')
      .map(s => ({
        id: s.id,
        name: s.name,
        sheetName: s.sheetName,
        username: s.username,
        email: s.email || '',
        phone: s.phone || ''
      }));

    res.json({ success: true, shops });
  } catch (err) {
    console.error(`${LOG_TAG} getAllShops error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/admin/shops/:id
 * Get single shop detail
 */
export async function getShop(req, res) {
  try {
    const { id } = req.params;
    const configPath = path.join(__dirname, '../config/users.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const shop = config.users.find(u => u.id === id && u.role === 'shop');

    if (!shop) {
      return res.status(404).json({ success: false, error: 'Shop not found' });
    }

    // Get vehicle count for this shop
    const result = await sheetWriter.getAllScheduleRows(shop.sheetName);
    const vehicleCount = (result.rows || []).length;

    res.json({
      success: true,
      shop: {
        id: shop.id,
        name: shop.name,
        sheetName: shop.sheetName,
        username: shop.username,
        email: shop.email || '',
        phone: shop.phone || '',
        vehicleCount
      }
    });
  } catch (err) {
    console.error(`${LOG_TAG} getShop error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * PUT /api/admin/shops/:id
 * Update shop info
 */
export async function updateShop(req, res) {
  res.json({ success: true, message: 'TODO - update shop' });
}

/**
 * POST /api/admin/shops
 * Create new shop
 */
export async function createShop(req, res) {
  res.json({ success: true, message: 'TODO - create shop' });
}

/**
 * GET /api/admin/techs
 * Get all techs from config
 */
export async function getAllTechs(req, res) {
  try {
    const configPath = path.join(__dirname, '../config/users.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const techs = config.users
      .filter(u => u.role === 'tech')
      .map(t => ({
        id: t.id,
        name: t.name,
        username: t.username,
        email: t.email || '',
        phone: t.phone || '',
        coverage: t.coverage || []
      }));

    res.json({ success: true, techs });
  } catch (err) {
    console.error(`${LOG_TAG} getAllTechs error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/admin/techs/:id
 * Get single tech detail
 */
export async function getTech(req, res) {
  try {
    const { id } = req.params;
    const configPath = path.join(__dirname, '../config/users.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const tech = config.users.find(u => u.id === id && u.role === 'tech');

    if (!tech) {
      return res.status(404).json({ success: false, error: 'Tech not found' });
    }

    // Get assigned jobs count
    const result = await sheetWriter.getAllScheduleRows();
    const assignedJobs = (result.rows || []).filter(r =>
      (r.technician || r.technicianAssigned || '').toLowerCase() === tech.name.toLowerCase()
    ).length;

    res.json({
      success: true,
      tech: {
        id: tech.id,
        name: tech.name,
        username: tech.username,
        email: tech.email || '',
        phone: tech.phone || '',
        coverage: tech.coverage || [],
        assignedJobs
      }
    });
  } catch (err) {
    console.error(`${LOG_TAG} getTech error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * PUT /api/admin/techs/:id
 * Update tech info
 */
export async function updateTech(req, res) {
  res.json({ success: true, message: 'TODO - update tech' });
}

/**
 * GET /api/admin/billing
 * Get billing overview
 */
export async function getBillingOverview(req, res) {
  try {
    const result = await sheetWriter.getAllScheduleRows();
    const vehicles = result.rows || [];

    const withInvoice = vehicles.filter(v => v.invoiceNumber);
    const totalBilled = withInvoice.reduce((sum, v) => {
      const amount = parseFloat(v.invoiceAmount) || 0;
      return sum + amount;
    }, 0);

    const unpaid = withInvoice.filter(v =>
      !['paid', 'completed'].includes((v.status || '').toLowerCase())
    );

    res.json({
      success: true,
      totalInvoices: withInvoice.length,
      totalBilled,
      unpaidCount: unpaid.length,
      recentInvoices: withInvoice.slice(0, 20).map(v => ({
        roPo: v.roPo,
        shopName: v.shopName,
        vehicle: v.vehicle,
        invoiceNumber: v.invoiceNumber,
        invoiceAmount: v.invoiceAmount,
        invoiceDate: v.invoiceDate,
        status: v.status
      }))
    });
  } catch (err) {
    console.error(`${LOG_TAG} getBillingOverview error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/admin/billing/shop/:shopName
 * Get billing for specific shop
 */
export async function getShopBilling(req, res) {
  try {
    const { shopName } = req.params;

    const result = await sheetWriter.getAllScheduleRows();
    const vehicles = (result.rows || []).filter(v =>
      (v.shopName || '').toLowerCase().includes(shopName.toLowerCase()) &&
      v.invoiceNumber
    );

    const total = vehicles.reduce((sum, v) => sum + (parseFloat(v.invoiceAmount) || 0), 0);

    res.json({
      success: true,
      shopName,
      totalInvoices: vehicles.length,
      totalAmount: total,
      invoices: vehicles.map(v => ({
        roPo: v.roPo,
        vehicle: v.vehicle,
        invoiceNumber: v.invoiceNumber,
        invoiceAmount: v.invoiceAmount,
        invoiceDate: v.invoiceDate,
        status: v.status
      }))
    });
  } catch (err) {
    console.error(`${LOG_TAG} getShopBilling error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/admin/billing/invoice/:roPo
 * Send invoice for vehicle
 */
export async function sendInvoice(req, res) {
  try {
    const { roPo } = req.params;
    const billingMailer = (await import('../services/billingMailer.js')).default;
    const result = await billingMailer.sendInvoice(roPo);
    res.json(result);
  } catch (err) {
    console.error(`${LOG_TAG} sendInvoice error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

// Placeholder functions for future implementation
export async function getAllInvoices(req, res) {
  res.json({ success: true, message: 'TODO - get all invoices' });
}

export async function getUnpaidInvoices(req, res) {
  res.json({ success: true, message: 'TODO - get unpaid invoices' });
}

export async function getDailyReport(req, res) {
  res.json({ success: true, message: 'TODO - daily report' });
}

export async function getWeeklyReport(req, res) {
  res.json({ success: true, message: 'TODO - weekly report' });
}

export async function getShopReport(req, res) {
  res.json({ success: true, message: 'TODO - shop report' });
}

export async function getTechReport(req, res) {
  res.json({ success: true, message: 'TODO - tech report' });
}

export async function getSystemLogs(req, res) {
  res.json({ success: true, message: 'TODO - system logs' });
}

export async function getSettings(req, res) {
  res.json({ success: true, message: 'TODO - get settings' });
}

export async function updateSettings(req, res) {
  res.json({ success: true, message: 'TODO - update settings' });
}

export default {
  getDashboard,
  getAllVehicles,
  getVehicleDetail,
  updateVehicle,
  updateStatus,
  deleteVehicle,
  getAllShops,
  getShop,
  updateShop,
  createShop,
  getAllTechs,
  getTech,
  updateTech,
  getBillingOverview,
  getShopBilling,
  sendInvoice,
  getAllInvoices,
  getUnpaidInvoices,
  getDailyReport,
  getWeeklyReport,
  getShopReport,
  getTechReport,
  getSystemLogs,
  getSettings,
  updateSettings
};
