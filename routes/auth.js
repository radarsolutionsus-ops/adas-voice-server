/**
 * routes/auth.js - Authentication routes for shop portal
 */

import express from 'express';
import { login, refresh, logout, getMe } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/login', login);
router.post('/refresh', refresh);

// Protected routes
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, getMe);

export default router;
