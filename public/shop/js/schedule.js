/**
 * schedule.js - Shop scheduling page logic
 */

// Require authentication
ShopAuth.requireAuth();

// Get RO from URL
const urlParams = new URLSearchParams(window.location.search);
const roPo = urlParams.get('ro');

if (!roPo) {
  window.location.href = '/shop/dashboard.html';
}

// State
let vehicle = null;

// Elements
const shopNameEl = document.getElementById('shop-name');
const scheduleForm = document.getElementById('schedule-form');
const scheduleBtn = document.getElementById('schedule-btn');
const formError = document.getElementById('form-error');
const successModal = document.getElementById('success-modal');

// Init
async function init() {
  const user = ShopAuth.getUser();
  if (user) {
    shopNameEl.textContent = user.shopName || user.name || '';
  }

  // Set minimum date to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('schedule-date').setAttribute('min', today);

  await loadVehicle();
  setupEventListeners();
}

async function loadVehicle() {
  try {
    vehicle = await ShopAPI.getVehicle(roPo);
    renderVehicleInfo();
  } catch (err) {
    console.error('Failed to load vehicle:', err);
    Toast.error('Failed to load vehicle');
    setTimeout(() => {
      window.location.href = '/shop/dashboard.html';
    }, 2000);
  }
}

function renderVehicleInfo() {
  document.getElementById('detail-ro').textContent = vehicle.roPo || '-';
  document.getElementById('detail-vin').textContent = vehicle.vin || '-';
  document.getElementById('detail-vehicle').textContent = vehicle.vehicle || '-';
  document.getElementById('detail-cals').textContent = vehicle.requiredCalibrations || 'Pending review';

  const statusEl = document.getElementById('vehicle-status');
  const status = vehicle.status || 'New';
  statusEl.textContent = status;
  statusEl.className = `status-badge status-${status.toLowerCase().replace(/\s+/g, '-')}`;

  // Show current schedule if exists
  if (vehicle.scheduledDate) {
    const currentSchedule = document.getElementById('current-schedule');
    const currentScheduleDate = document.getElementById('current-schedule-date');
    currentScheduleDate.textContent = formatSchedule(vehicle.scheduledDate, vehicle.scheduledTime);
    currentSchedule.classList.remove('hidden');

    // Update button text
    scheduleBtn.querySelector('.btn-text').textContent = 'Reschedule Appointment';
  }
}

function setupEventListeners() {
  // Form submit
  scheduleForm.addEventListener('submit', handleSubmit);

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    ShopAuth.logout();
    window.location.href = '/shop/';
  });
}

async function handleSubmit(e) {
  e.preventDefault();
  hideError();

  const date = document.getElementById('schedule-date').value;
  const time = document.getElementById('schedule-time').value;
  const notes = document.getElementById('schedule-notes').value.trim();

  if (!date) {
    showError('Please select a date');
    return;
  }

  setLoading(true);

  try {
    await ShopAPI.scheduleVehicle(roPo, { date, time, notes });

    // Format date for display
    const displayDate = new Date(date + 'T12:00:00');
    const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    let formattedDate = displayDate.toLocaleDateString('en-US', options);

    if (time) {
      const [hours, minutes] = time.split(':');
      const timeDate = new Date();
      timeDate.setHours(parseInt(hours), parseInt(minutes));
      const timeStr = timeDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      formattedDate += ` at ${timeStr}`;
    }

    document.getElementById('success-datetime').textContent = formattedDate;
    successModal.classList.remove('hidden');

  } catch (err) {
    showError(err.message || 'Failed to schedule appointment');
  } finally {
    setLoading(false);
  }
}

function showError(message) {
  formError.textContent = message;
  formError.classList.remove('hidden');
}

function hideError() {
  formError.classList.add('hidden');
}

function setLoading(loading) {
  scheduleBtn.disabled = loading;
  const btnText = vehicle && vehicle.scheduledDate ? 'Reschedule Appointment' : 'Schedule Appointment';
  scheduleBtn.querySelector('.btn-text').textContent = loading ? 'Scheduling...' : btnText;
  scheduleBtn.querySelector('.btn-spinner').classList.toggle('hidden', !loading);
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
          formatted += ' at ' + timeDate.toLocaleTimeString('en-US', timeOptions);
        }
      } else {
        formatted += ' at ' + timeStr;
      }
    }

    return formatted;
  } catch (e) {
    return 'Not scheduled';
  }
}

// Initialize
init();
