/**
 * dispatcher.js - High-level workflow functions for ADAS F1RST
 *
 * Shared business logic for:
 * - Technician assignment based on shop routing, time windows, day of week
 * - Blocker DTC detection
 * - Readiness checks
 * - Workflow status management
 *
 * RULESET A — TIME WINDOWS:
 *   Morning = 08:00–12:00 ET
 *   Afternoon = 12:00–17:00 ET
 *
 * RULESET B — DAY OF WEEK:
 *   Martin: Mon–Thu from 12:00–17:00; Fri–Sat all day
 *   Anthony: All day every day for CCNM
 *   Felipe: Default for most shops in morning
 *   Randy: Fallback and JMD primary
 *
 * RULESET C — GEOGRAPHY / DISTANCE (future enhancement):
 *   Zone 1 (Opa-Locka, Miami Gardens): Felipe, Anthony
 *   Zone 2 (Hialeah, Medley): Martin, Felipe
 *   Zone 3 (Doral, Sweetwater): Randy, Martin
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as sheetWriter from './sheetWriter.js';
import { extractROFromText, convertSpanishNumbersToDigits, padRO } from './estimateScrubber.js';

const LOG_TAG = '[DISPATCHER]';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Miami is in Eastern Time
const TIMEZONE = 'America/New_York';

// Scheduling constraints
const SCHEDULING_RULES = {
  earliestTime: 8.5,   // 8:30 AM in decimal hours
  latestTime: 16,      // 4:00 PM in decimal hours
  maxPerHourPerTech: 3, // Max 3 RO/POs per hour per technician
  workDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};

// Technician availability schedules
const TECH_SCHEDULES = {
  'Randy': {
    days: [1, 2, 3, 4, 5], // Mon-Fri (0=Sun, 1=Mon, etc.)
    startTime: 8.5,  // 8:30 AM
    endTime: 16      // 4:00 PM
  },
  'Felipe': {
    days: [1, 2, 3, 4, 5], // Mon-Fri
    startTime: 8.5,
    endTime: 16
  },
  'Anthony': {
    days: [1, 2, 3, 4, 5], // Mon-Fri
    startTime: 8.5,
    endTime: 16
  },
  'Martin': {
    days: [1, 2, 3, 4, 5, 6], // Mon-Sat
    startTime: 12.5, // 12:30 PM (afternoons only Mon-Fri)
    endTime: 16,
    saturdayHours: { startTime: 8.5, endTime: 16 } // All day Saturday
  }
};

// Load data files
let technicianAssignments = {};
let blockerDTCs = { codes: [], descriptions: {}, categories: {} };

function loadDataFiles() {
  try {
    const techPath = path.join(__dirname, '../data/technicianAssignments.json');
    const dtcPath = path.join(__dirname, '../data/blockerDTCs.json');

    if (fs.existsSync(techPath)) {
      technicianAssignments = JSON.parse(fs.readFileSync(techPath, 'utf8'));
      console.log(`${LOG_TAG} Loaded technician assignments for ${Object.keys(technicianAssignments).length} shops`);
    }

    if (fs.existsSync(dtcPath)) {
      blockerDTCs = JSON.parse(fs.readFileSync(dtcPath, 'utf8'));
      console.log(`${LOG_TAG} Loaded ${blockerDTCs.codes.length} blocker DTCs`);
    }
  } catch (err) {
    console.error(`${LOG_TAG} Failed to load data files:`, err.message);
  }
}

// Load data files on module init
loadDataFiles();

// Track tech assignment rotation
const techRotation = {};

// Martin's working hours: Mon-Fri 12:30-4:00 PM, Sat all day 8:30-4:00 PM
const MARTIN_SCHEDULE = {
  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  0: null, // Sunday - off
  1: { start: 12.5, end: 16 }, // Monday - 12:30 PM to 4:00 PM
  2: { start: 12.5, end: 16 }, // Tuesday - 12:30 PM to 4:00 PM
  3: { start: 12.5, end: 16 }, // Wednesday - 12:30 PM to 4:00 PM
  4: { start: 12.5, end: 16 }, // Thursday - 12:30 PM to 4:00 PM
  5: { start: 12.5, end: 16 }, // Friday - 12:30 PM to 4:00 PM
  6: { start: 8.5, end: 16 }   // Saturday - 8:30 AM to 4:00 PM (all day)
};

/**
 * Parse time string to decimal hours
 * @param {string} timeStr - Time like "10:00 AM", "2:30 PM", "14:00"
 * @returns {number} - Decimal hours (e.g., 14.5 for 2:30 PM)
 */
