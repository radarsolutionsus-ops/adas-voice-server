/**
 * tech-common.js - Shared functionality for tech portal (Apple-style design)
 */
(function() {
  'use strict';

  // Tech API wrapper
  window.TechAPI = {
    async request(endpoint, options = {}) {
      const token = await Auth.getValidToken();

      const response = await fetch(endpoint, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (response.status === 401 || response.status === 403) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace('/?logout=true');
        throw new Error('Session expired');
      }

      return response.json();
    },

    get(endpoint) {
      return this.request(endpoint);
    },

    post(endpoint, data) {
      return this.request(endpoint, {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    put(endpoint, data) {
      return this.request(endpoint, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    }
  };

  // Initialize tech portal
  window.initTechPortal = function() {
    console.log('[TECH] initTechPortal called');

    // Check auth
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('userRole');

    if (!token) {
      console.log('[TECH] No token, redirecting to login');
      window.location.replace('/?logout=true');
      return false;
    }

    if (role !== 'tech' && role !== 'admin') {
      console.log('[TECH] Wrong role:', role);
      localStorage.clear();
      window.location.replace('/?logout=true');
      return false;
    }

    // Set tech name in header
    const techName = localStorage.getItem('userName') || 'Technician';
    const techNameEl = document.getElementById('techName');
    if (techNameEl) {
      techNameEl.textContent = techName;
    }

    console.log('[TECH] Portal initialized for:', techName);
    return true;
  };

  // Setup common event listeners
  window.setupTechCommonHandlers = function() {
    console.log('[TECH] Setting up common handlers');

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[TECH] Logout clicked');

        // Clear all auth data
        localStorage.clear();
        sessionStorage.clear();
        console.log('[TECH] Storage cleared');

        // Redirect to login
        window.location.replace('/?logout=true');
      };
      console.log('[TECH] Logout handler attached');
    }
  };

  // Utility functions
  window.escapeHtml = function(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  window.formatDate = function(dateStr) {
    if (!dateStr || dateStr.includes('1899')) return '';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return dateStr;
    }
  };

  window.formatTime = function(timeStr) {
    if (!timeStr || String(timeStr).includes('1899')) return '';

    let time = String(timeStr).trim();

    // Remove any duplicate AM/PM patterns like "PM AM" or "AM PM"
    time = time.replace(/\s*(AM|PM)\s*(AM|PM)/gi, ' $1').trim();

    // If already has AM/PM at end, just clean and return
    if (/\d+:\d+\s*(AM|PM)$/i.test(time)) {
      return time.replace(/\s+/g, ' ').trim();
    }

    // Parse 24-hour time and convert to 12-hour
    const match24 = time.match(/(\d{1,2}):(\d{2})/);
    if (match24) {
      let hours = parseInt(match24[1], 10);
      const minutes = match24[2];
      const period = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      return `${hours}:${minutes} ${period}`;
    }

    try {
      const date = new Date(time);
      if (isNaN(date.getTime())) return time;
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return time;
    }
  };

  window.formatDateTime = function(date, time) {
    const d = formatDate(date);
    const t = formatTime(time);
    if (d && t) return `${d} at ${t}`;
    if (d) return d;
    return 'Not scheduled';
  };

  window.getStatusClass = function(status) {
    if (!status) return 'new';
    return status.toLowerCase().replace(/\s+/g, '-');
  };

  // Toast notifications - only define if not already defined by api.js
  if (!window.Toast) {
    window.Toast = {
      show(message, type = 'info', duration = 3000) {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
          toast.classList.add('show');
        });

        setTimeout(() => {
          toast.classList.remove('show');
          setTimeout(() => toast.remove(), 200);
        }, duration);
      },

      success(message) {
        this.show(message, 'success');
      },

      error(message) {
        this.show(message, 'error');
      }
    };
  }

  console.log('[TECH] tech-common.js loaded');
})();
