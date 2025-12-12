/**
 * ADAS F1RST Tech Portal - Calendar App
 * Weekly calendar view with job management
 */

const { useState, useEffect, useCallback, useRef } = React;

// API configuration
const API_BASE = '/api/tech';

// Time slots for the calendar (8 AM - 5 PM)
const TIME_SLOTS = [
  '08:00 AM', '09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '01:00 PM', '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM'
];

// Max jobs per hour per tech
const MAX_PER_HOUR = 3;

// Tech names for selector
const TECH_NAMES = ['Felipe', 'Martin', 'Anthony', 'Randy'];

// Helper: Get auth token from localStorage
function getAuthToken() {
  return localStorage.getItem('authToken');
}

// Helper: Get tech name from localStorage or default
function getSavedTechName() {
  return localStorage.getItem('calendarTechName') || '';
}

// Helper: Save tech name to localStorage
function saveTechName(name) {
  localStorage.setItem('calendarTechName', name);
}

// Helper: Format date as YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Helper: Get week start (Sunday)
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Helper: Get week dates
function getWeekDates(startDate) {
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

// Helper: Parse time to hour
function parseTimeToHour(timeStr) {
  const match = (timeStr || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return 9;
  let hour = parseInt(match[1]);
  if (match[3].toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (match[3].toUpperCase() === 'AM' && hour === 12) hour = 0;
  return hour;
}

// Helper: Check if date is today
function isToday(date) {
  const today = new Date();
  return formatDate(date) === formatDate(today);
}

// API call wrapper
async function apiCall(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` })
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

// Job Card Component
function JobCard({ job, onClick }) {
  const statusClass = {
    'pending_review': 'pending',
    'scheduled': '',
    'accepted': '',
    'in_progress': 'in-progress',
    'completed': 'completed',
    'urgent': 'urgent'
  }[job.status] || '';

  const priorityClass = job.priority === 'urgent' ? 'urgent' : '';

  return (
    <div
      className={`job-card ${statusClass} ${priorityClass}`}
      onClick={() => onClick(job)}
      title={`${job.roPo} - ${job.vehicle}`}
    >
      <div className="font-semibold truncate">{job.roPo}</div>
      <div className="truncate text-gray-600">{job.vehicle}</div>
      <div className="truncate text-gray-500">{job.shop}</div>
    </div>
  );
}

// Capacity Bar Component
function CapacityBar({ count, max = MAX_PER_HOUR }) {
  const percent = Math.min((count / max) * 100, 100);
  const level = percent >= 100 ? 'high' : percent >= 66 ? 'medium' : 'low';

  return (
    <div className="capacity-bar">
      <div
        className={`capacity-fill ${level}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

// Job Detail Modal
function JobModal({ job, onClose, onAccept, onReject, onDirections }) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!job) return null;

  const handleAccept = async () => {
    setLoading(true);
    try {
      await onAccept(job.roPo);
      onClose();
    } catch (err) {
      alert('Failed to accept: ' + err.message);
    }
    setLoading(false);
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      alert('Please provide a reason');
      return;
    }
    setLoading(true);
    try {
      await onReject(job.roPo, rejectReason);
      onClose();
    } catch (err) {
      alert('Failed to decline: ' + err.message);
    }
    setLoading(false);
  };

  const getStatusDisplay = (status) => {
    const map = {
      'pending_review': 'Pending Review',
      'accepted': 'Accepted',
      'scheduled': 'Scheduled',
      'in_progress': 'In Progress',
      'completed': 'Completed',
      'no_cal': 'No Calibration',
      'cancelled': 'Cancelled'
    };
    return map[status] || status;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-blue-800 text-white p-4 rounded-t-xl">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold">{job.roPo}</h2>
              <p className="text-blue-200">{job.vehicle}</p>
            </div>
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white text-2xl leading-none"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span className={`status-pill ${job.status.replace('_', '-')}`}>
              {getStatusDisplay(job.status)}
            </span>
            {job.priority === 'urgent' && (
              <span className="status-pill bg-red-100 text-red-700">Urgent</span>
            )}
          </div>

          {/* Shop Info */}
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="font-semibold text-gray-800">{job.shop}</div>
            {job.shopAddress && (
              <div className="text-sm text-gray-600 mt-1">{job.shopAddress}</div>
            )}
            {job.shopAddress && (
              <button
                onClick={() => onDirections(job.shopAddress)}
                className="mt-2 flex items-center gap-1 text-blue-600 text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Get Directions
              </button>
            )}
          </div>

          {/* Schedule */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-500">Date</div>
              <div className="font-medium">{job.scheduledDate || 'Not scheduled'}</div>
            </div>
            <div>
              <div className="text-gray-500">Time</div>
              <div className="font-medium">{job.scheduledTime || 'TBD'}</div>
            </div>
          </div>

          {/* VIN */}
          {job.fullVin && (
            <div className="text-sm">
              <div className="text-gray-500">VIN</div>
              <div className="font-mono">{job.fullVin}</div>
            </div>
          )}

          {/* Calibrations */}
          {job.calibrations && job.calibrations.length > 0 && (
            <div>
              <div className="text-gray-500 text-sm mb-2">Required Calibrations</div>
              <div className="flex flex-wrap gap-1">
                {job.calibrations.map((cal, i) => (
                  <span key={i} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                    {cal}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {job.notes && (
            <div className="text-sm">
              <div className="text-gray-500">Notes</div>
              <div className="bg-yellow-50 p-2 rounded mt-1">{job.notes}</div>
            </div>
          )}

          {/* Actions */}
          {(job.status === 'pending_review' || job.status === 'scheduled') && !showRejectForm && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleAccept}
                disabled={loading}
                className="flex-1 bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Accept Job'}
              </button>
              <button
                onClick={() => setShowRejectForm(true)}
                disabled={loading}
                className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-lg font-semibold hover:bg-gray-300 disabled:opacity-50"
              >
                Can't Do
              </button>
            </div>
          )}

          {/* Reject Form */}
          {showRejectForm && (
            <div className="space-y-3 pt-2">
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason for declining..."
                className="w-full border rounded-lg p-3 text-sm"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleReject}
                  disabled={loading}
                  className="flex-1 bg-red-600 text-white py-2 rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50"
                >
                  {loading ? 'Processing...' : 'Confirm Decline'}
                </button>
                <button
                  onClick={() => setShowRejectForm(false)}
                  className="flex-1 bg-gray-200 text-gray-800 py-2 rounded-lg font-semibold hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// PWA Install Banner
function InstallBanner({ onInstall, onDismiss }) {
  return (
    <div className="install-banner">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <div className="font-semibold">Add to Home Screen</div>
          <div className="text-sm text-blue-200">Get notifications & quick access</div>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onInstall}
          className="bg-white text-blue-800 px-4 py-2 rounded-lg font-semibold text-sm"
        >
          Install
        </button>
        <button
          onClick={onDismiss}
          className="text-white/70 hover:text-white px-2"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

// Main Calendar App
function CalendarApp() {
  const [techName, setTechName] = useState(getSavedTechName());
  const [weekStart, setWeekStart] = useState(getWeekStart(new Date()));
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const deferredPromptRef = useRef(null);

  const weekDates = getWeekDates(weekStart);

  // Check for PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      deferredPromptRef.current = e;
      setShowInstallBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setShowInstallBanner(false);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Check URL params for job/action
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('job');
    const action = params.get('action');

    if (jobId && jobs.length > 0) {
      const job = jobs.find(j => j.roPo === jobId || j.id === `RO-${jobId}`);
      if (job) {
        setSelectedJob(job);
        if (action === 'accept') {
          handleAcceptJob(jobId);
        }
      }
      // Clear URL params
      window.history.replaceState({}, '', '/tech/calendar.html');
    }
  }, [jobs]);

  // Listen for service worker messages
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data.type === 'NOTIFICATION_CLICK') {
          const { data } = event.data;
          if (data.roPo) {
            const job = jobs.find(j => j.roPo === data.roPo);
            if (job) setSelectedJob(job);
          }
        }
      });
    }
  }, [jobs]);

  // Fetch jobs when tech name or week changes
  const fetchJobs = useCallback(async () => {
    if (!techName) return;

    setLoading(true);
    setError(null);

    try {
      const startDate = formatDate(weekDates[0]);
      const endDate = formatDate(weekDates[6]);

      const result = await apiCall('/calendar/jobs', {
        method: 'POST',
        body: JSON.stringify({
          technician: techName,
          startDate,
          endDate
        })
      });

      setJobs(result.jobs || []);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
      setError(err.message);
    }

    setLoading(false);
  }, [techName, weekStart]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Handle tech name change
  const handleTechChange = (name) => {
    setTechName(name);
    saveTechName(name);
  };

  // Navigate weeks
  const goToPrevWeek = () => {
    const newStart = new Date(weekStart);
    newStart.setDate(newStart.getDate() - 7);
    setWeekStart(newStart);
  };

  const goToNextWeek = () => {
    const newStart = new Date(weekStart);
    newStart.setDate(newStart.getDate() + 7);
    setWeekStart(newStart);
  };

  const goToToday = () => {
    setWeekStart(getWeekStart(new Date()));
  };

  // Handle job actions
  const handleAcceptJob = async (roPo) => {
    await apiCall('/calendar/accept-job', {
      method: 'POST',
      body: JSON.stringify({ roPo, technician: techName })
    });
    fetchJobs();
  };

  const handleRejectJob = async (roPo, reason) => {
    await apiCall('/calendar/reject-job', {
      method: 'POST',
      body: JSON.stringify({ roPo, technician: techName, reason })
    });
    fetchJobs();
  };

  const handleDirections = (address) => {
    const encoded = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`, '_blank');
  };

  // PWA Install
  const handleInstall = async () => {
    if (deferredPromptRef.current) {
      deferredPromptRef.current.prompt();
      const result = await deferredPromptRef.current.userChoice;
      console.log('Install prompt result:', result);
      deferredPromptRef.current = null;
      setShowInstallBanner(false);
    }
  };

  // Push notifications
  const enableNotifications = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Notification permission denied');
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      // Get VAPID public key
      const keyResponse = await fetch('/api/tech/calendar/vapid-key');
      const { publicKey } = await keyResponse.json();

      if (!publicKey) {
        alert('Push notifications not configured on server');
        return;
      }

      // Convert VAPID key
      const applicationServerKey = urlBase64ToUint8Array(publicKey);

      // Subscribe
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });

      // Send to server
      await apiCall('/calendar/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          subscription,
          technician: techName
        })
      });

      setNotificationsEnabled(true);
      alert('Notifications enabled! You will be notified of new job assignments.');
    } catch (err) {
      console.error('Failed to enable notifications:', err);
      alert('Failed to enable notifications: ' + err.message);
    }
  };

  // Group jobs by date and time slot
  const getJobsForSlot = (date, timeSlot) => {
    const dateStr = formatDate(date);
    const slotHour = parseTimeToHour(timeSlot);

    return jobs.filter(job => {
      if (job.scheduledDate !== dateStr) return false;
      const jobHour = parseTimeToHour(job.scheduledTime);
      return jobHour === slotHour;
    });
  };

  // Get job count for a slot
  const getSlotCount = (date, timeSlot) => {
    return getJobsForSlot(date, timeSlot).length;
  };

  // Count pending jobs
  const pendingCount = jobs.filter(j =>
    j.status === 'pending_review' || j.status === 'scheduled'
  ).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-800 text-white">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">ADAS F1RST</h1>
            <p className="text-blue-200 text-sm">Tech Calendar</p>
          </div>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                {pendingCount}
              </span>
            )}
            {!notificationsEnabled && 'Notification' in window && (
              <button
                onClick={enableNotifications}
                className="p-2 hover:bg-blue-700 rounded-lg"
                title="Enable notifications"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Tech Selector */}
        <div className="px-4 pb-3">
          <select
            value={techName}
            onChange={e => handleTechChange(e.target.value)}
            className="w-full bg-blue-700 border border-blue-600 rounded-lg px-3 py-2 text-white"
          >
            <option value="">Select Technician...</option>
            {TECH_NAMES.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Week Navigation */}
      <div className="week-nav sticky top-0 z-10 bg-white shadow-sm">
        <button onClick={goToPrevWeek} className="flex items-center gap-1">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Prev
        </button>

        <div className="text-center">
          <div className="font-semibold">
            {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
          <button onClick={goToToday} className="text-blue-600 text-sm font-medium">
            Today
          </button>
        </div>

        <button onClick={goToNextWeek} className="flex items-center gap-1">
          Next
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Calendar Content */}
      <div className="p-2 overflow-x-auto">
        {loading && (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        )}

        {error && (
          <div className="text-center py-8 text-red-500">
            Error: {error}
            <button onClick={fetchJobs} className="block mx-auto mt-2 text-blue-600">
              Retry
            </button>
          </div>
        )}

        {!loading && !error && !techName && (
          <div className="text-center py-12 text-gray-500">
            <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <p>Select a technician to view their schedule</p>
          </div>
        )}

        {!loading && !error && techName && (
          <div className="calendar-grid" style={{ minWidth: '600px' }}>
            {/* Header Row - Days */}
            <div className="day-header">Time</div>
            {weekDates.map((date, i) => (
              <div
                key={i}
                className={`day-header ${isToday(date) ? 'today' : ''}`}
              >
                <div>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]}</div>
                <div className="text-lg">{date.getDate()}</div>
              </div>
            ))}

            {/* Time Slots */}
            {TIME_SLOTS.map((slot, slotIndex) => (
              <React.Fragment key={slot}>
                {/* Time Label */}
                <div className="time-slot">
                  {slot}
                </div>

                {/* Day Cells */}
                {weekDates.map((date, dayIndex) => {
                  const slotJobs = getJobsForSlot(date, slot);
                  const count = slotJobs.length;
                  const isFull = count >= MAX_PER_HOUR;

                  return (
                    <div
                      key={`${slotIndex}-${dayIndex}`}
                      className={`day-cell ${isToday(date) ? 'today' : ''} ${isFull ? 'full' : ''}`}
                    >
                      {slotJobs.map(job => (
                        <JobCard
                          key={job.id}
                          job={job}
                          onClick={setSelectedJob}
                        />
                      ))}
                      {count > 0 && (
                        <CapacityBar count={count} />
                      )}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {!loading && techName && jobs.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 flex justify-around text-center text-sm">
          <div>
            <div className="text-2xl font-bold text-blue-600">{jobs.length}</div>
            <div className="text-gray-500">Total Jobs</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-500">{pendingCount}</div>
            <div className="text-gray-500">Pending</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {jobs.filter(j => j.status === 'completed').length}
            </div>
            <div className="text-gray-500">Completed</div>
          </div>
        </div>
      )}

      {/* Job Detail Modal */}
      {selectedJob && (
        <JobModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onAccept={handleAcceptJob}
          onReject={handleRejectJob}
          onDirections={handleDirections}
        />
      )}

      {/* Install Banner */}
      {showInstallBanner && (
        <InstallBanner
          onInstall={handleInstall}
          onDismiss={() => setShowInstallBanner(false)}
        />
      )}
    </div>
  );
}

// Utility: Convert VAPID key for push subscription
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Render the app
ReactDOM.createRoot(document.getElementById('root')).render(<CalendarApp />);