function parseTimeToDecimalHours(timeStr) {
  if (!timeStr) return null;

  const normalized = timeStr.toString().trim().toUpperCase();
  let hours = 0;
  let minutes = 0;

  // Try 12-hour format (e.g., "10:00 AM", "2:30 PM")
  const match12 = normalized.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/i);
  if (match12) {
    hours = parseInt(match12[1], 10);
    minutes = match12[2] ? parseInt(match12[2], 10) : 0;
    const isPM = match12[3] === 'PM';
    const isAM = match12[3] === 'AM';

    if (isPM && hours !== 12) hours += 12;
    if (isAM && hours === 12) hours = 0;
  } else {
    // Try 24-hour format (e.g., "14:30")
    const match24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      hours = parseInt(match24[1], 10);
      minutes = parseInt(match24[2], 10);
    }
  }

  return hours + (minutes / 60);
}

/**
 * Check if a technician is available for a specific time slot
 * @param {string} techName - Technician name
 * @param {number} dayOfWeek - Day of week (0=Sun, 6=Sat)
 * @param {string} timeStr - Time string
 * @returns {{available: boolean, reason?: string}}
 */
function checkTechAvailability(techName, dayOfWeek, timeStr) {
  const schedule = TECH_SCHEDULES[techName];
  if (!schedule) {
    return { available: true }; // Unknown tech, assume available
  }

  // Check if tech works this day
  if (!schedule.days.includes(dayOfWeek)) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return {
      available: false,
      reason: `${techName} does not work on ${dayNames[dayOfWeek]}s`
    };
  }

  const requestedHour = parseTimeToDecimalHours(timeStr);
  if (requestedHour === null) {
    return { available: true }; // Can't parse time, assume available
  }

  // Special handling for Martin on Saturday (all day)
  let startTime = schedule.startTime;
  let endTime = schedule.endTime;
  if (techName === 'Martin' && dayOfWeek === 6 && schedule.saturdayHours) {
    startTime = schedule.saturdayHours.startTime;
    endTime = schedule.saturdayHours.endTime;
  }

  // Check if time is within tech's hours
  if (requestedHour < startTime) {
    const startFormatted = formatDecimalHoursToTime(startTime);
    return {
      available: false,
      reason: `${techName} is only available after ${startFormatted}`
    };
  }

  if (requestedHour >= endTime) {
    const endFormatted = formatDecimalHoursToTime(endTime);
    return {
      available: false,
      reason: `${techName} is not available after ${endFormatted}`
    };
  }

  return { available: true };
}

/**
 * Format decimal hours to time string
 * @param {number} decimalHours - e.g., 12.5 for 12:30 PM
 * @returns {string} - e.g., "12:30 PM"
 */
function formatDecimalHoursToTime(decimalHours) {
  const hours = Math.floor(decimalHours);
  const minutes = Math.round((decimalHours - hours) * 60);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

/**
 * Get current time window based on Miami (ET) time
 * @returns {'morning' | 'afternoon' | 'off_hours'}
 */
function getCurrentTimeWindow() {
  const now = new Date();
  const miamiTime = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
  const hour = miamiTime.getHours();

  if (hour >= 8 && hour < 12) {
    return 'morning';
  } else if (hour >= 12 && hour < 17) {
    return 'afternoon';
  }
  return 'off_hours';
}

/**
 * Get current day of week (0 = Sunday, 6 = Saturday)
 * @returns {number}
 */
function getCurrentDayOfWeek() {
  const now = new Date();
  const miamiTime = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
  return miamiTime.getDay();
}

/**
 * Check if Martin is available based on his schedule
 * @returns {boolean}
 */
function isMartinAvailable() {
  const dayOfWeek = getCurrentDayOfWeek();
  const schedule = MARTIN_SCHEDULE[dayOfWeek];

  if (!schedule) {
    console.log(`${LOG_TAG} Martin is off on day ${dayOfWeek}`);
    return false;
  }

  const now = new Date();
  const miamiTime = new Date(now.toLocaleString('en-US', { timeZone: TIMEZONE }));
  const hour = miamiTime.getHours();

  const available = hour >= schedule.start && hour < schedule.end;
  console.log(`${LOG_TAG} Martin availability check: day=${dayOfWeek}, hour=${hour}, available=${available}`);
  return available;
}

/**
 * PATCH B: Check if a time is in the morning (before 12:00)
 * @param {string} timeStr - Time string like "10:00 AM" or "14:00"
 * @returns {boolean} - True if morning (hour < 12)
 */
function isMorningTime(timeStr) {
  if (!timeStr) return false;

  // Parse time string (handles "10:00 AM", "2:00 PM", "14:00", etc.)
  const normalized = timeStr.toString().trim().toUpperCase();
  let hour = 0;

  // Try 12-hour format first (e.g., "10:00 AM")
  const match12 = normalized.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/i);
  if (match12) {
    hour = parseInt(match12[1], 10);
    const isPM = match12[3] === 'PM';
    const isAM = match12[3] === 'AM';

    if (isPM && hour !== 12) hour += 12;
    if (isAM && hour === 12) hour = 0;
  } else {
    // Try 24-hour format (e.g., "14:00")
    const match24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      hour = parseInt(match24[1], 10);
    }
  }

  return hour < 12;
}

/**
 * PATCH B: Check if Martin is allowed for a specific scheduled time
 * Martin is ONLY allowed for afternoon jobs (12:00 and later)
 * @param {string} scheduledTime - Scheduled time string
 * @returns {boolean} - True if Martin can be assigned
 */
