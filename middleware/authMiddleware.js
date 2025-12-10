/**
 * authMiddleware.js - JWT authentication middleware
 *
 * Verifies JWT tokens and attaches user info to request
 * Supports all roles: shop, tech, admin
 */

import jwt from 'jsonwebtoken';

const LOG_TAG = '[AUTH_MW]';

/**
 * Verify JWT token and attach user info to request
 *
 * req.user will contain:
 *   - userId: string
 *   - username: string
 *   - role: 'shop' | 'tech' | 'admin'
 *   - name: string
 *   - sheetName: string (for shops)
 *   - shopName: string (for shops)
 *   - techName: string (for techs)
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
      // Only log non-expiry errors to reduce noise
      if (err.name !== 'TokenExpiredError') {
        console.log(`${LOG_TAG} Token verification failed:`, err.message);
      }
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(403).json({ success: false, error: 'Invalid token' });
    }

    // Attach user info from token to request
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      name: decoded.name,
      sheetName: decoded.sheetName,
      shopName: decoded.shopName,
      techName: decoded.techName,
      coverage: decoded.coverage
    };

    next();
  });
}

/**
 * Optional authentication - allows both authenticated and unauthenticated requests
 * If token present and valid, attaches user info; otherwise continues without
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
      req.user = {
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role,
        name: decoded.name,
        sheetName: decoded.sheetName,
        shopName: decoded.shopName,
        techName: decoded.techName,
        coverage: decoded.coverage
      };
    }
    next();
  });
}

export default {
  authenticateToken,
  optionalAuth
};
