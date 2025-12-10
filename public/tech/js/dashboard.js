/**
 * dashboard.js - Tech dashboard page logic
 */

// Require authentication
TechAuth.requireAuth();

// State
let vehicles = [];
let currentTab = 'all';
let currentStatus = 'all';
let currentSearch = '';
let currentShop = '';

// Elements
const techNameEl = document.getElementById('tech-name');
const vehiclesTbody = document.getElementById('vehicles-tbody');
const statusFilter = document.getElementById('status-filter');
const shopFilter = document.getElementById('shop-filter');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const refreshBtn = document.getElementById('refresh-btn');
const emptyState = document.getElementById('empty-state');
const tableContainer = document.querySelector('.table-container');
const vehicleModal = document.getElementById('vehicle-modal');
const statusModal = document.getElementById('status-modal');
const completeModal = document.getElementById('complete-modal');

// Init
async function init() {
  const user = TechAuth.getUser();
  if (user) {
    techNameEl.textContent = user.techName || user.name || '';
  }

  await Promise.all([loadStats(), loadVehicles()]);
  setupEventListeners();
}

// Load stats
async function loadStats() {
  try {
    const stats = await TechAPI.getStats();
    document.getElementById('stat-today').textContent = stats.todayTotal || 0;
    document.getElementById('stat-my-jobs').textContent = stats.myAssigned || 0;
    document.getElementById('stat-new').textContent = stats.byStatus?.new || 0;
    document.getElementById('stat-ready').textContent = stats.byStatus?.ready || 0;
    document.getElementById('stat-scheduled').textContent = stats.byStatus?.scheduled || 0;
    document.getElementById('stat-completed').textContent = stats.byStatus?.completed || 0;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// Load vehicles
async function loadVehicles() {
  showLoading();

  try {
    if (currentTab === 'mine') {
      vehicles = await TechAPI.getMyVehicles({
        status: currentStatus !== 'all' ? currentStatus : undefined
      });
    } else {
      vehicles = await TechAPI.getVehicles({
        status: currentStatus !== 'all' ? currentStatus : undefined,
        search: currentSearch || undefined,
        shop: currentShop || undefined
      });
    }

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
    const statusClass = status.toLowerCase().replace(/\s+/g, '-');

    return `
    <tr data-ro="${escapeHtml(v.roPo)}" data-status="${escapeHtml(status)}">
      <td><strong>${escapeHtml(v.roPo)}</strong></td>
      <td>${escapeHtml(v.shopName) || '-'}</td>
      <td>${escapeHtml(v.vehicle) || '-'}</td>
      <td class="cals-col">${escapeHtml(truncate(v.requiredCalibrations, 25)) || '-'}</td>
      <td><span class="status-badge status-${statusClass}">${escapeHtml(status)}</span></td>
      <td>${formatSchedule(v.scheduledDate, v.scheduledTime)}</td>
      <td>
        <button class="btn btn-sm btn-secondary view-btn" data-ro="${escapeHtml(v.roPo)}">View</button>
        <button class="btn btn-sm btn-secondary status-btn" data-ro="${escapeHtml(v.roPo)}">Status</button>
        ${status.toLowerCase() !== 'completed' ? `<button class="btn btn-sm btn-primary complete-btn" data-ro="${escapeHtml(v.roPo)}" style="background: var(--success);">Complete</button>` : ''}
      </td>
    </tr>
  `;
  }).join('');

  // Add click handlers
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => showVehicleModal(btn.dataset.ro));
  });

  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showStatusModal(btn.dataset.ro);
    });
  });

  document.querySelectorAll('.complete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCompleteModal(btn.dataset.ro);
    });
  });

  // Row click
  document.querySelectorAll('#vehicles-tbody tr').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
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
        <label>Shop</label>
        <span>${escapeHtml(vehicle.shopName) || '-'}</span>
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
        <span>${escapeHtml(vehicle.requiredCalibrations) || 'Pending review'}</span>
      </div>
      <div class="detail-item full-width">
        <label>Notes</label>
        <pre class="notes-display">${escapeHtml(vehicle.notes) || 'No notes'}</pre>
      </div>
    </div>
    <div class="detail-actions">
      <div class="quick-actions">
        <button class="btn btn-sm btn-secondary" onclick="showStatusModal('${escapeHtml(vehicle.roPo)}'); closeModal(vehicleModal);">Change Status</button>
        <button class="btn btn-sm btn-secondary" onclick="handleQuickArrive('${escapeHtml(vehicle.roPo)}')">Mark Arrived</button>
        <button class="btn btn-sm btn-primary" onclick="showCompleteModal('${escapeHtml(vehicle.roPo)}'); closeModal(vehicleModal);" style="background: var(--success);">Complete Job</button>
      </div>
    </div>
  `;

  vehicleModal.classList.remove('hidden');
}

// Show status modal
function showStatusModal(roPo) {
  const vehicle = vehicles.find(v => v.roPo === roPo);
  document.getElementById('status-modal-ro').textContent = roPo;
  document.getElementById('status-change-ro').value = roPo;
  document.getElementById('status-notes').value = '';
  if (vehicle) {
    document.getElementById('new-status').value = vehicle.status || 'New';
  }
  statusModal.classList.remove('hidden');
}

// Show complete modal
function showCompleteModal(roPo) {
  document.getElementById('complete-modal-ro').textContent = roPo;
  document.getElementById('complete-change-ro').value = roPo;
  document.getElementById('completed-cals').value = '';
  document.getElementById('complete-notes').value = '';
  completeModal.classList.remove('hidden');
}

// Handle quick arrive
async function handleQuickArrive(roPo) {
  try {
    await TechAPI.markArrival(roPo);
    Toast.success('Arrival logged');
    loadVehicles();
    loadStats();
  } catch (err) {
    Toast.error(err.message || 'Failed to log arrival');
  }
}
window.handleQuickArrive = handleQuickArrive;

// Handle status change
async function handleStatusChange() {
  const roPo = document.getElementById('status-change-ro').value;
  const status = document.getElementById('new-status').value;
  const notes = document.getElementById('status-notes').value.trim();

  const btn = document.getElementById('confirm-status-btn');
  btn.disabled = true;
  btn.textContent = 'Updating...';

  try {
    await TechAPI.updateStatus(roPo, status, notes || null);
    Toast.success(`Status updated to ${status}`);
    closeModal(statusModal);
    loadVehicles();
    loadStats();
  } catch (err) {
    Toast.error(err.message || 'Failed to update status');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update Status';
  }
}

// Handle complete
async function handleComplete() {
  const roPo = document.getElementById('complete-change-ro').value;
  const cals = document.getElementById('completed-cals').value.trim();
  const notes = document.getElementById('complete-notes').value.trim();

  const btn = document.getElementById('confirm-complete-btn');
  btn.disabled = true;
  btn.textContent = 'Completing...';

  try {
    await TechAPI.markComplete(roPo, cals || null, notes || null);
    Toast.success('Job marked as complete');
    closeModal(completeModal);
    loadVehicles();
    loadStats();
  } catch (err) {
    Toast.error(err.message || 'Failed to complete job');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Mark Complete';
  }
}

// Close modal
function closeModal(modal) {
  modal.classList.add('hidden');
}
window.closeModal = closeModal;
window.showStatusModal = showStatusModal;
window.showCompleteModal = showCompleteModal;

// Setup event listeners
function setupEventListeners() {
  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      loadVehicles();
    });
  });

  // Status filter
  statusFilter.addEventListener('change', () => {
    currentStatus = statusFilter.value;
    loadVehicles();
  });

  // Shop filter
  let shopDebounce;
  shopFilter.addEventListener('input', () => {
    clearTimeout(shopDebounce);
    shopDebounce = setTimeout(() => {
      currentShop = shopFilter.value.trim();
      loadVehicles();
    }, 300);
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
    TechAuth.logout();
    window.location.href = '/tech/';
  });

  // Modal close handlers
  [vehicleModal, statusModal, completeModal].forEach(modal => {
    modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal));
    modal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(modal));
    const closeBtn = modal.querySelector('.modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => closeModal(modal));
  });

  // Status confirm
  document.getElementById('confirm-status-btn').addEventListener('click', handleStatusChange);

  // Complete confirm
  document.getElementById('confirm-complete-btn').addEventListener('click', handleComplete);

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      [vehicleModal, statusModal, completeModal].forEach(modal => {
        if (!modal.classList.contains('hidden')) closeModal(modal);
      });
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

    if (timeStr && !String(timeStr).includes('1899')) {
      if (String(timeStr).includes('T')) {
        const timeDate = new Date(timeStr);
        if (!isNaN(timeDate.getTime())) {
          const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
          formatted += ' ' + timeDate.toLocaleTimeString('en-US', timeOptions);
        }
      } else {
        formatted += ' ' + timeStr;
      }
    }

    return formatted;
  } catch (e) {
    return 'Not scheduled';
  }
}

// Initialize
init();