function isMartinAllowedForTime(scheduledTime) {
  if (!scheduledTime) {
    // If no scheduled time, fall back to current time check
    return isMartinAvailable();
  }

  const isMorning = isMorningTime(scheduledTime);
  if (isMorning) {
    console.log(`${LOG_TAG} Martin NOT allowed for morning time: ${scheduledTime}`);
    return false;
  }

  // Also check Martin's day schedule
  return isMartinAvailable();
}

/**
 * Validate scheduling time is within business hours (8:30 AM - 4:00 PM)
 * @param {string} timeStr - Time string
 * @returns {{valid: boolean, error?: string}}
 */
export function validateSchedulingTime(timeStr) {
  const hour = parseTimeToDecimalHours(timeStr);
  if (hour === null) {
    return { valid: true }; // Can't parse, assume valid
  }

  if (hour < SCHEDULING_RULES.earliestTime) {
    return {
      valid: false,
      error: 'Scheduling only available 8:30 AM to 4:00 PM. The requested time is too early.'
    };
  }

  if (hour >= SCHEDULING_RULES.latestTime) {
    return {
      valid: false,
      error: 'Scheduling only available 8:30 AM to 4:00 PM. The requested time is too late.'
    };
  }

  return { valid: true };
}

/**
 * Get technician bookings for a specific hour
 * @param {string} technician - Technician name
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} hour - Hour in decimal (e.g., 10.5 for 10:30)
 * @returns {Promise<number>} - Count of bookings
 */
async function getTechBookingsForHour(technician, date, hour) {
  try {
    const jobs = await sheetWriter.getScheduledJobsForTechOnDate(technician, date);
    let count = 0;

    for (const job of jobs) {
      const jobTime = job.scheduled_time || job.scheduledTime;
      if (jobTime) {
        const jobHour = parseTimeToDecimalHours(jobTime);
        // Count jobs within the same hour window
        if (jobHour !== null && Math.floor(jobHour) === Math.floor(hour)) {
          count++;
        }
      }
    }

    return count;
  } catch (err) {
    console.error(`${LOG_TAG} Error getting tech bookings:`, err.message);
    return 0;
  }
}

/**
 * Check if technician has capacity for a time slot
 * @param {string} technician - Technician name
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {string} timeStr - Time string
 * @returns {Promise<{hasCapacity: boolean, bookingCount: number}>}
 */
async function checkTechCapacity(technician, date, timeStr) {
  const hour = parseTimeToDecimalHours(timeStr);
  if (hour === null) {
    return { hasCapacity: true, bookingCount: 0 };
  }

  const bookings = await getTechBookingsForHour(technician, date, hour);
  const hasCapacity = bookings < SCHEDULING_RULES.maxPerHourPerTech;

  console.log(`${LOG_TAG} Capacity check: ${technician} on ${date} at hour ${Math.floor(hour)} has ${bookings}/${SCHEDULING_RULES.maxPerHourPerTech} bookings`);

  return { hasCapacity, bookingCount: bookings };
}

/**
 * Get the assigned technician for a shop based on time window, day of week, and shop routing
 *
 * @param {string} shopName - Name of the shop
 * @param {Object} options - Optional parameters
 * @param {Date} options.requestedTime - Time to use for assignment (defaults to now)
 * @param {string} options.scheduledDate - Scheduled date for the job
 * @param {string} options.scheduledTime - Scheduled time for the job (used for Martin constraint)
 * @param {string} options.zone - Geographic zone override
 * @returns {{technician: string|null, timeWindow: string, reasoning: string, noAvailableTech?: boolean}}
 */
