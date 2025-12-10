/**
 * dataFilter.js - Middleware for filtering data based on user role
 *
 * Shops can only see their own vehicles (filtered by sheetName)
 * Techs can see all vehicles
 * Admin can see everything
 */

import { ROLES } from '../config/roles.js';

const LOG_TAG = '[DATA_FILTER]';

/**
 * Filter an array of vehicle rows based on user's role and shop
 *
 * @param {Array} rows - Array of vehicle/schedule rows
 * @param {Object} user - User object from JWT (role, sheetName, etc.)
 * @returns {Array} - Filtered rows
 */
export function filterVehiclesByUser(rows, user) {
  if (!rows || !Array.isArray(rows)) return [];
  if (!user) return [];

  const { role, sheetName } = user;

  // Techs and admins see everything
  if (role === ROLES.TECH || role === ROLES.ADMIN) {
    return rows;
  }

  // Shops only see their own vehicles
  if (role === ROLES.SHOP && sheetName) {
    const shopNameLower = sheetName.toLowerCase().trim();
    return rows.filter(row => {
      const rowShop = (row.shopName || row.shop_name || '').toLowerCase().trim();
      return rowShop === shopNameLower;
    });
  }

  // No access
  return [];
}

/**
 * Check if user can access a specific vehicle
 *
 * @param {Object} vehicle - Vehicle row object
 * @param {Object} user - User object from JWT
 * @returns {boolean}
 */
export function canAccessVehicle(vehicle, user) {
  if (!vehicle || !user) return false;

  const { role, sheetName } = user;

  // Techs and admins can access any vehicle
  if (role === ROLES.TECH || role === ROLES.ADMIN) {
    return true;
  }

  // Shops can only access their own vehicles
  if (role === ROLES.SHOP && sheetName) {
    const vehicleShop = (vehicle.shopName || vehicle.shop_name || '').toLowerCase().trim();
    const userShop = sheetName.toLowerCase().trim();
    return vehicleShop === userShop;
  }

  return false;
}

/**
 * Filter vehicles by assigned technician
 *
 * @param {Array} rows - Array of vehicle rows
 * @param {string} techName - Technician name to filter by
 * @returns {Array}
 */
export function filterByTechnician(rows, techName) {
  if (!rows || !techName) return rows;

  const techNameLower = techName.toLowerCase().trim();
  return rows.filter(row => {
    const assigned = (row.technician || row.technicianAssigned || '').toLowerCase().trim();
    return assigned === techNameLower;
  });
}

/**
 * Filter vehicles scheduled for today
 *
 * @param {Array} rows - Array of vehicle rows
 * @returns {Array}
 */
export function filterTodaySchedule(rows) {
  if (!rows) return [];

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

  return rows.filter(row => {
    const scheduledDate = row.scheduledDate || row.scheduled_date || '';
    if (!scheduledDate) return false;

    // Handle various date formats
    let dateStr = scheduledDate;

    // ISO format
    if (dateStr.includes('T')) {
      dateStr = dateStr.split('T')[0];
    }
    // MM/DD/YYYY format
    else if (dateStr.includes('/')) {
      const parts = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (parts) {
        dateStr = `${parts[3]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      }
    }

    return dateStr === todayStr;
  });
}

/**
 * Filter vehicles by status
 *
 * @param {Array} rows - Array of vehicle rows
 * @param {string|string[]} statuses - Status or array of statuses to filter by
 * @returns {Array}
 */
export function filterByStatus(rows, statuses) {
  if (!rows) return [];
  if (!statuses) return rows;

  const statusList = Array.isArray(statuses) ? statuses : [statuses];
  const statusLower = statusList.map(s => s.toLowerCase().trim());

  return rows.filter(row => {
    const rowStatus = (row.status || '').toLowerCase().trim();
    return statusLower.includes(rowStatus);
  });
}

export default {
  filterVehiclesByUser,
  canAccessVehicle,
  filterByTechnician,
  filterTodaySchedule,
  filterByStatus
};
