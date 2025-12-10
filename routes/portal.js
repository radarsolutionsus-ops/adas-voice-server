/**
 * routes/portal.js - Shop portal routes for vehicles, scheduling, and file uploads
 */

import express from 'express';
import multer from 'multer';
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
import { uploadFile } from '../controllers/uploadController.js';

const router = express.Router();

// Configure multer for file uploads (in-memory storage for Google Drive upload)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

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

// File upload route
router.post('/upload', upload.single('file'), uploadFile);

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File size must be less than 10MB'
      });
    }
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
  if (err.message === 'Only PDF files are allowed') {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
  next(err);
});

export default router;
