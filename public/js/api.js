/**
 * api.js - API client for shop portal
 */

const API = {
  /**
   * Make authenticated API request
   */
  async request(endpoint, options = {}) {
    try {
      const token = await Auth.getValidToken();

      const response = await fetch(endpoint, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      // Handle auth errors
      if (response.status === 401) {
        const data = await response.json();
        if (data.code === 'TOKEN_EXPIRED') {
          // Try to refresh and retry
          try {
            const newToken = await Auth.refresh();
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
            // Refresh failed, redirect to login
            Auth.logout();
            window.location.href = '/';
            throw new Error('Session expired');
          }
        }
        Auth.logout();
        window.location.href = '/';
        throw new Error(data.error || 'Authentication failed');
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (err) {
      // Re-throw the error for handling by caller
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
    const endpoint = '/api/portal/vehicles' + (queryStr ? `?${queryStr}` : '');

    const data = await this.request(endpoint);
    return data.vehicles || [];
  },

  /**
   * Get single vehicle by RO
   */
  async getVehicle(roPo) {
    const data = await this.request(`/api/portal/vehicles/${encodeURIComponent(roPo)}`);
    return data.vehicle;
  },

  /**
   * Submit new vehicle
   */
  async submitVehicle(vehicleData) {
    const data = await this.request('/api/portal/vehicles', {
      method: 'POST',
      body: JSON.stringify(vehicleData)
    });
    return data;
  },

  /**
   * Get dashboard stats
   */
  async getStats() {
    const data = await this.request('/api/portal/stats');
    return data.stats;
  },

  /**
   * Get scheduling prerequisites
   */
  async getPrerequisites() {
    const data = await this.request('/api/portal/schedule/prerequisites');
    return data.prerequisites || [];
  },

  /**
   * Schedule appointment
   */
  async scheduleAppointment(scheduleData) {
    const data = await this.request('/api/portal/schedule', {
      method: 'POST',
      body: JSON.stringify(scheduleData)
    });
    return data;
  },

  /**
   * Update/reschedule appointment
   */
  async updateSchedule(roPo, scheduleData) {
    const data = await this.request(`/api/portal/schedule/${encodeURIComponent(roPo)}`, {
      method: 'PUT',
      body: JSON.stringify(scheduleData)
    });
    return data;
  },

  /**
   * Cancel appointment
   */
  async cancelSchedule(roPo, reason) {
    const data = await this.request(`/api/portal/schedule/${encodeURIComponent(roPo)}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });
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

// Export for use in other scripts
window.API = API;
window.Toast = Toast;
