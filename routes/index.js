/**
 * routes/index.js - Route aggregator for portal
 */

import authRoutes from './auth.js';
import portalRoutes from './portal.js';
import shopRoutes from './shop.js';
import techRoutes from './tech.js';
import adminRoutes from './admin.js';
import notificationRoutes from './notifications.js';

export { authRoutes, portalRoutes, shopRoutes, techRoutes, adminRoutes, notificationRoutes };