export function getAssignedTech(shopName, options = {}) {
  console.log(`${LOG_TAG} Looking up tech assignment for shop: ${shopName}`);

  const { scheduledTime, scheduledDate } = options;
  if (scheduledTime) {
    console.log(`${LOG_TAG} Scheduled time provided: ${scheduledTime}`);
  }

  if (!shopName) {
    console.log(`${LOG_TAG} No shop name provided`);
    return { technician: null, timeWindow: null, reasoning: 'No shop name provided' };
  }

  // Determine time window from scheduled time if provided, otherwise use current time
  let timeWindow;
  if (scheduledTime && isMorningTime(scheduledTime)) {
    timeWindow = 'morning';
  } else if (scheduledTime) {
    timeWindow = 'afternoon';
  } else {
    timeWindow = getCurrentTimeWindow();
  }

  const dayOfWeek = getCurrentDayOfWeek();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  console.log(`${LOG_TAG} Time context: ${dayNames[dayOfWeek]}, ${timeWindow}`);

  // Normalize shop name for lookup
  const normalizedShop = shopName.trim();

  // Find the shop's assignment config
  let shopConfig = null;

  // Try exact match first
  if (technicianAssignments[normalizedShop]) {
    shopConfig = technicianAssignments[normalizedShop];
  }

  // Try case-insensitive match
  if (!shopConfig) {
    for (const [key, value] of Object.entries(technicianAssignments)) {
      if (key.toLowerCase() === normalizedShop.toLowerCase()) {
        shopConfig = value;
        break;
      }
    }
  }

  // Try partial match
  if (!shopConfig) {
    for (const [key, value] of Object.entries(technicianAssignments)) {
      if (normalizedShop.toLowerCase().includes(key.toLowerCase()) ||
          key.toLowerCase().includes(normalizedShop.toLowerCase())) {
        shopConfig = value;
        break;
      }
    }
  }

  if (!shopConfig) {
    console.log(`${LOG_TAG} No technician assignment found for shop: ${shopName}`);
    return {
      technician: null,
      timeWindow,
      reasoning: `No technician assignment configured for shop: ${shopName}`
    };
  }

  // New format: { morning: [...], afternoon: [...], all_day: [...], fallback: [...] }
  let candidateTechs = [];
  let reasoning = '';

  // Check for all_day assignment first (takes priority)
  if (shopConfig.all_day && shopConfig.all_day.length > 0) {
    candidateTechs = shopConfig.all_day;
    reasoning = `All-day assignment for ${shopName}`;
  }
  // Then check time-based windows
  else if (timeWindow === 'morning' && shopConfig.morning && shopConfig.morning.length > 0) {
    candidateTechs = shopConfig.morning;
    reasoning = `Morning window (08:00-12:00) assignment for ${shopName}`;
  }
  else if (timeWindow === 'afternoon' && shopConfig.afternoon && shopConfig.afternoon.length > 0) {
    candidateTechs = shopConfig.afternoon;
    reasoning = `Afternoon window (12:00-17:00) assignment for ${shopName}`;
  }
  // Off-hours or no time-specific config - use fallback
  else if (shopConfig.fallback && shopConfig.fallback.length > 0) {
    candidateTechs = shopConfig.fallback;
    reasoning = `Fallback assignment for ${shopName} (${timeWindow})`;
  }
  // Legacy format: direct array of techs
  else if (Array.isArray(shopConfig)) {
    candidateTechs = shopConfig;
    reasoning = `Legacy assignment for ${shopName}`;
  }

  if (candidateTechs.length === 0) {
    console.log(`${LOG_TAG} No techs available for time window: ${timeWindow}`);
    return {
      technician: null,
      timeWindow,
      reasoning: `No technicians available for ${shopName} during ${timeWindow}`
    };
  }

  // PATCH B: Filter out Martin if he's not available OR if this is a morning job
  let availableTechs = candidateTechs.filter(tech => {
    if (tech.toLowerCase() === 'martin') {
      // Use scheduled time constraint if provided, otherwise check current availability
      const martinAllowed = scheduledTime
        ? isMartinAllowedForTime(scheduledTime)
        : isMartinAvailable();

      if (!martinAllowed) {
        console.log(`${LOG_TAG} Skipping Martin - not allowed for scheduled time: ${scheduledTime || 'current time'}`);
      }
      return martinAllowed;
    }
    return true;
  });

  // If all techs were filtered out (e.g., only Martin was assigned but he's off or it's morning)
  if (availableTechs.length === 0) {
    // Try fallback, but ALSO filter out Martin from fallback if morning
    if (shopConfig.fallback && shopConfig.fallback.length > 0) {
      availableTechs = shopConfig.fallback.filter(tech => {
        if (tech.toLowerCase() === 'martin') {
          return scheduledTime
            ? isMartinAllowedForTime(scheduledTime)
            : isMartinAvailable();
        }
        return true;
      });

      if (availableTechs.length > 0) {
        reasoning += ` (primary techs unavailable, using fallback)`;
      }
    }

    // If still no techs available, return no_available_tech
    if (availableTechs.length === 0) {
      console.log(`${LOG_TAG} No available techs after filtering (Martin constraint applied)`);
      return {
        technician: null,
        timeWindow,
        noAvailableTech: true,
        reasoning: `No technician available for ${shopName} at scheduled time ${scheduledTime || 'current time'}. Dispatch must assign manually.`
      };
    }
  }

  // Select technician (round-robin if multiple)
  let assignedTech;
  if (availableTechs.length === 1) {
    assignedTech = availableTechs[0];
  } else {
    // Round-robin rotation for multiple techs
    const rotationKey = `${normalizedShop.toLowerCase()}_${timeWindow}`;
    if (!(rotationKey in techRotation)) {
      techRotation[rotationKey] = 0;
    }

    const techIndex = techRotation[rotationKey] % availableTechs.length;
    assignedTech = availableTechs[techIndex];
    techRotation[rotationKey]++;

    reasoning += ` (rotation ${techIndex + 1}/${availableTechs.length})`;
  }

  console.log(`${LOG_TAG} Assigned tech: ${assignedTech} - ${reasoning}`);

  return {
    technician: assignedTech,
    timeWindow,
    dayOfWeek: dayNames[dayOfWeek],
    reasoning
  };
}

