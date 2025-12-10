/**
 * roleGuard.js - Middleware for role-based access control
 *
 * Provides:
 *   requirePermission(permission) - Check if user has specific permission
 *   requireRole(...roles) - Check if user has one of the specified roles
 */

import { PERMISSIONS, ROLES } from '../config/roles.js';

const LOG_TAG = '[ROLE_GUARD]';

/**
 * Middleware to require a specific permission
 *
 * Usage: router.post('/vehicles', requirePermission('canSubmitVehicle'), controller.submit)
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!userRole) {
      console.log(`${LOG_TAG} Permission denied: No role on user`);
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const rolePerms = PERMISSIONS[userRole];
    if (!rolePerms || !rolePerms[permission]) {
      console.log(`${LOG_TAG} Permission denied: ${userRole} lacks ${permission}`);
      return res.status(403).json({
        success: false,
        error: 'Permission denied',
        required: permission,
        yourRole: userRole
      });
    }

    next();
  };
}

/**
 * Middleware to require one of the specified roles
 *
 * Usage: router.use(requireRole('shop', 'admin'))
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!userRole) {
      console.log(`${LOG_TAG} Role check failed: No role on user`);
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    if (!roles.includes(userRole)) {
      console.log(`${LOG_TAG} Access denied: ${userRole} not in [${roles.join(', ')}]`);
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        requiredRoles: roles,
        yourRole: userRole
      });
    }

    next();
  };
}

/**
 * Middleware to require shop role specifically
 */
export const requireShop = requireRole(ROLES.SHOP);

/**
 * Middleware to require tech role specifically
 */
export const requireTech = requireRole(ROLES.TECH, ROLES.ADMIN);

/**
 * Middleware to require admin role specifically
 */
export const requireAdmin = requireRole(ROLES.ADMIN);

export default {
  requirePermission,
  requireRole,
  requireShop,
  requireTech,
  requireAdmin
};
