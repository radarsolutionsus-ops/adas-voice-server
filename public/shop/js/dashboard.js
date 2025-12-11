/**
 * shop/dashboard.js - Shop dashboard with Apple-style vehicle cards
 */

let allVehicles = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize shop portal
  if (!initShopPortal()) return;

  // Setup common handlers (logout, help modal)
  setupCommonHandlers();

  // Setup filter handlers
  setupFilters();

  // Load vehicles
  await loadVehicles();
});

function setupFilters() {
  // Filter tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      filterVehicles(tab.dataset.status);
    });
  });

  // Search
  const searchInput = document.getElementById('searchInput');
  let searchTimeout;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchVehicles(searchInput.value);
    }, 300);
  });
}

async function loadVehicles() {
  const list = document.getElementById('vehicleList');
  const emptyState = document.getElementById('emptyState');

  try {
    const response = await ShopAPI.get('/api/shop/vehicles');

    if (!response.success) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="icon icon-xl">${Icons.alertCircle}</span>
          <h3>Failed to load vehicles</h3>
          <p>Please refresh the page to try again.</p>
        </div>
      `;
      return;
    }

    allVehicles = response.vehicles || [];

    // Update stats
    updateStats(allVehicles);

    // Show vehicles or empty state
    if (allVehicles.length === 0) {
      list.classList.add('hidden');
      emptyState.classList.remove('hidden');
    } else {
      list.classList.remove('hidden');
      emptyState.classList.add('hidden');
      renderVehicles(allVehicles);
    }

  } catch (err) {
    console.error('Load error:', err);
    list.innerHTML = `
      <div class="empty-state">
        <span class="icon icon-xl">${Icons.alertCircle}</span>
        <h3>Failed to load vehicles</h3>
        <p>Please refresh the page to try again.</p>
      </div>
    `;
  }
}

function updateStats(vehicles) {
  document.getElementById('statTotal').textContent = vehicles.length;
  document.getElementById('statScheduled').textContent = vehicles.filter(v =>
    v.status === 'Scheduled' || v.status === 'Rescheduled'
  ).length;
  document.getElementById('statInProgress').textContent = vehicles.filter(v =>
    v.status === 'In Progress'
  ).length;
  document.getElementById('statCompleted').textContent = vehicles.filter(v =>
    v.status === 'Completed'
  ).length;
}

function renderVehicles(vehicles) {
  const list = document.getElementById('vehicleList');

  if (vehicles.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="icon icon-xl">${Icons.filter}</span>
        <h3>No vehicles match your filter</h3>
        <p>Try adjusting your search or filter criteria</p>
      </div>
    `;
    return;
  }

  list.innerHTML = vehicles.map(v => `
    <div class="vehicle-card" data-status="${v.status}" data-ro="${v.roPo}">
      <div class="vehicle-main">
        <div class="vehicle-ro">RO #${escapeHtml(v.roPo)}</div>
        <div class="vehicle-info">
          <div class="vehicle-name">${escapeHtml(v.vehicle || 'Unknown Vehicle')}</div>
          <div class="vehicle-vin">${escapeHtml(v.vin ? '...' + v.vin.slice(-6) : 'No VIN')}</div>
        </div>
        ${v.requiredCalibrations ? `
          <div class="vehicle-calibration">${escapeHtml(v.requiredCalibrations)}</div>
        ` : ''}
      </div>

      ${(v.status === 'Scheduled' || v.status === 'Rescheduled') && v.scheduledDate ? `
        <div class="vehicle-schedule">
          <div class="schedule-date">${formatDate(v.scheduledDate)}</div>
          ${v.scheduledTime ? `<div class="schedule-time">${formatTime(v.scheduledTime)}</div>` : ''}
        </div>
      ` : ''}

      <div class="vehicle-status">
        <span class="status-badge ${getStatusClass(v.status)}">${escapeHtml(v.status || 'New')}</span>
      </div>

      <div class="vehicle-actions">
        <a href="/shop/vehicle.html?ro=${encodeURIComponent(v.roPo)}" class="btn-secondary">
          ${Icons.eye}
          <span>View</span>
        </a>
        ${v.status !== 'Completed' && v.status !== 'In Progress' && v.status !== 'Cancelled' ? `
          <a href="/shop/schedule.html?ro=${encodeURIComponent(v.roPo)}" class="btn-accent">
            ${Icons.calendar}
            <span>${v.status === 'Scheduled' || v.status === 'Rescheduled' ? 'Reschedule' : 'Schedule'}</span>
          </a>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function filterByStatus(status) {
  // Update active tab
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.status === status);
  });
  filterVehicles(status);
}

function filterVehicles(status) {
  if (status === 'all') {
    renderVehicles(allVehicles);
  } else {
    const filtered = allVehicles.filter(v => {
      if (status === 'Scheduled') {
        return v.status === 'Scheduled' || v.status === 'Rescheduled';
      }
      return v.status === status;
    });
    renderVehicles(filtered);
  }
}

function searchVehicles(query) {
  if (!query) {
    renderVehicles(allVehicles);
    return;
  }

  const q = query.toLowerCase();
  const filtered = allVehicles.filter(v =>
    (v.roPo && v.roPo.toLowerCase().includes(q)) ||
    (v.vin && v.vin.toLowerCase().includes(q)) ||
    (v.vehicle && v.vehicle.toLowerCase().includes(q))
  );
  renderVehicles(filtered);
}

// Make filterByStatus available globally for stat card clicks
window.filterByStatus = filterByStatus;
