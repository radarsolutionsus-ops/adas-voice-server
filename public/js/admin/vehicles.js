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
    await loadTechFilter();
    buildMonthFilter();
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

async function loadTechFilter() {
  try {
    const data = await AdminAPI.get('/api/admin/techs');
    if (!data.success) return;

    const select = document.getElementById('techFilter');
    if (!select) return;

    (data.techs || []).forEach(tech => {
      const option = document.createElement('option');
      option.value = tech.name;
      option.textContent = tech.name;
      select.appendChild(option);
    });
  } catch (err) {
    console.error('Load techs error:', err);
  }
}

function buildMonthFilter() {
  const select = document.getElementById('monthFilter');
  if (!select || allVehicles.length === 0) return;

  const months = new Set();
  allVehicles.forEach(v => {
    const date = v.createdAt || v.scheduledDate;
    if (date && !date.includes('1899')) {
      try {
        const d = new Date(date);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthName = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        months.add(JSON.stringify({ key: monthKey, name: monthName }));
      } catch {}
    }
  });

  const sortedMonths = Array.from(months)
    .map(m => JSON.parse(m))
    .sort((a, b) => b.key.localeCompare(a.key))
    .slice(0, 12);

  sortedMonths.forEach(m => {
    const option = document.createElement('option');
    option.value = m.key;
    option.textContent = m.name;
    select.appendChild(option);
  });
}

