/**
 * submit.js - Submit vehicle page logic with PDF upload support
 */

// Require authentication
Auth.requireAuth();

// Constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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

// File inputs
const estimatePdfInput = document.getElementById('estimate-pdf');
const prescanPdfInput = document.getElementById('prescan-pdf');
const noPrescanCheckbox = document.getElementById('no-prescan');
const prescanErrorDiv = document.getElementById('prescan-error');

// File display elements
const estimateFileName = document.getElementById('estimate-file-name');
const estimateFileSize = document.getElementById('estimate-file-size');
const prescanFileName = document.getElementById('prescan-file-name');
const prescanFileSize = document.getElementById('prescan-file-size');

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

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Validate PDF file
function validatePdfFile(file, inputEl) {
  if (!file) return { valid: false, error: 'No file selected' };

  // Check file type
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    inputEl.value = '';
    return { valid: false, error: 'Only PDF files are allowed' };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    inputEl.value = '';
    return { valid: false, error: `File size must be less than ${formatFileSize(MAX_FILE_SIZE)}` };
  }

  return { valid: true };
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

  // VIN formatting - uppercase and validation
  vinInput.addEventListener('input', () => {
    vinInput.value = vinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  vinInput.addEventListener('blur', () => {
    const value = vinInput.value;
    if (value && value.length !== 17) {
      vinInput.setCustomValidity('VIN must be exactly 17 characters');
    } else {
      vinInput.setCustomValidity('');
    }
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

  // Estimate PDF change handler
  estimatePdfInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const validation = validatePdfFile(file, estimatePdfInput);
      if (validation.valid) {
        estimateFileName.textContent = file.name;
        estimateFileSize.textContent = formatFileSize(file.size);
        estimateFileName.classList.add('has-file');
      } else {
        estimateFileName.textContent = 'No file selected';
        estimateFileSize.textContent = '';
        estimateFileName.classList.remove('has-file');
        Toast.error(validation.error);
      }
    } else {
      estimateFileName.textContent = 'No file selected';
      estimateFileSize.textContent = '';
      estimateFileName.classList.remove('has-file');
    }
  });

  // Pre-scan PDF change handler
  prescanPdfInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const validation = validatePdfFile(file, prescanPdfInput);
      if (validation.valid) {
        prescanFileName.textContent = file.name;
        prescanFileSize.textContent = formatFileSize(file.size);
        prescanFileName.classList.add('has-file');
        // Uncheck "no prescan" if file is selected
        noPrescanCheckbox.checked = false;
        prescanErrorDiv.classList.add('hidden');
      } else {
        prescanFileName.textContent = 'No file selected';
        prescanFileSize.textContent = '';
        prescanFileName.classList.remove('has-file');
        Toast.error(validation.error);
      }
    } else {
      prescanFileName.textContent = 'No file selected';
      prescanFileSize.textContent = '';
      prescanFileName.classList.remove('has-file');
    }
  });

  // No pre-scan checkbox handler
  noPrescanCheckbox.addEventListener('change', () => {
    if (noPrescanCheckbox.checked) {
      // Clear pre-scan file if checkbox is checked
      prescanPdfInput.value = '';
      prescanFileName.textContent = 'No file selected';
      prescanFileSize.textContent = '';
      prescanFileName.classList.remove('has-file');
      prescanErrorDiv.classList.add('hidden');
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

// Upload a single PDF file
async function uploadPdf(file, roPo, pdfType) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('roPo', roPo);
  formData.append('pdfType', pdfType);

  const response = await fetch('/api/portal/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Auth.getToken()}`
    },
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
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

  // Validate VIN
  if (!vin || vin.length !== 17) {
    errorDiv.textContent = 'VIN must be exactly 17 characters';
    errorDiv.classList.remove('hidden');
    vinInput.focus();
    return;
  }

  // Validate Year
  if (!year) {
    errorDiv.textContent = 'Year is required';
    errorDiv.classList.remove('hidden');
    yearInput.focus();
    return;
  }

  // Validate Make
  if (!make) {
    errorDiv.textContent = 'Make is required';
    errorDiv.classList.remove('hidden');
    makeSelect.focus();
    return;
  }

  // Validate Model
  if (!model) {
    errorDiv.textContent = 'Model is required';
    errorDiv.classList.remove('hidden');
    modelInput.focus();
    return;
  }

  // Validate Estimate PDF
  const estimateFile = estimatePdfInput.files[0];
  if (!estimateFile) {
    errorDiv.textContent = 'Estimate PDF is required';
    errorDiv.classList.remove('hidden');
    estimatePdfInput.focus();
    return;
  }

  // Validate Pre-scan (file OR checkbox)
  const prescanFile = prescanPdfInput.files[0];
  const noPrescanConfirmed = noPrescanCheckbox.checked;

  if (!prescanFile && !noPrescanConfirmed) {
    prescanErrorDiv.classList.remove('hidden');
    errorDiv.textContent = 'Please upload a pre-scan PDF or confirm there are no active DTC codes';
    errorDiv.classList.remove('hidden');
    return;
  }

  prescanErrorDiv.classList.add('hidden');
  errorDiv.classList.add('hidden');

  // Show loading
  submitBtn.disabled = true;
  submitBtn.querySelector('.btn-text').textContent = 'Uploading files...';
  submitBtn.querySelector('.btn-spinner').classList.remove('hidden');

  try {
    // Step 1: Upload Estimate PDF
    const estimateResult = await uploadPdf(estimateFile, cleanRo, 'estimate');
    if (!estimateResult.success) {
      throw new Error(estimateResult.error || 'Failed to upload estimate PDF');
    }

    // Step 2: Upload Pre-scan PDF if provided
    let prescanResult = null;
    if (prescanFile) {
      submitBtn.querySelector('.btn-text').textContent = 'Uploading pre-scan...';
      prescanResult = await uploadPdf(prescanFile, cleanRo, 'scan_report');
      if (!prescanResult.success) {
        throw new Error(prescanResult.error || 'Failed to upload pre-scan PDF');
      }
    }

    // Step 3: Submit vehicle with PDF links
    submitBtn.querySelector('.btn-text').textContent = 'Submitting vehicle...';

    await API.submitVehicle({
      roPo: cleanRo,
      vin,
      year,
      make,
      model,
      notes,
      estimatePdfUrl: estimateResult.webViewLink,
      prescanPdfUrl: prescanResult ? prescanResult.webViewLink : null,
      noPrescanConfirmed: noPrescanConfirmed
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
  prescanErrorDiv.classList.add('hidden');

  // Reset file display
  estimateFileName.textContent = 'No file selected';
  estimateFileSize.textContent = '';
  estimateFileName.classList.remove('has-file');
  prescanFileName.textContent = 'No file selected';
  prescanFileSize.textContent = '';
  prescanFileName.classList.remove('has-file');

  roPoInput.focus();
}

// Close success modal
function closeSuccessModal() {
  successModal.classList.add('hidden');
}

// Initialize
init();
