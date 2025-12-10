/**
 * scheduleController.js - Scheduling controller for shop portal
 *
 * Handles scheduling calibration appointments
 */

import sheetWriter from '../services/sheetWriter.js';
import { validateShopAccess } from '../middleware/shopFilter.js';
import { getESTTimestamp } from '../utils/timezone.js';

const LOG_TAG = '[SCHEDULE_CTRL]';

// Prerequisites checklist items
const PREREQUISITES = [
  { id: 'bumper', label: 'Bumper/fascia installed' },
  { id: 'sensors', label: 'ADAS sensors mounted' },
  { id: 'coding', label: 'Module coding complete (if applicable)' },
  { id: 'alignment', label: 'Wheel alignment done' },
  { id: 'battery', label: 'Battery charged' }
];

/**
 * GET /api/portal/schedule/prerequisites
 * Get the list of prerequisites for scheduling
 */
export async function getPrerequisites(req, res) {
  res.json({
    success: true,
    prerequisites: PREREQUISITES
  });
}

/**
 * POST /api/portal/schedule
 * Schedule a calibration appointment
 */
export async function scheduleAppointment(req, res) {
  try {
    const { roPo, date, time, prerequisites, notes } = req.body;
    const shopName = req.shopFilter.shopName;

    // Validate required fields
    if (!roPo) {
      return res.status(400).json({
        success: false,
        error: 'RO/PO number is required'
      });
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Date is required'
      });
    }

    console.log(`${LOG_TAG} Scheduling appointment: RO ${roPo} for ${date} ${time || 'TBD'}`);

    // Look up the RO to validate shop access
    const existingRow = await sheetWriter.getScheduleRowByRO(roPo);

    if (!existingRow) {
      return res.status(404).json({
        success: false,
        error: `Vehicle with RO ${roPo} not found`
      });
    }

    // Validate shop access
    const rowShop = existingRow.shopName || existingRow.shop_name || existingRow.shop || '';
    if (!validateShopAccess(rowShop, shopName)) {
      console.log(`${LOG_TAG} Access denied: ${shopName} tried to schedule ${rowShop}'s vehicle`);
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Check current status - block if "No Cal"
    const currentStatus = existingRow.status || '';
    if (currentStatus.toLowerCase() === 'no cal') {
      return res.status(400).json({
        success: false,
        error: 'This vehicle does not require ADAS calibration based on the analysis.'
      });
    }

    // Build prerequisites note
    let prereqNote = '';
    if (prerequisites && Array.isArray(prerequisites) && prerequisites.length > 0) {
      const confirmedPrereqs = PREREQUISITES
        .filter(p => prerequisites.includes(p.id))
        .map(p => p.label);
      if (confirmedPrereqs.length > 0) {
        prereqNote = `Prerequisites confirmed: ${confirmedPrereqs.join(', ')}`;
      }
    }

    // Build status change note
    const timestamp = getESTTimestamp();
    const statusChangeNote = `Scheduled via portal${notes ? `: ${notes}` : ''}${prereqNote ? `. ${prereqNote}` : ''}`;

    // Update the schedule
    const result = await sheetWriter.setSchedule(roPo, {
      scheduledDate: date,
      scheduledTime: time || '',
      notes: `[${timestamp}] ${statusChangeNote}`
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to schedule appointment'
      });
    }

    console.log(`${LOG_TAG} Appointment scheduled: RO ${roPo} for ${date} ${time || 'TBD'}`);

    res.json({
      success: true,
      message: `Appointment scheduled for ${date}${time ? ' at ' + time : ''}`,
      roPo: roPo,
      scheduledDate: date,
      scheduledTime: time || ''
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error scheduling appointment:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to schedule appointment'
    });
  }
}

/**
 * PUT /api/portal/schedule/:roPo
 * Update/reschedule an existing appointment
 */
export async function updateSchedule(req, res) {
  try {
    const { roPo } = req.params;
    const { date, time, reason, notes } = req.body;
    const shopName = req.shopFilter.shopName;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'New date is required'
      });
    }

    console.log(`${LOG_TAG} Rescheduling: RO ${roPo} to ${date} ${time || 'TBD'}`);

    // Look up the RO to validate shop access
    const existingRow = await sheetWriter.getScheduleRowByRO(roPo);

    if (!existingRow) {
      return res.status(404).json({
        success: false,
        error: `Vehicle with RO ${roPo} not found`
      });
    }

    // Validate shop access
    const rowShop = existingRow.shopName || existingRow.shop_name || existingRow.shop || '';
    if (!validateShopAccess(rowShop, shopName)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Get old schedule info for notes
    const oldDate = existingRow.scheduledDate || existingRow.scheduled_date || '';
    const oldTime = existingRow.scheduledTime || existingRow.scheduled_time || '';

    // Build status change note
    const statusChangeNote = `Rescheduled via portal from ${oldDate || 'unscheduled'} ${oldTime || ''} to ${date} ${time || ''}${reason ? `: ${reason}` : ''}`;

    // Update with full notes
    const result = await sheetWriter.updateScheduleRowWithFullNotes(roPo, {
      status: 'Rescheduled',
      scheduledDate: date,
      scheduledTime: time || '',
      statusChangeNote: statusChangeNote
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to reschedule'
      });
    }

    console.log(`${LOG_TAG} Rescheduled: RO ${roPo} to ${date} ${time || 'TBD'}`);

    res.json({
      success: true,
      message: `Appointment rescheduled to ${date}${time ? ' at ' + time : ''}`,
      roPo: roPo,
      scheduledDate: date,
      scheduledTime: time || ''
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error rescheduling:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to reschedule appointment'
    });
  }
}

/**
 * DELETE /api/portal/schedule/:roPo
 * Cancel a scheduled appointment
 */
export async function cancelSchedule(req, res) {
  try {
    const { roPo } = req.params;
    const { reason } = req.body;
    const shopName = req.shopFilter.shopName;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Cancellation reason is required'
      });
    }

    console.log(`${LOG_TAG} Cancelling: RO ${roPo}`);

    // Look up the RO to validate shop access
    const existingRow = await sheetWriter.getScheduleRowByRO(roPo);

    if (!existingRow) {
      return res.status(404).json({
        success: false,
        error: `Vehicle with RO ${roPo} not found`
      });
    }

    // Validate shop access
    const rowShop = existingRow.shopName || existingRow.shop_name || existingRow.shop || '';
    if (!validateShopAccess(rowShop, shopName)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    // Update with cancellation
    const result = await sheetWriter.updateScheduleRowWithFullNotes(roPo, {
      status: 'Cancelled',
      statusChangeNote: `Cancelled via portal: ${reason}`
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to cancel'
      });
    }

    console.log(`${LOG_TAG} Cancelled: RO ${roPo}`);

    res.json({
      success: true,
      message: 'Appointment cancelled',
      roPo: roPo
    });
  } catch (err) {
    console.error(`${LOG_TAG} Error cancelling:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel appointment'
    });
  }
}

export default {
  getPrerequisites,
  scheduleAppointment,
  updateSchedule,
  cancelSchedule
};
