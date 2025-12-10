/**
 * notifications.js - Handle notification bell and new vehicle alerts
 */

class NotificationManager {
  constructor() {
    this.bell = document.getElementById('notificationBell');
    this.badge = document.getElementById('notificationCount');
    this.dropdown = document.getElementById('notificationDropdown');
    this.list = document.querySelector('.notification-list');
    this.newVehicles = [];
    this.previousCount = 0;
    this.hasPermission = false;

    this.init();
  }

  init() {
    if (!this.bell) return;

    // Toggle dropdown on click
    this.bell.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dropdown.classList.toggle('open');
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!this.dropdown.contains(e.target) && !this.bell.contains(e.target)) {
        this.dropdown.classList.remove('open');
      }
    });

    // Mark all as seen
    const markAllBtn = document.querySelector('.mark-all-read');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.markAllSeen();
      });
    }

    // Request browser notification permission (for techs)
    this.requestPermission();

    // Initial fetch
    this.fetchNewVehicles();

    // Poll every 30 seconds
    setInterval(() => this.fetchNewVehicles(), 30000);
  }

  async requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      this.hasPermission = permission === 'granted';
    } else {
      this.hasPermission = Notification.permission === 'granted';
    }
  }

  async fetchNewVehicles() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch('/api/notifications/new', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) return;

      const data = await response.json();

      if (data.success) {
        this.previousCount = this.newVehicles.length;
        this.newVehicles = data.vehicles || [];
        this.updateUI();

        // Show browser notification for truly NEW vehicles (not on initial load)
        if (this.previousCount > 0 && this.newVehicles.length > this.previousCount) {
          const newOnes = this.newVehicles.slice(0, this.newVehicles.length - this.previousCount);
          newOnes.forEach(v => this.showBrowserNotification(v));
          this.playNotificationSound();
        }
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }

  updateUI() {
    // Update badge count
    const count = this.newVehicles.length;
    if (this.badge) {
      this.badge.textContent = count > 0 ? count : '';
      this.badge.classList.toggle('hidden', count === 0);
    }

    // Update dropdown list
    if (this.list) {
      if (count === 0) {
        this.list.innerHTML = `
          <div class="notification-empty">
            <p>No new vehicles to process</p>
          </div>
        `;
      } else {
        this.list.innerHTML = this.newVehicles.map(v => `
          <div class="notification-item unread" data-ro="${v.roPo}" onclick="window.location='vehicle.html?ro=${v.roPo}'">
            <div class="notification-icon new-status">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
              </svg>
            </div>
            <div class="notification-content">
              <strong>RO ${this.escapeHtml(v.roPo)}</strong> - ${this.escapeHtml(v.vehicle || 'New Vehicle')}
              <span class="notification-shop">${this.escapeHtml(v.shopName || '')}</span>
              <span class="notification-time">${this.timeAgo(v.timestamp)}</span>
            </div>
          </div>
        `).join('');
      }
    }

    // Update page title with count
    const baseTitle = 'ADAS F1RST Portal';
    document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
  }

  markAllSeen() {
    localStorage.setItem('lastNotificationCheck', Date.now().toString());
    this.newVehicles = [];
    this.updateUI();
    this.dropdown.classList.remove('open');

    // Notify backend (optional, for future per-user tracking)
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/notifications/mark-seen', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      }).catch(() => {});
    }
  }

  showBrowserNotification(vehicle) {
    if (!this.hasPermission) return;

    try {
      const notification = new Notification('New Vehicle Submitted', {
        body: `RO ${vehicle.roPo} - ${vehicle.vehicle || 'New Vehicle'}\n${vehicle.shopName || ''}`,
        icon: '/images/logo-icon.png',
        tag: `new-vehicle-${vehicle.roPo}`,
        requireInteraction: true
      });

      notification.onclick = () => {
        window.focus();
        window.location.href = `vehicle.html?ro=${vehicle.roPo}`;
        notification.close();
      };
    } catch (err) {
      console.error('Browser notification error:', err);
    }
  }

  playNotificationSound() {
    try {
      // Simple beep using Web Audio API (no external file needed)
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (err) {
      // Audio not supported or blocked
    }
  }

  timeAgo(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diff = Math.floor((now - time) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    return `${Math.floor(diff / 86400)} days ago`;
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.notificationManager = new NotificationManager();
});
