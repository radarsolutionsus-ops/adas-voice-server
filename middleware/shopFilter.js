/**
 * shopFilter.js - Filter middleware to ensure shops only see their own data
 *
 * Injects shopName filter into queries and validates shop access
 */

const LOG_TAG = '[SHOP_FILTER]';

/**
 * Middleware that ensures shop context is available from req.user (set by authenticateToken)
 * Must be used after authenticateToken middleware
 */
export function requireShopContext(req, res, next) {
  // Shop context comes from JWT via req.user (set by authenticateToken)
  if (!req.user) {
    console.log(`${LOG_TAG} No user context found (not authenticated)`);
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  // For shop users, ensure we have sheetName
  if (req.user.role === 'shop') {
    if (!req.user.sheetName) {
      console.error(`${LOG_TAG} Shop user missing sheetName in token:`, {
        userId: req.user.userId,
        role: req.user.role,
        name: req.user.name
      });
      return res.status(403).json({
        success: false,
        error: 'Invalid session - missing shop context',
        code: 'MISSING_SHOP_CONTEXT'
      });
    }

    // Inject shopFilter for use in controllers
    req.shopFilter = {
      shopName: req.user.sheetName,
      shopId: req.user.userId
    };

    console.log(`${LOG_TAG} Shop context: ${req.user.name} (filter: ${req.shopFilter.shopName})`);
  }

  // Also set req.shop for backwards compatibility with any code that uses it
  req.shop = {
    id: req.user.userId,
    name: req.user.name,
    sheetName: req.user.sheetName
  };

  next();
}

/**
 * Validate that a specific RO belongs to the authenticated shop
 * @param {string} roPo - The RO/PO number
 * @param {string} shopName - The shop name from the row
 * @param {string} authenticatedShopName - The shop name from the token
 * @returns {boolean} - True if access is allowed
 */
export function validateShopAccess(rowShopName, authenticatedShopName) {
  if (!rowShopName || !authenticatedShopName) {
    return false;
  }

  // Normalize names for comparison (case-insensitive, trim whitespace)
  const normalizedRowShop = rowShopName.toLowerCase().trim();
  const normalizedAuthShop = authenticatedShopName.toLowerCase().trim();

  return normalizedRowShop === normalizedAuthShop;
}

/**
 * Filter an array of rows to only include those belonging to the shop
 * @param {Array} rows - Array of row objects
 * @param {string} shopName - The shop name to filter by
 * @returns {Array} - Filtered array
 */
export function filterRowsByShop(rows, shopName) {
  if (!Array.isArray(rows) || !shopName) {
    return [];
  }

  const normalizedShopName = shopName.toLowerCase().trim();

  return rows.filter(row => {
    const rowShop = row.shopName || row.shop_name || row.shop || '';
    return rowShop.toLowerCase().trim() === normalizedShopName;
  });
}

export default {
  requireShopContext,
  validateShopAccess,
  filterRowsByShop
};