function setupFilters() {
  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');
  const shopFilter = document.getElementById('shopFilter');
  const techFilter = document.getElementById('techFilter');
  const monthFilter = document.getElementById('monthFilter');
  const clearBtn = document.getElementById('clearFilters');

  let searchTimeout;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFilters, 300);
  });

  statusFilter?.addEventListener('change', applyFilters);
  shopFilter?.addEventListener('change', applyFilters);
  techFilter?.addEventListener('change', applyFilters);
  monthFilter?.addEventListener('change', applyFilters);

  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    statusFilter.value = '';
    shopFilter.value = '';
    if (techFilter) techFilter.value = '';
    if (monthFilter) monthFilter.value = '';
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
  const tech = (document.getElementById('techFilter')?.value || '').toLowerCase();
  const month = document.getElementById('monthFilter')?.value || '';

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

    // Tech filter
    if (tech) {
      const vTech = (v.technician || v.technicianAssigned || '').toLowerCase();
      if (!vTech.includes(tech)) {
        return false;
      }
    }

    // Month filter
    if (month) {
      const date = v.createdAt || v.scheduledDate;
      if (!date || date.includes('1899')) return false;
      try {
        const d = new Date(date);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthKey !== month) return false;
      } catch {
        return false;
      }
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
          <div class="empty-icon" style="width:64px;height:64px;margin:0 auto 16px;color:var(--text-tertiary);">${Icons.car}</div>
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

    // Normalize field names (GAS returns snake_case, we prefer camelCase)
    const roPoVal = v.roPo || v.ro_po || '';
    const shopName = v.shopName || v.shop_name || '';
    const scheduledDate = v.scheduledDate || v.scheduled_date || '';
    const scheduledTime = v.scheduledTime || v.scheduled_time || '';
    const technician = v.technician || v.technicianAssigned || v.technician_assigned || '';
    const requiredCals = v.requiredCalibrations || v.required_calibrations || '';
    const completedCals = v.completedCalibrations || v.completed_calibrations || '';
    const dtcs = v.dtcs || v.DTCs || '';
    const flowHistory = v.flowHistory || v.flow_history || '';

    // Format scheduled display
    const timeDisplay = scheduledTime ? formatTime(scheduledTime) : 'TBD';
    const scheduleDisplay = scheduledDate
      ? `${formatDate(scheduledDate)} at ${timeDisplay}`
      : null;

    // Build documents section
    const docs = [
      { name: 'Estimate', url: v.estimatePdf || v.estimate_pdf, icon: Icons.fileText },
      { name: 'Pre-Scan', url: v.preScanPdf || v.prescan_pdf, icon: Icons.clipboard },
      { name: 'Revv Report', url: v.revvReportPdf || v.revv_pdf || v.revvPdf, icon: Icons.barChart },
      { name: 'Post-Scan', url: v.postScanPdf || v.postscan_pdf, icon: Icons.clipboard },
      { name: 'Invoice', url: v.invoicePdf || v.invoice_pdf, icon: Icons.receipt }
    ];

    // Render flow history entries
    const flowEntries = flowHistory ? flowHistory.split('\n').filter(e => e.trim()) : [];

    modalBody.innerHTML = `
      <!-- Header: Vehicle + Status -->
      <div style="display:flex;justify-content:space-between;align-items:start;gap:16px;margin-bottom:16px;">
        <div>
          <h2 style="font-size:20px;font-weight:600;margin-bottom:4px;">${escapeHtml(v.vehicle || 'Unknown Vehicle')}</h2>
          <p style="color:var(--text-secondary);font-size:14px;">${escapeHtml(shopName || 'Unknown Shop')}</p>
        </div>
        <span class="status-badge ${getStatusClass(v.status)}">${escapeHtml(v.status || 'New')}</span>
      </div>

      <!-- Scheduled Banner (blue bar) -->
      ${scheduleDisplay ? `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:rgba(0,113,227,0.08);border-radius:8px;margin-bottom:20px;">
          <span style="color:var(--accent);">${Icons.calendar}</span>
          <strong>${escapeHtml(scheduleDisplay)}</strong>
          ${technician ? `<span style="margin-left:auto;color:var(--text-secondary);">Tech: ${escapeHtml(technician)}</span>` : ''}
        </div>
      ` : ''}

      <!-- Two Column Grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
        <!-- Left Column: Vehicle Info -->
        <div>
          <div class="modal-field">
            <label class="form-label">VIN</label>
            <p style="font-family:monospace;font-size:13px;">${escapeHtml(v.vin || '-')}</p>
          </div>
          <div class="modal-field">
            <label class="form-label">Required Calibrations</label>
            <p>${escapeHtml(requiredCals || 'Not determined')}</p>
          </div>
          ${completedCals ? `
            <div class="modal-field">
              <label class="form-label">Completed Calibrations</label>
              <p style="color:var(--success);">${escapeHtml(completedCals)}</p>
            </div>
          ` : ''}
          ${dtcs ? `
            <div class="modal-field">
              <label class="form-label">DTCs</label>
              <p style="color:var(--warning);">${escapeHtml(dtcs)}</p>
            </div>
          ` : ''}
          <div class="modal-field">
            <label class="form-label">Notes</label>
            <div class="notes-box">${escapeHtml(v.notes || 'No notes')}</div>
          </div>
        </div>

        <!-- Right Column: Documents -->
        <div>
          <label class="form-label">Documents</label>
          <div class="doc-cards-grid">
            ${docs.map(d => {
              const hasUrl = d.url && d.url.startsWith('http');
              return `
                <div class="doc-card ${hasUrl ? 'available' : 'unavailable'}" ${hasUrl ? `onclick="window.open('${d.url}', '_blank')"` : ''}>
                  <div class="doc-card-icon">${d.icon}</div>
                  <div class="doc-card-name">${d.name}</div>
                  <div class="doc-card-status">${hasUrl ? 'View' : 'N/A'}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- Activity Log (Collapsible) -->
      ${flowEntries.length > 0 ? `
        <details style="margin-bottom:20px;">
          <summary style="cursor:pointer;font-weight:500;margin-bottom:8px;">Activity Log (${flowEntries.length} entries)</summary>
          <div class="activity-log" style="max-height:150px;overflow-y:auto;">
            ${flowEntries.map(entry => {
              const parts = entry.match(/^(\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}[ap]?)\s+(\w+)\s+(.*)$/i);
              if (parts) {
                return `<div class="activity-entry">
                  <span class="activity-time">${escapeHtml(parts[1])}</span>
                  <span class="status-badge ${getStatusClass(parts[2])}" style="font-size:10px;padding:2px 6px;">${escapeHtml(parts[2])}</span>
                  <span class="activity-text">${escapeHtml(parts[3])}</span>
                </div>`;
              }
              return `<div class="activity-entry"><span class="activity-text">${escapeHtml(entry)}</span></div>`;
            }).join('')}
          </div>
        </details>
      ` : ''}

      <!-- Reassign Action -->
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-bottom:16px;">
        <label class="form-label">Technician Assignment</label>
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:14px;">Currently: <strong>${escapeHtml(technician || 'Unassigned')}</strong></span>
          <button class="btn btn-sm btn-secondary" onclick="openReassignModal('${roPoVal}', '${escapeHtml(technician || '')}')">
            Reassign
          </button>
        </div>
      </div>

      <!-- Status Change Actions -->
      <div style="border-top:1px solid var(--border);padding-top:16px;">
        <label class="form-label">Change Status</label>
        <div class="status-buttons">
          <button class="btn btn-sm btn-secondary" onclick="updateStatus('${roPoVal}','New')">New</button>
          <button class="btn btn-sm btn-secondary" onclick="updateStatus('${roPoVal}','Ready')">Ready</button>
          <button class="btn btn-sm btn-secondary" onclick="updateStatus('${roPoVal}','Scheduled')">Scheduled</button>
          <button class="btn btn-sm btn-secondary" onclick="updateStatus('${roPoVal}','In Progress')">In Progress</button>
          <button class="btn btn-sm btn-success" onclick="updateStatus('${roPoVal}','Completed')">Completed</button>
          <button class="btn btn-sm btn-danger" onclick="updateStatus('${roPoVal}','Cancelled')">Cancelled</button>
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

