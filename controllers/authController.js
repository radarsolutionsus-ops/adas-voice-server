/**
 * authController.js - Authentication controller for portal (shops, techs, admin)
 *
 * Handles login, logout, token refresh with role-based access
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ROLES } from '../config/roles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_TAG = '[AUTH_CTRL]';

// Load users config (shops + techs + admin)
function loadUsers() {
  try {
    const configPath = path.join(__dirname, '../config/users.json');
    const data = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(data).users || [];
  } catch (err) {
    console.error(`${LOG_TAG} Failed to load users config:`, err.message);
    return [];
  }
}

// Generate access token with role information
function generateAccessToken(user) {
  const jwtSecret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || '24h';

  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    name: user.name
  };

  // Add shop-specific fields for shop users
  if (user.role === ROLES.SHOP) {
    payload.sheetName = user.sheetName;
    payload.shopName = user.name;
  }

  // Add tech-specific fields for tech users
  if (user.role === ROLES.TECH) {
    payload.techName = user.name;
    payload.coverage = user.coverage;
  }

  return jwt.sign(payload, jwtSecret, { expiresIn });
}

// Generate refresh token (longer expiry)
function generateRefreshToken(user) {
  const jwtSecret = process.env.JWT_SECRET;

  return jwt.sign(
    {
      userId: user.id,
      type: 'refresh'
    },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

/**
 * POST /api/auth/login
 * Login with username and password
 * Returns role for frontend routing
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

    // Find user by username
    const users = loadUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) {
      console.log(`${LOG_TAG} Login attempt for unknown user: ${username}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password'
      });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.passwordHash);

    if (!passwordValid) {
      console.log(`${LOG_TAG} Invalid password for user: ${username}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid username or password'
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Determine redirect based on role
    let redirectTo = '/shop/dashboard.html';
    if (user.role === ROLES.TECH) {
      redirectTo = '/tech/dashboard.html';
    } else if (user.role === ROLES.ADMIN) {
      redirectTo = '/tech/dashboard.html'; // Admin uses tech portal for now
    }

    console.log(`${LOG_TAG} Login successful: ${user.name} (${user.role})`);

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email
      },
      redirectTo
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

      // Find user
      const users = loadUsers();
      const user = users.find(u => u.id === decoded.userId);

      if (!user) {
        return res.status(403).json({
          success: false,
          error: 'User not found'
        });
      }

      // Generate new access token
      const accessToken = generateAccessToken(user);

      console.log(`${LOG_TAG} Token refreshed for: ${user.name}`);

      res.json({
        success: true,
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          email: user.email
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
  console.log(`${LOG_TAG} Logout: ${req.user?.name || 'unknown'}`);

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}

/**
 * GET /api/auth/me
 * Get current authenticated user info
 */
export async function getMe(req, res) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }

  res.json({
    success: true,
    user: {
      id: req.user.userId,
      name: req.user.name,
      role: req.user.role,
      ...(req.user.role === ROLES.SHOP && { shopName: req.user.shopName }),
      ...(req.user.role === ROLES.TECH && { techName: req.user.techName })
    }
  });
}

export default {
  login,
  refresh,
  logout,
  getMe
};
