/**
 * dashboard.js - Tech Dashboard (Apple Style)
 */
(function() {
  'use strict';

  let allJobs = [];
  let currentJob = null;
  let currentFilter = 'all';
  let searchTerm = '';
  let pendingAction = null;
  let currentUserRole = null;
  let currentTechName = null;

  document.addEventListener('DOMContentLoaded', async () => {
    if (!initTechPortal()) return;

    // Get user info from token
    const token = Auth.getToken();
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentUserRole = payload.role;
        currentTechName = payload.name || payload.techName || '';
      } catch (e) {
        console.error('[TECH] Error parsing token:', e);
      }
    }

    initializeIcons();
    setupTechCommonHandlers();
    setupFilters();
    setupSearch();
    await loadJobs();
  });

  function initializeIcons() {
    // Header
    if (document.getElementById('logoutIcon')) {
      document.getElementById('logoutIcon').innerHTML = Icons.logout;
    }
    if (document.getElementById('searchIcon')) {
      document.getElementById('searchIcon').innerHTML = Icons.search;
    }

    // Modal icons
    if (document.getElementById('closeModalIcon')) {
      document.getElementById('closeModalIcon').innerHTML = Icons.x;
    }
    if (document.getElementById('statusWrenchIcon')) {
      document.getElementById('statusWrenchIcon').innerHTML = Icons.wrench;
    }
    if (document.getElementById('statusCheckIcon')) {
      document.getElementById('statusCheckIcon').innerHTML = Icons.checkCircle;
    }
    if (document.getElementById('addNoteIcon')) {
      document.getElementById('addNoteIcon').innerHTML = Icons.plus;
    }
  }

  function setupFilters() {
    document.querySelectorAll('.filter-pills .pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentFilter = pill.dataset.status;
        filterAndRenderJobs();
      });
    });
  }

  function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      let debounce;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          searchTerm = e.target.value.trim().toLowerCase();
          filterAndRenderJobs();
        }, 300);
      });
    }
  }

  async function loadJobs() {
    try {
      // Admins see all vehicles, techs see only their assigned vehicles
      const endpoint = currentUserRole === 'admin' ? '/api/tech/vehicles' : '/api/tech/vehicles/mine';
      const response = await TechAPI.get(endpoint);

      if (!response.success) {
        Toast.error(response.error || 'Failed to load jobs');
        return;
      }

      allJobs = response.vehicles || [];

      updateStats();
      renderTodayJobs();
      filterAndRenderJobs();

    } catch (err) {
      console.error('Load error:', err);
      Toast.error('Failed to load jobs');
    }
  }

  function updateStats() {
    const today = new Date().toISOString().split('T')[0];

    const todayJobs = allJobs.filter(job => {
      const jobDate = (job.scheduledDate || '').split('T')[0];
      return jobDate === today;
    });

    const scheduled = allJobs.filter(j => {
      const s = (j.status || '').toLowerCase();
      return s === 'scheduled' || s === 'rescheduled';
    });

    const inProgress = allJobs.filter(j => {
      const s = (j.status || '').toLowerCase();
      return s === 'in progress';
    });

    const completed = allJobs.filter(j => {
      const s = (j.status || '').toLowerCase();
      return s === 'completed';
    });

    document.getElementById('statToday').textContent = todayJobs.length;
    document.getElementById('statScheduled').textContent = scheduled.length;
    document.getElementById('statInProgress').textContent = inProgress.length;
    document.getElementById('statCompleted').textContent = completed.length;
  }

  function renderTodayJobs() {
    const container = document.getElementById('todayJobs');
    const today = new Date().toISOString().split('T')[0];

    const todayJobs = allJobs.filter(job => {
      const jobDate = (job.scheduledDate || '').split('T')[0];
      const status = (job.status || '').toLowerCase();
      return jobDate === today && status !== 'completed';
    });

    document.getElementById('todayCount').textContent = todayJobs.length;

    if (todayJobs.length === 0) {
      container.innerHTML = `
        <div class="empty-state-inline">
          <span class="icon">${Icons.calendar}</span>
          <p>No jobs scheduled for today</p>
        </div>
      `;
      return;
    }

    container.innerHTML = todayJobs.map(job => renderJobCard(job, true)).join('');
  }

  function filterAndRenderJobs() {
    let filtered = [...allJobs];

    // Apply status filter
    if (currentFilter !== 'all') {
      filtered = filtered.filter(j => {
        const jobStatus = (j.status || '').toLowerCase();
        return jobStatus === currentFilter.toLowerCase();
      });
    }

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(j => {
        const ro = (j.roPo || '').toLowerCase();
        const vehicle = (j.vehicle || '').toLowerCase();
        const shop = (j.shopName || '').toLowerCase();
        const vin = (j.vin || '').toLowerCase();
        return ro.includes(searchTerm) || vehicle.includes(searchTerm) ||
               shop.includes(searchTerm) || vin.includes(searchTerm);
      });
    }

    renderAllJobs(filtered);
  }

  function renderAllJobs(jobs) {
    const container = document.getElementById('allJobs');

    if (jobs.length === 0) {
      container.innerHTML = `
        <div class="empty-state-inline">
          <span class="icon">${Icons.car}</span>
          <p>No jobs found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = jobs.map(job => renderJobCard(job)).join('');
  }

  function renderJobCard(job, isToday = false) {
    const time = formatTime(job.scheduledTime);
    const statusClass = getStatusClass(job.status);
    const roPo = escapeHtml(job.roPo || '');

    return `
      <div class="job-card ${isToday ? 'today' : ''}" onclick="openJobModal('${roPo}')">
        <div class="job-main">
          <div class="job-time">${time || '--:--'}</div>
          <div class="job-info">
            <div class="job-ro">RO #${roPo}</div>
            <div class="job-vehicle">${escapeHtml(job.vehicle) || 'Unknown'}</div>
            <div class="job-shop">${escapeHtml(job.shopName) || '-'}</div>
          </div>
        </div>
        <div class="job-meta">
          <span class="status-badge ${statusClass}">${escapeHtml(job.status) || 'New'}</span>
          ${job.requiredCalibrations ? `
            <div class="job-cals">${escapeHtml(truncate(job.requiredCalibrations, 30))}</div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  // Make openJobModal globally accessible
  window.openJobModal = function(roPo) {
    currentJob = allJobs.find(j => j.roPo === roPo);
    if (!currentJob) return;

    const modal = document.getElementById('jobModal');

    // Populate modal
    document.getElementById('modalTitle').textContent = `RO #${currentJob.roPo}`;
    document.getElementById('modalShop').textContent = currentJob.shopName || '-';
    document.getElementById('modalVehicle').textContent = currentJob.vehicle || '-';
    document.getElementById('modalVin').textContent = currentJob.vin || '-';
    document.getElementById('modalSchedule').textContent = formatDateTime(currentJob.scheduledDate, currentJob.scheduledTime);
    document.getElementById('modalCalibrations').textContent = currentJob.requiredCalibrations || 'Not determined';
    document.getElementById('modalNotes').textContent = currentJob.notes || 'No notes';

    // DTCs
    if (currentJob.dtcs) {
      document.getElementById('dtcSection').style.display = 'block';
      document.getElementById('modalDtcs').textContent = currentJob.dtcs;
    } else {
      document.getElementById('dtcSection').style.display = 'none';
    }

    // Documents
    renderModalDocuments(currentJob);

    // Show modal
    modal.classList.add('open');
  };

  function renderModalDocuments(job) {
    const container = document.getElementById('modalDocuments');

    const docs = [
      { name: 'Estimate', url: job.estimatePdf || job.estimate_pdf, icon: 'fileText' },
      { name: 'Pre-Scan', url: job.prescanPdf || job.prescan_pdf || job.preScanPdf, icon: 'clipboard' },
      { name: 'Revv Report', url: job.revvPdf || job.revv_pdf || job.revvReportPdf, icon: 'barChart' },
      { name: 'Post-Scan', url: job.postscanPdf || job.postscan_pdf || job.postScanPdf, icon: 'clipboard' },
      { name: 'Invoice', url: job.invoicePdf || job.invoice_pdf, icon: 'fileText' }
    ];

    container.innerHTML = docs.map(doc => {
      const hasUrl = doc.url && doc.url.startsWith('http');
      const iconSvg = Icons[doc.icon] || Icons.fileText;

      if (hasUrl) {
        return `
          <a href="${doc.url}" target="_blank" class="doc-chip available">
            <span class="icon">${iconSvg}</span>
            ${doc.name}
          </a>
        `;
      } else {
        return `
          <span class="doc-chip unavailable">
            <span class="icon">${iconSvg}</span>
            ${doc.name}
          </span>
        `;
      }
    }).join('');
  }

  // Make closeModal globally accessible
  window.closeModal = function() {
    document.getElementById('jobModal').classList.remove('open');
    currentJob = null;
  };

  // Show confirmation modal before status update
  window.updateStatus = function(newStatus) {
    if (!currentJob) return;

    const isComplete = newStatus === 'Completed';
    const iconClass = isComplete ? 'success' : 'warning';
    const iconSvg = isComplete ? Icons.checkCircle : Icons.wrench;
    const title = isComplete ? 'Mark as Complete?' : 'Start Job?';
    const message = isComplete
      ? `Mark RO #${currentJob.roPo} as completed? This will notify the shop.`
      : `Start working on RO #${currentJob.roPo}?`;

    pendingAction = { type: 'status', status: newStatus };
    showConfirmModal(title, message, iconSvg, iconClass);
  };

  // Actually execute the status update
  async function executeStatusUpdate(newStatus) {
    if (!currentJob) return;

    try {
      const response = await TechAPI.put(`/api/tech/vehicles/${currentJob.roPo}/status`, {
        status: newStatus
      });

      if (response.success) {
        Toast.success(`Status updated to ${newStatus}`);
        closeModal();
        await loadJobs();
      } else {
        Toast.error(response.error || 'Failed to update status');
      }
    } catch (err) {
      Toast.error('Failed to update status');
    }
  }

  // Show confirmation modal
  function showConfirmModal(title, message, iconSvg, iconClass) {
    const modal = document.getElementById('confirmModal');
    const iconEl = document.getElementById('confirmIcon');

    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    iconEl.innerHTML = iconSvg;
    iconEl.className = 'confirm-icon ' + iconClass;

    modal.classList.add('open');
  }

  // Close confirmation modal
  window.closeConfirmModal = function() {
    document.getElementById('confirmModal').classList.remove('open');
    pendingAction = null;
  };

  // Execute the confirmed action
  window.executeConfirmedAction = async function() {
    if (!pendingAction) return;

    closeConfirmModal();

    if (pendingAction.type === 'status') {
      await executeStatusUpdate(pendingAction.status);
    }
  };

  // Make addNote globally accessible
  window.addNote = async function() {
    if (!currentJob) return;

    const noteText = document.getElementById('newNote').value.trim();
    if (!noteText) {
      Toast.error('Please enter a note');
      return;
    }

    try {
      const response = await TechAPI.post(`/api/tech/vehicles/${currentJob.roPo}/notes`, {
        note: noteText
      });

      if (response.success) {
        Toast.success('Note added');
        document.getElementById('newNote').value = '';

        // Refresh job data
        const updated = await TechAPI.get(`/api/tech/vehicles/${currentJob.roPo}`);
        if (updated.success && updated.vehicle) {
          currentJob = updated.vehicle;
          document.getElementById('modalNotes').textContent = currentJob.notes || 'No notes';
        }
      } else {
        Toast.error(response.error || 'Failed to add note');
      }
    } catch (err) {
      Toast.error('Failed to add note');
    }
  };

  // Close modals on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeConfirmModal();
      closeModal();
    }
  });

  // Close modal on backdrop click
  document.getElementById('jobModal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      closeModal();
    }
  });

  // Close confirm modal on backdrop click
  document.getElementById('confirmModal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      closeConfirmModal();
    }
  });

  console.log('[TECH] dashboard.js loaded');
})();
