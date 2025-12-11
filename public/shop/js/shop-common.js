/**
 * shop-common.js - Shared functionality for shop portal (Apple-style design)
 */
(function() {
  'use strict';

  // Shop API wrapper (only define if not already defined)
  if (!window.ShopAPI) {
    window.ShopAPI = {
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
      },

      delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
      }
    };
  }

  // Helper to get from either storage
  function getStorageItem(key) {
    return localStorage.getItem(key) || sessionStorage.getItem(key);
  }

  // Initialize shop portal
  window.initShopPortal = function() {
    // Check auth - try both key formats and both storage types for compatibility
    const token = getStorageItem('adas_access_token') || getStorageItem('token');
    const role = getStorageItem('adas_user_role') || getStorageItem('userRole');

    if (!token) {
      console.log('[SHOP] No token found, redirecting to login');
      window.location.replace('/?logout=true');
      return false;
    }

    if (role !== 'shop') {
      console.log('[SHOP] Wrong role:', role);
      localStorage.clear();
      sessionStorage.clear();
      window.location.replace('/?logout=true');
      return false;
    }

    // Set shop name in header
    const shopName = getStorageItem('userName') || getStorageItem('userShopName') || 'Shop';
    const shopNameEl = document.getElementById('shopName');
    if (shopNameEl) {
      shopNameEl.textContent = shopName;
    }

    console.log('[SHOP] Portal initialized for:', shopName);
    return true;
  };

  // Setup common event listeners
  window.setupCommonHandlers = function() {
    console.log('[SHOP] Setting up common handlers');

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[SHOP] Logout clicked');

        // Clear all auth data
        localStorage.clear();
        sessionStorage.clear();
        console.log('[SHOP] Storage cleared');

        // Redirect to login
        window.location.replace('/?logout=true');
      };
      console.log('[SHOP] Logout handler attached');
    }

    // Help modal
    const helpBtn = document.getElementById('helpBtn');
    const helpModal = document.getElementById('helpModal');
    const helpModalClose = document.getElementById('helpModalClose');

    if (helpBtn && helpModal) {
      helpBtn.onclick = function() {
        helpModal.classList.add('open');
      };

      if (helpModalClose) {
        helpModalClose.onclick = function() {
          helpModal.classList.remove('open');
        };
      }

      helpModal.onclick = function(e) {
        if (e.target === helpModal) {
          helpModal.classList.remove('open');
        }
      };
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
    if (!timeStr || timeStr.includes('1899')) return '';
    if (timeStr.includes('AM') || timeStr.includes('PM')) return timeStr;
    try {
      const date = new Date(timeStr);
      if (isNaN(date.getTime())) return timeStr;
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return timeStr;
    }
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

  console.log('[SHOP] shop-common.js loaded');
})();
