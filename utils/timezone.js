/**
 * timezone.js - Timezone utilities for ADAS Voice Server
 * All timestamps should use EST (America/New_York)
 */

const TIMEZONE = 'America/New_York';

/**
 * Get current timestamp in EST formatted for display
 * Format: "12/04/2024, 03:45 PM"
 * @returns {string}
 */
export function getESTTimestamp() {
  return new Date().toLocaleString('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Get current timestamp in EST as ISO-like string
 * Format: "2024-12-04T15:45:00-05:00"
 * @returns {string}
 */
export function getESTISOTimestamp() {
  const now = new Date();
  const estFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = estFormatter.formatToParts(now);
  const get = (type) => parts.find(p => p.type === type)?.value || '00';

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')} EST`;
}

/**
 * Get current date in EST
 * Format: "2024-12-04"
 * @returns {string}
 */
export function getESTDate() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

/**
 * Get current time in EST
 * Format: "3:45 PM"
 * @returns {string}
 */
export function getESTTime() {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format a Date object to EST display string
 * @param {Date} date - Date to format
 * @returns {string}
 */
export function formatToEST(date) {
  if (!date) return getESTTimestamp();
  return new Date(date).toLocaleString('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Get short date format in EST
 * Format: "Dec 4, 2024"
 * @returns {string}
 */
export function getESTShortDate() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export default {
  getESTTimestamp,
  getESTISOTimestamp,
  getESTDate,
  getESTTime,
  formatToEST,
  getESTShortDate,
  TIMEZONE
};