/**
 * Legacy compatibility wrapper - returns just the technician name
 * @param {string} shopName - Name of the shop
 * @returns {string|null} - Assigned technician name or null
 */
export function getAssignedTechName(shopName) {
  const result = getAssignedTech(shopName);
  return result.technician;
}

/**
 * Check if any DTCs are blockers that prevent calibration
 *
 * @param {Array|string} preScanDTCs - Pre-scan DTCs (array of codes or text)
 * @param {Array|string} postScanDTCs - Post-scan DTCs (array of codes or text)
 * @returns {{hasBlockers: boolean, blockers: Array}} - Result with blocker details
 */
export function hasBlockerDTCs(preScanDTCs, postScanDTCs) {
  console.log(`${LOG_TAG} Checking for blocker DTCs`);

  const foundBlockers = [];

  // Helper to extract DTC codes from various formats
  function extractCodes(dtcs) {
    if (!dtcs) return [];

    if (Array.isArray(dtcs)) {
      // Array of objects with code property
      if (dtcs.length > 0 && typeof dtcs[0] === 'object') {
        return dtcs.map(d => d.code || d).filter(Boolean);
      }
      return dtcs;
    }

    if (typeof dtcs === 'string') {
      // Extract DTC patterns from text (U0XXX, B1XXX, C0XXX, etc.)
      const matches = dtcs.match(/[UBCP]\d{4}/gi) || [];
      return matches.map(m => m.toUpperCase());
    }

    return [];
  }

  const allCodes = [
    ...extractCodes(preScanDTCs),
    ...extractCodes(postScanDTCs)
  ];

  for (const code of allCodes) {
    const normalizedCode = code.toUpperCase();
    if (blockerDTCs.codes.includes(normalizedCode)) {
      foundBlockers.push({
        code: normalizedCode,
        description: blockerDTCs.descriptions[normalizedCode] || 'Unknown blocker DTC'
      });
    }
  }

  const hasBlockers = foundBlockers.length > 0;
  console.log(`${LOG_TAG} Blocker DTCs found: ${hasBlockers} (${foundBlockers.length} codes)`);

  return {
    hasBlockers,
    blockers: foundBlockers
  };
}

/**
 * Build a readiness result for a vehicle/RO
 *
 * @param {Object} params - Readiness check parameters
 * @param {Array} params.requiredCalibrations - Required calibrations
 * @param {Array|string} params.preScan - Pre-scan DTCs
 * @param {Array|string} params.postScan - Post-scan DTCs
 * @param {Object} params.structuralInfo - Structural repair info
 * @param {Array} params.moduleReplacements - Module replacements
 * @param {string} params.status - Current status from shop
 * @param {Object} params.estimateScrubResult - Result from estimate scrubbing (optional)
 * @param {string} params.notes - Notes field (checked for estimate scrub flags)
 * @returns {{ready: boolean, canScheduleWithOverride: boolean, needsAttentionReason: string|null, reasons: Array<string>}} - Readiness result
 */
