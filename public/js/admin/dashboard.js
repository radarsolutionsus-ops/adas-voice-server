/**
 * admin/dashboard.js - Admin dashboard functionality
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Wait for admin-common.js to initialize
  setTimeout(loadDashboard, 100);
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
