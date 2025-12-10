/**
 * authMiddleware.js - JWT authentication middleware for shop portal
 *
 * Verifies JWT tokens and attaches shop info to request
 */

import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_TAG = '[AUTH_MW]';

// Load shop config
function loadShops() {
  try {
    const configPath = path.join(__dirname, '../config/shops.json');
    const data = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(data).shops || [];
  } catch (err) {
    console.error(`${LOG_TAG} Failed to load shops config:`, err.message);
    return [];
  }
}

/**
 * Verify JWT token and attach shop info to request
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error(`${LOG_TAG} JWT_SECRET not configured`);
    return res.status(500).json({ success: false, error: 'Server configuration error' });
  }

  jwt.verify(token, jwtSecret, (err, decoded) => {
    if (err) {
      console.log(`${LOG_TAG} Token verification failed:`, err.message);
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }

    // Find shop in config
    const shops = loadShops();
    const shop = shops.find(s => s.id === decoded.shopId);

    if (!shop) {
      console.log(`${LOG_TAG} Shop not found: ${decoded.shopId}`);
      return res.status(403).json({ success: false, error: 'Shop not found' });
    }

    // Attach shop info to request
    req.shop = {
      id: shop.id,
      name: shop.name,
      sheetName: shop.sheetName,
      email: shop.email,
      phone: shop.phone
    };

    console.log(`${LOG_TAG} Authenticated: ${shop.name}`);
    next();
  });
}

/**
 * Optional authentication - allows both authenticated and unauthenticated requests
 * If token present and valid, attaches shop info; otherwise continues without
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return next();
  }

  jwt.verify(token, jwtSecret, (err, decoded) => {
    if (!err && decoded) {
      const shops = loadShops();
      const shop = shops.find(s => s.id === decoded.shopId);
      if (shop) {
        req.shop = {
          id: shop.id,
          name: shop.name,
          sheetName: shop.sheetName,
          email: shop.email,
          phone: shop.phone
        };
      }
    }
    next();
  });
}

export default {
  authenticateToken,
  optionalAuth
};
