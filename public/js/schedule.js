/**
 * schedule.js - Schedule page logic
 */

// Require authentication
Auth.requireAuth();

// Get RO from URL
const urlParams = new URLSearchParams(window.location.search);
const roPo = urlParams.get('ro');

if (!roPo) {
  window.location.href = '/dashboard.html';
}

// Elements
const shopNameEl = document.getElementById('shop-name');
const vehicleInfoContent = document.getElementById('vehicle-info-content');
const scheduleForm = document.getElementById('schedule-form');
const prerequisitesList = document.getElementById('prerequisites-list');
const scheduleDate = document.getElementById('schedule-date');
const scheduleTime = document.getElementById('schedule-time');
const scheduleNotes = document.getElementById('schedule-notes');
const submitBtn = document.getElementById('submit-btn');
const errorDiv = document.getElementById('schedule-error');
const errorState = document.getElementById('error-state');

// State
let vehicle = null;
let prerequisites = [];

// Init
async function init() {
  // Set shop name
  const shop = Auth.getShop();
  if (shop) {
    shopNameEl.textContent = shop.name;
  }

  // Set min date to today
  const today = new Date().toISOString().split('T')[0];
  scheduleDate.min = today;
  scheduleDate.value = today;

  // Load data
  await Promise.all([loadVehicle(), loadPrerequisites()]);

  // Setup event listeners
  setupEventListeners();
}

// Load vehicle details
async function loadVehicle() {
  try {
    vehicle = await API.getVehicle(roPo);
    displayVehicle();
    scheduleForm.classList.remove('hidden');
  } catch (err) {
    showError(err.message || 'Vehicle not found');
  }
}

// Display vehicle info
function displayVehicle() {
  vehicleInfoContent.innerHTML = `
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
      <div class="detail-item full-width">
        <label>Required Calibrations</label>
        <span>${escapeHtml(vehicle.requiredCalibrations) || 'None specified'}</span>
      </div>
    </div>
    ${vehicle.scheduledDate ? `
      <div class="current-schedule">
        <p><strong>Current Schedule:</strong> ${escapeHtml(vehicle.scheduledDate)} ${escapeHtml(vehicle.scheduledTime) || ''}</p>
      </div>
    ` : ''}
  `;

  // Pre-fill date/time if already scheduled
  if (vehicle.scheduledDate) {
    // Try to parse the date
    const dateParts = vehicle.scheduledDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateParts) {
      const [, month, day, year] = dateParts;
      const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      scheduleDate.value = isoDate;
    }
  }
  if (vehicle.scheduledTime) {
    // Try to match time to select options
    const timeOptions = Array.from(scheduleTime.options).map(o => o.value);
    if (timeOptions.includes(vehicle.scheduledTime)) {
      scheduleTime.value = vehicle.scheduledTime;
    }
  }
}

// Load prerequisites
async function loadPrerequisites() {
  try {
    prerequisites = await API.getPrerequisites();
    renderPrerequisites();
  } catch (err) {
    console.error('Failed to load prerequisites:', err);
    // Use default prerequisites
    prerequisites = [
      { id: 'bumper', label: 'Bumper/fascia installed' },
      { id: 'sensors', label: 'ADAS sensors mounted' },
      { id: 'coding', label: 'Module coding complete (if applicable)' },
      { id: 'alignment', label: 'Wheel alignment done' },
      { id: 'battery', label: 'Battery charged' }
    ];
    renderPrerequisites();
  }
}

// Render prerequisites checkboxes
function renderPrerequisites() {
  prerequisitesList.innerHTML = prerequisites.map(p => `
    <div class="checkbox-item">
      <input type="checkbox" id="prereq-${p.id}" name="prerequisites" value="${p.id}">
      <label for="prereq-${p.id}">${escapeHtml(p.label)}</label>
    </div>
  `).join('');
}

// Show error
function showError(message) {
  vehicleInfoContent.classList.add('hidden');
  scheduleForm.classList.add('hidden');
  errorState.classList.remove('hidden');
  document.getElementById('error-message').textContent = message;
}

// Setup event listeners
function setupEventListeners() {
  // Form submit
  scheduleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitSchedule();
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    Auth.logout();
    window.location.href = '/';
  });
}

// Submit schedule
async function submitSchedule() {
  const date = scheduleDate.value;
  const time = scheduleTime.value;
  const notes = scheduleNotes.value;

  // Get checked prerequisites
  const checkedPrereqs = Array.from(
    document.querySelectorAll('input[name="prerequisites"]:checked')
  ).map(cb => cb.value);

  // Validate
  if (!date) {
    errorDiv.textContent = 'Please select a date';
    errorDiv.classList.remove('hidden');
    return;
  }

  // Show loading
  submitBtn.disabled = true;
  submitBtn.querySelector('.btn-text').textContent = 'Scheduling...';
  submitBtn.querySelector('.btn-spinner').classList.remove('hidden');
  errorDiv.classList.add('hidden');

  try {
    // Determine if this is a new schedule or reschedule
    const isReschedule = vehicle.scheduledDate && vehicle.status !== 'New';

    if (isReschedule) {
      await API.updateSchedule(roPo, {
        date,
        time,
        notes,
        reason: notes || 'Rescheduled via portal'
      });
    } else {
      await API.scheduleAppointment({
        roPo,
        date,
        time,
        prerequisites: checkedPrereqs,
        notes
      });
    }

    Toast.success('Appointment scheduled successfully!');

    // Redirect to dashboard after short delay
    setTimeout(() => {
      window.location.href = '/dashboard.html';
    }, 1500);
  } catch (err) {
    errorDiv.textContent = err.message || 'Failed to schedule appointment';
    errorDiv.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('.btn-text').textContent = 'Schedule Appointment';
    submitBtn.querySelector('.btn-spinner').classList.add('hidden');
  }
}

// Utility functions
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Initialize
init();
