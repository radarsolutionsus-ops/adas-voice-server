/**
 * roles.js - Role definitions and permissions for portal access control
 *
 * Roles:
 *   shop  - Body shop users: submit vehicles, view own data, schedule
 *   tech  - Technicians: view all jobs, change status, mark complete
 *   admin - Full access (future use)
 */

export const ROLES = {
  SHOP: 'shop',
  TECH: 'tech',
  ADMIN: 'admin'
};

export const PERMISSIONS = {
  [ROLES.SHOP]: {
    // Data access
    canViewOwnVehicles: true,
    canViewAllVehicles: false,

    // Vehicle submission
    canSubmitVehicle: true,

    // Scheduling
    canSchedule: true,
    canReschedule: true,
    canCancel: true,          // With required reason

    // Status - NEVER for shops
    canChangeStatus: false,

    // Document access
    canViewEstimate: true,
    canViewPreScan: true,
    canViewRevvReport: true,
    canViewPostScan: true,
    canViewInvoice: true,

    // Notes
    canAddNotes: true,        // Shop notes only
    canViewTechNotes: false,

    // Tech actions
    canMarkArrival: false,
    canMarkComplete: false
  },

  [ROLES.TECH]: {
    // Data access
    canViewOwnVehicles: false,
    canViewAllVehicles: true,

    // Vehicle submission - techs don't submit
    canSubmitVehicle: false,

    // Scheduling - techs don't schedule
    canSchedule: false,
    canReschedule: false,
    canCancel: false,

    // Status - full control
    canChangeStatus: true,

    // Document access
    canViewEstimate: true,
    canViewPreScan: true,
    canViewRevvReport: true,
    canViewPostScan: true,
    canViewInvoice: true,

    // Notes
    canAddNotes: true,
    canViewTechNotes: true,

    // Tech actions
    canMarkArrival: true,
    canMarkComplete: true
  },

  [ROLES.ADMIN]: {
    // Full access
    canViewOwnVehicles: true,
    canViewAllVehicles: true,
    canSubmitVehicle: true,
    canSchedule: true,
    canReschedule: true,
    canCancel: true,
    canChangeStatus: true,
    canViewEstimate: true,
    canViewPreScan: true,
    canViewRevvReport: true,
    canViewPostScan: true,
    canViewInvoice: true,
    canAddNotes: true,
    canViewTechNotes: true,
    canMarkArrival: true,
    canMarkComplete: true
  }
};

/**
 * Valid status values that techs can set
 */
export const VALID_STATUSES = [
  'New',
  'Ready',
  'No Cal',
  'Scheduled',
  'Rescheduled',
  'In Progress',
  'Completed',
  'Cancelled'
];

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role, permission) {
  const perms = PERMISSIONS[role];
  return perms ? perms[permission] === true : false;
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role) {
  return PERMISSIONS[role] || {};
}

export default {
  ROLES,
  PERMISSIONS,
  VALID_STATUSES,
  hasPermission,
  getRolePermissions
};
