/**
 * admin/vehicles.js - Vehicle management for admin portal
 */

let allVehicles = [];
let filteredVehicles = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Wait for admin-common.js to initialize
  setTimeout(async () => {
    await loadVehicles();
    await loadShopFilter();
    setupFilters();
    applyUrlFilters();
  }, 100);
});

async function loadVehicles() {
  try {
    const data = await AdminAPI.get('/api/admin/vehicles');

    if (!data.success) {
      console.error('Failed to load vehicles:', data.error);
      return;
    }

    allVehicles = data.rows || [];
    filteredVehicles = [...allVehicles];
    renderVehicles(filteredVehicles);

  } catch (err) {
    console.error('Load vehicles error:', err);
    document.getElementById('vehiclesList').innerHTML = `
      <tr><td colspan="7" style="text-align:center;padding:48px;color:var(--danger);">
        Failed to load vehicles. Please refresh the page.
      </td></tr>
    `;
  }
}

async function loadShopFilter() {
  try {
    const data = await AdminAPI.get('/api/admin/shops');
    if (!data.success) return;

    const select = document.getElementById('shopFilter');
    data.shops.forEach(shop => {
      const option = document.createElement('option');
      option.value = shop.sheetName || shop.name;
      option.textContent = shop.name;
      select.appendChild(option);
    });
  } catch (err) {
    console.error('Load shops error:', err);
  }
}

function setupFilters() {
  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');
  const shopFilter = document.getElementById('shopFilter');
  const clearBtn = document.getElementById('clearFilters');

  let searchTimeout;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFilters, 300);
  });

  statusFilter?.addEventListener('change', applyFilters);
  shopFilter?.addEventListener('change', applyFilters);

  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    statusFilter.value = '';
    shopFilter.value = '';
    window.history.replaceState({}, '', '/admin/vehicles.html');
    applyFilters();
  });
}

function applyUrlFilters() {
  const params = new URLSearchParams(window.location.search);

  const status = params.get('status');
  const shop = params.get('shop');
  const ro = params.get('ro');

  if (status) {
    document.getElementById('statusFilter').value = status;
  }
  if (shop) {
    document.getElementById('shopFilter').value = shop;
  }
  if (ro) {
    document.getElementById('searchInput').value = ro;
  }

  applyFilters();
}

function applyFilters() {
  const search = document.getElementById('searchInput').value.toLowerCase().trim();
  const status = document.getElementById('statusFilter').value;
  const shop = document.getElementById('shopFilter').value.toLowerCase();

  filteredVehicles = allVehicles.filter(v => {
    // Search filter
    if (search) {
      const ro = (v.roPo || '').toLowerCase();
      const vin = (v.vin || '').toLowerCase();
      const vehicle = (v.vehicle || '').toLowerCase();
      if (!ro.includes(search) && !vin.includes(search) && !vehicle.includes(search)) {
        return false;
      }
    }

    // Status filter
    if (status && (v.status || '').toLowerCase() !== status.toLowerCase()) {
      return false;
    }

    // Shop filter
    if (shop && !(v.shopName || '').toLowerCase().includes(shop)) {
      return false;
    }

    return true;
  });

  renderVehicles(filteredVehicles);
}