// Reassign modal functions
let reassignRoPo = null;
let allTechs = [];

async function loadTechsForReassign() {
  if (allTechs.length > 0) return;

  try {
    const data = await AdminAPI.get('/api/admin/techs');
    if (data.success) {
      allTechs = data.techs || [];
    }
  } catch (err) {
    console.error('Failed to load techs:', err);
  }
}

async function openReassignModal(roPo, currentTech) {
  reassignRoPo = roPo;

  // Load techs if not already loaded
  await loadTechsForReassign();

  // Populate tech select
  const select = document.getElementById('reassignTechSelect');
  select.innerHTML = '<option value="">Select technician...</option>';
  allTechs.forEach(tech => {
    const option = document.createElement('option');
    option.value = tech.name;
    option.textContent = tech.name;
    if (tech.name === currentTech) {
      option.disabled = true;
      option.textContent += ' (current)';
    }
    select.appendChild(option);
  });

  document.getElementById('reassignRO').textContent = `RO #${roPo}`;
  document.getElementById('reassignReason').value = '';
  document.getElementById('reassignStatus').textContent = '';
  document.getElementById('reassignModal').style.display = 'flex';
}

function closeReassignModal() {
  document.getElementById('reassignModal').style.display = 'none';
  reassignRoPo = null;
}

async function submitReassign() {
  const newTech = document.getElementById('reassignTechSelect').value;
  const reason = document.getElementById('reassignReason').value.trim();
  const statusEl = document.getElementById('reassignStatus');

  if (!newTech) {
    statusEl.textContent = 'Please select a technician';
    statusEl.style.color = 'var(--danger)';
    return;
  }

  statusEl.textContent = 'Reassigning...';
  statusEl.style.color = 'var(--text-secondary)';

  try {
    const data = await AdminAPI.post('/api/admin/reassign', {
      roPo: reassignRoPo,
      newTech: newTech,
      reason: reason
    });

    if (data.success) {
      statusEl.textContent = 'Reassigned successfully!';
      statusEl.style.color = 'var(--success)';

      // Close modals and refresh
      setTimeout(() => {
        closeReassignModal();
        closeModal();
        loadVehicles();
        applyFilters();
      }, 1000);
    } else {
      statusEl.textContent = 'Failed: ' + (data.error || 'Unknown error');
      statusEl.style.color = 'var(--danger)';
    }
  } catch (err) {
    console.error('Reassign error:', err);
    statusEl.textContent = 'Failed to reassign';
    statusEl.style.color = 'var(--danger)';
  }
}

// Make functions available globally
window.showVehicleDetail = showVehicleDetail;
window.updateStatus = updateStatus;
window.closeModal = closeModal;
window.openReassignModal = openReassignModal;
window.closeReassignModal = closeReassignModal;
window.submitReassign = submitReassign;
