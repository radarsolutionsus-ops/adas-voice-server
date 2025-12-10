/**
 * dashboard.js - Dashboard page logic
 */

// Require authentication
Auth.requireAuth();

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

// Init
async function init() {
  // Set shop name
  const shop = Auth.getShop();
  if (shop) {
    shopNameEl.textContent = shop.name;
  }

  // Load data
  await Promise.all([loadStats(), loadVehicles()]);

  // Set up event listeners
  setupEventListeners();
}

// Load stats
async function loadStats() {
  try {
    const stats = await API.getStats();
    document.getElementById('stat-total').textContent = stats.total || 0;
    document.getElementById('stat-new').textContent = stats.new || 0;
    document.getElementById('stat-ready').textContent = stats.ready || 0;
    document.getElementById('stat-scheduled').textContent = stats.scheduled || 0;
    document.getElementById('stat-progress').textContent = stats.inProgress || 0;
    document.getElementById('stat-completed').textContent = stats.completed || 0;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// Load vehicles
async function loadVehicles() {
  showLoading();

  try {
    vehicles = await API.getVehicles({
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

  vehiclesTbody.innerHTML = vehicles.map(v => `
    <tr data-ro="${escapeHtml(v.roPo)}">
      <td><strong>${escapeHtml(v.roPo)}</strong></td>
      <td class="vin-col">${escapeHtml(v.vin) || '-'}</td>
      <td>${escapeHtml(v.vehicle) || '-'}</td>
      <td class="cals-col">${escapeHtml(truncate(v.requiredCalibrations, 30)) || '-'}</td>
      <td><span class="status-badge status-${(v.status || 'new').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(v.status || 'New')}</span></td>
      <td>${formatSchedule(v.scheduledDate, v.scheduledTime)}</td>
      <td>
        <button class="btn btn-sm btn-secondary view-btn" data-ro="${escapeHtml(v.roPo)}">View</button>
        <a href="/schedule.html?ro=${encodeURIComponent(v.roPo)}" class="btn btn-sm btn-primary">Schedule</a>
      </td>
    </tr>
  `).join('');

  // Add click handlers for view buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => showVehicleModal(btn.dataset.ro));
  });

  // Add row click handlers
  document.querySelectorAll('#vehicles-tbody tr').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      // Don't trigger if clicking a button or link
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
        <label>Technician</label>
        <span>${escapeHtml(vehicle.technician) || 'Not assigned'}</span>
      </div>
      <div class="detail-item">
        <label>Scheduled</label>
        <span>${formatSchedule(vehicle.scheduledDate, vehicle.scheduledTime)}</span>
      </div>
      <div class="detail-item full-width">
        <label>Required Calibrations</label>
        <span>${escapeHtml(vehicle.requiredCalibrations) || 'None specified'}</span>
      </div>
      <div class="detail-item full-width">
        <label>DTCs</label>
        <span>${escapeHtml(vehicle.dtcs) || 'None'}</span>
      </div>
      <div class="detail-item full-width">
        <label>Notes</label>
        <pre class="notes-display">${escapeHtml(vehicle.notes) || 'No notes'}</pre>
      </div>
    </div>
  `;

  document.getElementById('schedule-vehicle-btn').href = `/schedule.html?ro=${encodeURIComponent(vehicle.roPo)}`;

  vehicleModal.classList.remove('hidden');
}

// Close modal
function closeModal() {
  vehicleModal.classList.add('hidden');
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
    Auth.logout();
    window.location.href = '/';
  });

  // Modal close
  vehicleModal.querySelector('.modal-close').addEventListener('click', closeModal);
  vehicleModal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
  vehicleModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);

  // Close modal on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !vehicleModal.classList.contains('hidden')) {
      closeModal();
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

function formatSchedule(date, time) {
  if (!date) return 'Not scheduled';
  return time ? `${date} ${time}` : date;
}

// Initialize
init();
