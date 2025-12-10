/**
 * logger.js - Log utility with configurable verbosity levels
 *
 * Log levels (from most to least severe):
 *   error: Always logged - critical failures
 *   warn:  Always logged - warnings and potential issues
 *   info:  Default level - important operational messages
 *   debug: Verbose mode - detailed operational info
 *   trace: Very verbose - per-message/per-frame logging
 *
 * Set LOG_LEVEL environment variable to control verbosity:
 *   LOG_LEVEL=warn   - Only errors and warnings (quietest)
 *   LOG_LEVEL=info   - Default production level
 *   LOG_LEVEL=debug  - For troubleshooting
 *   LOG_LEVEL=trace  - Maximum verbosity (dev only)
 */

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

const currentLevel = levels[LOG_LEVEL.toLowerCase()] ?? levels.info;

// Format timestamp for logs
function timestamp() {
  return new Date().toISOString().substring(11, 23);
}

const logger = {
  /**
   * Error level - always logged
   * Use for: Exceptions, failures, things that need immediate attention
   */
  error: (...args) => {
    console.error(`[${timestamp()}] [ERROR]`, ...args);
  },

  /**
   * Warn level - always logged
   * Use for: Non-fatal issues, deprecations, recoverable errors
   */
  warn: (...args) => {
    if (currentLevel >= levels.warn) {
      console.warn(`[${timestamp()}] [WARN]`, ...args);
    }
  },

  /**
   * Info level - default production level
   * Use for: Important state changes, startup/shutdown, key operations
   */
  info: (...args) => {
    if (currentLevel >= levels.info) {
      console.log(`[${timestamp()}] [INFO]`, ...args);
    }
  },

  /**
   * Debug level - for troubleshooting
   * Use for: Detailed operational info, API calls, processing steps
   */
  debug: (...args) => {
    if (currentLevel >= levels.debug) {
      console.log(`[${timestamp()}] [DEBUG]`, ...args);
    }
  },

  /**
   * Trace level - maximum verbosity
   * Use for: Per-message logging, audio frames, websocket messages
   */
  trace: (...args) => {
    if (currentLevel >= levels.trace) {
      console.log(`[${timestamp()}] [TRACE]`, ...args);
    }
  },

  /**
   * Get current log level
   */
  getLevel: () => LOG_LEVEL,

  /**
   * Check if a level is enabled
   */
  isEnabled: (level) => currentLevel >= (levels[level] ?? 0)
};

// Log the current level on startup
if (currentLevel >= levels.info) {
  console.log(`[${timestamp()}] [INFO] Logger initialized with level: ${LOG_LEVEL.toUpperCase()}`);
}

export default logger;
