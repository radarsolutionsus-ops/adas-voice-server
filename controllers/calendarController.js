/**
 * calendarController.js - Controller for Tech Portal Calendar
 *
 * Provides calendar-specific endpoints:
 *   - Get jobs for a technician by date range
 *   - Accept/Reject job assignments
 *   - Log arrival/completion
 *   - Get slot capacity information
 *   - Push notification subscription
 */

import sheetWriter from '../services/sheetWriter.js';
import { getESTTimestamp } from '../utils/timezone.js';
import webpush from 'web-push';
import axios from 'axios';

const LOG_TAG = '[CALENDAR]';

// VAPID keys for push notifications
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
const GAS_TOKEN = process.env.GAS_TOKEN;

// Configure web-push if VAPID keys are available
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:randy@adasf1rst.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  console.log(`${LOG_TAG} Web push configured with VAPID keys`);
}

// Store push subscriptions (techName -> subscription)
const pushSubscriptions = new Map();

/**
 * Map internal status to calendar display status
 */
function mapJobStatus(status) {
  const map = {
    'New': 'pending_review',
    'Ready': 'accepted',
    'Scheduled': 'scheduled',
    'Rescheduled': 'scheduled',
    'In Progress': 'in_progress',
    'On Site': 'in_progress',
    'En Route': 'en_route',
    'Completed': 'completed',
    'Needs Attention': 'pending_review',
    'Not Ready': 'pending_review',
    'No Cal': 'no_cal',
    'Cancelled': 'cancelled'
  };
  return map[status] || 'pending_review';
}

/**
 * Determine job priority based on various factors
 */
function determineJobPriority(job) {
  const today = new Date().toISOString().split('T')[0];

  // Urgent if scheduled for today or past
  if (job.scheduledDate && job.scheduledDate <= today) {
    return 'urgent';
  }

  // High priority for many calibrations
  const cals = (job.requiredCalibrations || '').split(',').filter(Boolean);
  if (cals.length >= 3) {
    return 'high';
  }

  // High priority for luxury/high-value vehicles
  const highValue = ['mercedes', 'bmw', 'audi', 'porsche', 'tesla', 'lexus', 'infiniti'];
  if (highValue.some(b => (job.vehicle || '').toLowerCase().includes(b))) {
    return 'high';
  }

  return 'normal';
}

/**
 * Parse time string to hour (24h format)
 */
function parseScheduleTime(timeStr) {
  const match = (timeStr || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return 9; // Default to 9 AM

  let hour = parseInt(match[1]);
  if (match[3].toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (match[3].toUpperCase() === 'AM' && hour === 12) hour = 0;
  return hour;
}

/**
 * POST /api/tech/calendar/jobs
 * Get jobs for technician with date range
 */
export async function getCalendarJobs(req, res) {
  try {
    const { technician, startDate, endDate } = req.body;
    const user = req.user;

    const techName = technician || user?.techName;

    if (!techName) {
      return res.status(400).json({ success: false, error: 'Technician name required' });
    }

    console.log(`${LOG_TAG} Getting calendar jobs for ${techName} (${startDate} to ${endDate})`);

    // Try to get data via GAS for shop addresses, fallback to local
    let jobs = [];
    let shopAddresses = {};

    try {
      // Call GAS to get tech schedule with shop addresses
      const response = await axios.post(GAS_WEBHOOK_URL, {
        token: GAS_TOKEN,
        action: 'get_tech_schedule',
        data: { technician: techName, startDate, endDate }
      }, { timeout: 15000 });

      if (response.data.success) {
        jobs = response.data.jobs || [];
        // Build shop address map from response
        jobs.forEach(job => {
          if (job.shop_address) {
            shopAddresses[job.shop_name?.toLowerCase()] = job.shop_address;
          }
        });
      }
    } catch (gasError) {
      console.log(`${LOG_TAG} GAS call failed, using local data:`, gasError.message);
    }

    // If GAS failed or returned no data, fallback to local sheetWriter
    if (jobs.length === 0) {
      const result = await sheetWriter.getAllScheduleRows();
      if (result.success) {
        const allRows = result.rows || [];

        // Filter by technician
        jobs = allRows.filter(row => {
          const rowTech = (row.technician || row.technicianAssigned || '').toLowerCase();
          return rowTech === techName.toLowerCase();
        });

        // Filter by date range if provided
        if (startDate || endDate) {
          jobs = jobs.filter(job => {
            const jobDate = job.scheduledDate || '';
            if (startDate && jobDate && jobDate < startDate) return false;
            if (endDate && jobDate && jobDate > endDate) return false;
            return true;
          });
        }
      }
    }

    // Format jobs for calendar display
    const formattedJobs = jobs.map(job => ({
      id: `RO-${job.roPo || job.ro_po}`,
      roPo: job.roPo || job.ro_po,
      shop: job.shopName || job.shop_name,
      shopAddress: job.shop_address || shopAddresses[(job.shopName || job.shop_name || '').toLowerCase()] || '',
      vehicle: job.vehicle,
      vin: job.vin ? `...${job.vin.slice(-4)}` : '',
      fullVin: job.vin || '',
      calibrations: (job.requiredCalibrations || job.required_calibrations || '').split(',').map(c => c.trim()).filter(Boolean),
      status: mapJobStatus(job.status),
      rawStatus: job.status,
      scheduledDate: job.scheduledDate || job.scheduled_date,
      scheduledTime: job.scheduledTime || job.scheduled_time || '09:00 AM',
      notes: job.notes || '',
      priority: determineJobPriority(job),
      dtcs: job.dtcs || '',
      estimatePdf: job.estimatePdf || job.estimate_pdf || '',
      revvReportPdf: job.revvReportPdf || job.revv_report_pdf || ''
    }));

    res.json({ success: true, jobs: formattedJobs, count: formattedJobs.length });
  } catch (error) {
    console.error(`${LOG_TAG} Error fetching calendar jobs:`, error);
    res.status(500).json({ success: false, error: 'Failed to fetch jobs' });
  }
}

/**
 * POST /api/tech/calendar/accept-job
 * Accept a job assignment
 */
export async function acceptJob(req, res) {
  try {
    const { roPo } = req.body;
    const user = req.user;
    const technician = req.body.technician || user?.techName;

    if (!roPo || !technician) {
      return res.status(400).json({ success: false, error: 'RO/PO and technician required' });
    }

    console.log(`${LOG_TAG} Job ${roPo} accepted by ${technician}`);

    const timestamp = getESTTimestamp();
    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      status: 'Scheduled',
      notes: `Job accepted by ${technician} at ${timestamp}`
    });

    if (result.success) {
      res.json({ success: true, message: `Job ${roPo} accepted` });
    } else {
      res.status(400).json({ success: false, error: result.error || 'Failed to accept job' });
    }
  } catch (error) {
    console.error(`${LOG_TAG} Error accepting job:`, error);
    res.status(500).json({ success: false, error: 'Failed to accept job' });
  }
}

