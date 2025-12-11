/**
 * shop-common.js - Shared functionality for shop portal (Apple-style design)
 */

// Shop API wrapper
const ShopAPI = {
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
      Auth.logout();
      window.location.href = '/';
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

// Initialize shop portal
function initShopPortal() {
  // Check auth
  const token = Auth.getToken();
  if (!token) {
    window.location.href = '/';
    return false;
  }

  // Verify role from token
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.role !== 'shop') {
      console.error('Access denied: Shop role required');
      Auth.logout();
      window.location.href = '/';
      return false;
    }

    // Set shop name
    const shopNameEl = document.getElementById('shopName');
    if (shopNameEl) {
      shopNameEl.textContent = payload.name || 'Your Shop';
    }

    return true;
  } catch (e) {
    console.error('Invalid token');
    Auth.logout();
    window.location.href = '/';
    return false;
  }
}

// Setup common event listeners
function setupCommonHandlers() {
  // Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Clear all auth data
      localStorage.clear();

      // Also call Auth.logout() for server-side cleanup
      try {
        await Auth.logout();
      } catch (err) {
        // Ignore logout errors, we're clearing anyway
      }

      // Redirect to login
      window.location.href = '/';
    });
  }

  // Help modal
  const helpBtn = document.getElementById('helpBtn');
  const helpModal = document.getElementById('helpModal');
  const helpModalClose = document.getElementById('helpModalClose');

  if (helpBtn && helpModal) {
    helpBtn.addEventListener('click', () => helpModal.classList.add('open'));

    helpModalClose?.addEventListener('click', () => {
      helpModal.classList.remove('open');
    });

    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) helpModal.classList.remove('open');
    });
  }
}

// Utility functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr || dateStr.includes('1899')) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr) {
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
  } catch {
    return timeStr;
  }
}

function getStatusClass(status) {
  if (!status) return 'new';
  return status.toLowerCase().replace(/\s+/g, '-');
}

// Toast notifications (Apple-style)
const Toast = {
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

// Export
window.ShopAPI = ShopAPI;
window.initShopPortal = initShopPortal;
window.setupCommonHandlers = setupCommonHandlers;
window.escapeHtml = escapeHtml;
window.formatDate = formatDate;
window.formatTime = formatTime;
window.getStatusClass = getStatusClass;
window.Toast = Toast;
