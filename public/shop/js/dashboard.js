/**
 * dashboard.js - Shop dashboard page logic
 */

// Require authentication
ShopAuth.requireAuth();

// State
let vehicles = [];
let currentStatus = 'all';
let currentSearch = '';

// Elements
const shopNameEl = document.getElementById('shop-name');
const vehiclesTbody = document.getElementById('vehicles-tbody');
const statusFilter = document.getElementById('status-filter');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const refreshBtn = document.getElementById('refresh-btn');
const emptyState = document.getElementById('empty-state');
const tableContainer = document.querySelector('.table-container');
const vehicleModal = document.getElementById('vehicle-modal');
const cancelModal = document.getElementById('cancel-modal');

// Init
async function init() {
  // Set shop name
  const user = ShopAuth.getUser();
  if (user) {
    shopNameEl.textContent = user.shopName || user.name || '';
  }

  // Load data
  await Promise.all([loadStats(), loadVehicles()]);

  // Set up event listeners
  setupEventListeners();
}

// Load stats
async function loadStats() {
  try {
    const stats = await ShopAPI.getStats();
    document.getElementById('stat-total').textContent = stats.total || 0;
    document.getElementById('stat-new').textContent = stats.new || 0;
    document.getElementById('stat-ready').textContent = stats.ready || 0;
    document.getElementById('stat-scheduled').textContent = stats.scheduled || 0;
    document.getElementById('stat-progress').textContent = stats.inProgress || 0;
    document.getElementById('stat-completed').textContent = stats.completed || 0;

    const newCard = document.getElementById('stat-card-new');
    if (newCard) {
      if ((stats.new || 0) > 0) {
        newCard.classList.add('has-new');
      } else {
        newCard.classList.remove('has-new');
      }
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// Load vehicles
async function loadVehicles() {
  showLoading();

  try {
    vehicles = await ShopAPI.getVehicles({
      status: currentStatus !== 'all' ? currentStatus : undefined,
      search: currentSearch || undefined
    });

    renderVehicles();
  } catch (err) {
    console.error('Failed to load vehicles:', err);
    Toast.error('Failed to load vehicles');
    showEmpty();
  }
}

// Show loading state
function showLoading() {
  vehiclesTbody.innerHTML = `
    <tr class="loading-row">
      <td colspan="7">
        <div class="loading-spinner"></div>
        <span>Loading vehicles...</span>
      </td>
    </tr>
  `;
  emptyState.classList.add('hidden');
  tableContainer.classList.remove('hidden');
}

// Show empty state
function showEmpty() {
  tableContainer.classList.add('hidden');
  emptyState.classList.remove('hidden');
}

// Render vehicles
function renderVehicles() {
  if (vehicles.length === 0) {
    showEmpty();
    return;
  }

  tableContainer.classList.remove('hidden');
  emptyState.classList.add('hidden');

  vehiclesTbody.innerHTML = vehicles.map(v => {
    const status = v.status || 'New';
    const isNew = status.toLowerCase() === 'new';
    const newBadge = isNew ? '<span class="new-indicator">NEW</span>' : '';
    const canCancel = ['scheduled', 'rescheduled'].includes(status.toLowerCase());

    return `
    <tr data-ro="${escapeHtml(v.roPo)}" data-status="${escapeHtml(status)}">
      <td><strong>${escapeHtml(v.roPo)}</strong>${newBadge}</td>
      <td class="vin-col">${escapeHtml(v.vin) || '-'}</td>
      <td>${escapeHtml(v.vehicle) || '-'}</td>
      <td class="cals-col">${escapeHtml(truncate(v.requiredCalibrations, 30)) || '-'}</td>
      <td><span class="status-badge status-${status.toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(status)}</span></td>
      <td>${formatSchedule(v.scheduledDate, v.scheduledTime)}</td>
      <td>
        <button class="btn btn-sm btn-secondary view-btn" data-ro="${escapeHtml(v.roPo)}">View</button>
        <a href="/shop/schedule.html?ro=${encodeURIComponent(v.roPo)}" class="btn btn-sm btn-primary">Schedule</a>
        ${canCancel ? `<button class="btn btn-sm btn-secondary cancel-btn" data-ro="${escapeHtml(v.roPo)}" style="background: var(--danger);">Cancel</button>` : ''}
      </td>
    </tr>
  `;
  }).join('');

  // Add click handlers
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => showVehicleModal(btn.dataset.ro));
  });

  document.querySelectorAll('.cancel-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCancelModal(btn.dataset.ro);
    });
  });

  // Row click
  document.querySelectorAll('#vehicles-tbody tr').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
      showVehicleModal(row.dataset.ro);
    });
  });
}

