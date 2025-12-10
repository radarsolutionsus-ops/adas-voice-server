/**
 * auth.js - Authentication utilities for tech portal
 */

const TechAuth = {
  TOKEN_KEY: 'adas_tech_access_token',
  REFRESH_KEY: 'adas_tech_refresh_token',
  USER_KEY: 'adas_tech_user',

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

    // Verify this is a tech or admin user
    if (data.user && !['tech', 'admin'].includes(data.user.role)) {
      throw new Error('Access denied. This portal is for technicians only.');
    }

    // Store tokens
    localStorage.setItem(this.TOKEN_KEY, data.accessToken);
    localStorage.setItem(this.REFRESH_KEY, data.refreshToken);
    localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));

    return data.user;
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
    localStorage.removeItem(this.USER_KEY);
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
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.REFRESH_KEY);
      localStorage.removeItem(this.USER_KEY);
      throw new Error(data.error || 'Token refresh failed');
    }

    localStorage.setItem(this.TOKEN_KEY, data.accessToken);
    if (data.user) {
      localStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
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
   * Get current user info
   */
  getUser() {
    try {
      const user = localStorage.getItem(this.USER_KEY);
      return user ? JSON.parse(user) : null;
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
      window.location.href = '/tech/';
      return false;
    }
    return true;
  },

  /**
   * Get valid token, refreshing if needed
   */
  async getValidToken() {
    let token = this.getToken();

    if (!token) {
      throw new Error('Not authenticated');
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const exp = payload.exp * 1000;
      const buffer = 5 * 60 * 1000; // 5 minutes

      if (Date.now() > exp - buffer) {
        token = await this.refresh();
      }
    } catch {
      token = await this.refresh();
    }

    return token;
  }
};

window.TechAuth = TechAuth;
