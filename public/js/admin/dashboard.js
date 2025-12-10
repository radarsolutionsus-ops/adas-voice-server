/**
 * admin/dashboard.js - Admin dashboard functionality
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Check auth - must be admin
  const token = Auth.getToken();
  if (!token) {
    window.location.href = '/';
    return;
  }

  // Verify role from token
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.role !== 'admin') {
      console.error('Access denied: Admin role required');
      Auth.logout();
      window.location.href = '/';
      return;
    }
  } catch (e) {
    console.error('Invalid token');
    Auth.logout();
    window.location.href = '/';
    return;
  }

  // Logout handler
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await Auth.logout();
    window.location.href = '/';
  });

  // Fetch dashboard data
  await loadDashboard();
});

async function loadDashboard() {
  try {
    const token = await Auth.getValidToken();

    const response = await fetch('/api/admin/dashboard', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      console.error('Dashboard load failed:', data.error);
      if (response.status === 401 || response.status === 403) {
        Auth.logout();
        window.location.href = '/';
      }
      return;
    }

    // Update stats
    document.getElementById('statTotal').textContent = data.stats.total;
    document.getElementById('statNew').textContent = data.stats.new;
    document.getElementById('statScheduled').textContent = data.stats.scheduled;
    document.getElementById('statInProgress').textContent = data.stats.inProgress;
    document.getElementById('statCompleted').textContent = data.stats.completed;
    document.getElementById('statAttention').textContent = data.stats.needsAttention;

    // Today's jobs
    document.getElementById('todayCount').textContent = data.todayJobs.length;
    renderTodayJobs(data.todayJobs);

    // By shop breakdown
    renderBreakdown('byShop', data.byShop);

    // By tech breakdown
    renderBreakdown('byTech', data.byTech);

  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

function renderTodayJobs(jobs) {
  const container = document.getElementById('todayJobs');

  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<p class="empty-state">No jobs scheduled for today</p>';
    return;
  }

  container.innerHTML = jobs.map(job => `
    <div class="job-item">
      <div class="job-info">
        <strong>${escapeHtml(job.roPo)}</strong> - ${escapeHtml(job.vehicle || 'Unknown')}
        <span class="job-shop">${escapeHtml(job.shopName || '')}</span>
      </div>
      <div>
        <span class="job-time">${escapeHtml(job.scheduledTime || 'TBD')}</span>
        <span class="status-badge ${(job.status || '').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(job.status || 'Unknown')}</span>
      </div>
    </div>
  `).join('');
}

function renderBreakdown(containerId, data) {
  const container = document.getElementById(containerId);

  if (!data || Object.keys(data).length === 0) {
    container.innerHTML = '<p class="empty-state">No data</p>';
    return;
  }

  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);

  container.innerHTML = entries.map(([name, count]) => `
    <div class="breakdown-item">
      <span class="breakdown-name">${escapeHtml(name)}</span>
      <span class="breakdown-count">${count}</span>
    </div>
  `).join('');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
