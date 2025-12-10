/**
 * api.js - API client for shop portal
 */

const ShopAPI = {
  /**
   * Make authenticated API request
   */
  async request(endpoint, options = {}) {
    try {
      const token = await ShopAuth.getValidToken();

      const response = await fetch(endpoint, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (response.status === 401) {
        const data = await response.json();
        if (data.code === 'TOKEN_EXPIRED') {
          try {
            const newToken = await ShopAuth.refresh();
            const retryResponse = await fetch(endpoint, {
              ...options,
              headers: {
                'Authorization': `Bearer ${newToken}`,
                'Content-Type': 'application/json',
                ...options.headers
              }
            });
            const retryData = await retryResponse.json();
            if (!retryResponse.ok) {
              throw new Error(retryData.error || 'Request failed');
            }
            return retryData;
          } catch {
            ShopAuth.logout();
            window.location.href = '/shop/';
            throw new Error('Session expired');
          }
        }
        ShopAuth.logout();
        window.location.href = '/shop/';
        throw new Error(data.error || 'Authentication failed');
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (err) {
      throw err;
    }
  },

  /**
   * Get all vehicles for the shop
   */
  async getVehicles(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);

    const queryStr = query.toString();
    const endpoint = '/api/shop/vehicles' + (queryStr ? `?${queryStr}` : '');

    const data = await this.request(endpoint);
    return data.vehicles || [];
  },

  /**
   * Get single vehicle by RO
   */
  async getVehicle(roPo) {
    const data = await this.request(`/api/shop/vehicles/${encodeURIComponent(roPo)}`);
    return data.vehicle;
  },

  /**
   * Submit new vehicle
   */
  async submitVehicle(vehicleData) {
    const data = await this.request('/api/shop/vehicles', {
      method: 'POST',
      body: JSON.stringify(vehicleData)
    });
    return data;
  },

  /**
   * Get dashboard stats
   */
  async getStats() {
    const data = await this.request('/api/shop/stats');
    return data.stats;
  },

  /**
   * Schedule appointment
   */
  async scheduleVehicle(roPo, scheduleData) {
    const data = await this.request(`/api/shop/vehicles/${encodeURIComponent(roPo)}/schedule`, {
      method: 'POST',
      body: JSON.stringify(scheduleData)
    });
    return data;
  },

  /**
   * Cancel appointment
   */
  async cancelVehicle(roPo, reason) {
    const data = await this.request(`/api/shop/vehicles/${encodeURIComponent(roPo)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    return data;
  },

  /**
   * Add note to vehicle
   */
  async addNote(roPo, note) {
    const data = await this.request(`/api/shop/vehicles/${encodeURIComponent(roPo)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
    return data;
  },

  /**
   * Get documents for vehicle
   */
  async getDocuments(roPo) {
    const data = await this.request(`/api/shop/vehicles/${encodeURIComponent(roPo)}/documents`);
    return data.documents;
  },

  /**
   * Upload file
   */
  async uploadFile(file) {
    const token = await ShopAuth.getValidToken();
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/shop/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    return data;
  }
};

/**
 * Toast notification utility
 */
const Toast = {
  show(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `toast toast-${type} show`;

    setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  },

  success(message) {
    this.show(message, 'success');
  },

  error(message) {
    this.show(message, 'error');
  }
};

window.ShopAPI = ShopAPI;
window.Toast = Toast;