// Show vehicle modal
function showVehicleModal(roPo) {
  const vehicle = vehicles.find(v => v.roPo === roPo);
  if (!vehicle) return;

  const content = document.getElementById('vehicle-detail-content');
  content.innerHTML = `
    <div class="detail-grid">
      <div class="detail-item">
        <label>RO/PO</label>
        <span>${escapeHtml(vehicle.roPo)}</span>
      </div>
      <div class="detail-item">
        <label>VIN</label>
        <span>${escapeHtml(vehicle.vin) || '-'}</span>
      </div>
      <div class="detail-item">
        <label>Vehicle</label>
        <span>${escapeHtml(vehicle.vehicle) || '-'}</span>
      </div>
      <div class="detail-item">
        <label>Status</label>
        <span class="status-badge status-${(vehicle.status || 'new').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(vehicle.status || 'New')}</span>
      </div>
      <div class="detail-item">
        <label>Scheduled</label>
        <span>${formatSchedule(vehicle.scheduledDate, vehicle.scheduledTime)}</span>
      </div>
      <div class="detail-item full-width">
        <label>Required Calibrations</label>
        <span>${escapeHtml(vehicle.requiredCalibrations) || 'Pending review'}</span>
      </div>
      <div class="detail-item full-width">
        <label>Notes</label>
        <pre class="notes-display">${escapeHtml(vehicle.notes) || 'No notes'}</pre>
      </div>
    </div>
  `;

  document.getElementById('schedule-vehicle-btn').href = `/shop/schedule.html?ro=${encodeURIComponent(vehicle.roPo)}`;
  vehicleModal.classList.remove('hidden');
}

// Show cancel modal
function showCancelModal(roPo) {
  document.getElementById('cancel-ro').value = roPo;
  document.getElementById('cancel-reason').value = '';
  cancelModal.classList.remove('hidden');
}

// Close modals
function closeModal(modal) {
  modal.classList.add('hidden');
}

// Handle cancel confirmation
async function handleCancel() {
  const roPo = document.getElementById('cancel-ro').value;
  const reason = document.getElementById('cancel-reason').value.trim();

  if (!reason || reason.length < 10) {
    Toast.error('Please provide a reason (minimum 10 characters)');
    return;
  }

  const btn = document.getElementById('confirm-cancel-btn');
  btn.disabled = true;
  btn.textContent = 'Cancelling...';

  try {
    await ShopAPI.cancelVehicle(roPo, reason);
    Toast.success('Appointment cancelled');
    closeModal(cancelModal);
    loadStats();
    loadVehicles();
  } catch (err) {
    Toast.error(err.message || 'Failed to cancel');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cancel Appointment';
  }
}

// Setup event listeners
function setupEventListeners() {
  // Status filter
  statusFilter.addEventListener('change', () => {
    currentStatus = statusFilter.value;
    loadVehicles();
  });

  // Search
  searchBtn.addEventListener('click', () => {
    currentSearch = searchInput.value.trim();
    loadVehicles();
  });

  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      currentSearch = searchInput.value.trim();
      loadVehicles();
    }
  });

  // Refresh
  refreshBtn.addEventListener('click', () => {
    loadStats();
    loadVehicles();
    Toast.success('Dashboard refreshed');
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    ShopAuth.logout();
    window.location.href = '/shop/';
  });

  // Vehicle modal close
  vehicleModal.querySelector('.modal-close').addEventListener('click', () => closeModal(vehicleModal));
  vehicleModal.querySelector('.modal-close-btn').addEventListener('click', () => closeModal(vehicleModal));
  vehicleModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(vehicleModal));

  // Cancel modal
  cancelModal.querySelector('.modal-close').addEventListener('click', () => closeModal(cancelModal));
  cancelModal.querySelector('.modal-close-btn').addEventListener('click', () => closeModal(cancelModal));
  cancelModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(cancelModal));
  document.getElementById('confirm-cancel-btn').addEventListener('click', handleCancel);

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!vehicleModal.classList.contains('hidden')) closeModal(vehicleModal);
      if (!cancelModal.classList.contains('hidden')) closeModal(cancelModal);
    }
  });
}

// Utility functions
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function formatSchedule(dateStr, timeStr) {
  if (!dateStr) return 'Not scheduled';
  if (String(dateStr).includes('1899')) return 'Not scheduled';

  try {
    let date;
    if (String(dateStr).includes('T')) {
      date = new Date(dateStr);
    } else if (String(dateStr).includes('/')) {
      const parts = String(dateStr).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (parts) {
        date = new Date(parts[3], parts[1] - 1, parts[2]);
      }
    } else if (String(dateStr).includes('-')) {
      date = new Date(dateStr + 'T12:00:00');
    }

    if (!date || isNaN(date.getTime())) return 'Not scheduled';

    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    let formatted = date.toLocaleDateString('en-US', options);

    if (timeStr) {
      let timeFormatted = null;
      if (String(timeStr).includes('T')) {
        const timeDate = new Date(timeStr);
        if (!isNaN(timeDate.getTime())) {
          const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
          timeFormatted = timeDate.toLocaleTimeString('en-US', timeOptions);
        }
      } else if (!String(timeStr).includes('1899')) {
        timeFormatted = timeStr;
      }
      if (timeFormatted) {
        formatted += ' ' + timeFormatted;
      }
    }

    return formatted;
  } catch (e) {
    return 'Not scheduled';
  }
}

// Initialize
init();
