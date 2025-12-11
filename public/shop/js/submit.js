/**
 * submit.js - Submit Vehicle Document-First Workflow
 */
(function() {
  'use strict';

  let currentStep = 1;
  let extractedData = {};
  let extractedRoPo = null; // RO/PO extracted from estimate
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
    setupRoSuggestion();
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

    // RO suggestion icon
    if (document.getElementById('roSuggestionIcon')) {
      document.getElementById('roSuggestionIcon').innerHTML = Icons.alertCircle;
    }
  }

  function setupRoSuggestion() {
    const useSuggestedBtn = document.getElementById('useSuggestedRo');
    if (useSuggestedBtn) {
      useSuggestedBtn.addEventListener('click', () => {
        if (extractedRoPo) {
          document.getElementById('roPo').value = extractedRoPo;
          hideRoSuggestion();
          Toast.success(`RO updated to: ${extractedRoPo}`);
        }
      });
    }
  }

  function showRoSuggestion(suggestedRo) {
    const suggestionBox = document.getElementById('roSuggestion');
    const suggestedRoEl = document.getElementById('suggestedRo');

    if (suggestionBox && suggestedRoEl) {
      suggestedRoEl.textContent = suggestedRo;
      suggestionBox.style.display = 'flex';

      // Re-init icon in case it wasn't set
      const iconEl = document.getElementById('roSuggestionIcon');
      if (iconEl && Icons.alertCircle) {
        iconEl.innerHTML = Icons.alertCircle;
      }
    }
  }

  function hideRoSuggestion() {
    const suggestionBox = document.getElementById('roSuggestion');
    if (suggestionBox) {
      suggestionBox.style.display = 'none';
    }
  }

  function compareRoPoWithExtracted() {
    if (!extractedRoPo) {
      hideRoSuggestion();
      return;
    }

    const userRo = (document.getElementById('roPo')?.value || '').trim();
    const extractedRoNorm = extractedRoPo.toLowerCase().trim();
    const userRoNorm = userRo.toLowerCase().trim();

    // Show suggestion if:
    // 1. User has entered something
    // 2. Extracted RO is different from user input
    // 3. Extracted RO is "more complete" (e.g., 12317-1 vs 12317)
    if (userRo && extractedRoNorm !== userRoNorm) {
      // Check if extracted appears to be more complete
      const isMoreComplete = extractedRoNorm.includes(userRoNorm) ||
                             extractedRoNorm.length > userRoNorm.length;

      if (isMoreComplete || extractedRoNorm !== userRoNorm) {
        showRoSuggestion(extractedRoPo);
      } else {
        hideRoSuggestion();
      }
    } else {
      hideRoSuggestion();
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

  async function handleFileSelect(type, file) {
    console.log(`[SUBMIT] handleFileSelect called: type=${type}, file=${file?.name}`);
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

    // If this is an estimate, extract VIN/vehicle info immediately
    if (type === 'estimate') {
      console.log('[SUBMIT] Calling extractEstimateData...');
      await extractEstimateData(file);
    }
  }

  /**
   * Extract VIN and vehicle info from estimate PDF
   * Called immediately when user uploads estimate
   */
  async function extractEstimateData(file) {
    console.log('[SUBMIT] extractEstimateData starting...');
    const content = document.getElementById('estimateContent');

    try {
      // Show extracting status
      if (content) {
        content.innerHTML = `
          <div class="spinner spinner-sm"></div>
          <p class="upload-text">Extracting vehicle info...</p>
          <p class="upload-hint">${escapeHtml(file.name)}</p>
        `;
      }

      const formData = new FormData();
      formData.append('estimate', file);

      console.log('[SUBMIT] Getting auth token...');
      const token = await Auth.getValidToken();
      console.log('[SUBMIT] Calling /api/shop/extract-estimate...');
      const response = await fetch('/api/shop/extract-estimate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const result = await response.json();
      console.log('[SUBMIT] Extract API response:', result);

      if (result.success && result.extracted) {
        extractedData = {
          vin: result.extracted.vin || '',
          vehicle: result.extracted.vehicle || ''
        };

        // Store extracted RO/PO for suggestion comparison
        if (result.extracted.roPo) {
          extractedRoPo = result.extracted.roPo;
          console.log('[SUBMIT] Extracted RO/PO from estimate:', extractedRoPo);
          // Compare with user's current input
          compareRoPoWithExtracted();
        }

        console.log('[SUBMIT] Extracted from estimate:', extractedData);

        // Update UI with success and extracted info
        if (content) {
          let extractedInfo = '';
          if (extractedData.vin) {
            extractedInfo += `<span class="extracted-badge">VIN: ${extractedData.vin.substring(0, 6)}...</span>`;
          }
          if (extractedData.vehicle) {
            extractedInfo += `<span class="extracted-badge">${escapeHtml(extractedData.vehicle)}</span>`;
          }

          content.innerHTML = `
            <span class="icon upload-success">${Icons.checkCircle}</span>
            <p class="upload-text">${escapeHtml(file.name)}</p>
            ${extractedInfo ? `<div class="extracted-info">${extractedInfo}</div>` : ''}
            <p class="upload-hint">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
          `;
        }

        if (result.warning) {
          Toast.warning(result.warning);
        }
      } else {
        // Show file uploaded but no extraction
        if (content) {
          content.innerHTML = `
            <span class="icon upload-success">${Icons.checkCircle}</span>
            <p class="upload-text">${escapeHtml(file.name)}</p>
            <p class="upload-hint">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
          `;
        }
      }
    } catch (err) {
      console.error('[SUBMIT] Extraction error:', err);
      // Still show file as uploaded even if extraction fails
      if (content) {
        content.innerHTML = `
          <span class="icon upload-success">${Icons.checkCircle}</span>
          <p class="upload-text">${escapeHtml(file.name)}</p>
          <p class="upload-hint">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
        `;
      }
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

    showProcessing('Preparing review...');

    try {
      // If no VIN was extracted but user provided vehicle info, use that
      if (!extractedData.vehicle) {
        const userVehicle = document.getElementById('vehicleDesc').value.trim();
        if (userVehicle) {
          extractedData.vehicle = userVehicle;
        }
      }

      // Populate review section with extracted data
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

    // Show extracted VIN or indicate it wasn't found
    const reviewVin = document.getElementById('reviewVin');
    if (extractedData.vin) {
      reviewVin.textContent = extractedData.vin;
      reviewVin.classList.add('success');
      reviewVin.classList.remove('warning');
    } else {
      reviewVin.textContent = 'Not found in estimate';
      reviewVin.classList.add('warning');
      reviewVin.classList.remove('success');
    }

    // Show extracted vehicle or user-provided value
    const reviewVehicle = document.getElementById('reviewVehicle');
    const displayVehicle = extractedData.vehicle || vehicle;
    if (displayVehicle) {
      reviewVehicle.textContent = displayVehicle;
      reviewVehicle.classList.add('success');
      reviewVehicle.classList.remove('warning');
    } else {
      reviewVehicle.textContent = 'Not found in estimate';
      reviewVehicle.classList.add('warning');
      reviewVehicle.classList.remove('success');
    }

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
