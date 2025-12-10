/**
 * authController.js - Authentication controller for shop portal
 *
 * Handles login, logout, token refresh
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_TAG = '[AUTH_CTRL]';

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

// Generate access token
function generateAccessToken(shop) {
  const jwtSecret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || '24h';

  return jwt.sign(
    {
      shopId: shop.id,
      shopName: shop.name,
      sheetName: shop.sheetName
    },
    jwtSecret,
    { expiresIn }
  );
}

// Generate refresh token (longer expiry)
function generateRefreshToken(shop) {
  const jwtSecret = process.env.JWT_SECRET;

  return jwt.sign(
    {
      shopId: shop.id,
      type: 'refresh'
    },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

/**
 * POST /api/auth/login
 * Login with username and password
 */
export async function login(req, res) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error(`${LOG_TAG} JWT_SECRET not configured`);
      return res.status(500).json({
        success: false,
        error: 'Server configuration error'
      });
    }

    // Find shop by username
    const shops = loadShops();
    const shop = shops.find(s => s.username.toLowerCase() === username.toLowerCase());

    if (!shop) {
      console.log(`${LOG_TAG} Login attempt for unknown user: ${username}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password'
      });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, shop.passwordHash);

    if (!passwordValid) {
      console.log(`${LOG_TAG} Invalid password for user: ${username}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password'
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(shop);
    const refreshToken = generateRefreshToken(shop);

    console.log(`${LOG_TAG} Login successful: ${shop.name}`);

    res.json({
      success: true,
      accessToken,
      refreshToken,
      shop: {
        id: shop.id,
        name: shop.name,
        email: shop.email
      }
    });
  } catch (err) {
    console.error(`${LOG_TAG} Login error:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
}

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
export async function refresh(req, res) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token required'
      });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error'
      });
    }

    // Verify refresh token
    jwt.verify(refreshToken, jwtSecret, (err, decoded) => {
      if (err) {
        console.log(`${LOG_TAG} Invalid refresh token:`, err.message);
        return res.status(403).json({
          success: false,
          error: 'Invalid refresh token'
        });
      }

      if (decoded.type !== 'refresh') {
        return res.status(403).json({
          success: false,
          error: 'Invalid token type'
        });
      }

      // Find shop
      const shops = loadShops();
      const shop = shops.find(s => s.id === decoded.shopId);

      if (!shop) {
        return res.status(403).json({
          success: false,
          error: 'Shop not found'
        });
      }

      // Generate new access token
      const accessToken = generateAccessToken(shop);

      console.log(`${LOG_TAG} Token refreshed for: ${shop.name}`);

      res.json({
        success: true,
        accessToken,
        shop: {
          id: shop.id,
          name: shop.name,
          email: shop.email
        }
      });
    });
  } catch (err) {
    console.error(`${LOG_TAG} Refresh error:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Token refresh failed'
    });
  }
}

/**
 * POST /api/auth/logout
 * Logout (client should discard tokens)
 */
export async function logout(req, res) {
  // JWT is stateless, so we just acknowledge the logout
  // Client should delete their tokens
  console.log(`${LOG_TAG} Logout: ${req.shop?.name || 'unknown'}`);

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}

/**
 * GET /api/auth/me
 * Get current authenticated shop info
 */
export async function getMe(req, res) {
  if (!req.shop) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }

  res.json({
    success: true,
    shop: req.shop
  });
}

export default {
  login,
  refresh,
  logout,
  getMe
};
