/**
 * auth.js - Authentication utilities for shop portal
 */

const Auth = {
  TOKEN_KEY: 'adas_access_token',
  REFRESH_KEY: 'adas_refresh_token',
  SHOP_KEY: 'adas_shop',

  /**
   * Login with username and password
   */
  async login(username, password) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Login failed');
    }

    // Store tokens
    localStorage.setItem(this.TOKEN_KEY, data.accessToken);
    localStorage.setItem(this.REFRESH_KEY, data.refreshToken);
    localStorage.setItem(this.SHOP_KEY, JSON.stringify(data.shop));

    return data.shop;
  },

  /**
   * Logout
   */
  async logout() {
    try {
      const token = this.getToken();
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (e) {
      // Ignore errors during logout
    }

    // Clear storage
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_KEY);
    localStorage.removeItem(this.SHOP_KEY);
  },

  /**
   * Refresh access token
   */
  async refresh() {
    const refreshToken = localStorage.getItem(this.REFRESH_KEY);
    if (!refreshToken) {
      throw new Error('No refresh token');
    }

    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      // Clear tokens if refresh fails
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.REFRESH_KEY);
      localStorage.removeItem(this.SHOP_KEY);
      throw new Error(data.error || 'Token refresh failed');
    }

    // Update access token
    localStorage.setItem(this.TOKEN_KEY, data.accessToken);
    if (data.shop) {
      localStorage.setItem(this.SHOP_KEY, JSON.stringify(data.shop));
    }

    return data.accessToken;
  },

  /**
   * Get current access token
   */
  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  /**
   * Get current shop info
   */
  getShop() {
    try {
      const shop = localStorage.getItem(this.SHOP_KEY);
      return shop ? JSON.parse(shop) : null;
    } catch {
      return null;
    }
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.getToken();
  },

  /**
   * Require authentication - redirect to login if not authenticated
   */
  requireAuth() {
    if (!this.isAuthenticated()) {
      window.location.href = '/';
      return false;
    }
    return true;
  },

  /**
   * Parse JWT to check expiration (without verification)
   */
  isTokenExpired(token) {
    if (!token) return true;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const exp = payload.exp * 1000; // Convert to milliseconds
      return Date.now() > exp;
    } catch {
      return true;
    }
  },

  /**
   * Get valid token, refreshing if needed
   */
  async getValidToken() {
    let token = this.getToken();

    if (!token) {
      throw new Error('Not authenticated');
    }

    // Check if token is expired or about to expire (5 min buffer)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const exp = payload.exp * 1000;
      const buffer = 5 * 60 * 1000; // 5 minutes

      if (Date.now() > exp - buffer) {
        token = await this.refresh();
      }
    } catch {
      // If we can't parse the token, try to refresh
      token = await this.refresh();
    }

    return token;
  }
};

// Export for use in other scripts
window.Auth = Auth;
