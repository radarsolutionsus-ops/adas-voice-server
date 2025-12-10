/**
 * submit.js - Shop vehicle submission page logic
 */

// Require authentication
ShopAuth.requireAuth();

// Elements
const shopNameEl = document.getElementById('shop-name');
const submitForm = document.getElementById('submit-form');
const submitBtn = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');
const successModal = document.getElementById('success-modal');

// File inputs
const estimateInput = document.getElementById('estimate-pdf');
const prescanInput = document.getElementById('prescan-pdf');
const noPrescanConfirm = document.getElementById('no-prescan-confirm');

// File URLs after upload
let estimatePdfUrl = null;
let prescanPdfUrl = null;

// Init
function init() {
  const user = ShopAuth.getUser();
  if (user) {
    shopNameEl.textContent = user.shopName || user.name || '';
  }

  setupEventListeners();
}

function setupEventListeners() {
  // File input change handlers
  estimateInput.addEventListener('change', (e) => handleFileSelect(e, 'estimate'));
  prescanInput.addEventListener('change', (e) => handleFileSelect(e, 'prescan'));

  // Form submit
  submitForm.addEventListener('submit', handleSubmit);

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    ShopAuth.logout();
    window.location.href = '/shop/';
  });

  // VIN auto-uppercase
  document.getElementById('vin').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });
}

function handleFileSelect(e, type) {
  const file = e.target.files[0];
  const fileNameEl = document.getElementById(`${type}-file-name`);
  const fileSizeEl = document.getElementById(`${type}-file-size`);

  if (file) {
    fileNameEl.textContent = file.name;
    fileNameEl.classList.add('has-file');
    fileSizeEl.textContent = formatFileSize(file.size);
  } else {
    fileNameEl.textContent = 'No file selected';
    fileNameEl.classList.remove('has-file');
    fileSizeEl.textContent = '';
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function handleSubmit(e) {
  e.preventDefault();
  hideError();

  // Validate
  const roPo = document.getElementById('ro-po').value.trim();
  const vin = document.getElementById('vin').value.trim().toUpperCase();
  const year = document.getElementById('year').value.trim();
  const make = document.getElementById('make').value.trim();
  const model = document.getElementById('model').value.trim();
  const notes = document.getElementById('notes').value.trim();

  if (!roPo) {
    showError('RO/PO number is required');
    return;
  }

  if (!vin || vin.length !== 17) {
    showError('Full 17-character VIN is required');
    return;
  }

  if (!year || !make || !model) {
    showError('Year, make, and model are required');
    return;
  }

  const estimateFile = estimateInput.files[0];
  if (!estimateFile) {
    showError('Estimate PDF is required');
    return;
  }

  const prescanFile = prescanInput.files[0];
  if (!prescanFile && !noPrescanConfirm.checked) {
    showError('Please upload a pre-scan PDF or confirm no active DTCs');
    return;
  }

  // Show loading
  setLoading(true);

  try {
    // Upload estimate PDF
    const estimateResult = await ShopAPI.uploadFile(estimateFile);
    estimatePdfUrl = estimateResult.url;

    // Upload prescan PDF if provided
    if (prescanFile) {
      const prescanResult = await ShopAPI.uploadFile(prescanFile);
      prescanPdfUrl = prescanResult.url;
    }

    // Submit vehicle
    const result = await ShopAPI.submitVehicle({
      roPo,
      vin,
      year,
      make,
      model,
      notes,
      estimatePdfUrl,
      prescanPdfUrl,
      noPrescanConfirmed: noPrescanConfirm.checked && !prescanFile
    });

    // Show success
    document.getElementById('success-ro').textContent = roPo;
    successModal.classList.remove('hidden');

  } catch (err) {
    showError(err.message || 'Failed to submit vehicle');
  } finally {
    setLoading(false);
  }
}

function showError(message) {
  formError.textContent = message;
  formError.classList.remove('hidden');
  formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideError() {
  formError.classList.add('hidden');
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.querySelector('.btn-text').textContent = loading ? 'Submitting...' : 'Submit Vehicle';
  submitBtn.querySelector('.btn-spinner').classList.toggle('hidden', !loading);
}

// Initialize
init();
