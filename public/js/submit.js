/**
 * submit.js - Submit vehicle page logic
 */

// Require authentication
Auth.requireAuth();

// Elements
const shopNameEl = document.getElementById('shop-name');
const submitForm = document.getElementById('submit-form');
const roPoInput = document.getElementById('ro-po');
const vinInput = document.getElementById('vin');
const yearInput = document.getElementById('year');
const makeSelect = document.getElementById('make');
const modelInput = document.getElementById('model');
const notesTextarea = document.getElementById('notes');
const submitBtn = document.getElementById('submit-btn');
const errorDiv = document.getElementById('submit-error');
const successModal = document.getElementById('success-modal');
const submittedRoEl = document.getElementById('submitted-ro');

// Init
function init() {
  // Set shop name
  const shop = Auth.getShop();
  if (shop) {
    shopNameEl.textContent = shop.name;
  }

  // Setup event listeners
  setupEventListeners();
}

// Setup event listeners
function setupEventListeners() {
  // Form submit
  submitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitVehicle();
  });

  // RO/PO validation
  roPoInput.addEventListener('blur', () => {
    const value = roPoInput.value.replace(/\D/g, '');
    if (value && (value.length < 4 || value.length > 8)) {
      roPoInput.setCustomValidity('RO must be 4-8 digits');
    } else {
      roPoInput.setCustomValidity('');
    }
  });

  // VIN formatting - uppercase
  vinInput.addEventListener('input', () => {
    vinInput.value = vinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // Year validation
  yearInput.addEventListener('blur', () => {
    const value = yearInput.value;
    if (value) {
      const year = parseInt(value, 10);
      const currentYear = new Date().getFullYear();
      if (year < 1990 || year > currentYear + 1) {
        yearInput.setCustomValidity(`Year must be between 1990 and ${currentYear + 1}`);
      } else {
        yearInput.setCustomValidity('');
      }
    }
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    Auth.logout();
    window.location.href = '/';
  });

  // Submit another button
  document.getElementById('submit-another-btn').addEventListener('click', () => {
    closeSuccessModal();
    resetForm();
  });

  // Modal backdrop click
  successModal.querySelector('.modal-backdrop').addEventListener('click', () => {
    window.location.href = '/dashboard.html';
  });
}

// Submit vehicle
async function submitVehicle() {
  const roPo = roPoInput.value.trim();
  const vin = vinInput.value.trim();
  const year = yearInput.value.trim();
  const make = makeSelect.value;
  const model = modelInput.value.trim();
  const notes = notesTextarea.value.trim();

  // Validate RO
  const cleanRo = roPo.replace(/\D/g, '');
  if (!cleanRo || cleanRo.length < 4 || cleanRo.length > 8) {
    errorDiv.textContent = 'RO/PO must be 4-8 digits';
    errorDiv.classList.remove('hidden');
    roPoInput.focus();
    return;
  }

  // Show loading
  submitBtn.disabled = true;
  submitBtn.querySelector('.btn-text').textContent = 'Submitting...';
  submitBtn.querySelector('.btn-spinner').classList.remove('hidden');
  errorDiv.classList.add('hidden');

  try {
    await API.submitVehicle({
      roPo: cleanRo,
      vin,
      year,
      make,
      model,
      notes
    });

    // Show success modal
    submittedRoEl.textContent = cleanRo;
    successModal.classList.remove('hidden');

    Toast.success('Vehicle submitted successfully!');
  } catch (err) {
    errorDiv.textContent = err.message || 'Failed to submit vehicle';
    errorDiv.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('.btn-text').textContent = 'Submit Vehicle';
    submitBtn.querySelector('.btn-spinner').classList.add('hidden');
  }
}

// Reset form
function resetForm() {
  submitForm.reset();
  errorDiv.classList.add('hidden');
  roPoInput.focus();
}

// Close success modal
function closeSuccessModal() {
  successModal.classList.add('hidden');
}

// Initialize
init();
