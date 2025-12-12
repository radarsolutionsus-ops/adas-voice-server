/**
 * routes/tech.js - Tech portal routes
 *
 * All routes require tech or admin role authentication
 */

import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireRole, requirePermission } from '../middleware/roleGuard.js';
import { ROLES } from '../config/roles.js';
import * as techController from '../controllers/techController.js';
import * as calendarController from '../controllers/calendarController.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

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

// Upload document (postScan, invoice, revvReport)
router.post('/vehicles/:roPo/upload', upload.single('file'), techController.uploadDocument);

// Request assignment to a job
router.post('/request-assignment', techController.requestAssignment);

// ============================================================
// CALENDAR ENDPOINTS (for Tech Portal Calendar feature)
// ============================================================

// Get jobs for calendar view (with date range filtering)
router.post('/calendar/jobs', calendarController.getCalendarJobs);

// Accept a job assignment
router.post('/calendar/accept-job', calendarController.acceptJob);

// Reject/decline a job assignment
router.post('/calendar/reject-job', calendarController.rejectJob);

// Log arrival at shop
router.post('/calendar/log-arrival', calendarController.logArrival);

// Log job completion
router.post('/calendar/log-completion', calendarController.logCompletion);

// Get slot capacity for a date
router.post('/calendar/capacity', calendarController.getCapacity);

// Subscribe to push notifications
router.post('/calendar/subscribe', calendarController.subscribeToNotifications);

// Get VAPID public key (no auth required for this one)
router.get('/calendar/vapid-key', calendarController.getVapidKey);

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File size must be less than 10MB' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ success: false, error: err.message });
  }
  next(err);
});

export default router;
