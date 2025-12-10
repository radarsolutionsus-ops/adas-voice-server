/**
 * today.js - Tech today's jobs page logic
 */

// Require authentication
TechAuth.requireAuth();

// State
let jobs = [];
let showMineOnly = false;

// Elements
const techNameEl = document.getElementById('tech-name');
const jobsContainer = document.getElementById('jobs-container');
const emptyState = document.getElementById('empty-state');
const statusModal = document.getElementById('status-modal');

// Init
async function init() {
  const user = TechAuth.getUser();
  if (user) {
    techNameEl.textContent = user.techName || user.name || '';
  }

  // Set today's date
  const today = new Date();
  const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  document.getElementById('today-date').textContent = today.toLocaleDateString('en-US', options);

  await loadJobs();
  setupEventListeners();
}

// Load jobs
async function loadJobs() {
  showLoading();

  try {
    jobs = await TechAPI.getTodaySchedule(showMineOnly);
    renderJobs();
  } catch (err) {
    console.error('Failed to load jobs:', err);
    Toast.error('Failed to load today\'s schedule');
    showEmpty();
  }
}

// Show loading
function showLoading() {
  jobsContainer.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading today's schedule...</p>
    </div>
  `;
  emptyState.classList.add('hidden');
}

// Show empty state
function showEmpty() {
  jobsContainer.innerHTML = '';
  emptyState.classList.remove('hidden');
}

// Render jobs
function renderJobs() {
  if (jobs.length === 0) {
    showEmpty();
    return;
  }

  emptyState.classList.add('hidden');

  jobsContainer.innerHTML = jobs.map(job => {
    const status = job.status || 'Scheduled';
    const statusClass = status.toLowerCase().replace(/\s+/g, '-');
    const timeDisplay = formatTime(job.scheduledTime) || 'Flexible';

    return `
      <div class="job-card" data-ro="${escapeHtml(job.roPo)}">
        <div class="job-card-header">
          <div>
            <h3>${escapeHtml(job.roPo)} - ${escapeHtml(job.vehicle) || 'Unknown Vehicle'}</h3>
            <span class="status-badge status-${statusClass}">${escapeHtml(status)}</span>
          </div>
          <div class="job-time">${timeDisplay}</div>
        </div>
        <div class="job-card-body">
          <div class="job-meta">
            <div class="job-meta-item">
              <label>Shop</label>
              <span>${escapeHtml(job.shopName) || '-'}</span>
            </div>
            <div class="job-meta-item">
              <label>VIN</label>
              <span style="font-family: var(--font-mono); font-size: 0.8rem;">${escapeHtml(job.vin) || '-'}</span>
            </div>
            <div class="job-meta-item">
              <label>Technician</label>
              <span>${escapeHtml(job.technician) || 'Not assigned'}</span>
            </div>
            <div class="job-meta-item">
              <label>Calibrations</label>
              <span>${escapeHtml(job.requiredCalibrations) || 'Pending'}</span>
            </div>
          </div>
        </div>
        <div class="job-card-footer">
          <button class="btn btn-sm btn-secondary status-btn" data-ro="${escapeHtml(job.roPo)}">Change Status</button>
          <button class="btn btn-sm btn-secondary arrive-btn" data-ro="${escapeHtml(job.roPo)}">Mark Arrived</button>
          <button class="btn btn-sm btn-secondary start-btn" data-ro="${escapeHtml(job.roPo)}">Start Job</button>
          <button class="btn btn-sm btn-primary complete-btn" data-ro="${escapeHtml(job.roPo)}" style="background: var(--success);">Complete</button>
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners to buttons
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => showStatusModal(btn.dataset.ro));
  });

  document.querySelectorAll('.arrive-btn').forEach(btn => {
    btn.addEventListener('click', () => handleArrive(btn.dataset.ro));
  });

  document.querySelectorAll('.start-btn').forEach(btn => {
    btn.addEventListener('click', () => handleStart(btn.dataset.ro));
  });

  document.querySelectorAll('.complete-btn').forEach(btn => {
    btn.addEventListener('click', () => handleQuickComplete(btn.dataset.ro));
  });
}

// Show status modal
function showStatusModal(roPo) {
  const job = jobs.find(j => j.roPo === roPo);
  document.getElementById('status-modal-ro').textContent = roPo;
  document.getElementById('status-change-ro').value = roPo;
  document.getElementById('status-notes').value = '';
  if (job) {
    document.getElementById('new-status').value = job.status || 'Scheduled';
  }
  statusModal.classList.remove('hidden');
}

// Handle arrive
async function handleArrive(roPo) {
  try {
    await TechAPI.markArrival(roPo);
    Toast.success('Arrival logged');
    loadJobs();
  } catch (err) {
    Toast.error(err.message || 'Failed to log arrival');
  }
}

// Handle start job
async function handleStart(roPo) {
  try {
    await TechAPI.updateStatus(roPo, 'In Progress');
    Toast.success('Job started');
    loadJobs();
  } catch (err) {
    Toast.error(err.message || 'Failed to start job');
  }
}

// Handle quick complete
async function handleQuickComplete(roPo) {
  try {
    await TechAPI.markComplete(roPo);
    Toast.success('Job completed');
    loadJobs();
  } catch (err) {
    Toast.error(err.message || 'Failed to complete job');
  }
}

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
    loadJobs();
  } catch (err) {
    Toast.error(err.message || 'Failed to update status');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update Status';
  }
}

// Close modal
function closeModal(modal) {
  modal.classList.add('hidden');
}

// Setup event listeners
function setupEventListeners() {
  // Toggle buttons
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showMineOnly = btn.dataset.filter === 'mine';
      loadJobs();
    });
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    TechAuth.logout();
    window.location.href = '/tech/';
  });

  // Status modal
  statusModal.querySelector('.modal-close').addEventListener('click', () => closeModal(statusModal));
  statusModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(statusModal));
  statusModal.querySelector('.modal-close-btn').addEventListener('click', () => closeModal(statusModal));
  document.getElementById('confirm-status-btn').addEventListener('click', handleStatusChange);

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !statusModal.classList.contains('hidden')) {
      closeModal(statusModal);
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

function formatTime(timeStr) {
  if (!timeStr) return null;
  if (String(timeStr).includes('1899')) return null;

  try {
    if (String(timeStr).includes('T')) {
      const timeDate = new Date(timeStr);
      if (!isNaN(timeDate.getTime())) {
        return timeDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      }
    } else if (timeStr.includes(':')) {
      const [hours, minutes] = timeStr.split(':');
      const date = new Date();
      date.setHours(parseInt(hours), parseInt(minutes));
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return timeStr;
  } catch {
    return timeStr;
  }
}

// Initialize
init();
