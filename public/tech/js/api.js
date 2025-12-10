/**
 * api.js - API client for tech portal
 */

const TechAPI = {
  /**
   * Make authenticated API request
   */
  async request(endpoint, options = {}) {
    try {
      const token = await TechAuth.getValidToken();

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
            const newToken = await TechAuth.refresh();
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
            TechAuth.logout();
            window.location.href = '/tech/';
            throw new Error('Session expired');
          }
        }
        TechAuth.logout();
        window.location.href = '/tech/';
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
   * Get all vehicles
   */
  async getVehicles(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.shop) query.set('shop', params.shop);

    const queryStr = query.toString();
    const endpoint = '/api/tech/vehicles' + (queryStr ? `?${queryStr}` : '');

    const data = await this.request(endpoint);
    return data.vehicles || [];
  },

  /**
   * Get my assigned vehicles
   */
  async getMyVehicles(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);

    const queryStr = query.toString();
    const endpoint = '/api/tech/vehicles/mine' + (queryStr ? `?${queryStr}` : '');

    const data = await this.request(endpoint);
    return data.vehicles || [];
  },

  /**
   * Get today's schedule
   */
  async getTodaySchedule(mine = false) {
    const endpoint = '/api/tech/today' + (mine ? '?mine=true' : '');
    const data = await this.request(endpoint);
    return data.vehicles || [];
  },

  /**
   * Get single vehicle by RO
   */
  async getVehicle(roPo) {
    const data = await this.request(`/api/tech/vehicles/${encodeURIComponent(roPo)}`);
    return data.vehicle;
  },

  /**
   * Get dashboard stats
   */
  async getStats() {
    const data = await this.request('/api/tech/stats');
    return data.stats;
  },

  /**
   * Update vehicle status
   */
  async updateStatus(roPo, status, notes = null) {
    const data = await this.request(`/api/tech/vehicles/${encodeURIComponent(roPo)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, notes })
    });
    return data;
  },

  /**
   * Mark arrival
   */
  async markArrival(roPo) {
    const data = await this.request(`/api/tech/vehicles/${encodeURIComponent(roPo)}/arrive`, {
      method: 'POST'
    });
    return data;
  },

  /**
   * Mark job complete
   */
  async markComplete(roPo, completedCalibrations = null, notes = null) {
    const data = await this.request(`/api/tech/vehicles/${encodeURIComponent(roPo)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ completedCalibrations, notes })
    });
    return data;
  },

  /**
   * Add note to vehicle
   */
  async addNote(roPo, note) {
    const data = await this.request(`/api/tech/vehicles/${encodeURIComponent(roPo)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
    return data;
  },

  /**
   * Get documents for vehicle
   */
  async getDocuments(roPo) {
    const data = await this.request(`/api/tech/vehicles/${encodeURIComponent(roPo)}/documents`);
    return data.documents;
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

window.TechAPI = TechAPI;
window.Toast = Toast;