function renderVehicles(vehicles) {
  const tbody = document.getElementById('vehiclesList');
  const countEl = document.getElementById('resultCount');

  countEl.textContent = `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''}`;

  if (vehicles.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="7" style="text-align:center;padding:48px;">
        <div class="empty-state">
          <div class="empty-icon">&#128663;</div>
          <h3>No vehicles found</h3>
          <p>Try adjusting your filters</p>
        </div>
      </td></tr>
    `;
    return;
  }

  tbody.innerHTML = vehicles.map(v => `
    <tr class="clickable" onclick="showVehicleDetail('${escapeHtml(v.roPo)}')">
      <td><strong>${escapeHtml(v.roPo)}</strong></td>
      <td>${escapeHtml(v.vehicle || '-')}</td>
      <td>${escapeHtml(v.shopName || '-')}</td>
      <td><span class="status-badge ${getStatusClass(v.status)}">${escapeHtml(v.status || 'New')}</span></td>
      <td>${v.scheduledDate ? formatDate(v.scheduledDate) : '-'}</td>
      <td>${escapeHtml(v.technician || v.technicianAssigned || '-')}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();showVehicleDetail('${escapeHtml(v.roPo)}')">View</button>
      </td>
    </tr>
  `).join('');
}

async function showVehicleDetail(roPo) {
  const modal = document.getElementById('vehicleModal');
  const modalBody = document.getElementById('modalBody');
  const modalTitle = document.getElementById('modalTitle');

  modal.style.display = 'flex';
  modalTitle.textContent = `RO #${roPo}`;
  modalBody.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const data = await AdminAPI.get(`/api/admin/vehicles/${encodeURIComponent(roPo)}`);

    if (!data.success) {
      modalBody.innerHTML = `<p style="color:var(--danger);">Failed to load vehicle: ${data.error}</p>`;
      return;
    }

    const v = data.vehicle;
    modalBody.innerHTML = `
      <div style="display:grid;gap:16px;">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
          <div>
            <label class="form-label">RO/PO</label>
            <p style="font-weight:600;">${escapeHtml(v.roPo)}</p>
          </div>
          <div>
            <label class="form-label">Status</label>
            <p><span class="status-badge ${getStatusClass(v.status)}">${escapeHtml(v.status || 'New')}</span></p>
          </div>
        </div>

        <div>
          <label class="form-label">Vehicle</label>
          <p>${escapeHtml(v.vehicle || '-')}</p>
        </div>

        <div>
          <label class="form-label">VIN</label>
          <p style="font-family:monospace;">${escapeHtml(v.vin || '-')}</p>
        </div>

        <div>
          <label class="form-label">Shop</label>
          <p>${escapeHtml(v.shopName || '-')}</p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
          <div>
            <label class="form-label">Scheduled Date</label>
            <p>${v.scheduledDate ? formatDate(v.scheduledDate) : '-'}</p>
          </div>
          <div>
            <label class="form-label">Scheduled Time</label>
            <p>${v.scheduledTime ? formatTime(v.scheduledTime) : '-'}</p>
          </div>
        </div>

        <div>
          <label class="form-label">Technician</label>
          <p>${escapeHtml(v.technician || v.technicianAssigned || 'Unassigned')}</p>
        </div>

        <div>
          <label class="form-label">Required Calibrations</label>
          <p>${escapeHtml(v.requiredCalibrations || '-')}</p>
        </div>

        <div>
          <label class="form-label">Notes</label>
          <p style="white-space:pre-wrap;background:var(--bg);padding:12px;border-radius:8px;max-height:150px;overflow-y:auto;">${escapeHtml(v.notes || 'No notes')}</p>
        </div>

        ${v.estimatePdf || v.revvReportPdf || v.invoicePdf ? `
          <div>
            <label class="form-label">Documents</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${v.estimatePdf ? `<a href="${v.estimatePdf}" target="_blank" class="btn btn-sm btn-secondary">Estimate</a>` : ''}
              ${v.revvReportPdf ? `<a href="${v.revvReportPdf}" target="_blank" class="btn btn-sm btn-secondary">Revv Report</a>` : ''}
              ${v.postScanPdf ? `<a href="${v.postScanPdf}" target="_blank" class="btn btn-sm btn-secondary">Post Scan</a>` : ''}
              ${v.invoicePdf ? `<a href="${v.invoicePdf}" target="_blank" class="btn btn-sm btn-secondary">Invoice</a>` : ''}
            </div>
          </div>
        ` : ''}

        <div style="border-top:1px solid var(--border);padding-top:16px;">
          <label class="form-label">Change Status</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-secondary" onclick="updateStatus('${v.roPo}','New')">New</button>
            <button class="btn btn-sm btn-secondary" onclick="updateStatus('${v.roPo}','Ready')">Ready</button>
            <button class="btn btn-sm btn-secondary" onclick="updateStatus('${v.roPo}','Scheduled')">Scheduled</button>
            <button class="btn btn-sm btn-secondary" onclick="updateStatus('${v.roPo}','In Progress')">In Progress</button>
            <button class="btn btn-sm btn-success" onclick="updateStatus('${v.roPo}','Completed')">Completed</button>
            <button class="btn btn-sm btn-danger" onclick="updateStatus('${v.roPo}','Cancelled')">Cancelled</button>
          </div>
        </div>
      </div>
    `;

  } catch (err) {
    console.error('Load vehicle detail error:', err);
    modalBody.innerHTML = `<p style="color:var(--danger);">Failed to load vehicle details.</p>`;
  }
}

async function updateStatus(roPo, newStatus) {
  if (!confirm(`Change status to "${newStatus}"?`)) return;

  try {
    const data = await AdminAPI.put(`/api/admin/vehicles/${encodeURIComponent(roPo)}/status`, {
      status: newStatus
    });

    if (data.success) {
      closeModal();
      await loadVehicles();
      applyFilters();
    } else {
      alert('Failed to update status: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Update status error:', err);
    alert('Failed to update status');
  }
}

function closeModal() {
  document.getElementById('vehicleModal').style.display = 'none';
}

// Close modal on overlay click
document.getElementById('vehicleModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'vehicleModal') closeModal();
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Make functions available globally
window.showVehicleDetail = showVehicleDetail;
window.updateStatus = updateStatus;
window.closeModal = closeModal;
