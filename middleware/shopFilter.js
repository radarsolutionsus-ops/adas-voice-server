/**
 * shopFilter.js - Filter middleware to ensure shops only see their own data
 *
 * Injects shopName filter into queries and validates shop access
 */

const LOG_TAG = '[SHOP_FILTER]';

/**
 * Middleware that ensures req.shop is set and injects shopName into query params
 * Must be used after authenticateToken middleware
 */
export function requireShopContext(req, res, next) {
  if (!req.shop) {
    console.log(`${LOG_TAG} No shop context found`);
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  // Inject shopName into query for filtering
  req.shopFilter = {
    shopName: req.shop.sheetName,
    shopId: req.shop.id
  };

  console.log(`${LOG_TAG} Shop context: ${req.shop.name} (filter: ${req.shopFilter.shopName})`);
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