export function buildReadinessResult({
  requiredCalibrations = [],
  preScan = null,
  postScan = null,
  structuralInfo = {},
  moduleReplacements = [],
  status = null,
  estimateScrubResult = null,
  notes = null
} = {}) {
  console.log(`${LOG_TAG} Building readiness result`);

  const reasons = [];
  let ready = true;
  let canScheduleWithOverride = true;  // Can still schedule with shop confirmation
  let needsAttentionReason = null;     // Specific reason for "Needs Attention" status

  // Check for blocker DTCs - these are HARD blockers, no override
  const dtcResult = hasBlockerDTCs(preScan, postScan);
  if (dtcResult.hasBlockers) {
    ready = false;
    canScheduleWithOverride = false;  // DTCs cannot be overridden
    const dtcList = dtcResult.blockers.map(b => b.code).join(', ');
    reasons.push(`Blocker DTCs present: ${dtcList}. These must be resolved before calibration.`);
  }

  // Check if structural repairs are complete - HARD blocker
  if (structuralInfo.pendingRepairs && structuralInfo.pendingRepairs.length > 0) {
    ready = false;
    canScheduleWithOverride = false;
    reasons.push(`Pending structural repairs: ${structuralInfo.pendingRepairs.join(', ')}`);
  }

  // Check if bumper is properly installed - HARD blocker
  if (structuralInfo.bumperStatus === 'removed' || structuralInfo.bumperStatus === 'partial') {
    ready = false;
    canScheduleWithOverride = false;
    reasons.push('Front or rear bumper must be fully installed for calibration.');
  }

  // Check alignment if required - HARD blocker
  if (structuralInfo.alignmentNeeded && !structuralInfo.alignmentCompleted) {
    ready = false;
    canScheduleWithOverride = false;
    reasons.push('Wheel alignment must be completed before ADAS calibration.');
  }

  // Check module replacements - HARD blocker
  if (moduleReplacements && moduleReplacements.length > 0) {
    for (const mod of moduleReplacements) {
      if (mod.status !== 'installed' && mod.status !== 'complete') {
        ready = false;
        canScheduleWithOverride = false;
        reasons.push(`Module replacement pending: ${mod.module || mod.name || mod}`);
      }
    }
  }

  // Check estimate scrub result for missing calibrations - SOFT blocker (CAN be overridden)
  if (estimateScrubResult && estimateScrubResult.needsAttention) {
    ready = false;
    // canScheduleWithOverride stays TRUE - shop can confirm and we schedule anyway
    if (estimateScrubResult.missingCalibrations && estimateScrubResult.missingCalibrations.length > 0) {
      const missingList = estimateScrubResult.missingCalibrations.slice(0, 3).join(', ');
      const moreCount = estimateScrubResult.missingCalibrations.length - 3;
      let msg = `Estimate scrub found calibrations not in RevvADAS: ${missingList}`;
      if (moreCount > 0) msg += ` (+${moreCount} more)`;
      reasons.push(msg);
      needsAttentionReason = 'estimate_vs_revv_mismatch';
    } else {
      reasons.push('Estimate scrub requires attention - review notes for details.');
      needsAttentionReason = 'estimate_scrub_flag';
    }
  }

  // Check notes for estimate scrub attention flags - SOFT blocker
  if (notes && typeof notes === 'string') {
    if (notes.includes('ATTENTION REQUIRED') || notes.includes('MISSING CALIBRATIONS')) {
      if (!reasons.some(r => r.includes('Estimate scrub'))) {
        ready = false;
        // canScheduleWithOverride stays TRUE
        reasons.push('Estimate scrub flagged attention required - review notes.');
        needsAttentionReason = needsAttentionReason || 'estimate_scrub_flag';
      }
    }
  }

  // Check shop-reported status
  if (status) {
    const statusLower = status.toLowerCase();
    if (statusLower === 'not ready') {
      if (!reasons.some(r => r.toLowerCase().includes('not ready'))) {
        ready = false;
        canScheduleWithOverride = false;  // Explicit "not ready" = HARD blocker
        reasons.push('Shop has marked vehicle as not ready.');
      }
    } else if (statusLower === 'needs attention') {
      if (!reasons.some(r => r.includes('attention'))) {
        ready = false;
        // canScheduleWithOverride stays TRUE - "Needs Attention" CAN be scheduled with override
        reasons.push('Vehicle status indicates attention needed.');
        needsAttentionReason = needsAttentionReason || 'status_needs_attention';
      }
    }
  }

  // If no calibrations required, note it
  if (!requiredCalibrations || requiredCalibrations.length === 0) {
    reasons.push('No calibrations have been identified as required yet.');
  }

  // If ready and no issues, add positive note
  if (ready && reasons.length === 0) {
    reasons.push('Vehicle appears ready for calibration.');
  }

  console.log(`${LOG_TAG} Readiness: ${ready ? 'READY' : 'NOT READY'}, canScheduleWithOverride: ${canScheduleWithOverride} (${reasons.length} notes)`);

  return {
    ready,
    canScheduleWithOverride,
    needsAttentionReason,
    reasons
  };
}

/**
 * Determine workflow status based on current state
 *
 * @param {Object} roData - Current RO data from sheet
 * @returns {string} - Recommended status
 */
export function determineWorkflowStatus(roData) {
  if (!roData) return 'Unknown';

  // Check for completed state
  if (roData.status === 'Completed') {
    return 'Completed';
  }

  // Check for invoice (indicates completed work)
  if (roData.invoiceNumber && roData.invoiceAmount) {
    return 'Completed';
  }

  // Check for Needs Attention status (from estimate scrub or manual)
  if (roData.status === 'Needs Attention') {
    return 'Needs Attention';
  }

  // Check if notes indicate estimate scrub attention needed
  if (roData.notes && typeof roData.notes === 'string') {
    if (roData.notes.includes('ATTENTION REQUIRED') || roData.notes.includes('MISSING CALIBRATIONS')) {
      return 'Needs Attention';
    }
  }

  // Check if tech is assigned and working
  if (roData.technician && roData.status === 'In Progress') {
    return 'In Progress';
  }

  // Check for tech assignment
  if (roData.technician) {
    return 'Ready';
  }

  // Check readiness
  const readiness = buildReadinessResult({
    preScan: roData.preScanDTCsText || roData.pre_scan_dtcs_text,
    postScan: roData.postScanDTCsText || roData.post_scan_dtcs_text,
    status: roData.status,
    notes: roData.notes
  });

  if (readiness.ready) {
    return 'Ready';
  }

  return 'Not Ready';
}

/**
 * Get a summary of an RO for the assistant to communicate
 *
 * @param {Object} roData - RO data from sheet
 * @returns {Object} - Summary object for assistant use
 */
