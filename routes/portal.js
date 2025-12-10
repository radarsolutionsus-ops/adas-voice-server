/**
 * routes/portal.js - Shop portal routes for vehicles and scheduling
 */

import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireShopContext } from '../middleware/shopFilter.js';
import {
  getVehicles,
  getVehicleByRO,
  submitVehicle,
  getStats
} from '../controllers/vehicleController.js';
import {
  getPrerequisites,
  scheduleAppointment,
  updateSchedule,
  cancelSchedule
} from '../controllers/scheduleController.js';

const router = express.Router();

// All portal routes require authentication and shop context
router.use(authenticateToken);
router.use(requireShopContext);

// Vehicle routes
router.get('/vehicles', getVehicles);
router.get('/vehicles/:roPo', getVehicleByRO);
router.post('/vehicles', submitVehicle);

// Stats
router.get('/stats', getStats);

// Scheduling routes
router.get('/schedule/prerequisites', getPrerequisites);
router.post('/schedule', scheduleAppointment);
router.put('/schedule/:roPo', updateSchedule);
router.delete('/schedule/:roPo', cancelSchedule);

export default router;
