/**
 * admin/dashboard.js - Admin dashboard functionality
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Wait for admin-common.js to initialize
  setTimeout(async () => {
    await loadDashboard();
    await loadAssignmentRequests();
  }, 100);
});

async function loadDashboard() {
  try {
    const data = await AdminAPI.get('/api/admin/dashboard');

    if (!data.success) {
      console.error('Dashboard load failed:', data.error);
      return;
    }

    // Update stats
    document.getElementById('statTotal').textContent = data.stats.total;
    document.getElementById('statNew').textContent = data.stats.new;
    document.getElementById('statScheduled').textContent = data.stats.scheduled;
    document.getElementById('statCompleted').textContent = data.stats.completed;

    // Update sidebar badge
    const newCount = document.getElementById('newCount');
    if (newCount) {
      newCount.textContent = data.stats.new;
      newCount.style.display = data.stats.new > 0 ? 'inline' : 'none';
    }

    // Today's schedule
    document.getElementById('todayCount').textContent = `${data.todayJobs.length} jobs`;
    renderTodaySchedule(data.todayJobs);

    // By shop breakdown
    renderBreakdown('byShop', data.byShop, '/admin/vehicles.html?shop=');

    // By tech breakdown
    renderBreakdown('byTech', data.byTech, '/admin/vehicles.html?tech=');

  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

async function loadAssignmentRequests() {
  try {
    const data = await AdminAPI.get('/api/admin/assignment-requests');

    if (!data.success) {
      console.error('Failed to load assignment requests:', data.error);
      return;
    }

    const requests = data.requests || [];
    const pendingRequests = requests.filter(r => r.status === 'Pending');

    const card = document.getElementById('assignmentRequestsCard');
    const container = document.getElementById('assignmentRequests');
    const countEl = document.getElementById('requestsCount');

    if (pendingRequests.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    countEl.textContent = pendingRequests.length;

    container.innerHTML = pendingRequests.map(req => `
      <div class="request-item" style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;">
          <div style="font-weight:600;margin-bottom:4px;">RO #${escapeHtml(req.roPo)}</div>
          <div style="font-size:13px;color:var(--text-secondary);">
            <strong>${escapeHtml(req.requestingTech)}</strong> wants to take over from
            <strong>${escapeHtml(req.currentTech || 'Unassigned')}</strong>
          </div>
          ${req.reason ? `<div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;">Reason: ${escapeHtml(req.reason)}</div>` : ''}
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(req.requestedAt || '')}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-success" onclick="reviewRequest('${escapeHtml(req.requestId)}', 'Approved')">Approve</button>
          <button class="btn btn-sm btn-danger" onclick="reviewRequest('${escapeHtml(req.requestId)}', 'Denied')">Deny</button>
        </div>
      </div>
    `).join('');

  } catch (err) {
    console.error('Assignment requests error:', err);
  }
}

async function reviewRequest(requestId, decision) {
  const reason = decision === 'Denied' ? prompt('Reason for denial (optional):') : '';

  try {
    const data = await AdminAPI.post('/api/admin/assignment-requests/review', {
      requestId,
      decision,
      reason
    });

    if (!data.success) {
      alert('Failed to process request: ' + (data.error || 'Unknown error'));
      return;
    }

    alert(decision === 'Approved' ? 'Request approved. Tech has been reassigned.' : 'Request denied.');
    await loadAssignmentRequests();
  } catch (err) {
    console.error('Review request error:', err);
    alert('Failed to process request');
  }
}

// Make functions available globally
window.reviewRequest = reviewRequest;

function renderTodaySchedule(jobs) {
  const container = document.getElementById('todaySchedule');

  if (!jobs || jobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#128197;</div>
        <h3>No jobs scheduled for today</h3>
      </div>
    `;
    return;
  }

  container.innerHTML = jobs.map(job => `
    <div class="schedule-item">
      <div class="schedule-time">${escapeHtml(job.scheduledTime) || 'TBD'}</div>
      <div class="schedule-info">
        <div class="schedule-ro">
          <a href="/admin/vehicles.html?ro=${encodeURIComponent(job.roPo)}">${escapeHtml(job.roPo)}</a>
          - ${escapeHtml(job.vehicle || 'Unknown')}
        </div>
        <div class="schedule-shop">${escapeHtml(job.shopName || '')}</div>
      </div>
      <span class="status-badge ${getStatusClass(job.status)}">${escapeHtml(job.status)}</span>
    </div>
  `).join('');
}

function renderBreakdown(containerId, data, linkPrefix) {
  const container = document.getElementById(containerId);

  if (!data || Object.keys(data).length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No data available</p>
      </div>
    `;
    return;
  }

  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);

  container.innerHTML = `
    <table class="data-table">
      <tbody>
        ${entries.map(([name, count]) => `
          <tr class="clickable" onclick="window.location='${linkPrefix}${encodeURIComponent(name)}'">
            <td>${escapeHtml(name)}</td>
            <td style="text-align:right;font-weight:600;">${count}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