/**
 * POST /api/tech/calendar/reject-job
 * Reject/decline a job assignment
 */
export async function rejectJob(req, res) {
  try {
    const { roPo, reason } = req.body;
    const user = req.user;
    const technician = req.body.technician || user?.techName;

    if (!roPo || !technician) {
      return res.status(400).json({ success: false, error: 'RO/PO and technician required' });
    }

    console.log(`${LOG_TAG} Job ${roPo} declined by ${technician}: ${reason || 'No reason'}`);

    const timestamp = getESTTimestamp();
    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      technician: '', // Unassign the tech
      status: 'Ready', // Back to ready for reassignment
      notes: `Job declined by ${technician}: ${reason || 'No reason'} at ${timestamp}`
    });

    res.json({ success: result.success, message: result.success ? 'Job declined' : result.error });
  } catch (error) {
    console.error(`${LOG_TAG} Error declining job:`, error);
    res.status(500).json({ success: false, error: 'Failed to decline job' });
  }
}

/**
 * POST /api/tech/calendar/log-arrival
 * Log arrival at shop location
 */
export async function logArrival(req, res) {
  try {
    const { roPo } = req.body;
    const user = req.user;
    const technician = req.body.technician || user?.techName;

    if (!roPo) {
      return res.status(400).json({ success: false, error: 'RO/PO required' });
    }

    const timestamp = getESTTimestamp();
    const result = await sheetWriter.upsertScheduleRowByRO(roPo, {
      status: 'In Progress',
      jobStart: timestamp,
      notes: `Tech ${technician} arrived at ${timestamp}`
    });

    console.log(`${LOG_TAG} Arrival logged for ${roPo} by ${technician}`);
    res.json({ success: result.success, arrivalTime: timestamp });
  } catch (error) {
    console.error(`${LOG_TAG} Error logging arrival:`, error);
    res.status(500).json({ success: false, error: 'Failed to log arrival' });
  }
}

/**
 * POST /api/tech/calendar/log-completion
 * Log job completion
 */
