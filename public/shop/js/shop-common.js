/**
 * shop-common.js - Shared functionality for shop portal
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
    logoutBtn.addEventListener('click', async () => {
      await Auth.logout();
      window.location.href = '/';
    });
  }

  // Help modal
  const helpBtn = document.getElementById('helpBtn');
  const helpModal = document.getElementById('helpModal');

  if (helpBtn && helpModal) {
    helpBtn.addEventListener('click', () => helpModal.classList.add('open'));

    helpModal.querySelector('.modal-close')?.addEventListener('click', () => {
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

// Toast notifications
const Toast = {
  show(message, type = 'info', duration = 3000) {
    // Remove existing toast
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1a73e8'};
      color: white;
      padding: 14px 24px;
      border-radius: 8px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1000;
      animation: slideUp 0.3s ease;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideDown 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  success(message) {
    this.show(message, 'success');
  },

  error(message) {
    this.show(message, 'error');
  }
};

// Add toast animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slideUp {
    from { transform: translateX(-50%) translateY(100%); opacity: 0; }
    to { transform: translateX(-50%) translateY(0); opacity: 1; }
  }
  @keyframes slideDown {
    from { transform: translateX(-50%) translateY(0); opacity: 1; }
    to { transform: translateX(-50%) translateY(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

// Export
window.ShopAPI = ShopAPI;
window.initShopPortal = initShopPortal;
window.setupCommonHandlers = setupCommonHandlers;
window.escapeHtml = escapeHtml;
window.formatDate = formatDate;
window.formatTime = formatTime;
window.getStatusClass = getStatusClass;
window.Toast = Toast;
