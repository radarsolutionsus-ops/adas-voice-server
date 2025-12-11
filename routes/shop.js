/**
 * routes/shop.js - Shop portal routes
 *
 * All routes require shop role authentication
 */

import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireRole, requirePermission } from '../middleware/roleGuard.js';
import { ROLES } from '../config/roles.js';
import * as shopController from '../controllers/shopController.js';
import { uploadFile } from '../controllers/uploadController.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Multiple file upload configuration for vehicle submission
const vehicleUpload = upload.fields([
  { name: 'estimatePdf', maxCount: 1 },
  { name: 'preScanPdf', maxCount: 1 }
]);

// All shop routes require authentication and shop role
router.use(authenticateToken);
router.use(requireRole(ROLES.SHOP));

// Dashboard stats
router.get('/stats', shopController.getStats);

// Vehicle list (shop's vehicles only)
router.get('/vehicles', shopController.getShopVehicles);

// Vehicle detail
router.get('/vehicles/:roPo', shopController.getVehicleDetail);

// Submit new vehicle with file uploads
router.post('/vehicles', requirePermission('canSubmitVehicle'), vehicleUpload, shopController.submitVehicleWithFiles);

// Schedule/Reschedule
router.post('/vehicles/:roPo/schedule', requirePermission('canReschedule'), shopController.scheduleVehicle);

// Cancel (requires reason)
router.post('/vehicles/:roPo/cancel', requirePermission('canCancel'), shopController.cancelVehicle);

// Documents
router.get('/vehicles/:roPo/documents', shopController.getDocuments);

// Shop notes
router.post('/vehicles/:roPo/notes', requirePermission('canAddNotes'), shopController.addShopNote);

// File upload
router.post('/upload', upload.single('file'), uploadFile);

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