export async function logCompletion(req, res) {
  try {
    const { roPo, completedCalibrations, notes } = req.body;
    const user = req.user;
    const technician = req.body.technician || user?.techName;

    if (!roPo) {
      return res.status(400).json({ success: false, error: 'RO/PO required' });
    }

    const timestamp = getESTTimestamp();
    const updateData = {
      status: 'Completed',
      jobEnd: timestamp,
      notes: `Completed by ${technician} at ${timestamp}. ${notes || ''}`
    };

    if (completedCalibrations) {
      updateData.completedCalibrations = Array.isArray(completedCalibrations)
        ? completedCalibrations.join(', ')
        : completedCalibrations;
    }

    const result = await sheetWriter.upsertScheduleRowByRO(roPo, updateData);

    console.log(`${LOG_TAG} Completion logged for ${roPo} by ${technician}`);
    res.json({ success: result.success, completionTime: timestamp });
  } catch (error) {
    console.error(`${LOG_TAG} Error logging completion:`, error);
    res.status(500).json({ success: false, error: 'Failed to log completion' });
  }
}

/**
 * POST /api/tech/calendar/capacity
 * Get slot capacity for a technician on a specific date
 */
export async function getCapacity(req, res) {
  try {
    const { technician, date } = req.body;
    const MAX_PER_HOUR = 3;

    if (!technician || !date) {
      return res.status(400).json({ success: false, error: 'Technician and date required' });
    }

    console.log(`${LOG_TAG} Getting capacity for ${technician} on ${date}`);

    // Get all jobs for this tech on this date
    const result = await sheetWriter.getAllScheduleRows();
    if (!result.success) {
      return res.status(500).json({ success: false, error: 'Failed to fetch schedule' });
    }

    const jobs = (result.rows || []).filter(row => {
      const rowTech = (row.technician || row.technicianAssigned || '').toLowerCase();
      const rowDate = row.scheduledDate || '';
      return rowTech === technician.toLowerCase() && rowDate === date;
    });

    // Count jobs per hour
    const hourCounts = {};
    jobs.forEach(job => {
      const hour = parseScheduleTime(job.scheduledTime || '09:00 AM');
      const key = hour.toString().padStart(2, '0');
      hourCounts[key] = (hourCounts[key] || 0) + 1;
    });

    // Build availability for each time slot
    const timeSlots = [
      '08:00 AM', '09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
      '01:00 PM', '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM'
    ];

    const availability = timeSlots.map(slot => {
      const hour = parseScheduleTime(slot);
      const key = hour.toString().padStart(2, '0');
      const count = hourCounts[key] || 0;
      return {
        time: slot,
        hour,
        count,
        available: MAX_PER_HOUR - count,
        isFull: count >= MAX_PER_HOUR
      };
    });

    res.json({
      success: true,
      date,
      technician,
      maxPerHour: MAX_PER_HOUR,
      totalJobs: jobs.length,
      availability
    });
  } catch (error) {
    console.error(`${LOG_TAG} Error getting capacity:`, error);
    res.status(500).json({ success: false, error: 'Failed to get capacity' });
  }
}

/**
 * POST /api/tech/calendar/subscribe
 * Subscribe to push notifications
 */
export async function subscribeToNotifications(req, res) {
  try {
    const { subscription } = req.body;
    const user = req.user;
    const technician = req.body.technician || user?.techName;

    if (!subscription || !technician) {
      return res.status(400).json({ success: false, error: 'Subscription and technician required' });
    }

    pushSubscriptions.set(technician, subscription);
    console.log(`${LOG_TAG} ${technician} subscribed to push notifications`);

    res.json({ success: true, message: 'Subscribed to notifications' });
  } catch (error) {
    console.error(`${LOG_TAG} Subscription error:`, error);
    res.status(500).json({ success: false, error: 'Failed to subscribe' });
  }
}

/**
 * GET /api/tech/calendar/vapid-key
 * Get VAPID public key for client
 */
export function getVapidKey(req, res) {
  res.json({ publicKey: VAPID_PUBLIC_KEY || '' });
}

/**
 * Send push notification to a technician
 * Exported for use by other modules (e.g., when scheduling a job)
 */
export async function sendPushToTech(techName, notification) {
  const subscription = pushSubscriptions.get(techName);
  if (!subscription) {
    console.log(`${LOG_TAG} No push subscription for ${techName}`);
    return false;
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(notification));
    console.log(`${LOG_TAG} Push notification sent to ${techName}`);
    return true;
  } catch (error) {
    console.error(`${LOG_TAG} Failed to send push to ${techName}:`, error.message);
    // Remove invalid subscriptions
    if (error.statusCode === 410) {
      pushSubscriptions.delete(techName);
    }
    return false;
  }
}

/**
 * Get all push subscriptions (for admin use)
 */
export function getPushSubscriptions() {
  return new Map(pushSubscriptions);
}

export default {
  getCalendarJobs,
  acceptJob,
  rejectJob,
  logArrival,
  logCompletion,
  getCapacity,
  subscribeToNotifications,
  getVapidKey,
  sendPushToTech,
  getPushSubscriptions
};
