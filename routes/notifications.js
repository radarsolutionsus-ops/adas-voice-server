/**
 * routes/notifications.js - Notification API endpoints
 *
 * Provides endpoints for fetching new vehicle alerts
 */

import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import sheetWriter from '../services/sheetWriter.js';
import { filterVehiclesByUser } from '../middleware/dataFilter.js';

const router = express.Router();

// All notification routes require authentication
router.use(authenticateToken);

/**
 * GET /api/notifications/new
 * Get vehicles with "New" status for notifications
 */
router.get('/new', async (req, res) => {
  try {
    const user = req.user;

    // Fetch all schedule rows
    const result = await sheetWriter.getAllScheduleRows();

    if (!result.success) {
      return res.json({ success: true, vehicles: [] });
    }

    // Filter by user role/shop
    let vehicles = filterVehiclesByUser(result.rows || [], user);

    // Filter to only "New" status
    vehicles = vehicles.filter(v => {
      const status = (v.status || '').toLowerCase();
      return status === 'new';
    });

    // Sort by timestamp descending (most recent first)
    vehicles.sort((a, b) => {
      const dateA = new Date(a.timestampCreated || 0);
      const dateB = new Date(b.timestampCreated || 0);
      return dateB - dateA;
    });

    // Limit to most recent 20
    vehicles = vehicles.slice(0, 20);

    // Return minimal data for notifications
    const notifications = vehicles.map(v => ({
      roPo: v.roPo || '',
      vin: v.vin || '',
      vehicle: v.vehicle || '',
      shopName: v.shopName || v.shop_name || '',
      timestamp: v.timestampCreated || '',
      status: v.status || 'New'
    }));

    res.json({ success: true, vehicles: notifications });
  } catch (err) {
    console.error('[NOTIFICATIONS] Error fetching new vehicles:', err.message);
    res.json({ success: true, vehicles: [] });
  }
});

/**
 * POST /api/notifications/mark-seen
 * Mark notifications as seen (for future per-user tracking)
 */
router.post('/mark-seen', (req, res) => {
  // For now, just acknowledge - state is stored client-side in localStorage
  // Future: could track per-user read state in a database
  res.json({ success: true });
});

export default router;