export function getROSummary(roData) {
  if (!roData) {
    return {
      found: false,
      message: 'RO not found in system'
    };
  }

  // Build vehicle string - prefer direct vehicle field, fallback to year/make/model components
  let vehicleStr = roData.vehicle || '';
  if (!vehicleStr) {
    vehicleStr = `${roData.vehicle_year || roData.vehicleYear || ''} ${roData.vehicle_make || roData.vehicleMake || ''} ${roData.vehicle_model || roData.vehicleModel || ''}`.trim();
  }

  // Get required calibrations - prefer direct field, never show "Not specified" if data exists
  const requiredCals = roData.required_calibrations ||
                       roData.requiredCalibrations ||
                       roData.required_calibrations_text ||
                       roData.requiredCalibrationsText ||
                       '';

  const summary = {
    found: true,
    roPo: roData.ro_po || roData.roPo,
    shopName: roData.shop_name || roData.shopName || roData.shop,
    vehicle: vehicleStr,
    vin: roData.vin || '',
    vinLast4: roData.vin ? roData.vin.slice(-4) : '',
    status: roData.status || '',
    technician: roData.technician || 'Not assigned',
    requiredCalibrations: requiredCals || 'Not specified',
    completedCalibrations: roData.completed_calibrations_text || roData.completedCalibrationsText || 'None',
    notes: roData.notes || 'None'
  };

  // Check readiness (include notes for estimate scrub flags)
  const readiness = buildReadinessResult({
    preScan: roData.pre_scan_dtcs_text || roData.preScanDTCsText || roData.dtcs,
    postScan: roData.post_scan_dtcs_text || roData.postScanDTCsText,
    status: roData.status,
    notes: roData.notes
  });

  summary.ready = readiness.ready;
  summary.canScheduleWithOverride = readiness.canScheduleWithOverride;
  summary.needsAttentionReason = readiness.needsAttentionReason;
  summary.readinessNotes = readiness.reasons;

  return summary;
}

/**
 * Validate RO data before logging
 *
 * @param {Object} data - RO data to validate
 * @returns {{valid: boolean, errors: Array<string>}} - Validation result
 */
