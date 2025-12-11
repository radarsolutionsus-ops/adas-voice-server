/**
 * submit.js - Submit Vehicle Document-First Workflow
 */
(function() {
  'use strict';

  let currentStep = 1;
  let extractedData = {};
  let uploadedFiles = {
    estimate: null,
    prescan: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (!initShopPortal()) return;

    initializeIcons();
    setupCommonHandlers();
    setupFileUploads();
    setupForm();
  });

  function initializeIcons() {
    // Header icons
    if (document.getElementById('helpIcon')) {
      document.getElementById('helpIcon').innerHTML = Icons.help;
    }
    if (document.getElementById('logoutIcon')) {
      document.getElementById('logoutIcon').innerHTML = Icons.logout;
    }
    if (document.getElementById('backIcon')) {
      document.getElementById('backIcon').innerHTML = Icons.arrowLeft;
    }

    // Form icons
    if (document.getElementById('nextIcon1')) {
      document.getElementById('nextIcon1').innerHTML = Icons.chevronRight;
    }
    if (document.getElementById('nextIcon2')) {
      document.getElementById('nextIcon2').innerHTML = Icons.chevronRight;
    }
    if (document.getElementById('backIcon2')) {
      document.getElementById('backIcon2').innerHTML = Icons.arrowLeft;
    }
    if (document.getElementById('submitIcon')) {
      document.getElementById('submitIcon').innerHTML = Icons.checkCircle;
    }
    if (document.getElementById('editIcon')) {
      document.getElementById('editIcon').innerHTML = Icons.edit;
    }

    // Upload icons
    if (document.getElementById('uploadIcon1')) {
      document.getElementById('uploadIcon1').innerHTML = Icons.upload;
    }
    if (document.getElementById('uploadIcon2')) {
      document.getElementById('uploadIcon2').innerHTML = Icons.upload;
    }

    // Info banner
    if (document.getElementById('infoBannerIcon')) {
      document.getElementById('infoBannerIcon').innerHTML = Icons.alertCircle;
    }

    // Modal icons
    if (document.getElementById('closeIcon')) {
      document.getElementById('closeIcon').innerHTML = Icons.x;
    }
    if (document.getElementById('helpPhoneIcon')) {
      document.getElementById('helpPhoneIcon').innerHTML = Icons.phone;
    }
    if (document.getElementById('helpMailIcon')) {
      document.getElementById('helpMailIcon').innerHTML = Icons.mail;
    }
    if (document.getElementById('successIcon')) {
      document.getElementById('successIcon').innerHTML = Icons.checkCircle;
    }
  }

  function setupFileUploads() {
    // Estimate upload
    const estimateUpload = document.getElementById('estimateUpload');
    const estimateFile = document.getElementById('estimateFile');

    if (estimateUpload && estimateFile) {
      estimateUpload.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          estimateFile.click();
        }
      });

      estimateUpload.addEventListener('dragover', (e) => {
        e.preventDefault();
        estimateUpload.classList.add('dragover');
      });

      estimateUpload.addEventListener('dragleave', () => {
        estimateUpload.classList.remove('dragover');
      });

      estimateUpload.addEventListener('drop', (e) => {
        e.preventDefault();
        estimateUpload.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
          handleFileSelect('estimate', e.dataTransfer.files[0]);
        }
      });

      estimateFile.addEventListener('change', (e) => {
        if (e.target.files.length) {
          handleFileSelect('estimate', e.target.files[0]);
        }
      });
    }

    // Prescan upload
    const prescanUpload = document.getElementById('prescanUpload');
    const prescanFile = document.getElementById('prescanFile');

    if (prescanUpload && prescanFile) {
      prescanUpload.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          prescanFile.click();
        }
      });

      prescanUpload.addEventListener('dragover', (e) => {
        e.preventDefault();
        prescanUpload.classList.add('dragover');
      });

      prescanUpload.addEventListener('dragleave', () => {
        prescanUpload.classList.remove('dragover');
      });

      prescanUpload.addEventListener('drop', (e) => {
        e.preventDefault();
        prescanUpload.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
          handleFileSelect('prescan', e.dataTransfer.files[0]);
        }
      });

      prescanFile.addEventListener('change', (e) => {
        if (e.target.files.length) {
          handleFileSelect('prescan', e.target.files[0]);
        }
      });
    }
  }

  function handleFileSelect(type, file) {
    if (!file) return;

    if (file.type !== 'application/pdf') {
      Toast.error('Please upload a PDF file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      Toast.error('File size must be under 10MB');
      return;
    }

    uploadedFiles[type] = file;

    const content = document.getElementById(`${type}Content`);
    if (content) {
      content.innerHTML = `
        <span class="icon upload-success">${Icons.checkCircle}</span>
        <p class="upload-text">${escapeHtml(file.name)}</p>
        <p class="upload-hint">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
      `;
    }

    const upload = document.getElementById(`${type}Upload`);
    if (upload) {
      upload.classList.add('has-file');
    }
  }

  function setupForm() {
    const form = document.getElementById('submitForm');
    if (form) {
      form.addEventListener('submit', handleSubmit);
    }
  }

  // Make goToStep globally accessible
  window.goToStep = function(step) {
    // Validate current step before advancing
    if (step > currentStep) {
      if (currentStep === 1 && !validateStep1()) return;
      if (currentStep === 2 && !validateStep2()) return;
    }

    // Hide all steps
    document.querySelectorAll('.form-step').forEach(el => {
      el.classList.remove('active');
    });

    // Show target step
    const targetStep = document.getElementById(`step${step}`);
    if (targetStep) {
      targetStep.classList.add('active');
    }

    // Update progress indicators
    document.querySelectorAll('.form-steps .step').forEach(el => {
      const stepNum = parseInt(el.dataset.step);
      el.classList.remove('active', 'completed');
      if (stepNum === step) {
        el.classList.add('active');
      }
      if (stepNum < step) {
        el.classList.add('completed');
        const numEl = el.querySelector('.step-number');
        if (numEl) {
          numEl.innerHTML = Icons.check;
        }
      } else if (stepNum > step) {
        const numEl = el.querySelector('.step-number');
        if (numEl) {
          numEl.textContent = stepNum;
        }
      } else {
        const numEl = el.querySelector('.step-number');
        if (numEl) {
          numEl.textContent = stepNum;
        }
      }
    });

    // Update step lines
    document.querySelectorAll('.step-line').forEach((line, idx) => {
      if (idx < step - 1) {
        line.classList.add('completed');
      } else {
        line.classList.remove('completed');
      }
    });

    currentStep = step;

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function validateStep1() {
    const roPo = document.getElementById('roPo').value.trim();
    if (!roPo) {
      Toast.error('Please enter RO/PO number');
      document.getElementById('roPo').focus();
      return false;
    }
    return true;
  }

  function validateStep2() {
    if (!uploadedFiles.estimate) {
      Toast.error('Please upload an estimate PDF');
      return false;
    }

    const noDtc = document.getElementById('noDtcConfirm')?.checked;
    if (!uploadedFiles.prescan && !noDtc) {
      Toast.error('Please upload pre-scan or confirm no DTCs');
      return false;
    }

    return true;
  }

  // Make processDocuments globally accessible
  window.processDocuments = async function() {
    if (!validateStep2()) return;

    showProcessing('Processing documents...');

    try {
      // For now, we just populate the review section without server processing
      // The actual VIN extraction happens during submission
      extractedData = {
        vin: '',
        vehicle: document.getElementById('vehicleDesc').value.trim() || ''
      };

      // Populate review section
      populateReview();

      hideProcessing();
      goToStep(3);

    } catch (err) {
      hideProcessing();
      Toast.error(err.message || 'Failed to process documents');
      console.error('Process error:', err);
    }
  };

  function populateReview() {
    const roPo = document.getElementById('roPo')?.value || '';
    const vehicle = document.getElementById('vehicleDesc')?.value || '';
    const notes = document.getElementById('notes')?.value || '';
    const noDtcConfirm = document.getElementById('noDtcConfirm')?.checked;

    document.getElementById('reviewRoPo').textContent = roPo || '-';
    document.getElementById('reviewVin').textContent = extractedData.vin || 'Will be extracted from estimate';
    document.getElementById('reviewVehicle').textContent = extractedData.vehicle || vehicle || 'Will be extracted';
    document.getElementById('reviewEstimate').textContent = uploadedFiles.estimate ? 'Uploaded' : '-';

    const reviewPrescan = document.getElementById('reviewPrescan');
    if (uploadedFiles.prescan) {
      reviewPrescan.textContent = 'Uploaded';
      reviewPrescan.classList.add('success');
    } else if (noDtcConfirm) {
      reviewPrescan.textContent = 'No DTCs confirmed';
      reviewPrescan.classList.remove('success');
    } else {
      reviewPrescan.textContent = 'Not provided';
      reviewPrescan.classList.remove('success');
    }

    const notesSection = document.getElementById('reviewNotesSection');
    if (notes) {
      notesSection.style.display = 'block';
      document.getElementById('reviewNotes').textContent = notes;
    } else {
      notesSection.style.display = 'none';
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    // Final validation
    if (!uploadedFiles.estimate) {
      Toast.error('Estimate PDF is required');
      goToStep(2);
      return;
    }

    const noDtcConfirm = document.getElementById('noDtcConfirm')?.checked;
    if (!uploadedFiles.prescan && !noDtcConfirm) {
      Toast.error('Please upload a pre-scan PDF or confirm no DTC codes');
      goToStep(2);
      return;
    }

    showProcessing('Submitting vehicle...');

    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
    }

    try {
      const formData = new FormData();
      formData.append('roPo', document.getElementById('roPo').value.trim());
      formData.append('vehicle', document.getElementById('vehicleDesc').value.trim());
      formData.append('notes', document.getElementById('notes').value.trim());
      formData.append('noPrescanConfirmed', noDtcConfirm ? 'true' : 'false');

      if (uploadedFiles.estimate) {
        formData.append('estimatePdf', uploadedFiles.estimate);
      }
      if (uploadedFiles.prescan) {
        formData.append('preScanPdf', uploadedFiles.prescan);
      }

      const token = await Auth.getValidToken();
      const response = await fetch('/api/shop/vehicles', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const result = await response.json();

      hideProcessing();

      if (result.success) {
        document.getElementById('successModal').classList.add('open');
      } else {
        Toast.error(result.error || 'Failed to submit vehicle');
        if (submitBtn) {
          submitBtn.disabled = false;
        }
      }
    } catch (err) {
      console.error('Submit error:', err);
      hideProcessing();
      Toast.error('Failed to submit vehicle. Please try again.');
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  function showProcessing(text) {
    const overlay = document.getElementById('processingOverlay');
    const textEl = document.getElementById('processingText');
    if (textEl) {
      textEl.textContent = text;
    }
    if (overlay) {
      overlay.style.display = 'flex';
    }
  }

  function hideProcessing() {
    const overlay = document.getElementById('processingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  console.log('[SHOP] submit.js loaded');
})();
