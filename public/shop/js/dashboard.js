/**
 * shop/dashboard.js - Shop dashboard with card-based vehicle display
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
      list.innerHTML = '<p class="error">Failed to load vehicles. Please refresh the page.</p>';
      return;
    }

    allVehicles = response.vehicles || [];

    // Update stats
    updateStats(allVehicles);

    // Show vehicles or empty state
    if (allVehicles.length === 0) {
      list.style.display = 'none';
      emptyState.style.display = 'block';
    } else {
      list.style.display = 'flex';
      emptyState.style.display = 'none';
      renderVehicles(allVehicles);
    }

  } catch (err) {
    console.error('Load error:', err);
    list.innerHTML = '<p class="error">Failed to load vehicles. Please refresh the page.</p>';
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
      <div class="loading-state">
        <p>No vehicles match your filter</p>
      </div>
    `;
    return;
  }

  list.innerHTML = vehicles.map(v => `
    <div class="vehicle-card" data-status="${v.status}" data-ro="${v.roPo}">
      <div class="vehicle-info">
        <div class="vehicle-header">
          <span class="vehicle-ro">RO #${escapeHtml(v.roPo)}</span>
          <span class="vehicle-status ${getStatusClass(v.status)}">${escapeHtml(v.status || 'New')}</span>
        </div>

        <div class="vehicle-details">
          <span class="vehicle-detail">
            <span class="vehicle-detail-icon">&#128663;</span>
            ${escapeHtml(v.vehicle || 'Unknown Vehicle')}
          </span>
          <span class="vehicle-detail">
            <span class="vehicle-detail-icon">&#128178;</span>
            ${escapeHtml(v.vin ? v.vin.slice(-6) : 'No VIN')}
          </span>
        </div>

        ${v.requiredCalibrations ? `
          <div class="vehicle-calibrations">
            &#128208; ${escapeHtml(v.requiredCalibrations)}
          </div>
        ` : ''}

        ${(v.status === 'Scheduled' || v.status === 'Rescheduled') && v.scheduledDate ? `
          <div class="scheduled-info">
            <span class="icon">&#128197;</span>
            <span class="date">${formatDate(v.scheduledDate)}</span>
            ${v.scheduledTime ? `<span class="time">at ${formatTime(v.scheduledTime)}</span>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="vehicle-actions">
        <a href="/shop/vehicle.html?ro=${encodeURIComponent(v.roPo)}" class="btn-action btn-view">
          View Details
        </a>
        ${v.status !== 'Completed' && v.status !== 'In Progress' && v.status !== 'Cancelled' ? `
          <a href="/shop/schedule.html?ro=${encodeURIComponent(v.roPo)}" class="btn-action btn-schedule">
            ${v.status === 'Scheduled' || v.status === 'Rescheduled' ? 'Reschedule' : 'Schedule'}
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