export function validateROData(data) {
  const errors = [];

  if (!data.roPo && !data.ro_number) {
    errors.push('RO/PO number is required');
  }

  if (!data.shopName && !data.shop) {
    errors.push('Shop name is required');
  }

  // VIN is optional but if provided should be valid format
  if (data.vin && !/^[A-HJ-NPR-Z0-9]{4,17}$/i.test(data.vin.replace(/\s/g, ''))) {
    errors.push('VIN format appears invalid');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Reload data files (useful for hot-reloading)
 */
export function reloadDataFiles() {
  loadDataFiles();
}

// Max jobs per technician per day before schedule is considered full
const MAX_JOBS_PER_DAY = 5;

// Default time slots for scheduling
const TIME_SLOTS = {
  morning: ['9:00 AM', '10:00 AM', '11:00 AM'],
  afternoon: ['1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM']
};

/**
 * Suggest an available time slot for a technician on a given date
 *
 * @param {string} shopName - Name of the shop (used to determine technician if not provided)
 * @param {string} technician - Technician name (optional - if not provided, uses shop assignment)
 * @param {string} requestedDate - Date in YYYY-MM-DD format
 * @returns {Promise<{available: boolean, suggestedTime: string|null, jobCount: number, reasoning: string}>}
 */
export async function suggestTimeSlot(shopName, technician, requestedDate) {
  console.log(`${LOG_TAG} Suggesting time slot for ${shopName}, tech: ${technician}, date: ${requestedDate}`);

  // If no technician provided, get assigned tech for the shop
  let techName = technician;
  if (!techName && shopName) {
    const assignment = getAssignedTech(shopName);
    techName = assignment.technician;
    if (!techName) {
      return {
        available: false,
        suggestedTime: null,
        jobCount: 0,
        reasoning: `No technician assigned to shop: ${shopName}`
      };
    }
  }

  if (!techName) {
    return {
      available: false,
      suggestedTime: null,
      jobCount: 0,
      reasoning: 'No technician specified or determinable from shop'
    };
  }

  // Parse the requested date to check Martin's availability
  const requestedDateObj = new Date(requestedDate + 'T12:00:00');
  const dayOfWeek = requestedDateObj.getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Check if Martin is available on this day
  if (techName.toLowerCase() === 'martin') {
    const schedule = MARTIN_SCHEDULE[dayOfWeek];
    if (!schedule) {
      return {
        available: false,
        suggestedTime: null,
        jobCount: 0,
        reasoning: `Martin is not available on ${dayNames[dayOfWeek]}s`
      };
    }
  }

  // Get existing jobs for this technician on this date
  let existingJobs = [];
  try {
    existingJobs = await sheetWriter.getScheduledJobsForTechOnDate(techName, requestedDate);
  } catch (err) {
    console.error(`${LOG_TAG} Error fetching scheduled jobs:`, err.message);
  }

  const jobCount = existingJobs.length;
  console.log(`${LOG_TAG} ${techName} has ${jobCount} jobs on ${requestedDate}`);

  // Check if schedule is full
  if (jobCount >= MAX_JOBS_PER_DAY) {
    return {
      available: false,
      suggestedTime: null,
      jobCount,
      reasoning: `${techName} is fully booked on ${requestedDate} (${jobCount}/${MAX_JOBS_PER_DAY} jobs)`
    };
  }

  // Get booked times to avoid conflicts
  const bookedTimes = existingJobs
    .map(job => job.scheduled_time || job.scheduledTime)
    .filter(Boolean);

  // Determine which time windows to check based on technician
  let availableSlots = [];

  if (techName.toLowerCase() === 'martin') {
    const schedule = MARTIN_SCHEDULE[dayOfWeek];
    // Martin: Mon-Thu afternoons only, Fri-Sat all day
    if (schedule.start === 8) {
      // All day - check both morning and afternoon
      availableSlots = [...TIME_SLOTS.morning, ...TIME_SLOTS.afternoon];
    } else {
      // Afternoon only
      availableSlots = TIME_SLOTS.afternoon;
    }
  } else {
    // Other techs - prefer morning, then afternoon
    availableSlots = [...TIME_SLOTS.morning, ...TIME_SLOTS.afternoon];
  }

  // Find first available slot not already booked
  let suggestedTime = null;
  for (const slot of availableSlots) {
    // Check if this slot conflicts with any booked time
    const isBooked = bookedTimes.some(booked => {
      if (!booked) return false;
      // Simple check - if the booked time contains this slot time
      return booked.includes(slot) || slot.includes(booked.split(' - ')[0]);
    });

    if (!isBooked) {
      suggestedTime = slot;
      break;
    }
  }

  if (!suggestedTime) {
    // All preferred slots taken, but still under max jobs
    // Suggest a mid-point time
    if (techName.toLowerCase() === 'martin' && MARTIN_SCHEDULE[dayOfWeek]?.start === 12) {
      suggestedTime = '2:30 PM';
    } else {
      suggestedTime = jobCount < 3 ? '10:30 AM' : '2:30 PM';
    }
  }

  return {
    available: true,
    suggestedTime,
    jobCount,
    technician: techName,
    date: requestedDate,
    reasoning: `${techName} has ${jobCount}/${MAX_JOBS_PER_DAY} jobs on ${requestedDate}. Suggested: ${suggestedTime}`
  };
}

/**
 * Normalize and validate RO number from text input
 * Supports English and Spanish spoken numbers
 * @param {string} text - Raw text containing RO
 * @returns {string|null} - Normalized RO (4-8 digits, left-padded) or null
 */
export function normalizeRO(text) {
  if (!text) return null;

  // Use the shared extraction function from estimateScrubber
  const extracted = extractROFromText(text);
  if (extracted) {
    console.log(`${LOG_TAG} Normalized RO: "${text}" → "${extracted}"`);
    return extracted;
  }

  return null;
}

/**
 * Validate shop name against known shops
 * Cleans up question phrases and validates
 * @param {string} shopName - Raw shop name input
 * @returns {string|null} - Validated shop name or null
 */
export function validateShopName(shopName) {
  if (!shopName) return null;

  // Remove common question prefixes (Spanish/English)
  const cleanedShop = shopName
    .replace(/^[¿?].*\??\s*/i, '') // Remove questions
    .replace(/^(el vehículo|the vehicle|debe|should|ya|already).*?(en|at|from)?\s*/i, '')
    .trim();

  if (!cleanedShop || cleanedShop.length < 2) {
    console.log(`${LOG_TAG} Invalid shop name after cleanup: "${shopName}"`);
    return null;
  }

  // Normalize to known shop names
  const normalizedShops = {
    'jmd': 'JMD Body Shop',
    'j.m.d': 'JMD Body Shop',
    'jmd body': 'JMD Body Shop',
    'reinaldo': 'Reinaldo Body Shop',
    'reynaldo': 'Reinaldo Body Shop',
    'paintmax': 'PaintMax',
    'paint max': 'PaintMax',
    'autosport': 'AutoSport',
    'auto sport': 'AutoSport',
    'autosport international': 'AutoSport',
    'ccnm': 'CCNM',
    'collision center': 'CCNM',
    'north miami': 'CCNM'
  };

  const lower = cleanedShop.toLowerCase();

  for (const [key, value] of Object.entries(normalizedShops)) {
    if (lower.includes(key)) {
      console.log(`${LOG_TAG} Normalized shop: "${shopName}" → "${value}"`);
      return value;
    }
  }

  // Return cleaned name if no match found
  return cleanedShop;
}

export {
  extractROFromText,
  convertSpanishNumbersToDigits,
  padRO
};

export default {
  getAssignedTech,
  getAssignedTechName,
  hasBlockerDTCs,
  buildReadinessResult,
  determineWorkflowStatus,
  getROSummary,
  validateROData,
  reloadDataFiles,
  suggestTimeSlot,
  normalizeRO,
  validateShopName,
  validateSchedulingTime,
  extractROFromText,
  convertSpanishNumbersToDigits,
  padRO
};
