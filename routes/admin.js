/**
 * routes/admin.js - Admin portal routes
 *
 * All routes require admin role authentication
 * Full access to vehicles, shops, techs, billing, reports
 */

import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleGuard.js';
import { ROLES } from '../config/roles.js';
import * as adminController from '../controllers/adminController.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticateToken);
router.use(requireRole(ROLES.ADMIN));

// Dashboard - overview of everything
router.get('/dashboard', adminController.getDashboard);

// ALL vehicles (no filtering)
router.get('/vehicles', adminController.getAllVehicles);
router.get('/vehicles/:roPo', adminController.getVehicleDetail);
router.put('/vehicles/:roPo', adminController.updateVehicle);
router.put('/vehicles/:roPo/status', adminController.updateStatus);
router.delete('/vehicles/:roPo', adminController.deleteVehicle);

// Shop management
router.get('/shops', adminController.getAllShops);
router.get('/shops/:id', adminController.getShop);
router.put('/shops/:id', adminController.updateShop);
router.post('/shops', adminController.createShop);

// Tech management
router.get('/techs', adminController.getAllTechs);
router.get('/techs/:id', adminController.getTech);
router.put('/techs/:id', adminController.updateTech);

// Billing & Invoicing
router.get('/billing', adminController.getBillingOverview);
router.get('/billing/shop/:shopName', adminController.getShopBilling);
router.post('/billing/invoice/:roPo', adminController.sendInvoice);
router.get('/invoices', adminController.getAllInvoices);
router.get('/invoices/unpaid', adminController.getUnpaidInvoices);

// Reports
router.get('/reports/daily', adminController.getDailyReport);
router.get('/reports/weekly', adminController.getWeeklyReport);
router.get('/reports/shop/:shopName', adminController.getShopReport);
router.get('/reports/tech/:techName', adminController.getTechReport);

// System logs
router.get('/logs', adminController.getSystemLogs);

// Settings
router.get('/settings', adminController.getSettings);
router.put('/settings', adminController.updateSettings);

// Assignment requests
router.get('/assignment-requests', adminController.getAssignmentRequests);
router.post('/assignment-requests/review', adminController.reviewAssignmentRequest);
router.post('/reassign', adminController.adminReassign);

export default router;
