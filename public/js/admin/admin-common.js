/**
 * admin-common.js - Shared functionality for admin portal
 */

// Initialize admin portal
document.addEventListener('DOMContentLoaded', () => {
  // Check auth - must be admin
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('userRole');

  if (!token) {
    console.log('[ADMIN] No token, redirecting to login');
    window.location.replace('/?logout=true');
    return;
  }

  if (role !== 'admin') {
    console.log('[ADMIN] Wrong role:', role);
    localStorage.clear();
    window.location.replace('/?logout=true');
    return;
  }

  // Set user info
  const userName = localStorage.getItem('userName') || 'Admin';
  const userAvatar = document.getElementById('userAvatar');
  const userNameEl = document.getElementById('userName');

  if (userAvatar) userAvatar.textContent = userName.charAt(0).toUpperCase();
  if (userNameEl) userNameEl.textContent = userName;

  // Setup sidebar toggle
  setupSidebar();

  // Setup logout
  setupLogout();

  // Setup mobile menu
  setupMobileMenu();

  // Mark active nav item
  markActiveNav();
});

function setupSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebarToggle');

  if (!sidebar || !toggle) return;

  // Load saved state
  const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
  if (collapsed) {
    sidebar.classList.add('collapsed');
  }

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
  });
}

function setupLogout() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      localStorage.clear();
      sessionStorage.clear();
      window.location.replace('/?logout=true');
    });
  }
}

function setupMobileMenu() {
  const sidebar = document.getElementById('sidebar');
  const mobileBtn = document.getElementById('mobileMenuBtn');
  const overlay = document.getElementById('sidebarOverlay');

  if (mobileBtn) {
    mobileBtn.addEventListener('click', () => {
      sidebar?.classList.add('open');
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar?.classList.remove('open');
    });
  }
}

function markActiveNav() {
  const currentPath = window.location.pathname;
  const currentSearch = window.location.search;

  document.querySelectorAll('.nav-item').forEach(item => {
    const href = item.getAttribute('href');
    if (href === currentPath + currentSearch || href === currentPath) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

// API helper for admin
const AdminAPI = {
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

// Utility functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr || dateStr.includes('1899')) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
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

// Export utilities
window.AdminAPI = AdminAPI;
window.escapeHtml = escapeHtml;
window.formatDate = formatDate;
window.formatTime = formatTime;
window.getStatusClass = getStatusClass;
