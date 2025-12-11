/**
 * dashboard-new.js - Tech Dashboard (Apple-style)
 */
(function() {
  'use strict';

  let allJobs = [];
  let currentJob = null;
  let currentFilter = 'all';

  document.addEventListener('DOMContentLoaded', async () => {
    if (!initTechPortal()) return;

    initializeIcons();
    setupTechCommonHandlers();
    setupFilters();
    await loadJobs();
  });

  function initializeIcons() {
    // Header
    if (document.getElementById('logoutIcon')) {
      document.getElementById('logoutIcon').innerHTML = Icons.logout;
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
        filterJobs(currentFilter);
      });
    });
  }

  async function loadJobs() {
    try {
      const response = await TechAPI.get('/api/tech/vehicles');

      if (!response.success) {
        Toast.error(response.error || 'Failed to load jobs');
        return;
      }

      allJobs = response.vehicles || [];

      renderTodayJobs();
      renderAllJobs(allJobs);

    } catch (err) {
      console.error('Load error:', err);
      Toast.error('Failed to load jobs');
    }
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
            <div class="job-cals">${escapeHtml(job.requiredCalibrations)}</div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function filterJobs(status) {
    if (status === 'all') {
      renderAllJobs(allJobs);
    } else {
      const filtered = allJobs.filter(j => {
        const jobStatus = (j.status || '').toLowerCase();
        return jobStatus === status.toLowerCase();
      });
      renderAllJobs(filtered);
    }
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

  // Make updateStatus globally accessible
  window.updateStatus = async function(newStatus) {
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

  // Close modal on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  });

  // Close modal on backdrop click
  document.getElementById('jobModal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      closeModal();
    }
  });

  console.log('[TECH] dashboard-new.js loaded');
})();
