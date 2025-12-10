/**
 * routes/tech.js - Tech portal routes
 *
 * All routes require tech or admin role authentication
 */

import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireRole, requirePermission } from '../middleware/roleGuard.js';
import { ROLES } from '../config/roles.js';
import * as techController from '../controllers/techController.js';

const router = express.Router();

// All tech routes require authentication and tech or admin role
router.use(authenticateToken);
router.use(requireRole(ROLES.TECH, ROLES.ADMIN));

// Dashboard stats
router.get('/stats', techController.getStats);

// All vehicles
router.get('/vehicles', techController.getAllVehicles);

// My assigned vehicles
router.get('/vehicles/mine', techController.getMyVehicles);

// Today's schedule
router.get('/today', techController.getTodaySchedule);

// Vehicle detail
router.get('/vehicles/:roPo', techController.getVehicleDetail);

// Change status (requires permission)
router.put('/vehicles/:roPo/status', requirePermission('canChangeStatus'), techController.updateStatus);

// Log arrival
router.post('/vehicles/:roPo/arrive', techController.markArrival);

// Mark complete
router.post('/vehicles/:roPo/complete', requirePermission('canMarkComplete'), techController.markComplete);

// Tech notes
router.post('/vehicles/:roPo/notes', requirePermission('canAddNotes'), techController.addTechNote);

// Documents
router.get('/vehicles/:roPo/documents', techController.getDocuments);

export default router;
