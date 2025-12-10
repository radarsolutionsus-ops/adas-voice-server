// ============================================================
// ADAS FIRST - PRODUCTION VOICE AUTOMATION SYSTEM
// COMPLETE SYSTEM: Ops (Intake) + Tech (Completion)
// One shared sheet, columns A-G (Ops) and H-M (Tech)
// ============================================================

import dotenv from "dotenv";
dotenv.config({ override: true });

import express from "express";
import { WebSocketServer } from "ws";
import { WebSocket } from "ws";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Import timezone utilities
import { getESTTimestamp, getESTISOTimestamp } from "./utils/timezone.js";

// Import services
import sheetWriter from "./services/sheetWriter.js";
import dispatcher from "./services/dispatcher.js";
import emailListener from "./services/emailListener.js";
import billingMailer from "./services/billingMailer.js";
import smsHandler from "./services/smsHandler.js";
// DEPRECATED: Scrubbing imports removed - all estimate analysis now done manually via RevvADAS
// import { formatScrubResultsAsNotes, getScrubSummary } from "./services/estimateScrubber.js";
// import { scrubEstimateNew } from "./src/scrub/index.js";

// Keep utility functions for RO extraction
import {
  extractROFromText,
  convertSpanishNumbersToDigits,
  padRO
} from "./services/estimateScrubber.js";

// Import utilities (lazy-loaded on demand)
import downloadPlan from "./utils/downloadPlan.js";
import oem from "./utils/oem/index.js";

// Import shop portal routes
import { authRoutes, portalRoutes } from "./routes/index.js";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check - MUST be first, responds immediately for Railway
// Silent - no logging to avoid Railway rate limits (health checks are frequent)
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ============================================================
// SHOP PORTAL - Static files and API routes
// ============================================================

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "public")));

// Portal API routes
app.use("/api/auth", authRoutes);
app.use("/api/portal", portalRoutes);

// Root path - serve portal login page OR health check for non-browser requests
app.get("/", (req, res) => {
  // If request accepts HTML (browser), serve portal login
  const acceptsHtml = req.headers.accept && req.headers.accept.includes("text/html");
  if (acceptsHtml) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }
  // Otherwise return JSON health check (for Railway, APIs, etc.)
  res.status(200).json({ status: "ok", service: "adas-voice-server" });
});

const PORT = process.env.PORT || 8080;

// Start server immediately - no async operations before listen
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ ADAS First Voice Server LIVE on port ${PORT}`);
  console.log(`📞 Ops webhook: /voice-ops`);
  console.log(`🔧 Tech webhook: /voice-tech`);
  console.log(`[STARTUP] Server ready for health checks`);
});

// Start email listener AFTER server is fully running (longer delay for Railway)
setTimeout(() => {
  if (!emailListener.isRunning()) {
    console.log("[EMAIL_PIPELINE] Auto-starting email listener...");
    emailListener.startListener().catch(err =>
      console.error("[EMAIL_PIPELINE] Failed to auto-start listener:", err)
    );
  }
}, 10000);  // Wait 10 seconds after server starts

// Graceful shutdown handlers for Railway
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received - gracefully shutting down...');
  emailListener.stopListener();
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received - gracefully shutting down...');
  emailListener.stopListener();
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

const wss = new WebSocketServer({ server });  // Handle all WebSocket paths

const NGROK = (process.env.BASE_URL || process.env.NGROK_URL || "").replace("https://", "").replace(/\/$/, "");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-realtime-preview-2024-10-01";
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
const GAS_TOKEN = process.env.GAS_TOKEN;
const RANDY_PHONE = process.env.RANDY_PHONE || "+17865551234";

// ============================================================
// VOICE CONFIGURATION
// ============================================================
// OpenAI Realtime API voices: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar
// cedar = deep, authoritative male voice
// shimmer = warm female voice
const VOICES = {
  ops: "shimmer",    // Female voice for Operations Assistant (warm, professional)
  tech: "cedar"      // Deep male voice for Tech Assistant (authoritative, confident)
};

// ============================================================
// FUNCTION TOOLS DEFINITIONS FOR OPENAI REALTIME API
// ============================================================

// OPS Assistant Tools
const OPS_TOOLS = [
  {
    type: "function",
    name: "log_ro_to_sheet",
    description: "Log a new RO/PO to the ADAS Schedule sheet or update existing entry. Use when a shop calls to schedule a calibration.",
    parameters: {
      type: "object",
      properties: {
        shopName: { type: "string", description: "Name of the body shop" },
        roPo: { type: "string", description: "RO or PO number" },
        vin: { type: "string", description: "VIN or last 4 digits of VIN" },
        year: { type: "string", description: "Vehicle year" },
        make: { type: "string", description: "Vehicle make (e.g., Toyota, Ford)" },
        model: { type: "string", description: "Vehicle model (e.g., Camry, F-150)" },
        notes: { type: "string", description: "Any notes about the vehicle or job" }
      },
      required: ["shopName", "roPo"]
    }
  },
  {
    type: "function",
    name: "update_ro_status",
    description: "Update the status of an existing RO. For cancellations use cancel_ro, for rescheduling use reschedule_ro.",
    parameters: {
      type: "object",
      properties: {
        roPo: { type: "string", description: "RO or PO number" },
        status: { type: "string", enum: ["New", "Ready", "Scheduled", "Rescheduled", "Completed"], description: "New status (use cancel_ro or reschedule_ro for those actions)" },
        notes: { type: "string", description: "Additional notes to append" }
      },
      required: ["roPo", "status"]
    }
  },
  {
    type: "function",
    name: "get_ro_summary",
    description: "Look up information about an existing RO/PO. Returns shop, vehicle, status, technician, notes, isNoCalRequired (true if no calibration needed), hasPreScanDTCs (true if pre-scan had codes), and preScanDTCsList (comma-separated list of DTCs). ALWAYS call before scheduling.",
    parameters: {
      type: "object",
      properties: {
        roPo: { type: "string", description: "RO or PO number to look up" }
      },
      required: ["roPo"]
    }
  },
  {
    type: "function",
    name: "compute_readiness",
    description: "Check if a vehicle is ready for ADAS calibration. Returns ready status and any reasons if not ready.",
    parameters: {
      type: "object",
      properties: {
        roPo: { type: "string", description: "RO or PO number to check" }
      },
      required: ["roPo"]
    }
  },
  {
    type: "function",
    name: "assign_technician",
    description: "Assign a technician to an RO based on the shop's routing. Returns the assigned technician name.",
    parameters: {
      type: "object",
      properties: {
        roPo: { type: "string", description: "RO or PO number to assign" }
      },
      required: ["roPo"]
    }
  },
  {
    type: "function",
    name: "set_schedule",
    description: "Schedule a calibration appointment for an RO. Sets the scheduled date and time, and optionally suggests an available time slot.",
    parameters: {
      type: "object",
      properties: {
        roPo: { type: "string", description: "RO or PO number to schedule" },
        scheduledDate: { type: "string", description: "Date in YYYY-MM-DD format (e.g., 2024-12-15)" },
        scheduledTime: { type: "string", description: "Time or time range (e.g., '10:00 AM' or '9:00 AM - 10:00 AM')" },
        suggestSlot: { type: "boolean", description: "If true, suggests an available time slot instead of setting a specific time" },
        override: { type: "boolean", description: "DEPRECATED - override no longer needed with simplified status workflow" }
      },
      required: ["roPo", "scheduledDate"]
    }
  },
  {
    type: "function",
    name: "reschedule_ro",
    description: "Reschedule an existing appointment to a new date/time. Use when shop or tech wants to change the appointment. Status becomes 'Rescheduled'.",
    parameters: {
      type: "object",
      properties: {
        roPo: { type: "string", description: "RO or PO number" },
        newDate: { type: "string", description: "New date in YYYY-MM-DD format" },
        newTime: { type: "string", description: "New time (e.g., '10:00 AM' or 'afternoon')" },
        reason: { type: "string", description: "Reason for rescheduling" }
      },
      required: ["roPo", "newDate", "reason"]
    }
  },
  {
    type: "function",
    name: "cancel_ro",
    description: "Cancel a job. Requires a reason. Can be called by shop (via OPS) or tech. Always offer to reschedule first before cancelling.",
    parameters: {
      type: "object",
      properties: {
        roPo: { type: "string", description: "RO or PO number" },
        reason: { type: "string", description: "Reason for cancellation (required)" }
      },
      required: ["roPo", "reason"]
    }
  },
  {
    type: "function",
    name: "oem_lookup",
    description: "Look up OEM ADAS calibration requirements, prerequisites, quirks, target specs, and programming requirements. Use to answer questions about specific brand calibration procedures, what tools are needed, what prerequisites apply, and any known issues.",
    parameters: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Vehicle brand/make (e.g., Toyota, Honda, BMW, Nissan, Subaru)" },
        system: { type: "string", description: "Optional: Specific ADAS system (e.g., camera, radar, BSM, EyeSight)" },
        query: { type: "string", description: "Optional: Free-text search query to search across all OEM data" }
      },
      required: []
    }
  }
];

// TECH Assistant Tools - 6 STATUS WORKFLOW
const TECH_TOOLS = [
  {
    type: "function",
    name: "tech_get_ro",
    description: "Look up RO details. Returns vehicle info, shop, status, required calibrations, and notes.",
    parameters: {
      type: "object",
      properties: {
        roPo: { type: "string", description: "RO or PO number to look up" }
      },
      required: ["roPo"]
    }
  },
  {
    type: "function",
    name: "tech_update_notes",
    description: "Add notes to an RO. Appends to existing notes with timestamp.",
    parameters: {
      type: "object",
      properties: {
        roPo: { type: "string", description: "RO or PO number" },
        notes: { type: "string", description: "Notes to append" }
      },
      required: ["roPo", "notes"]
    }
  },
  {
    type: "function",
    name: "cancel_ro",
    description: "Cancel a job. A reason is required. The reason is logged in the flow history.",
    parameters: {
      type: "object",
      properties: {
        roPo: { type: "string", description: "RO or PO number" },
        reason: { type: "string", description: "Reason for cancellation (required)" }
      },
      required: ["roPo", "reason"]
    }
  },
  {
    type: "function",
    name: "oem_lookup",
    description: "Look up OEM ADAS calibration requirements, procedures, prerequisites, quirks, target specs, and equipment. Use to get detailed calibration procedures for a specific brand/system, identify required tools, check prerequisites (alignment, battery, floor level), or get troubleshooting info.",
    parameters: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Vehicle brand/make (e.g., Toyota, Honda, BMW, Nissan, Subaru)" },
        system: { type: "string", description: "Optional: Specific ADAS system (e.g., camera, radar, BSM, EyeSight, ACC)" },
        query: { type: "string", description: "Optional: Free-text search query to search across all OEM data" }
      },
      required: []
    }
  }
];

// ============================================================
// FUNCTION TOOL HANDLERS
// ============================================================

async function handleOpsToolCall(toolName, args) {
  console.log(`[OPS_TOOL] Handling: ${toolName}`, args);

  try {
    switch (toolName) {
      case "log_ro_to_sheet": {
        const result = await sheetWriter.upsertScheduleRowByRO(args.roPo, {
          shopName: args.shopName,
          vin: args.vin,
          vehicleYear: args.year,
          vehicleMake: args.make,
          vehicleModel: args.model,
          notes: args.notes,
          status: "New"
        });
        return result.success
          ? { success: true, message: `RO ${args.roPo} logged successfully` }
          : { success: false, error: result.error };
      }

      case "update_ro_status": {
        const result = await sheetWriter.updateScheduleRow(args.roPo, {
          status: args.status,
          notes: args.notes
        });
        return result.success
          ? { success: true, message: `Status updated to ${args.status}` }
          : { success: false, error: result.error };
      }

      case "get_ro_summary": {
        const row = await sheetWriter.getScheduleRowByRO(args.roPo);
        if (row) {
          const summary = dispatcher.getROSummary(row);
          // Include the actual RO stored in sheet for partial match detection
          const actualRoPo = row.ro_po || row.roPo || args.roPo;
          const wasPartialMatch = actualRoPo.toLowerCase() !== args.roPo.toLowerCase();
          summary.actualRoPo = actualRoPo;
          summary.searchedRoPo = args.roPo;
          summary.wasPartialMatch = wasPartialMatch;

          // Check for No Cal status
          const status = row.status || row.Status || '';
          summary.isNoCalRequired = status.toLowerCase() === 'no cal';

          // Parse DTCs from Column L for voice assistant
          const dtcs = row.dtcs || '';
          let preScanDTCs = [];
          let hasPreScanDTCs = false;
          let preScanDTCsList = '';

          if (dtcs) {
            // Parse PRE section from "PRE: P0171, U0100 | POST: None" format
            const preMatch = dtcs.match(/PRE:\s*([^|]+)/i);
            if (preMatch) {
              const prePart = preMatch[1].trim();
              if (prePart.toLowerCase() !== 'none') {
                // Extract individual DTC codes
                preScanDTCs = prePart.split(',').map(d => d.trim()).filter(d => /^[PBCU][0-9A-Fa-f]{4}$/i.test(d));
                hasPreScanDTCs = preScanDTCs.length > 0;
                preScanDTCsList = preScanDTCs.join(', ');
              }
            }
          }

          summary.hasPreScanDTCs = hasPreScanDTCs;
          summary.preScanDTCsList = preScanDTCsList;

          return summary;
        }
        return { found: false, message: `RO ${args.roPo} not found in system` };
      }

      case "compute_readiness": {
        const row = await sheetWriter.getScheduleRowByRO(args.roPo);
        if (!row) {
          return { ready: false, reasons: [`RO ${args.roPo} not found in system`] };
        }
        // New column structure uses combined 'dtcs' field
        // Also check notes for estimate scrub flags
        return dispatcher.buildReadinessResult({
          preScan: row.dtcs,  // Combined DTCs column
          postScan: null,     // No separate post-scan column anymore
          status: row.status,
          notes: row.notes    // Check notes for estimate scrub attention flags
        });
      }

      case "assign_technician": {
        const row = await sheetWriter.getScheduleRowByRO(args.roPo);
        if (!row) {
          return { success: false, error: `RO ${args.roPo} not found` };
        }

        // PATCH A: Guard - require scheduled date/time before assigning technician
        const scheduledDate = row.scheduled_date || row.Scheduled_Date || row.scheduledDate || row.scheduled;
        const scheduledTime = row.scheduled_time || row.Scheduled_Time || row.scheduledTime;

        if (!scheduledDate || !scheduledTime) {
          console.log(`[OPS_TOOL] Blocked technician assignment: schedule missing for RO ${args.roPo}`);
          return {
            success: false,
            needsScheduleFirst: true,
            message: "No scheduled date/time found for this RO. Ask the caller for the date and time before assigning a technician."
          };
        }

        // PATCH B: Pass scheduled time to dispatcher for Martin constraint check
        const result = dispatcher.getAssignedTech(
          row.shop_name || row.shopName || row.shop,
          { scheduledDate, scheduledTime }
        );

        if (result.technician) {
          await sheetWriter.updateScheduleRow(args.roPo, {
            technician: result.technician,
            status: "Ready",
            assignmentTime: getESTISOTimestamp()
          });
          return {
            success: true,
            technician: result.technician,
            timeWindow: result.timeWindow,
            dayOfWeek: result.dayOfWeek,
            reasoning: result.reasoning
          };
        }

        // No technician available - return helpful message
        if (result.noAvailableTech) {
          return {
            success: true,
            technician: null,
            reason: "no_available_tech_for_slot",
            message: result.reasoning || "No technician available for this time slot; dispatch must assign manually."
          };
        }

        return { success: false, error: result.reasoning || "No technician assignment for this shop" };
      }

      case "set_schedule": {
        const row = await sheetWriter.getScheduleRowByRO(args.roPo);
        if (!row) {
          return { success: false, error: `RO ${args.roPo} not found` };
        }

        // Block scheduling for "No Cal" status - vehicle doesn't need calibration
        const currentStatus = row.status || row.Status || '';
        if (currentStatus.toLowerCase() === 'no cal') {
          console.log(`[OPS_TOOL] Blocked scheduling for No Cal RO: ${args.roPo}`);
          return {
            success: false,
            isNoCalRequired: true,
            error: `RO ${args.roPo} does not require ADAS calibration based on the RevvADAS report. No scheduling needed.`
          };
        }

        // Validate scheduling time is within business hours (8:30 AM - 4:00 PM)
        if (args.scheduledTime) {
          const timeValidation = dispatcher.validateSchedulingTime(args.scheduledTime);
          if (!timeValidation.valid) {
            return { success: false, error: timeValidation.error };
          }
        }

        const shopName = row.shop_name || row.shopName || row.shop;
        const existingTechnician = row.technician_assigned || row.technician;

        // Check if this is a "Needs Attention" override
        const isNeedsAttentionOverride = args.override && currentStatus === "Needs Attention";
        let overrideNote = "";
        if (isNeedsAttentionOverride) {
          const timestamp = getESTTimestamp();
          overrideNote = `Scheduled under Needs Attention override by OPS on ${timestamp}`;
          console.log(`[OPS_TOOL] Scheduling with override for RO ${args.roPo}: ${overrideNote}`);
        }

        // If suggestSlot is true, get a suggested time
        if (args.suggestSlot) {
          const suggestion = await dispatcher.suggestTimeSlot(shopName, existingTechnician, args.scheduledDate);
          if (!suggestion.available) {
            return {
              success: false,
              error: suggestion.reasoning
            };
          }
          // Use setSchedule to write date/time/technician to Sheets columns G/H/I
          const scheduleResult = await sheetWriter.setSchedule(args.roPo, {
            scheduledDate: args.scheduledDate,
            scheduledTime: suggestion.suggestedTime,
            technician: suggestion.technician,
            override: isNeedsAttentionOverride,
            notes: overrideNote
          });

          if (!scheduleResult.success) {
            return { success: false, error: scheduleResult.error || "Failed to set schedule" };
          }

          return {
            success: true,
            scheduledDate: args.scheduledDate,
            scheduledTime: suggestion.suggestedTime,
            technician: suggestion.technician,
            jobCount: suggestion.jobCount,
            override: isNeedsAttentionOverride,
            message: `Scheduled for ${args.scheduledDate} at ${suggestion.suggestedTime}. ${suggestion.technician} will be assigned.${isNeedsAttentionOverride ? " (override applied)" : ""}`
          };
        }

        // FIX: Auto-assign technician using dispatcher based on shop, date, and time
        const techAssignment = dispatcher.getAssignedTech(shopName, {
          scheduledDate: args.scheduledDate,
          scheduledTime: args.scheduledTime
        });

        const assignedTech = techAssignment.technician || existingTechnician || null;
        console.log(`[OPS_TOOL] Technician assignment for RO ${args.roPo}: ${assignedTech || 'None'} (${techAssignment.reasoning || 'existing/fallback'})`);

        // Use setSchedule to write date/time/technician to Sheets columns G/H/I
        const scheduleResult = await sheetWriter.setSchedule(args.roPo, {
          scheduledDate: args.scheduledDate,
          scheduledTime: args.scheduledTime || null,
          technician: assignedTech,
          override: isNeedsAttentionOverride,
          notes: overrideNote
        });

        if (!scheduleResult.success) {
          return { success: false, error: scheduleResult.error || "Failed to set schedule" };
        }

        // Build response message
        let message = `Scheduled for ${args.scheduledDate}`;
        if (args.scheduledTime) message += ` at ${args.scheduledTime}`;
        if (assignedTech) message += `. ${assignedTech} will be assigned.`;
        if (isNeedsAttentionOverride) message += " (override applied)";

        return {
          success: true,
          scheduledDate: args.scheduledDate,
          scheduledTime: args.scheduledTime || "Not specified",
          technician: assignedTech || "Not assigned",
          override: isNeedsAttentionOverride,
          message: message
        };
      }

      case "reschedule_ro": {
        const { roPo, newDate, newTime, reason } = args;

        // Get current appointment info
        const current = await sheetWriter.getScheduleRowByRO(roPo);
        if (!current) {
          return { success: false, error: `RO ${roPo} not found` };
        }

        const rawOldDate = current.scheduledDate || current.scheduled_date || '';
        const rawOldTime = current.scheduledTime || current.scheduled_time || '';

        // Format dates for display (handles ISO strings, Date objects, and pre-formatted strings)
        const oldScheduleFormatted = formatScheduleDateTime(rawOldDate, rawOldTime);
        const newScheduleFormatted = formatScheduleDateTime(newDate, newTime);

        // Translate reason to English for flow history
        const translatedReason = translateToEnglish(reason);
        const statusChangeNote = `Rescheduled from ${oldScheduleFormatted} to ${newScheduleFormatted}: ${translatedReason}`;

        const result = await sheetWriter.updateScheduleRowWithFullNotes(roPo, {
          status: "Rescheduled",
          scheduledDate: newDate,
          scheduledTime: newTime || '',
          statusChangeNote: statusChangeNote
        });

        return result.success
          ? { success: true, message: `Rescheduled to ${newScheduleFormatted}. Previous: ${oldScheduleFormatted}` }
          : { success: false, error: result.error };
      }

      case "cancel_ro": {
        const { roPo, reason } = args;
        if (!reason || reason.trim() === '') {
          return { success: false, error: "Cancellation reason is required" };
        }

        // Translate reason to English for flow history
        const translatedCancelReason = translateToEnglish(reason);

        const result = await sheetWriter.updateScheduleRowWithFullNotes(roPo, {
          status: "Cancelled",
          statusChangeNote: `Cancelled: ${translatedCancelReason}`
        });

        return result.success
          ? { success: true, message: `Job cancelled. Reason: ${reason}` }
          : { success: false, error: result.error };
      }

      case "oem_lookup": {
        // OEM Knowledge lookup - shared between OPS and TECH
        return handleOEMLookup(args);
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[OPS_TOOL] Error:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Format a date/time value for display in flow history
 * Handles Date objects, ISO strings, and pre-formatted strings
 * @param {*} dateVal - Date value (Date object, ISO string, or formatted string)
 * @param {*} timeVal - Time value (Date object, ISO string, or formatted string)
 * @returns {string} Formatted string like "12/10/2025 2:00 PM" or "unscheduled"
 */
function formatScheduleDateTime(dateVal, timeVal) {
  if (!dateVal && !timeVal) return 'unscheduled';

  let datePart = '';
  let timePart = '';

  // Format date
  if (dateVal) {
    if (dateVal instanceof Date) {
      datePart = (dateVal.getMonth() + 1) + '/' + dateVal.getDate() + '/' + dateVal.getFullYear();
    } else if (typeof dateVal === 'string') {
      // Handle ISO string or already formatted
      if (dateVal.includes('T') || dateVal.match(/^\d{4}-\d{2}-\d{2}/)) {
        const d = new Date(dateVal);
        if (!isNaN(d.getTime())) {
          datePart = (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
        } else {
          datePart = dateVal; // Can't parse, use as-is
        }
      } else {
        datePart = dateVal; // Already formatted like "12/10/2025"
      }
    }
  }

  // Format time
  if (timeVal) {
    if (timeVal instanceof Date) {
      let hours = timeVal.getHours();
      const mins = String(timeVal.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      timePart = hours + ':' + mins + ' ' + ampm;
    } else if (typeof timeVal === 'string') {
      if (timeVal.includes('T') || timeVal.match(/^\d{4}-\d{2}-\d{2}/)) {
        const t = new Date(timeVal);
        if (!isNaN(t.getTime())) {
          let hours = t.getHours();
          const mins = String(t.getMinutes()).padStart(2, '0');
          const ampm = hours >= 12 ? 'PM' : 'AM';
          hours = hours % 12;
          hours = hours ? hours : 12;
          timePart = hours + ':' + mins + ' ' + ampm;
        } else {
          timePart = timeVal; // Can't parse, use as-is
        }
      } else {
        timePart = timeVal; // Already formatted like "2:00 PM"
      }
    }
  }

  if (datePart && timePart) {
    return datePart + ' ' + timePart;
  } else if (datePart) {
    return datePart;
  } else if (timePart) {
    return timePart;
  }
  return 'unscheduled';
}

/**
 * Translate Spanish notes/reasons to English before saving to sheets
 * Flow history must always be in English for consistency
 * @param {string} text - Text that may contain Spanish
 * @returns {string} Text with Spanish phrases translated to English
 */
function translateToEnglish(text) {
  if (!text) return text;

  // Common Spanish phrases used in ADAS scheduling (case-insensitive matching)
  const translations = {
    // Cancellation reasons
    'el vehículo fue declarado pérdida total': 'Vehicle was declared a total loss',
    'vehículo fue declarado pérdida total': 'Vehicle was declared a total loss',
    'pérdida total': 'total loss',
    'el carro no está listo': 'The car is not ready',
    'carro no está listo': 'Car is not ready',
    'no está listo': 'not ready',
    'el cliente canceló': 'Customer cancelled',
    'cliente canceló': 'Customer cancelled',
    'el cliente no quiere': 'Customer does not want',
    'cliente no quiere': 'Customer does not want',
    'ya no necesita calibración': 'No longer needs calibration',
    'no necesita calibración': 'Does not need calibration',
    'el seguro no aprobó': 'Insurance did not approve',
    'seguro no aprobó': 'Insurance did not approve',
    'el taller canceló': 'Shop cancelled',
    'taller canceló': 'Shop cancelled',

    // Reschedule reasons
    'el carro no estaba listo': 'The car was not ready',
    'carro no estaba listo': 'Car was not ready',
    'no estaba listo': 'was not ready',
    'necesitan más tiempo': 'They need more time',
    'necesita más tiempo': 'Needs more time',
    'el cliente pidió otro día': 'Customer requested another day',
    'cliente pidió otro día': 'Customer requested another day',
    'conflicto de horario': 'Schedule conflict',
    'el técnico no puede': 'Technician cannot make it',
    'técnico no puede': 'Technician cannot make it',
    'el técnico está ocupado': 'Technician is busy',
    'técnico está ocupado': 'Technician is busy',

    // Status notes
    'calibración completada': 'Calibration completed',
    'calibración completada exitosamente': 'Calibration completed successfully',
    'en camino': 'On the way',
    'llegué al taller': 'Arrived at shop',
    'llegue al taller': 'Arrived at shop',
    'esperando el vehículo': 'Waiting for vehicle',
    'esperando vehículo': 'Waiting for vehicle',
    'trabajando en el vehículo': 'Working on vehicle',
    'trabajo completado': 'Work completed',
    'sin problemas': 'No issues',
    'todo bien': 'All good',
    'listo': 'Done'
  };

  let result = text;

  // Sort by length descending to match longer phrases first
  const sortedPhrases = Object.entries(translations).sort((a, b) => b[0].length - a[0].length);

  // Check for Spanish phrases (case-insensitive) and replace
  for (const [spanish, english] of sortedPhrases) {
    const regex = new RegExp(spanish, 'gi');
    result = result.replace(regex, english);
  }

  return result;
}

/**
 * @param {string} roPo - Raw RO/PO input
 * @returns {{valid: boolean, cleaned: string, error?: string}}
 */
function validateRoPo(roPo) {
  const cleaned = String(roPo || '').replace(/[^\d]/g, '');
  const isValid = /^\d{4,8}$/.test(cleaned);

  if (!isValid) {
    return {
      valid: false,
      cleaned: '',
      error: `Invalid RO/PO format: "${roPo}". RO must be 4-8 digits only (e.g., "24567"). Please ask for the correct RO number.`
    };
  }

  return { valid: true, cleaned };
}

async function handleTechToolCall(toolName, args) {
  console.log(`[TECH_TOOL] Handling: ${toolName}`, args);

  try {
    // All tech tools require a valid RO/PO - validate upfront
    if (args.roPo) {
      const validation = validateRoPo(args.roPo);
      if (!validation.valid) {
        console.warn(`[TECH_TOOL] Invalid RO format rejected: "${args.roPo}"`);
        return { success: false, error: validation.error };
      }
      // Replace with cleaned/validated RO
      args.roPo = validation.cleaned;
    }

    switch (toolName) {
      case "tech_get_ro": {
        const row = await sheetWriter.getScheduleRowByRO(args.roPo);
        if (row) {
          // Include the actual RO stored in sheet for partial match detection
          const actualRoPo = row.ro_po || row.roPo || args.roPo;
          const wasPartialMatch = actualRoPo.toLowerCase() !== args.roPo.toLowerCase();
          return {
            found: true,
            roPo: actualRoPo,
            actualRoPo: actualRoPo,
            searchedRoPo: args.roPo,
            wasPartialMatch: wasPartialMatch,
            shopName: row.shop_name || row.shopName,
            vehicle: row.vehicle,
            vin: row.vin,
            status: row.status,
            technician: row.technician_assigned || row.technician,
            scheduledDate: row.scheduled_date,
            scheduledTime: row.scheduled_time,
            requiredCalibrations: row.required_calibrations,
            notes: row.notes,
            flowHistory: row.flow_history || row.flowHistory || ''
          };
        }
        return { found: false, message: `RO ${args.roPo} not found` };
      }

      case "tech_update_notes": {
        const row = await sheetWriter.getScheduleRowByRO(args.roPo);
        const existingNotes = row?.notes || "";
        const timestamp = getESTTimestamp();
        const timestampedNote = `[${timestamp}] ${args.notes}`;
        const newNotes = existingNotes
          ? `${existingNotes} | ${timestampedNote}`
          : timestampedNote;

        const result = await sheetWriter.updateScheduleRow(args.roPo, { notes: newNotes });
        return result.success
          ? { success: true, message: "Notes updated" }
          : { success: false, error: result.error };
      }

      case "cancel_ro": {
        // Cancel job - requires a reason (same handler as OPS)
        if (!args.reason || args.reason.trim() === '') {
          return { success: false, error: "Cancellation reason is required" };
        }

        // Translate reason to English for flow history
        const translatedTechCancelReason = translateToEnglish(args.reason);

        const result = await sheetWriter.updateScheduleRowWithFullNotes(args.roPo, {
          status: "Cancelled",
          statusChangeNote: `Cancelled: ${translatedTechCancelReason}`
        });

        return result.success
          ? { success: true, message: `Job ${args.roPo} cancelled. Reason: ${args.reason}` }
          : { success: false, error: result.error };
      }

      case "oem_lookup": {
        // OEM Knowledge lookup - shared between OPS and TECH
        return handleOEMLookup(args);
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[TECH_TOOL] Error:`, err);
    return { success: false, error: err.message };
  }
}

// ============================================================
// OEM KNOWLEDGE LOOKUP HANDLER
// ============================================================

function handleOEMLookup(args) {
  const LOG_TAG = '[OEM_LOOKUP]';
  console.log(`${LOG_TAG} Lookup request:`, args);

  try {
    // If just a query (no brand), do a full search
    if (args.query && !args.brand) {
      const searchResults = oem.searchAllOEMs(args.query);
      return {
        success: true,
        type: 'search',
        query: args.query,
        totalResults: searchResults.totalResults,
        summary: searchResults.summary,
        results: {
          oemPortals: searchResults.results.oem_portals.slice(0, 5),
          calibrations: searchResults.results.calibrations.slice(0, 10),
          equipment: searchResults.results.equipment.slice(0, 5)
        }
      };
    }

    // Brand lookup (with optional system filter)
    if (args.brand) {
      const result = oem.oemLookup({
        brand: args.brand,
        system: args.system || null,
        query: args.query || null
      });

      if (!result.found) {
        return {
          success: false,
          brand: args.brand,
          message: result.message || `No information found for ${args.brand}`
        };
      }

      // Build a concise response for voice assistant
      const response = {
        success: true,
        brand: result.brand,
        system: result.system,
        portal: result.portal,
        availableSystems: result.availableSystems,
        calibrationMethods: result.calibrationMethods,
        triggers: result.triggers.slice(0, 10), // Limit for voice
        prerequisites: {
          alignment: result.prerequisites.alignment,
          rideHeight: result.prerequisites.rideHeight,
          battery: result.prerequisites.battery,
          criticalNotes: result.prerequisites.criticalNotes.slice(0, 3)
        },
        dtcBlockers: result.dtcBlockers.slice(0, 5),
        quirks: result.quirks.slice(0, 5),
        programmingRequirements: {
          software: result.programmingRequirements.software,
          j2534: result.programmingRequirements.j2534Compatible,
          nastfRequired: result.programmingRequirements.nastfRequired
        },
        legalAccess: {
          nastfRequired: result.legalAccess.nastfRequired,
          freeAccess: result.legalAccess.freeAccess,
          sgwSecurity: result.legalAccess.sgwSecurity
        }
      };

      // If specific system requested, add detailed calibration info
      if (args.system && result.calibrations.length > 0) {
        response.calibrationDetails = result.calibrations.map(c => ({
          system: c.system,
          staticRequired: c.staticRequired,
          dynamicRequired: c.dynamicRequired,
          targetSpecs: c.targetSpecs,
          tools: c.tools,
          triggers: c.triggers
        }));
      }

      console.log(`${LOG_TAG} Returning data for ${result.brand}`);
      return response;
    }

    // No brand or query - return list of available OEMs
    return {
      success: true,
      type: 'list',
      availableOEMs: oem.getOEMList(),
      summary: oem.getKnowledgeBaseSummary()
    };

  } catch (err) {
    console.error(`${LOG_TAG} Error:`, err);
    return { success: false, error: err.message };
  }
}

// ============================================================
// OPS ASSISTANT INSTRUCTIONS (loaded from external file)
// ============================================================
// NOTE: Primary instructions now in config/instructions/ops.md
// Legacy path (prompts/ops.txt) maintained for backward compatibility

const OPS_INSTRUCTIONS = fs.readFileSync(
  path.join(__dirname, "config", "instructions", "ops.md"),
  "utf-8"
);

// ============================================================
// TECH ASSISTANT INSTRUCTIONS (loaded from external file)
// ============================================================
// NOTE: Primary instructions now in config/instructions/tech.md
// Legacy path (prompts/tech.txt) maintained for backward compatibility

const TECH_INSTRUCTIONS = fs.readFileSync(
  path.join(__dirname, "config", "instructions", "tech.md"),
  "utf-8"
);

// ============================================================
// SERVER-SIDE EXTRACTION LOGIC
// ============================================================

function extractOpsData(transcript, sessionState = {}) {
  const fullText = transcript.map(t => t.content).join(" ");
  const text = fullText.toLowerCase();
  // userText = only user messages (for extraction from user responses)
  const userText = transcript.filter(t => t.role === "user").map(t => t.content).join(" ");

  const data = {
    ro_number: null,
    shop: null,
    vehicle_info: null,
    status_from_shop: null,
    scheduled: null,
    shop_notes: null,
    caller_name: null  // Track caller name for notes formatting
  };

  // PATCH 2+: STRICT CALLER NAME EXTRACTION
  // Only extract from: (a) User's answer to name question, (b) Assistant's confirmation phrase
  // NO fallback from random transcript segments
  // Lock name once captured
  // CRITICAL: Reject junk phrases like "Do" from "Do you want to cut it?"

  // Reject list for non-name words (expanded to catch more junk)
  const notNames = [
    // English common words
    'yes', 'yeah', 'yep', 'no', 'okay', 'ok', 'hey', 'hi', 'hello', 'help', 'need', 'got', 'have', 'the', 'and', 'for', 'calling', 'from', 'here',
    'thank', 'thanks', 'thankyou', 'you', 'sorry', 'excuse', 'please', 'sure', 'right', 'correct', 'good', 'great', 'fine', 'well',
    // JUNK WORDS - from misheard/garbage transcriptions
    'do', 'want', 'cut', 'phone', 'continued', 'tinued', 'ontinued', 'cont', 'inued', 'audio', 'speaking', 'unclear', 'inaudible',
    'sequence', 'handling', 'peace', 'nor', 'antes',
    // Filler words
    'um', 'uh', 'hmm', 'uh-huh', 'mhm', 'ah', 'eh', 'huh', 'uhh', 'umm',
    'just', 'like', 'so', 'that', 'this', 'what', 'with', 'about', 'actually', 'basically',
    // Spanish common words
    'gracias', 'por', 'favor', 'bueno', 'bien', 'claro', 'dale', 'esta', 'si', 'como', 'quien', 'quién',
    'después', 'despues', 'ahora', 'luego', 'nunca', 'siempre', 'también', 'tambien',
    'hola', 'adiós', 'adios', 'mucho', 'gusto', 'tengo', 'taller', 'vehículo', 'vehiculo',
    'listo', 'lista', 'correcto', 'exacto', 'perfecto',
    'empezar', 'terminar', 'confirmar', 'registrar', 'calibrar', 'número', 'numero',
    'calling', 'ready', 'waiting',
    // Industry terms that shouldn't be names
    'autosport', 'paintmax', 'jmd', 'ccnm', 'reinaldo', 'ford', 'mustang', 'toyota', 'honda', 'nissan',
    'ro', 'po', 'vin', 'adas'
  ];

  // JUNK PHRASE PATTERNS - if the response looks like a junk transcription, skip entirely
  const junkResponsePatterns = [
    /^do\s+you/i,           // "Do you want..."
    /want\s+to\s+cut/i,     // "...want to cut it"
    /phone\s+from/i,        // "Phone from me"
    /^continued/i,          // "Continued..."
    /^sequence/i,           // "Sequence..."
    /^handling/i,           // "Handling..."
    /^\s*[a-z]{1,2}\s*$/i,  // Single/double letter responses
  ];

  // PRIORITY 1: Get name from user's direct answer to name question
  for (let i = 0; i < transcript.length - 1; i++) {
    const msg = transcript[i];
    const msgLower = msg.content.toLowerCase();
    if (msg.role === "assistant" &&
        (msgLower.includes("who am i speaking") ||
         msgLower.includes("con quién") ||
         msgLower.includes("con quien") ||
         msgLower.includes("tengo el gusto") ||
         msgLower.includes("your name") ||
         msgLower.includes("tu nombre") ||
         msgLower.includes("antes de empezar"))) {
      // Get the IMMEDIATE next user message
      for (let j = i + 1; j < transcript.length; j++) {
        if (transcript[j].role === "user") {
          const response = transcript[j].content.trim();
          console.log(`👤 Checking name question response: "${response}"`);

          // FIRST: Check if entire response is junk
          const isJunkResponse = junkResponsePatterns.some(p => p.test(response));
          if (isJunkResponse) {
            console.log(`🗑️ Skipping junk response for name extraction: "${response}"`);
            break; // Skip this response entirely
          }

          // Extract first capitalized word that's not in notNames
          const words = response.split(/\s+/);
          for (const word of words) {
            const cleanWord = word.replace(/[.,!?]/g, '');
            // Must be at least 2 chars and start with capital or be clearly a name
            if (cleanWord.length >= 2 && /^[A-Z]/.test(cleanWord)) {
              const nameLower = cleanWord.toLowerCase();
              // Additional check: reject if it's the first word of a junk phrase
              if (!notNames.includes(nameLower) && nameLower !== 'do' && nameLower !== 'phone') {
                data.caller_name = cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1).toLowerCase();
                console.log(`👤 Extracted caller name from name question: "${data.caller_name}"`);
                break;
              }
            }
          }
          break;
        }
        if (transcript[j].role === "assistant") break;
      }
      if (data.caller_name) break;
    }
  }

  // PRIORITY 2: Get name from assistant's greeting phrase ("Nice to meet you, Randy", "Mucho gusto, Randy")
  // This is MORE RELIABLE than user input because assistant confirms what they heard
  // PATCH: This should OVERRIDE Priority 1 if assistant used a different name
  if (!data.caller_name) {
    for (const msg of transcript) {
      if (msg.role === "assistant") {
        const msgContent = msg.content;
        // Only look for specific greeting patterns where assistant uses the name
        const greetingPatterns = [
          // English greeting patterns
          /nice to meet you,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          /great,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          /perfect,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          /thanks?,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          /got it,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          /hi,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          /hello,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          // Spanish greeting patterns
          /mucho gusto,?\s+([A-Z][a-záéíóúñ]{2,15})(?:[.,!]|\s|$)/i,
          /gracias,?\s+([A-Z][a-záéíóúñ]{2,15})(?:[.,!]|\s|$)/i,
          /genial,?\s+([A-Z][a-záéíóúñ]{2,15})(?:[.,!]|\s|$)/i,
          /perfecto,?\s+([A-Z][a-záéíóúñ]{2,15})(?:[.,!]|\s|$)/i,
        ];

        for (const pattern of greetingPatterns) {
          const match = msgContent.match(pattern);
          if (match && match[1]) {
            const nameLower = match[1].toLowerCase();
            if (!notNames.includes(nameLower) && match[1].length >= 3) {
              data.caller_name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
              console.log(`👤 Extracted caller name from assistant greeting: "${data.caller_name}"`);
              break;
            }
          }
        }
        if (data.caller_name) break;
      }
    }
  }

  // PRIORITY 3: If we found a name from user AND assistant greeting has a DIFFERENT name,
  // prefer the assistant's version (they heard and confirmed it)
  const assistantGreetingName = (() => {
    for (const msg of transcript) {
      if (msg.role === "assistant") {
        const greetingPatterns = [
          // English patterns
          /nice to meet you,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          /great,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          /perfect,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          /thanks?,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          /got it,?\s+([A-Z][a-z]{2,15})(?:[.,!]|\s|$)/i,
          // Spanish patterns
          /mucho gusto,?\s+([A-Z][a-záéíóúñ]{2,15})(?:[.,!]|\s|$)/i,
          /gracias,?\s+([A-Z][a-záéíóúñ]{2,15})(?:[.,!]|\s|$)/i,
        ];
        for (const pattern of greetingPatterns) {
          const match = msg.content.match(pattern);
          if (match && match[1] && !notNames.includes(match[1].toLowerCase())) {
            return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
          }
        }
      }
    }
    return null;
  })();

  // If assistant greeting has a name, use it (overrides Priority 1)
  if (assistantGreetingName && assistantGreetingName !== data.caller_name) {
    console.log(`👤 Overriding caller name "${data.caller_name}" with assistant greeting name: "${assistantGreetingName}"`);
    data.caller_name = assistantGreetingName;
  }

  // PRIORITY 4: Extract from assistant's confirmation summary
  // Look for "Caller: X" in the confirmation or the name used after greeting
  if (!data.caller_name) {
    for (let i = assistantConfirmations.length - 1; i >= 0; i--) {
      const conf = assistantConfirmations[i].content;
      // Look for name in confirmation context
      const nameInConfirm = conf.match(/(?:hola|hi|hey|gracias|mucho gusto),?\s+([A-Z][a-záéíóúñ]{2,15})(?:[.,!]|\s|$)/i);
      if (nameInConfirm && nameInConfirm[1]) {
        const nameLower = nameInConfirm[1].toLowerCase();
        if (!notNames.includes(nameLower)) {
          data.caller_name = nameInConfirm[1].charAt(0).toUpperCase() + nameInConfirm[1].slice(1).toLowerCase();
          console.log(`👤 Extracted caller name from confirmation: "${data.caller_name}"`);
          break;
        }
      }
    }
  }

  // RO number - STRICT extraction: MUST contain digits, reject names/VIN/shop
  // PRIORITY: Use assistant's LAST confirmation (most reliable - contains corrections)
  console.log(`🔍 Extracting RO number...`);

  // PRIORITY 1: Look in assistant's LAST confirmation for RO (most accurate - has corrections)
  const assistantConfirmations = transcript.filter(t => t.role === "assistant" &&
    (t.content.toLowerCase().includes("confirm") || t.content.toLowerCase().includes("confirmar")));

  // Use the LAST confirmation (most recent) since it has any corrections applied
  for (let i = assistantConfirmations.length - 1; i >= 0; i--) {
    const conf = assistantConfirmations[i];
    const roInConfirm = conf.content.match(/(?:ro|r\.o\.|po|p\.o\.)\s*[\s#:]*(\d{3,10})/i);
    if (roInConfirm) {
      data.ro_number = roInConfirm[1].toUpperCase();
      console.log(`✅ Extracted RO from assistant confirmation (PRIORITY): "${data.ro_number}"`);
      break;
    }
  }

  // PRIORITY 2: If not in confirmation, try to find RO from direct answer to RO question
  let roFromDirectAnswer = null;
  for (let i = 0; i < transcript.length - 1; i++) {
    if (transcript[i].role === "assistant") {
      const assistantMsg = transcript[i].content.toLowerCase();
      // Check if assistant asked for RO/PO
      if (assistantMsg.includes("ro") || assistantMsg.includes("po") ||
          assistantMsg.includes("repair order") || assistantMsg.includes("work order") ||
          assistantMsg.includes("número de ro") || assistantMsg.includes("número de orden")) {
        // Get the next user message
        for (let j = i + 1; j < transcript.length; j++) {
          if (transcript[j].role === "user") {
            const userResponse = transcript[j].content.trim();
            // Extract digits/alphanumeric from this response
            const roMatch = userResponse.match(/\b(\d{3,10})\b/) ||  // Pure digits (3-10 digits)
                           userResponse.match(/\b([A-Z]?\d{3,}[A-Z]?)\b/i);  // Optional letter prefix/suffix
            if (roMatch) {
              roFromDirectAnswer = roMatch[1].toUpperCase();
              console.log(`📋 Found RO from direct answer: "${roFromDirectAnswer}"`);
            }
            break;
          }
          if (transcript[j].role === "assistant") break;
        }
      }
    }
  }

  // PATCH 3: RO corrections - ONLY check messages that explicitly mention RO/PO
  // User must say "the RO is", "RO is", "el RO es", etc. - not just random numbers
  // This ensures we don't pick up years, VIN digits, or other numbers
  const correctionPatterns = [
    /(?:actually|no,?\s*it'?s?|correction|the ro is|ro is|po is)\s*[\s#:]*(\d[\d\s\-]{2,15}\d)/gi,
    /(?:ro|po|r\.o\.|p\.o\.)\s*(?:number)?\s*[\s#:]*(\d[\d\s\-]{2,15}\d)/gi,
    // Spanish: "el R.O. es el 1-2-3-0-0"
    /(?:el\s+)?(?:ro|r\.o\.|po|p\.o\.)\s*(?:es|es el)\s*(?:el\s+)?(\d[\d\s\-]{2,15}\d)/gi,
    // Spanish: "no, el RO es..."
    /no,?\s*(?:el\s+)?(?:ro|r\.o\.|po|p\.o\.)\s*(?:es|es el)\s*(?:el\s+)?(\d[\d\s\-]{2,15}\d)/gi
  ];

  // PATCH 3: Only search for RO corrections in user messages that EXPLICITLY mention RO/PO
  // Don't scan the entire userText - only messages with RO context
  let roFromCorrection = null;
  for (const msg of transcript) {
    if (msg.role === "user") {
      const msgLower = msg.content.toLowerCase();
      // Only check this message if it explicitly mentions RO/PO
      if (msgLower.includes("ro") || msgLower.includes("r.o") ||
          msgLower.includes("po") || msgLower.includes("p.o") ||
          msgLower.includes("repair order") || msgLower.includes("orden")) {
        for (const pattern of correctionPatterns) {
          pattern.lastIndex = 0; // Reset regex state
          let match;
          while ((match = pattern.exec(msg.content)) !== null) {
            if (match[1]) {
              // Remove hyphens and spaces from RO number like "1-2-3-0-0" → "12300"
              const cleanRO = match[1].replace(/[\s\-]/g, "").toUpperCase();
              if (cleanRO.length >= 3 && cleanRO.length <= 10) {
                roFromCorrection = cleanRO;
                console.log(`📋 Found RO from correction pattern: "${roFromCorrection}" (original: "${match[1]}")`);
              }
            }
          }
        }
      }
    }
  }

  // Use correction if found (most recent), otherwise use direct answer
  // But ONLY if we didn't already get RO from assistant confirmation
  const roCandidate = data.ro_number ? null : (roFromCorrection || roFromDirectAnswer);

  // STRICT VALIDATION: RO must be primarily digits and NOT a vehicle year
  if (roCandidate && !data.ro_number) {
    const digitCount = (roCandidate.match(/\d/g) || []).length;
    const letterCount = (roCandidate.match(/[A-Z]/gi) || []).length;

    // Reject if it looks like a vehicle year (2020-2029, 2019, etc.)
    const isVehicleYear = /^20(1[5-9]|2[0-9])$/.test(roCandidate);
    if (isVehicleYear) {
      console.log(`❌ Rejecting "${roCandidate}" - appears to be vehicle year, not RO`);
    }
    // Must have at least 3 digits and digits must be majority
    else if (digitCount >= 3 && digitCount >= letterCount) {
      // Reject if it looks like a VIN (17 chars) or VIN fragment mentioned near "vin"
      if (roCandidate.length === 17 || roCandidate.length === 4) {
        // Could be VIN or VIN ending - check context
        const vinContext = userText.toLowerCase().includes("vin") &&
                          userText.toLowerCase().indexOf(roCandidate.toLowerCase()) >
                          userText.toLowerCase().indexOf("vin") - 20;
        if (vinContext && roCandidate.length === 4) {
          console.log(`❌ Rejecting "${roCandidate}" - appears to be VIN ending, not RO`);
        } else if (roCandidate.length !== 17) {
          data.ro_number = roCandidate;
          console.log(`✅ Extracted RO: "${data.ro_number}"`);
        }
      } else {
        data.ro_number = roCandidate;
        console.log(`✅ Extracted RO: "${data.ro_number}"`);
      }
    } else {
      console.log(`❌ Rejecting RO candidate "${roCandidate}" - not enough digits (${digitCount} digits, ${letterCount} letters)`);
    }
  }

  // Final rejection: Never use caller name as RO
  if (data.ro_number && data.caller_name) {
    if (data.ro_number.toLowerCase() === data.caller_name.toLowerCase()) {
      console.log(`❌ Rejecting RO "${data.ro_number}" - matches caller name`);
      data.ro_number = null;
    }
  }

  // Shop - PRIORITY ORDER:
  // 1. Assistant's confirmation sentence (most reliable)
  // 2. User's direct answer to shop question
  // 3. Whitelist normalization
  // DO NOT scan random transcript lines
  // PATCH: Reject junk phrases like "la tarde. Peace" that leak from time/day context
  console.log(`🔍 Extracting shop name...`);

  const assistantText = transcript.filter(t => t.role === "assistant").map(t => t.content).join(" ");

  // SHOP WHITELIST - final output MUST be exactly one of these
  const shopWhitelist = ["Reinaldo Body Shop", "AutoSport", "PaintMax", "JMD Body Shop", "CCNM"];

  // JUNK PHRASES that should NEVER be shop names
  const shopJunkPhrases = [
    "la tarde", "la mañana", "la noche", "de la tarde", "de la mañana", "de la noche",
    "por la tarde", "por la mañana", "por la noche",
    "peace", "bye", "goodbye", "thanks", "gracias",
    "a las", "el miércoles", "el lunes", "el martes", "el jueves", "el viernes",
    "hoy", "mañana", "manana", "tarde", "noche",
    "continued", "sequence", "handling", "phone from"
  ];

  // PRIORITY 1: Get shop from assistant's LAST confirmation (most reliable)
  for (let i = assistantConfirmations.length - 1; i >= 0; i--) {
    const conf = assistantConfirmations[i].content.toLowerCase();
    // English: "shop is X" or "shop X"
    let shopMatch = conf.match(/(?:shop\s+(?:is\s+)?|taller\s+(?:es\s+)?)([a-záéíóúñA-Z0-9\s&'.-]+?)(?:,|\.|veh[ií]culo|vehicle|20\d{2}|\s+ro\s|\s+estado)/i);
    if (shopMatch && shopMatch[1]) {
      const shopFromConf = shopMatch[1].trim()
        .replace(/[.,]+$/, '')  // Remove trailing punctuation
        .replace(/\s+(sí|si|correct|correcto)$/i, '')  // Remove confirmation words
        .trim();

      // JUNK CHECK: Reject if it looks like time/day phrase
      const isJunkShop = shopJunkPhrases.some(junk => shopFromConf.toLowerCase().includes(junk));
      if (isJunkShop) {
        console.log(`🗑️ Rejecting junk shop from confirmation: "${shopFromConf}"`);
        continue;
      }

      // Normalize to whitelist
      const normalized = normalizeShopName(shopFromConf);
      if (shopWhitelist.some(s => s.toLowerCase() === normalized.toLowerCase())) {
        data.shop = normalized;
        console.log(`✅ Extracted shop from assistant confirmation: "${data.shop}"`);
        break;
      } else if (shopFromConf.length >= 3) {
        data.shop = normalized;
        console.log(`✅ Extracted shop from assistant confirmation (non-whitelist): "${data.shop}"`);
        break;
      }
    }
  }

  // PRIORITY 2: Get shop from user's direct answer to shop question
  if (!data.shop) {
    for (let i = 0; i < transcript.length - 1; i++) {
      const msg = transcript[i];
      const msgLower = msg.content.toLowerCase();
      if (msg.role === "assistant" &&
          (msgLower.includes("what shop") || msgLower.includes("calling from") ||
           msgLower.includes("qué taller") || msgLower.includes("de qué taller"))) {
        // Get the next user message
        for (let j = i + 1; j < transcript.length; j++) {
          if (transcript[j].role === "user") {
            const userShopResponse = transcript[j].content.trim();

            // JUNK CHECK: Reject if it looks like time/day phrase
            const isJunkShop = shopJunkPhrases.some(junk => userShopResponse.toLowerCase().includes(junk));
            if (isJunkShop) {
              console.log(`🗑️ Rejecting junk shop from direct answer: "${userShopResponse}"`);
              break;
            }

            // Clean the response
            let cleaned = userShopResponse
              .replace(/^(de |del |from |at |en )/i, '')
              .replace(/\s+(body\s*shop|collision|auto)$/i, '')
              .replace(/[.,:;!?]+\s*[A-Za-z]?$/, '')  // Remove trailing punctuation
              .replace(/\s+(sí|si|no|es|el|la|un|una|de|del|y|o)$/i, '')
              .trim();

            if (cleaned.length >= 3) {
              const normalized = normalizeShopName(cleaned);
              data.shop = normalized;
              console.log(`✅ Extracted shop from direct answer: "${data.shop}"`);
            }
            break;
          }
          if (transcript[j].role === "assistant") break;
        }
        if (data.shop) break;
      }
    }
  }

  // Names to explicitly REJECT as shop names (common caller names)
  const callerNames = ["randy", "sandy", "carlos", "mike", "john", "jose", "david", "james", "robert", "michael", "william", "richard", "joseph", "thomas", "charles", "daniel", "matthew", "anthony", "mark", "donald", "steven", "paul", "andrew", "joshua", "kenneth", "kevin", "brian", "george", "timothy", "ronald", "edward", "jason", "jeffrey", "ryan", "jacob", "gary", "nicholas", "eric", "jonathan", "stephen", "larry", "justin", "scott", "brandon", "benjamin", "samuel", "raymond", "gregory", "frank", "alexander", "patrick", "jack", "dennis", "jerry", "tyler", "aaron", "jose", "adam", "nathan", "henry", "douglas", "zachary", "peter", "kyle", "noah", "ethan", "jeremy", "walter", "christian", "keith", "roger", "terry", "austin", "sean", "gerald", "carl", "dylan", "harold", "jordan", "jesse", "bryan", "lawrence", "arthur", "gabriel", "bruce", "albert", "willie", "alan", "wayne", "elijah", "juan", "louis", "russell", "vincent", "philip", "bobby", "johnny", "bradley", "maria", "ana", "carmen", "rosa", "elena", "lucia", "isabel", "sofia", "pedro", "luis", "miguel", "jorge", "fernando", "manuel", "francisco", "antonio", "ricardo", "alberto", "roberto"];

  // Reject if shop is a caller name OR contains junk
  if (data.shop) {
    const shopLower = data.shop.toLowerCase();
    if (callerNames.includes(shopLower.split(/\s+/)[0])) {
      console.log(`❌ Rejecting shop "${data.shop}" - appears to be caller name`);
      data.shop = null;
    } else if (shopJunkPhrases.some(junk => shopLower.includes(junk))) {
      console.log(`❌ Rejecting shop "${data.shop}" - contains junk phrase`);
      data.shop = null;
    }
  }

  // LEGACY FALLBACK: Pattern matching on user text (only if above failed)
  const userTextLower = userText.toLowerCase();
  if (!data.shop) {
  const shopPatterns = [
    /(?:calling from|from)\s+([a-z0-9\s&'.-]{2,25})(?:\s+shop|\s+auto|\s+collision|\s+body)?/i,
    /(?:shop name is|shop is|the shop is|shop's)\s+([a-z0-9\s&'.-]{2,25})/i,
    /(?:taller\s+(?:es|se llama))\s+([a-z0-9\s&'.-]{2,25})/i,
    /(?:de)\s+([a-z0-9\s&'.-]{2,25})\s+(?:body\s*shop|taller)/i,
  ];

  for (const pattern of shopPatterns) {
    const match = userText.match(pattern);
    if (match && match[1]) {
      let shopCandidate = match[1].trim()
        .replace(/\s+(sí|si|no|es|el|la|un|una|de|del|y|o|que|para|con|por)$/i, '')
        .replace(/[.,:;!?]+\s*[A-Za-z]?$/, '')
        .replace(/\s+[A-Z]$/i, '')
        .trim();

      const shopLower = shopCandidate.toLowerCase();
      const isCallerName = callerNames.includes(shopLower.split(/\s+/)[0]);
      const vehicleKeywords = /\b(2024|2025|2023|toyota|honda|ford|nissan|camry|accord|f-150)\b/i;
      const fillerWords = ["the shop", "the", "a", "an", "that", "our", "my", "here", "this is", "hi", "hello", "yes", "no"];

      if (shopCandidate.length >= 3 &&
          !fillerWords.includes(shopLower) &&
          !isCallerName &&
          !vehicleKeywords.test(shopCandidate)) {
        data.shop = shopCandidate;
        console.log(`✅ Extracted shop: "${data.shop}"`);
        break;
      } else {
        console.log(`❌ Shop candidate rejected: too short=${shopCandidate.length < 3}, filler=${fillerWords.includes(shopLower)}, callerName=${isCallerName}, vehicle=${vehicleKeywords.test(shopCandidate)}`);
      }
    }
  }
  } // End of legacy fallback if (!data.shop) block

  // PATCH 6: Vehicle info - ONLY from vehicle question answer or assistant confirmation
  // Don't scan entire userText - be strict about where we extract from
  let year = null, make = null, model = null, vin = null;

  // PATCH 14: Year validation - separate valid vehicle years from RO numbers
  const yearPattern = /\b(19[9]\d|20[0-2]\d)\b/g;
  let yearMatches = [];
  let yearMatch;

  // PRIORITY 1: Look for year in user's answer to vehicle question
  for (let i = 0; i < transcript.length - 1; i++) {
    const msg = transcript[i];
    const msgLower = msg.content.toLowerCase();
    if (msg.role === "assistant" &&
        (msgLower.includes("year, make") ||
         msgLower.includes("make and model") ||
         msgLower.includes("what vehicle") ||
         msgLower.includes("año, marca") ||
         msgLower.includes("marca y modelo") ||
         msgLower.includes("qué vehículo") ||
         msgLower.includes("que vehiculo"))) {
      // Get the next user message
      for (let j = i + 1; j < transcript.length; j++) {
        if (transcript[j].role === "user") {
          const vehicleResponse = transcript[j].content;
          while ((yearMatch = yearPattern.exec(vehicleResponse)) !== null) {
            yearMatches.push(yearMatch[1]);
          }
          break;
        }
        if (transcript[j].role === "assistant") break;
      }
    }
  }

  // PRIORITY 2: If no year from direct answer, check all user messages for vehicle context
  // (user might say "it's a 2018 Nissan" without being asked)
  if (yearMatches.length === 0) {
    while ((yearMatch = yearPattern.exec(userText)) !== null) {
      yearMatches.push(yearMatch[1]);
    }
  }

  if (yearMatches.length > 0) year = yearMatches[yearMatches.length - 1];

  const makes = {
    "toyota": "Toyota", "lexus": "Lexus", "honda": "Honda", "acura": "Acura",
    "ford": "Ford", "lincoln": "Lincoln", "chevrolet": "Chevrolet", "chevy": "Chevrolet",
    "gmc": "GMC", "buick": "Buick", "cadillac": "Cadillac", "nissan": "Nissan",
    "infiniti": "Infiniti", "mercedes": "Mercedes-Benz", "benz": "Mercedes-Benz",
    "bmw": "BMW", "audi": "Audi", "volkswagen": "Volkswagen", "vw": "Volkswagen",
    "tesla": "Tesla", "subaru": "Subaru", "mazda": "Mazda", "hyundai": "Hyundai",
    "kia": "Kia", "jeep": "Jeep", "ram": "Ram", "dodge": "Dodge", "chrysler": "Chrysler",
    "volvo": "Volvo", "porsche": "Porsche", "land rover": "Land Rover", "jaguar": "Jaguar",
    "genesis": "Genesis", "mini": "MINI", "mitsubishi": "Mitsubishi"
  };

  // Find ALL make mentions and use the last one
  let makeMatches = [];
  for (const [key, value] of Object.entries(makes)) {
    const makeRegex = new RegExp(`\\b${key}\\b`, "gi");
    let match;
    while ((match = makeRegex.exec(userText)) !== null) {
      makeMatches.push({ make: value, index: match.index });
    }
  }

  if (makeMatches.length > 0) {
    // Use the LAST (most recent) make mentioned
    const lastMake = makeMatches[makeMatches.length - 1];
    make = lastMake.make;

    // Extract model after this make mention - include accented chars like Máxima
    const afterMake = userText.slice(lastMake.index + lastMake.make.length).trim();
    // Allow accented letters (á, é, í, ó, ú, ñ) in model names
    const modelMatch = afterMake.match(/^([a-záéíóúñA-ZÁÉÍÓÚÑ0-9\-]+(?:\s+[a-záéíóúñA-ZÁÉÍÓÚÑ0-9\-]+)?)/i);
    if (modelMatch) {
      // Skip words that aren't model names (English and Spanish)
      const skipWords = ["with", "for", "on", "the", "has", "is", "was", "are", "and", "del", "de", "el", "la", "un", "una", "es", "y", "sí", "si", "no"];
      let modelCandidate = modelMatch[1].trim();

      // Remove trailing Spanish words like "del" from model name
      modelCandidate = modelCandidate.replace(/\s+(del|de|el|la|un|una|es|y|sí|si)$/i, "").trim();

      if (!skipWords.includes(modelCandidate.toLowerCase()) && modelCandidate.length > 1) {
        model = modelCandidate;
      }
    }
  }

  // PRIORITY: Get vehicle info from assistant's LAST confirmation (most accurate)
  if (!year || !make || !model) {
    for (let i = assistantConfirmations.length - 1; i >= 0; i--) {
      const conf = assistantConfirmations[i].content;
      // Look for "2025 Kia Telluride" pattern
      const vehicleMatch = conf.match(/\b(20\d{2})\s+([A-Za-z]+)\s+([A-Za-záéíóúñ]+)/);
      if (vehicleMatch) {
        if (!year) year = vehicleMatch[1];
        // Try to map the make properly
        const confMake = vehicleMatch[2].toLowerCase();
        if (!make && makes[confMake]) make = makes[confMake];
        else if (!make) make = vehicleMatch[2];
        if (!model) model = vehicleMatch[3];
        console.log(`✅ Extracted vehicle from assistant confirmation: ${year} ${make} ${model}`);
        break;
      }
    }
  }

  // VIN - find ALL VIN mentions and use the last one
  // Support: full 17-digit, "VIN ending XXXX", "ending XXXX", spaced digits "1 2 5 7", dashes "0-5-2-6"
  // PATCH: Enhanced to handle Spanish word forms and dashes
  const fullVinPattern = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;
  const last4Pattern = /(?:vin|v\.i\.n\.)(?:\s+(?:ending|is|number|terminado|termina))?[\s:en]*([A-HJ-NPR-Z0-9]{4})\b/gi;
  const endingPattern = /(?:ending|ends with|last four|last 4|terminado en|termina en|últimos cuatro|ultimos cuatro)\s+([A-HJ-NPR-Z0-9]{4})\b/gi;

  // Pattern for dashed VIN digits (e.g., "0-5-2-6" or "0 - 5 - 2 - 6")
  const dashedVinPattern = /(?:vin|ending|terminado)[\s:en]*([A-Z0-9])[\s\-]+([A-Z0-9])[\s\-]+([A-Z0-9])[\s\-]+([A-Z0-9])\b/gi;

  // Pattern for spaced-out VIN digits with prefix (e.g., "VIN ending 1 2 5 7" or "ending 1 2 5 7")
  const spacedVinPattern = /(?:vin|ending|ends with|last four|last 4|terminado|termina)[\s:en]+([A-Z0-9])[\s,]+([A-Z0-9])[\s,]+([A-Z0-9])[\s,]+([A-Z0-9])\b/gi;

  // Pattern for spaced/comma-separated digits spoken naturally (e.g., "1 2 3 0" or "1, 2, 3, 0")
  // Matches 4 consecutive single digits/letters separated by spaces or commas
  const naturalSpacedPattern = /\b([0-9])[\s,]+([0-9])[\s,]+([0-9])[\s,]+([0-9])\.?\b/g;

  // PATCH 5+: Pattern for word-form numbers (English AND Spanish)
  // Enhanced with Spanish compound numbers like "veintiséis" (26)
  const wordNumbers = {
    // English
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    // Spanish basic
    "cero": "0", "uno": "1", "dos": "2", "tres": "3", "cuatro": "4",
    "cinco": "5", "seis": "6", "siete": "7", "ocho": "8", "nueve": "9",
    // Spanish compound numbers for last 2 digits (common in VIN)
    "diez": "10", "once": "11", "doce": "12", "trece": "13", "catorce": "14",
    "quince": "15", "dieciséis": "16", "dieciseis": "16", "diecisiete": "17",
    "dieciocho": "18", "diecinueve": "19", "veinte": "20",
    "veintiuno": "21", "veintidós": "22", "veintidos": "22", "veintitrés": "23", "veintitres": "23",
    "veinticuatro": "24", "veinticinco": "25", "veintiséis": "26", "veintiseis": "26",
    "veintisiete": "27", "veintiocho": "28", "veintinueve": "29"
  };
  // English pattern
  const wordPattern = /(?:vin|ending|ends with|last four|last 4)[\s:]+(?:is\s+)?(\w+)\s+(\w+)\s+(\w+)\s+(\w+)\b/gi;
  // Spanish pattern: "terminado en uno dos tres cuatro" or "VIN uno dos tres cuatro"
  const spanishWordPattern = /(?:vin|terminado en|termina en|últimos cuatro|ultimos cuatro)[\s:]+(?:es\s+)?(\w+)\s+(\w+)\s+(\w+)\s+(\w+)\b/gi;
  // Spanish compound pattern: "cero cinco veintiséis" (0526) - handles 2-digit Spanish numbers
  const spanishCompoundPattern = /(?:vin|terminado en|termina en)[\s:]+(?:es\s+)?(\w+)\s+(\w+)\s+(\w+)\b/gi;

  let vinMatches = [];
  let vinMatch;

  while ((vinMatch = fullVinPattern.exec(userText)) !== null) {
    vinMatches.push(vinMatch[1].slice(-4).toUpperCase());
  }

  while ((vinMatch = last4Pattern.exec(userText)) !== null) {
    vinMatches.push(vinMatch[1].toUpperCase());
  }

  while ((vinMatch = endingPattern.exec(userText)) !== null) {
    vinMatches.push(vinMatch[1].toUpperCase());
  }

  // Handle dashed VIN digits (e.g., "0-5-2-6")
  while ((vinMatch = dashedVinPattern.exec(userText)) !== null) {
    const dashedVin = `${vinMatch[1]}${vinMatch[2]}${vinMatch[3]}${vinMatch[4]}`.toUpperCase();
    vinMatches.push(dashedVin);
    console.log(`🔢 Found dashed VIN digits: ${dashedVin}`);
  }

  // Handle spaced-out VIN with prefix
  while ((vinMatch = spacedVinPattern.exec(userText)) !== null) {
    const spacedVin = `${vinMatch[1]}${vinMatch[2]}${vinMatch[3]}${vinMatch[4]}`.toUpperCase();
    vinMatches.push(spacedVin);
  }

  // Handle natural spaced digits (after we've confirmed vehicle context exists)
  if (year && make) {
    while ((vinMatch = naturalSpacedPattern.exec(userText)) !== null) {
      const spacedVin = `${vinMatch[1]}${vinMatch[2]}${vinMatch[3]}${vinMatch[4]}`.toUpperCase();
      vinMatches.push(spacedVin);
      console.log(`🔢 Found natural spaced VIN digits: ${spacedVin}`);
    }
  }

  // Handle word-form numbers (e.g., "one two five seven")
  while ((vinMatch = wordPattern.exec(userText)) !== null) {
    const d1 = wordNumbers[vinMatch[1].toLowerCase()];
    const d2 = wordNumbers[vinMatch[2].toLowerCase()];
    const d3 = wordNumbers[vinMatch[3].toLowerCase()];
    const d4 = wordNumbers[vinMatch[4].toLowerCase()];
    if (d1 && d2 && d3 && d4) {
      const wordVin = `${d1}${d2}${d3}${d4}`;
      vinMatches.push(wordVin);
      console.log(`🔢 Found word-form VIN: ${wordVin}`);
    }
  }

  // PATCH 5: Handle Spanish word-form numbers (e.g., "uno dos tres cuatro", "cero cinco seis siete")
  while ((vinMatch = spanishWordPattern.exec(userText)) !== null) {
    const d1 = wordNumbers[vinMatch[1].toLowerCase()];
    const d2 = wordNumbers[vinMatch[2].toLowerCase()];
    const d3 = wordNumbers[vinMatch[3].toLowerCase()];
    const d4 = wordNumbers[vinMatch[4].toLowerCase()];
    if (d1 && d2 && d3 && d4) {
      const wordVin = `${d1}${d2}${d3}${d4}`;
      vinMatches.push(wordVin);
      console.log(`🔢 Found Spanish word-form VIN: ${wordVin}`);
    }
  }

  // Handle Spanish compound numbers (e.g., "cero cinco veintiséis" = 0526)
  while ((vinMatch = spanishCompoundPattern.exec(userText)) !== null) {
    const w1 = vinMatch[1].toLowerCase();
    const w2 = vinMatch[2].toLowerCase();
    const w3 = vinMatch[3].toLowerCase();

    // Check if w3 is a compound number (like "veintiséis" = 26)
    if (wordNumbers[w1] && wordNumbers[w2] && wordNumbers[w3]) {
      const d1 = wordNumbers[w1];
      const d2 = wordNumbers[w2];
      const d3 = wordNumbers[w3];  // This will be "26" for "veintiséis"
      if (d1.length === 1 && d2.length === 1 && d3.length === 2) {
        // Format: d1 + d2 + d3 = "0" + "5" + "26" = "0526"
        const compoundVin = `${d1}${d2}${d3}`;
        vinMatches.push(compoundVin);
        console.log(`🔢 Found Spanish compound VIN: ${compoundVin} (from "${w1} ${w2} ${w3}")`);
      }
    }
  }

  // ALSO check assistant confirmation for VIN (assistant repeats back correctly)
  // Enhanced to handle Spanish confirmation format "VIN terminado en XXXX"
  if (vinMatches.length === 0) {
    const assistantVinMatch = assistantText.match(/VIN\s+(?:ending|terminado\s+en)\s+([A-Z0-9]{4})/i);
    if (assistantVinMatch) {
      vinMatches.push(assistantVinMatch[1].toUpperCase());
      console.log(`🔢 Extracted VIN from assistant confirmation: ${assistantVinMatch[1]}`);
    }
  }

  if (vinMatches.length > 0) {
    vin = vinMatches[vinMatches.length - 1];
    console.log(`🔢 Final VIN ending: ${vin}`);
  }

  // Format vehicle_info EXACTLY as: "YYYY Make Model (VIN ending XXXX)"
  console.log(`🚗 Vehicle components: year="${year}", make="${make}", model="${model}", vin="${vin}"`);

  if (year && make && model && vin) {
    data.vehicle_info = `${year} ${make} ${model} (VIN ending ${vin})`;
  } else if (year && make && model) {
    data.vehicle_info = `${year} ${make} ${model}`;
  }

  if (data.vehicle_info) {
    console.log(`✅ Formatted vehicle_info: "${data.vehicle_info}"`);
  } else {
    console.log(`⚠️  No vehicle_info created - missing components`);
  }

  // Status (ONLY "ready" or "not ready") - extract from USER messages only, not assistant questions
  // Must handle both English and Spanish
  // PATCH: ALWAYS output English values ("ready"/"not ready") even for Spanish calls
  // PRIORITY: Use assistant's confirmation summary as source of truth
  const userMessages = transcript.filter(t => t.role === "user").map(t => t.content).join(" ").toLowerCase();

  // PRIORITY 1: Check assistant confirmation for status (most reliable)
  for (let i = assistantConfirmations.length - 1; i >= 0; i--) {
    const conf = assistantConfirmations[i].content.toLowerCase();
    // English: "status ready" or "status not ready"
    // Spanish: "estado listo" or "estado no está listo" or "estado no listo"
    if (conf.includes("status not ready") || conf.includes("estado no") || conf.includes("no está listo") || conf.includes("no listo")) {
      data.status_from_shop = "not ready";
      console.log(`✅ Status extracted from confirmation: "not ready"`);
      break;
    } else if (conf.includes("status ready") || conf.includes("estado listo") || (conf.includes("estado") && conf.includes("listo"))) {
      data.status_from_shop = "ready";
      console.log(`✅ Status extracted from confirmation: "ready"`);
      break;
    }
  }

  // PRIORITY 2: Fall back to user message extraction if not found in confirmation
  if (!data.status_from_shop) {
    // Check for "not ready" first (more specific) - English and Spanish
    const notReadyPatterns = [
      // English
      "not ready", "isn't ready", "not yet ready", "not currently ready",
      "is not ready", "still not ready", "isn't ready yet",
      // Spanish - check "no" + "listo" patterns first
      "no está listo", "no esta listo", "no listo", "no está lista", "no esta lista",
      "todavía no está listo", "todavia no esta listo",
      "todavía no", "todavia no", "aún no", "aun no",
      "no está preparado", "no esta preparado",
      "no, no está listo", "no, no esta listo"
    ];

    const readyPatterns = [
      // English
      "ready", "is ready", "it's ready", "vehicle is ready", "car is ready",
      "yes ready", "yes it's ready", "yes, ready",
      // Spanish - various forms of "listo/lista"
      "está listo", "esta listo", "está lista", "esta lista",
      "sí, listo", "si, listo", "sí listo", "si listo",
      "sí, está listo", "si, esta listo", "sí está listo", "si esta listo",
      "y está listo", "y esta listo", "ya está listo", "ya esta listo",
      "sí, ya está listo", "si, ya esta listo",
      "listo para calibrar", "lista para calibrar",
      "preparado", "preparada"
    ];

    // Check for "not ready" FIRST (more specific)
    let isNotReady = false;
    for (const pattern of notReadyPatterns) {
      if (userMessages.includes(pattern)) {
        isNotReady = true;
        break;
      }
    }

    if (isNotReady) {
      data.status_from_shop = "not ready";
      console.log(`✅ Status extracted from user: "not ready"`);
    } else {
      // Check for "ready"
      let isReady = false;
      for (const pattern of readyPatterns) {
        if (userMessages.includes(pattern)) {
          isReady = true;
          break;
        }
      }
      // Also check for standalone "listo" or "lista" (Spanish)
      if (!isReady && (/\blisto\b/.test(userMessages) || /\blista\b/.test(userMessages))) {
        isReady = true;
      }

      if (isReady) {
        data.status_from_shop = "ready";
        console.log(`✅ Status extracted from user: "ready"`);
      }
    }
  }

  // Scheduled - extract date AND time from USER messages only
  // Must handle both English and Spanish
  // PRIORITY: Use assistant's LAST confirmation first (most accurate)
  console.log(`📅 Checking for scheduled date/time in user text`);

  // PRIORITY 1: Get scheduled from assistant confirmation
  for (let i = assistantConfirmations.length - 1; i >= 0; i--) {
    const conf = assistantConfirmations[i].content.toLowerCase();
    // Spanish: "programado para hoy a las 3 de la tarde"
    let schedMatch = conf.match(/programado\s+(?:para\s+)?(.+?)(?:,|notas|notes|\.|$)/i);
    if (!schedMatch) {
      // English: "scheduled for today at 3pm"
      schedMatch = conf.match(/scheduled\s+(?:for\s+)?(.+?)(?:,|notes|\.|$)/i);
    }
    if (schedMatch && schedMatch[1]) {
      data.scheduled = schedMatch[1].trim();
      console.log(`✅ Extracted scheduled from assistant confirmation: "${data.scheduled}"`);
      break;
    }
  }

  // PRIORITY 2: If not from assistant, try user text extraction
  if (!data.scheduled) {
  // Try combined date+time patterns FIRST (e.g., "Monday at 2 p.m." or "hoy a las 3 de la tarde")
  const combinedPatterns = [
    // English patterns
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i,
    /\b(today|tomorrow)\s+(?:at|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}(?:st|nd|rd|th)?)\s+(?:at|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i,
    /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(?:at|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i,
    // Spanish patterns - "hoy a las 3 de la tarde", "mañana a las 10 de la mañana"
    /(?:para\s+)?(hoy|mañana|manana)\s+(?:a las?|a eso de las?)\s+([\w\s]+(?:de la tarde|de la mañana|de la manana|de la noche))/i,
    /(?:para\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(?:a las?|a eso de las?)\s+([\w\s]+(?:de la tarde|de la mañana|de la manana|de la noche))/i
  ];

  let foundScheduled = null;

  for (const pattern of combinedPatterns) {
    const match = userText.match(pattern);
    if (match) {
      if (match[3]) {
        // Month + day + time pattern
        foundScheduled = `${match[1]} ${match[2]} at ${match[3]}`;
      } else {
        // Day/date + time pattern
        foundScheduled = `${match[1]} at ${match[2]}`;
      }
      console.log(`📅 Found combined date+time: "${foundScheduled}"`);
      break;
    }
  }

  // If no combined match, try separate date and time extraction
  if (!foundScheduled) {
    const scheduledParts = [];

    // Try to find date (English and Spanish)
    const datePatterns = [
      // English
      /(?:on|for|scheduled)\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
      /(?:on|for|scheduled)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}(?:st|nd|rd|th)?)/i,
      /(?:on|for|scheduled)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      /(?:on|for|scheduled)\s+(today|tomorrow|next week|this week)/i,
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      /\b(today|tomorrow)\b/i,
      // Spanish
      /(?:para\s+)?(hoy|mañana|manana)\b/i,
      /(?:para\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i,
    ];

    for (const pattern of datePatterns) {
      const match = userText.match(pattern);
      if (match) {
        scheduledParts.push(match[1] + (match[2] ? ` ${match[2]}` : ""));
        console.log(`📅 Found date: "${scheduledParts[scheduledParts.length - 1]}"`);
        break;
      }
    }

    // Try to find time (English and Spanish)
    // Track if we found Spanish time to use correct connector
    let timeIsSpanish = false;
    let foundTime = null;

    // Spanish time patterns first (more specific)
    const spanishTimePatterns = [
      /a\s+las?\s+([\w\s]+de la tarde)/i,  // "a las tres de la tarde"
      /a\s+las?\s+([\w\s]+de la mañana)/i,  // "a las diez de la mañana"
      /a\s+las?\s+([\w\s]+de la noche)/i,  // "a las ocho de la noche"
      /a\s+las?\s+(\d{1,2}(?::\d{2})?)/i,  // "a las 3"
    ];

    for (const pattern of spanishTimePatterns) {
      const match = userText.match(pattern);
      if (match) {
        foundTime = `a las ${match[1]}`;
        timeIsSpanish = true;
        console.log(`📅 Found Spanish time: "${foundTime}"`);
        break;
      }
    }

    // English time patterns if no Spanish found
    if (!foundTime) {
      const englishTimePatterns = [
        /(?:at|around)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))/i,
        /(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))/i,  // Time without "at"
        /(?:at|around)\s+(\d{1,2})\s*(?:o'clock|oclock)/i,
        /(?:at|around)\s+(\d{1,2})\b/i,  // Just "at 2" without am/pm
      ];

      for (const pattern of englishTimePatterns) {
        const match = userText.match(pattern);
        if (match) {
          foundTime = `at ${match[1]}`;
          console.log(`📅 Found English time: "${foundTime}"`);
          break;
        }
      }
    }

    if (foundTime) {
      scheduledParts.push(foundTime);
    }

    if (scheduledParts.length > 0) {
      foundScheduled = scheduledParts.join(" ");
    }
  }

  // ALSO check assistant confirmation for scheduled (assistant repeats back correctly)
  // Handle both English and Spanish confirmations
  if (!foundScheduled) {
    // English: "scheduled for today at 3 pm"
    let scheduledMatch = assistantText.match(/scheduled\s+(?:for\s+)?([A-Za-z]+(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)?)/i);

    // Spanish: "programado para hoy a las 3 de la tarde"
    if (!scheduledMatch) {
      scheduledMatch = assistantText.match(/programado\s+(?:para\s+)?(.+?)(?:,|\.|\s+notas|\s+notes)/i);
    }

    if (scheduledMatch && scheduledMatch[1]) {
      foundScheduled = scheduledMatch[1].trim();
      console.log(`📅 Extracted scheduled from assistant confirmation: "${foundScheduled}"`);
    }
  }

  if (foundScheduled) {
    data.scheduled = foundScheduled;
    console.log(`📅 Final scheduled: "${data.scheduled}"`);
  }
  } // End of !data.scheduled block

  // Extract caller name from conversation (assistant asks "who am I speaking with?")
  // Only do this secondary extraction if we didn't already get a name from patterns
  let callerName = data.caller_name;  // Start with any name we already extracted from patterns

  if (!callerName) {
    for (let i = 0; i < transcript.length - 1; i++) {
      if (transcript[i].role === "assistant" &&
          (transcript[i].content.toLowerCase().includes("who am i speaking with") ||
           transcript[i].content.toLowerCase().includes("who am i speaking to") ||
           transcript[i].content.toLowerCase().includes("may i have your name") ||
           transcript[i].content.toLowerCase().includes("what's your name") ||
           transcript[i].content.toLowerCase().includes("your name") ||
           transcript[i].content.toLowerCase().includes("con quién") ||
           transcript[i].content.toLowerCase().includes("con quien") ||
           transcript[i].content.toLowerCase().includes("tu nombre"))) {
        // Get the next user message as the caller name
        for (let j = i + 1; j < transcript.length; j++) {
          if (transcript[j].role === "user") {
            const nameResponse = transcript[j].content.trim();
            // Reject noise words
            const noiseWords = ["bye", "peace", "thanks", "ok", "okay", "yes", "no", "si", "sí"];
            if (noiseWords.includes(nameResponse.toLowerCase())) {
              break;
            }
            // Extract just the name (remove common prefixes)
            const nameMatch = nameResponse.match(/(?:this is|my name is|i'm|i am|it's|con|habla|soy)\s*([A-Za-záéíóúñ]+)/i) ||
                             nameResponse.match(/^([A-Za-záéíóúñ]{2,15})\.?$/i);
            if (nameMatch && nameMatch[1]) {
              const candidate = nameMatch[1].toLowerCase();
              if (!noiseWords.includes(candidate) && candidate.length > 2) {
                callerName = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1).toLowerCase();
                console.log(`👤 Extracted caller name from question: "${callerName}"`);
              }
            }
            break;
          }
        }
        if (callerName) break;
      }
    }
  }

  // Notes - ONLY extract from the direct answer to the notes question
  console.log(`📝 Extracting notes from user response`);

  // Patterns for "no notes" responses (multi-language)
  const noNotesPatterns = [
    /^(no|none|nothing|nope|nah)$/i,
    /^no\s*(notes?)?$/i,
    /^(that'?s?\s*(all|it)|nothing\s*else)$/i,
    // Spanish
    /^(no|nada|ninguno|ninguna|no\s*hay|sin\s*notas?)$/i,
    // Portuguese
    /^(não|nao|nenhum|nenhuma)$/i
  ];

  // Patterns that are DEFINITELY not notes (confirmations/filler)
  const notNotesPatterns = [
    /^(yes|yeah|yep|yup|correct|that'?s?\s*right|sounds?\s*good|looks?\s*good|perfect|all\s*good|ok|okay|affirmative|sí|si|claro|dale|perfecto|está\s*bien)$/i,
    /^(yes|yeah|sí),?\s*(that'?s?\s*(right|correct)|sounds?\s*good|correcto)$/i,
  ];

  // Patterns that indicate date/time ONLY (NOT notes) - comprehensive list
  const dateTimeOnlyPatterns = [
    // Day words at start (English)
    /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    // Day words at start (Spanish)
    /^(hoy|mañana|manana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)/i,
    // Time patterns (standalone)
    /^\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i,  // "2pm", "2:00pm"
    /^\d{1,2}\/\d{1,2}/i,  // "12/5"
    /^at\s+\d/i,  // "at 2pm"
    /^a\s+las?\s+\d/i,  // "a las 2"
    // Full date/time phrases (English)
    /^(for\s+)?(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(at\s+)?\d/i,
    // Full date/time phrases (Spanish) - "hoy por la tarde a las 3 p.m."
    /^(para\s+)?(hoy|mañana|lunes|martes|miércoles|jueves|viernes)\s+(por\s+la\s+)?(mañana|tarde|noche)/i,
    /^(para\s+)?(hoy|mañana|lunes|martes|miércoles|jueves|viernes)\s+(a\s+las?\s+)?\d/i,
    /hoy\s+por\s+la\s+(mañana|tarde|noche)/i,  // "hoy por la tarde"
    /hoy\s+a\s+las?\s+\d/i,  // "hoy a las 3"
    /mañana\s+a\s+las?\s+\d/i,  // "mañana a las 10"
    // Time of day (English)
    /^(this\s+)?(morning|afternoon|evening)/i,
    // Time of day (Spanish) - any mention
    /^(esta\s+)?(mañana|tarde|noche)/i,
    /^in\s+the\s+(morning|afternoon|evening)/i,
    /^(por|en)\s+la\s+(mañana|tarde|noche)/i,
    // Spanish full scheduling phrases
    /de\s+la\s+(mañana|tarde|noche)/i,  // "de la tarde", "de la mañana"
    /por\s+la\s+(mañana|tarde|noche)/i,  // "por la tarde"
    /a\s+las?\s+\d.*p\.?m\.?/i,  // "a las 3 p.m."
    /a\s+las?\s+\d.*de\s+la\s+(mañana|tarde|noche)/i,  // "a las 3 de la tarde"
    // Relative scheduling (English)
    /^(next|this)\s+(week|month|monday|tuesday|wednesday|thursday|friday)/i,
    // Relative scheduling (Spanish)
    /^(la\s+)?(próxima|proxima|esta)\s+(semana)/i
  ];

  // Find the LAST time assistant asked about notes and get the immediate next user response
  let notesResponse = null;
  let userSaidNoNotes = false;

  // Scan for notes questions (find the LAST one to handle re-asks)
  const notesQuestionPatterns = [
    /any\s*(other\s*)?(notes?|special|additional)/i,
    /notes?\s*for\s*(the\s*)?(vehicle|this)/i,
    /anything\s*(else\s*)?(to\s*add|to\s*note|special)/i,
    /alguna\s*nota/i,  // Spanish
    /algo\s*más/i  // Spanish "anything else"
  ];

  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === "assistant") {
      const assistantMsg = transcript[i].content.toLowerCase();
      const isNotesQuestion = notesQuestionPatterns.some(p => p.test(assistantMsg));

      if (isNotesQuestion) {
        // Get the IMMEDIATE next user message after this notes question
        for (let j = i + 1; j < transcript.length; j++) {
          if (transcript[j].role === "user") {
            notesResponse = transcript[j].content.trim();
            console.log(`📝 Found notes response after question: "${notesResponse}"`);
            break;
          }
          // If we hit another assistant message before finding a user response, stop
          if (transcript[j].role === "assistant") {
            break;
          }
        }
        break;  // Found the last notes question, stop searching
      }
    }
  }

  if (notesResponse) {
    const trimmedLower = notesResponse.toLowerCase().trim();

    // Check if it's a "no notes" response
    if (noNotesPatterns.some(p => p.test(trimmedLower))) {
      userSaidNoNotes = true;
      console.log(`📋 User explicitly said no notes: "${trimmedLower}"`);
    }
    // Check if it's a confirmation phrase (NOT a note)
    else if (notNotesPatterns.some(p => p.test(trimmedLower))) {
      userSaidNoNotes = true;
      console.log(`📋 Response is confirmation, not notes: "${trimmedLower}"`);
    }
    // Check if it's only a date/time (NOT a note - ignore)
    else if (dateTimeOnlyPatterns.some(p => p.test(trimmedLower))) {
      console.log(`📋 Response is date/time only, ignoring as notes: "${trimmedLower}"`);
      // Don't set notes, don't mark as "no notes" - just ignore
    }
    // Otherwise, it's actual notes content - use ONLY this direct response
    else if (notesResponse.length >= 2 && notesResponse.length < 200) {
      data.shop_notes = notesResponse;
      console.log(`📋 Captured notes from direct response: "${data.shop_notes}"`);
    }
  }

  // Format final notes - simple format: "Caller: X. Notes: Y" or "Caller: X. Notes: none."
  // The normalizeNotes function will translate and format properly
  if (data.shop_notes) {
    // Store raw notes - normalizeNotes() will format with caller name
    console.log(`📋 Raw notes to be normalized: "${data.shop_notes}"`);
  } else {
    // No notes or user said no - store "none"
    data.shop_notes = "none";
    console.log(`📋 Notes set to "none"`);
  }

  // Store caller name separately for normalizeNotes to use
  data.caller_name = callerName;
  console.log(`📋 Caller name for notes: "${callerName}"`);

  // Use session state for shop and scheduled if not found in current extraction
  if (!data.shop && sessionState.shop) {
    data.shop = sessionState.shop;
    console.log(`📌 Using persisted shop name: ${data.shop}`);
  } else if (data.shop) {
    // Update session state with newly extracted shop
    sessionState.shop = data.shop;
    console.log(`💾 Updated sessionState.shop: ${sessionState.shop}`);
  }

  if (!data.scheduled && sessionState.scheduled) {
    data.scheduled = sessionState.scheduled;
    console.log(`📌 Using persisted scheduled time: ${data.scheduled}`);
  } else if (data.scheduled) {
    // Update session state with newly extracted scheduled time
    sessionState.scheduled = data.scheduled;
    console.log(`💾 Updated sessionState.scheduled: ${sessionState.scheduled}`);
  }

  console.log(`💾 Final sessionState: ${JSON.stringify(sessionState)}`);
  return data;
}

function extractTechData(transcript) {
  const fullText = transcript.map(t => t.content).join(" ");
  const text = fullText.toLowerCase();

  const data = {
    ro_number: null,
    technician: null,
    calibration_required: null,
    calibration_performed: null,
    status_from_tech: null,
    tech_notes: null
  };

  // RO
  const roPatterns = [
    /(?:ro|r\.o\.|po|p\.o\.)[\s#:]*([A-Z0-9\-]+)/i,
    /\b(ro[\s]?[\d]{3,})\b/i
  ];
  for (const pattern of roPatterns) {
    const match = text.match(pattern);
    if (match) {
      data.ro_number = match[1].toUpperCase().replace(/\s/g, "");
      break;
    }
  }

  // Technician
  const namePatterns = [
    /(?:my name is|this is|i'm|im|i am)\s+([a-z]+)/i,
    /(?:tech|technician)[\s:]+([a-z]+)/i
  ];
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1].length > 2) {
      data.technician = match[1].charAt(0).toUpperCase() + match[1].slice(1);
      break;
    }
  }

  // Calibrations
  const systems = [];
  if (/fcw|forward collision/i.test(text)) systems.push("FCW");
  if (/lka|lkas|lane keep|lane assist/i.test(text)) systems.push("LKA");
  if (/acc|adaptive cruise/i.test(text)) systems.push("ACC");
  if (/bsm|blind spot/i.test(text)) systems.push("BSM");
  if (/rcta|rear cross/i.test(text)) systems.push("RCTA");
  if (/tss|toyota safety sense/i.test(text)) systems.push("TSS");
  if (/honda sensing/i.test(text)) systems.push("Honda Sensing");

  if (systems.length > 0) {
    data.calibration_required = systems.join(", ");
    data.calibration_performed = systems.join(", ");
  }

  // Status
  const techStatuses = ["completed", "failed", "not ready", "blocked dtc"];
  for (const status of techStatuses) {
    if (text.includes(status)) {
      data.status_from_tech = status.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      break;
    }
  }

  // Notes
  const notes = [];
  const dtcMatches = text.match(/(?:dtc|code|error)[\s:]*([A-Z]\d{4})/gi);
  if (dtcMatches) {
    notes.push(`DTCs: ${dtcMatches.map(m => m.toUpperCase()).join(", ")}`);
  }
  if (text.includes("issue") || text.includes("problem")) {
    const issueMatch = text.match(/(?:issue|problem)[\s:]*([^.,;!?]{10,60})/i);
    if (issueMatch) {
      notes.push(issueMatch[1].trim());
    }
  }
  data.tech_notes = notes.length > 0 ? notes.join("; ") : "none";

  return data;
}

// ============================================================
// OPS NORMALIZATION FUNCTIONS
// ============================================================

// Shop name whitelist and normalization
const SHOP_WHITELIST = [
  "JMD Body Shop",
  "Reinaldo Body Shop",
  "PaintMax",
  "AutoSport",
  "CCNM"
];

function normalizeShopName(shopName) {
  if (!shopName) return null;

  // Strip leading filler words before processing
  const fillerPrefixes = [
    "is", "es", "the", "el", "la", "from", "de", "at", "en",
    "it's", "its", "it is", "this is", "that's", "that is",
    "called", "named", "llamado", "llamada"
  ];

  let cleaned = shopName.trim();

  // Remove leading filler words (case-insensitive)
  for (const filler of fillerPrefixes) {
    const regex = new RegExp(`^${filler}\\s+`, "i");
    if (regex.test(cleaned)) {
      cleaned = cleaned.replace(regex, "").trim();
      console.log(`🔧 Stripped filler "${filler}" from shop name: "${shopName}" → "${cleaned}"`);
    }
  }

  // Reject if after stripping, nothing meaningful remains
  if (!cleaned || cleaned.length < 2) {
    console.log(`⚠️  Shop name "${shopName}" is only filler words, rejecting`);
    return null;
  }

  const lower = cleaned.toLowerCase().trim();

  // JMD Body Shop variations
  if (lower.includes("jmd") || lower.includes("j.m.d") || lower.includes("j m d")) {
    return "JMD Body Shop";
  }

  // Reinaldo Body Shop variations
  if (lower.includes("reinaldo") || lower.includes("reynaldo")) {
    return "Reinaldo Body Shop";
  }

  // PaintMax variations
  if (lower.includes("paintmax") || lower.includes("paint max") || lower.includes("paint-max")) {
    return "PaintMax";
  }

  // AutoSport / Autosport International variations
  if (lower.includes("autosport") || lower.includes("auto sport") || lower.includes("auto-sport") ||
      lower.includes("autosport international") || lower.includes("auto sport international")) {
    return "AutoSport";
  }

  // CCNM / Collision Center of North Miami variations
  if (lower.includes("ccnm") ||
      lower.includes("collision center") ||
      lower.includes("north miami") ||
      lower.includes("centro de colision") ||
      lower.includes("centro de colisión")) {
    return "CCNM";
  }

  // No match found - return cleaned version (assistant will handle clarification)
  console.log(`⚠️  Shop name "${cleaned}" not in whitelist, returning as-is`);
  return cleaned;
}

// Notes normalization - translate to English and format
// PREVENTS DUPLICATION: Never stack "Caller: X. Notes: Caller: X. Notes: ..."
// REJECTS DATE/TIME: If user gave scheduling info, don't treat as notes
// PATCH: Clean up typos and mixed language issues like "Nor, ninguna"
function normalizeNotes(notes, callerName) {
  const formattedCaller = callerName || "Unknown";

  if (!notes) {
    return `Caller: ${formattedCaller}. Notes: none.`;
  }

  let cleanNotes = notes.trim();

  // PREVENT DUPLICATION: If notes already has "Caller:" prefix, extract just the notes part
  if (cleanNotes.toLowerCase().startsWith("caller:")) {
    // Extract just the notes portion after "Notes:"
    const notesMatch = cleanNotes.match(/notes:\s*(.*)$/i);
    if (notesMatch) {
      cleanNotes = notesMatch[1].trim();
    } else {
      // If no "Notes:" found, strip the "Caller: X." prefix
      cleanNotes = cleanNotes.replace(/^caller:\s*[^.]+\.\s*/i, "").trim();
    }
  }

  // CLEAN UP COMMON TYPOS AND JUNK
  // "Nor, ninguna" -> "ninguna" (typo cleanup)
  cleanNotes = cleanNotes
    .replace(/^nor,?\s*/i, '')  // Remove "Nor," prefix (common transcription error)
    .replace(/^no,?\s*/i, '')   // Remove "No," prefix before Spanish words
    .trim();

  const lower = cleanNotes.toLowerCase().trim();

  // REJECT DATE/TIME PHRASES - these are scheduling info, not notes
  const dateTimePatterns = [
    /^(for\s+)?today(\s+at\s+\d+)?/i,
    /^(for\s+)?tomorrow(\s+at\s+\d+)?/i,
    /^(for\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(\s+at\s+\d+)?/i,
    /^(for\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(\s+a\s+las?\s+\d+)?/i,
    /^(for\s+)?hoy(\s+a\s+las?\s+\d+)?/i,
    /^(for\s+)?ma[nñ]ana(\s+a\s+las?\s+\d+)?/i,
    /^\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)$/i,  // Just a time like "2pm" or "10:30 am"
    /^at\s+\d{1,2}/i,  // "at 2pm"
    /^a\s+las?\s+\d{1,2}/i  // Spanish "a las 2"
  ];

  for (const pattern of dateTimePatterns) {
    if (pattern.test(lower)) {
      console.log(`⚠️ Notes "${cleanNotes}" looks like scheduling info, treating as none`);
      return `Caller: ${formattedCaller}. Notes: none.`;
    }
  }

  // Check for "no notes" variations in multiple languages
  // EXPANDED: Include common typos and partial words
  const noNotesPatterns = [
    "no", "none", "nothing", "n/a", "na", "nope", "nor",
    // Spanish
    "nada", "ninguna", "ninguno", "no hay", "sin notas", "no tengo",
    // Portuguese
    "não", "nao", "nenhum", "nenhuma"
  ];

  if (noNotesPatterns.includes(lower) || lower.length < 3) {
    return `Caller: ${formattedCaller}. Notes: none.`;
  }

  // PHRASE-BASED "no notes" detection - catch longer phrases that mean "no notes"
  const noNotesPhrasePatterns = [
    /^(and\s+)?no,?\s*no\s+notes/i,                    // "no, no notes" or "and no, no notes"
    /^(and\s+)?no\s+notes?\s*(for\s+)?(the\s+)?vehicle/i,  // "no notes for the vehicle"
    /^(and\s+)?no\s+notes?$/i,                         // "no notes" or "no note"
    /^(and\s+)?there('s|s)?\s*(are\s+)?no\s+notes/i,   // "there are no notes"
    /^nothing\s+(else|more|to\s+add)/i,                // "nothing else", "nothing more"
    /^that('s|s)?\s*(it|all)/i,                        // "that's it", "that's all"
    /^(and\s+)?nope/i,                                 // "nope", "and nope"
    // Spanish phrases
    /^(y\s+)?no,?\s*ninguna\s*nota/i,                  // "no, ninguna nota"
    /^(y\s+)?sin\s+notas?/i,                           // "sin notas"
    /^(y\s+)?no\s+hay\s+notas?/i,                      // "no hay notas"
    /^(y\s+)?nada\s+(más|mas)?$/i,                     // "nada" or "nada más"
  ];

  for (const pattern of noNotesPhrasePatterns) {
    if (pattern.test(lower)) {
      console.log(`📝 Notes phrase "${cleanNotes}" detected as 'no notes', normalizing to none`);
      return `Caller: ${formattedCaller}. Notes: none.`;
    }
  }

  // REJECT FOREIGN LANGUAGE NOISE - if text is not recognizable English or Spanish, treat as none
  // Check if the text contains mostly non-Latin characters or unrecognizable words
  const latinChars = cleanNotes.match(/[a-záéíóúüñ\s.,!?'-]/gi) || [];
  const totalChars = cleanNotes.replace(/\s/g, "").length;

  // If less than 70% Latin characters, treat as foreign noise
  if (totalChars > 0 && latinChars.length / totalChars < 0.7) {
    console.log(`⚠️ Notes "${cleanNotes}" appears to be foreign language noise, treating as none`);
    return `Caller: ${formattedCaller}. Notes: none.`;
  }

  // Check for common non-English/non-Spanish patterns (Tamil, Hindi, Arabic, etc.)
  const foreignPatterns = [
    /[\u0900-\u097F]/,  // Devanagari (Hindi)
    /[\u0B80-\u0BFF]/,  // Tamil
    /[\u0600-\u06FF]/,  // Arabic
    /[\u4E00-\u9FFF]/,  // Chinese
    /[\u3040-\u30FF]/,  // Japanese
    /[\uAC00-\uD7AF]/,  // Korean
    /[\u0400-\u04FF]/   // Cyrillic
  ];

  for (const pattern of foreignPatterns) {
    if (pattern.test(cleanNotes)) {
      console.log(`⚠️ Notes "${cleanNotes}" contains foreign script, treating as none`);
      return `Caller: ${formattedCaller}. Notes: none.`;
    }
  }

  // Comprehensive Spanish to English translations for notes
  let translatedNotes = cleanNotes;
  const translations = {
    // Vehicle condition
    "cámara frontal": "front camera",
    "camara frontal": "front camera",
    "cámara trasera": "rear camera",
    "camara trasera": "rear camera",
    "cámara delantera": "front camera",
    "camara delantera": "front camera",
    "radar": "radar",
    "radar delantero": "front radar",
    "sensor": "sensor",
    "sensores": "sensors",
    "parabrisas": "windshield",
    "parabrisas nuevo": "new windshield",
    "vidrio nuevo": "new glass",
    "recién reparado": "recently repaired",
    "recien reparado": "recently repaired",
    "golpe frontal": "front collision",
    "golpe trasero": "rear collision",
    "accidente": "accident",
    "colisión": "collision",
    "colision": "collision",
    "daño": "damage",
    "dano": "damage",
    // Urgency
    "urgente": "urgent",
    "lo antes posible": "ASAP",
    "lo más pronto posible": "ASAP",
    "lo mas pronto posible": "ASAP",
    "rápido": "rush",
    "rapido": "rush",
    "prioridad": "priority",
    "cuanto antes": "ASAP",
    // Status
    "listo": "ready",
    "está listo": "is ready",
    "esta listo": "is ready",
    "no listo": "not ready",
    "no está listo": "not ready",
    "no esta listo": "not ready",
    "esperando": "waiting",
    "en espera": "waiting",
    // General/Actions
    "por favor": "please",
    "necesita": "needs",
    "necesitan": "need",
    "revisar": "check",
    "verificar": "verify",
    "calibrar": "calibrate",
    "calibración": "calibration",
    "calibracion": "calibration",
    "hacer": "do",
    "también": "also",
    "tambien": "also",
    "solo": "only",
    "sólo": "only",
    // Common Spanish connecting words
    "el vehículo": "the vehicle",
    "el vehiculo": "the vehicle",
    "el carro": "the vehicle",
    "la camioneta": "the truck",
    "del cliente": "from customer",
    "para el": "for the",
    "para la": "for the",
    "con": "with",
    "sin": "without",
    "y": "and",
    "o": "or",
    // Time-related (not dates, just descriptors)
    "pronto": "soon",
    "después": "later",
    "despues": "later"
  };

  // Apply translations (case-insensitive) with word boundaries
  // CRITICAL: Use word boundaries to prevent partial word matches
  for (const [spanish, english] of Object.entries(translations)) {
    // Escape special regex characters in the spanish phrase
    const escaped = spanish.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    translatedNotes = translatedNotes.replace(regex, english);
  }

  // Clean up and format
  translatedNotes = translatedNotes.trim();
  if (translatedNotes.endsWith(".")) {
    translatedNotes = translatedNotes.slice(0, -1);
  }

  // Remove any remaining "none." if it got doubled
  translatedNotes = translatedNotes.replace(/^none\.?\s*/i, "").trim() || "none";

  return `Caller: ${formattedCaller}. Notes: ${translatedNotes}.`;
}

// Scheduled date/time - Convert to standardized format: "Monday, December 1, 2025 at 2:00 PM"
// Both English and Spanish callers get the same English format in the sheet
function normalizeScheduled(scheduled, sessionLanguage = "en") {
  if (!scheduled) return "TBD";

  const raw = scheduled.trim().toLowerCase();
  if (!raw) return "TBD";

  const now = new Date();
  let targetDate = null;
  let hour = null;
  let minute = 0;

  // ============================================================
  // STEP 1: Parse the DATE component
  // ============================================================

  // Check for "today" / "hoy"
  if (/\b(today|hoy)\b/i.test(raw)) {
    targetDate = new Date(now);
  }
  // Check for "tomorrow" / "mañana"
  else if (/\b(tomorrow|mañana|manana)\b/i.test(raw)) {
    targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + 1);
  }
  // Check for day of week (English)
  else if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(raw)) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const match = raw.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (match) {
      const targetDay = dayNames.indexOf(match[1].toLowerCase());
      targetDate = new Date(now);
      const currentDay = targetDate.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7; // Next week if today or past
      targetDate.setDate(targetDate.getDate() + daysUntil);
    }
  }
  // Check for day of week (Spanish)
  else if (/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i.test(raw)) {
    const spanishDays = {
      'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3,
      'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6, 'domingo': 0
    };
    const match = raw.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i);
    if (match) {
      const targetDay = spanishDays[match[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")] ||
                        spanishDays[match[1].toLowerCase()];
      targetDate = new Date(now);
      const currentDay = targetDate.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      targetDate.setDate(targetDate.getDate() + daysUntil);
    }
  }
  // Check for specific date like "December 5" or "12/5"
  else if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i.test(raw)) {
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const match = raw.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i);
    if (match) {
      const month = monthNames.indexOf(match[1].toLowerCase());
      const day = parseInt(match[2]);
      targetDate = new Date(now.getFullYear(), month, day);
      // If the date is in the past, assume next year
      if (targetDate < now) {
        targetDate.setFullYear(targetDate.getFullYear() + 1);
      }
    }
  }
  // Check for numeric date format MM/DD or M/D
  else if (/\b(\d{1,2})\/(\d{1,2})\b/.test(raw)) {
    const match = raw.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (match) {
      const month = parseInt(match[1]) - 1;
      const day = parseInt(match[2]);
      targetDate = new Date(now.getFullYear(), month, day);
      if (targetDate < now) {
        targetDate.setFullYear(targetDate.getFullYear() + 1);
      }
    }
  }

  // Default to today if no date found
  if (!targetDate) {
    targetDate = new Date(now);
  }

  // ============================================================
  // STEP 2: Parse the TIME component
  // ============================================================

  // Check for specific time with AM/PM (English)
  let timeMatch = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const isPM = /p\.?m\.?/i.test(timeMatch[3]);
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
  }
  // Check for "at X" without AM/PM (assume PM for business hours)
  else if (/\bat\s+(\d{1,2})(?::(\d{2}))?(?!\s*[ap])/i.test(raw)) {
    const atMatch = raw.match(/\bat\s+(\d{1,2})(?::(\d{2}))?/i);
    if (atMatch) {
      hour = parseInt(atMatch[1]);
      minute = atMatch[2] ? parseInt(atMatch[2]) : 0;
      // Assume PM for business hours (1-6)
      if (hour >= 1 && hour <= 6) hour += 12;
    }
  }
  // Check for Spanish time formats
  // "a las tres" / "a las 3"
  else if (/a\s+las?\s+(\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)/i.test(raw)) {
    const spanishNumbers = {
      'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6,
      'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10, 'once': 11, 'doce': 12
    };
    const spanishMatch = raw.match(/a\s+las?\s+(\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s+y\s+(media|cuarto|(\d{1,2})))?/i);
    if (spanishMatch) {
      hour = spanishNumbers[spanishMatch[1].toLowerCase()] || parseInt(spanishMatch[1]);
      if (spanishMatch[2]) {
        if (spanishMatch[2].toLowerCase() === 'media') minute = 30;
        else if (spanishMatch[2].toLowerCase() === 'cuarto') minute = 15;
        else minute = parseInt(spanishMatch[3]) || 0;
      }
      // Check for "de la tarde" / "de la mañana" / "de la noche"
      if (/de\s+la\s+(tarde|noche)/i.test(raw) && hour < 12) hour += 12;
      else if (/de\s+la\s+mañana/i.test(raw) && hour === 12) hour = 0;
      // Default to PM for business hours if not specified
      else if (hour >= 1 && hour <= 6 && !/de\s+la\s+mañana/i.test(raw)) hour += 12;
    }
  }

  // Default to 9 AM if no time found
  if (hour === null) {
    hour = 9;
    minute = 0;
    console.log(`⚠️ No specific time found in "${scheduled}", defaulting to 9:00 AM`);
  }

  // ============================================================
  // STEP 3: Format the output
  // ============================================================

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];

  const dayName = dayNames[targetDate.getDay()];
  const monthName = monthNames[targetDate.getMonth()];
  const dayNum = targetDate.getDate();
  const year = targetDate.getFullYear();

  // Format time as 12-hour with AM/PM
  const displayHour = hour % 12 || 12;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayMinute = minute.toString().padStart(2, '0');

  const result = `${dayName}, ${monthName} ${dayNum}, ${year} at ${displayHour}:${displayMinute} ${ampm}`;

  console.log(`📅 Scheduled normalized: "${scheduled}" → "${result}" (user language: ${sessionLanguage})`);
  return result;
}

// ============================================================
// VALIDATION HELPERS
// ============================================================

function allOpsFieldsPresent(data) {
  // Core required fields: ro_number, shop, vehicle_info, status_from_shop
  // scheduled and shop_notes can default if not provided
  const hasRequired = data.ro_number &&
                      data.shop &&
                      data.vehicle_info &&
                      data.status_from_shop;

  if (!hasRequired) {
    console.log("❌ Missing required fields:", {
      ro_number: !!data.ro_number,
      shop: !!data.shop,
      vehicle_info: !!data.vehicle_info,
      status_from_shop: !!data.status_from_shop
    });
  }

  return hasRequired;
}

function allTechFieldsPresent(data) {
  return data.ro_number &&
         data.technician &&
         data.calibration_required &&
         data.calibration_performed &&
         data.status_from_tech &&
         data.tech_notes;
}

// ============================================================
// LOGGING FUNCTIONS
// ============================================================

async function logOpsData(data, callerName = null, sessionLanguage = "en") {
  if (!allOpsFieldsPresent(data)) {
    console.log("⚠️  Skipping log_ro: missing required fields");
    return false;
  }

  if (!GAS_WEBHOOK_URL) {
    console.log("⚠️  Google Sheets webhook not configured");
    console.log("📋 Would log:", JSON.stringify(data, null, 2));
    return false;
  }

  // Apply OPS normalizations before sending to Sheets
  const normalizedShop = normalizeShopName(data.shop);
  const normalizedScheduled = normalizeScheduled(data.scheduled, sessionLanguage);
  const normalizedNotes = normalizeNotes(data.shop_notes, callerName);

  console.log("🔄 OPS Normalization applied:");
  console.log(`   Shop: "${data.shop}" → "${normalizedShop}"`);
  console.log(`   Scheduled: "${data.scheduled}" → "${normalizedScheduled}"`);
  console.log(`   Notes: "${data.shop_notes}" → "${normalizedNotes}"`);

  // Apps Script expects: { token, action, data: { fields } }
  const payload = {
    token: GAS_TOKEN,
    action: "log_ro",
    data: {
      date_logged: getESTTimestamp(),
      ro_number: data.ro_number,
      shop: normalizedShop,
      vehicle_info: data.vehicle_info,
      status_from_shop: data.status_from_shop,
      scheduled: normalizedScheduled,
      shop_notes: normalizedNotes
    }
  };

  try {
    console.log("📤 Logging to Operations Log:", JSON.stringify(payload, null, 2));
    const response = await axios.post(GAS_WEBHOOK_URL, payload, {
      timeout: 10000,
      headers: { "Content-Type": "application/json" }
    });

    // Check Apps Script response
    if (response.data && response.data.success === false) {
      console.error("❌ Apps Script rejected the data:", response.data.error);
      console.error("📋 Rejected payload was:", JSON.stringify(payload.data, null, 2));
      return false;
    }

    console.log("✅ Ops data logged successfully:", response.data);
    return true;
  } catch (err) {
    console.error("❌ Failed to log ops data:", err.message);
    if (err.response) {
      console.error("📋 Response data:", err.response.data);
    }
    return false;
  }
}

// ============================================================
// RO LOOKUP FUNCTION (for TECH assistant)
// ============================================================

async function lookupRO(roNumber) {
  if (!GAS_WEBHOOK_URL) {
    console.log("⚠️  Google Sheets webhook not configured");
    return null;
  }

  const payload = {
    token: GAS_TOKEN,
    action: "lookup_ro",
    data: { ro_number: roNumber }
  };

  try {
    console.log(`🔍 Looking up RO: ${roNumber}`);
    const response = await axios.post(GAS_WEBHOOK_URL, payload, {
      timeout: 10000,
      headers: { "Content-Type": "application/json" }
    });

    if (response.data && response.data.success) {
      console.log("✅ RO found:", JSON.stringify(response.data.data, null, 2));
      return response.data.data;
    } else {
      console.log(`⚠️  RO ${roNumber} not found:`, response.data?.error || "Unknown error");
      return null;
    }
  } catch (err) {
    console.error("❌ Failed to lookup RO:", err.message);
    return null;
  }
}

// ============================================================
// APPEND TECH NOTE FUNCTION (appends, doesn't overwrite)
// ============================================================

async function appendTechNote(roNumber, noteToAdd, existingNotes = "") {
  if (!GAS_WEBHOOK_URL) {
    console.log("⚠️  Google Sheets webhook not configured");
    return false;
  }

  // Combine existing notes with new note, keeping under 3-4 sentences
  let combinedNotes = existingNotes ? existingNotes.trim() : "";

  if (combinedNotes && noteToAdd) {
    // Count existing sentences (rough estimate)
    const existingSentences = combinedNotes.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const newSentences = noteToAdd.split(/[.!?]+/).filter(s => s.trim().length > 0);

    // If adding would exceed 4 sentences, summarize
    if (existingSentences.length + newSentences.length > 4) {
      // Keep only most recent context + new note
      combinedNotes = `${existingSentences.slice(-2).join(". ")}. ${noteToAdd}`;
    } else {
      combinedNotes = `${combinedNotes} ${noteToAdd}`;
    }
  } else if (noteToAdd) {
    combinedNotes = noteToAdd;
  }

  const payload = {
    token: GAS_TOKEN,
    action: "append_tech_note",
    data: {
      ro_number: roNumber,
      tech_notes: combinedNotes.trim()
    }
  };

  try {
    console.log(`📝 Appending tech note for RO ${roNumber}: "${noteToAdd}"`);
    const response = await axios.post(GAS_WEBHOOK_URL, payload, {
      timeout: 10000,
      headers: { "Content-Type": "application/json" }
    });

    if (response.data && response.data.success) {
      console.log("✅ Tech note appended successfully");
      return true;
    } else {
      console.log("⚠️  Failed to append note:", response.data?.error);
      return false;
    }
  } catch (err) {
    console.error("❌ Failed to append tech note:", err.message);
    return false;
  }
}

async function updateTechData(data, existingTechNotes = "") {
  // For tech_update, only ro_number is strictly required
  // Other fields can be partial updates
  if (!data.ro_number) {
    console.log("⚠️  Skipping tech_update: missing ro_number");
    return false;
  }

  if (!GAS_WEBHOOK_URL) {
    console.log("⚠️  Google Sheets webhook not configured");
    console.log("📋 Would update:", JSON.stringify(data, null, 2));
    return false;
  }

  // Append new tech notes to existing ones
  let finalTechNotes = existingTechNotes || "";
  if (data.tech_notes && data.tech_notes !== "none") {
    if (finalTechNotes) {
      finalTechNotes = `${finalTechNotes} ${data.tech_notes}`;
    } else {
      finalTechNotes = data.tech_notes;
    }
  }

  // Apps Script expects: { token, action, data: { fields } }
  const payload = {
    token: GAS_TOKEN,
    action: "tech_update",
    data: {
      ro_number: data.ro_number,
      technician: data.technician || "",
      calibration_required: data.calibration_required || "",
      calibration_performed: data.calibration_performed || "",
      status_from_tech: data.status_from_tech || "",
      completion: data.status_from_tech === "Completed"
        ? getESTTimestamp()
        : "",
      tech_notes: finalTechNotes || "none"
    }
  };

  try {
    console.log("📤 Updating Tech Log:", JSON.stringify(payload, null, 2));
    const response = await axios.post(GAS_WEBHOOK_URL, payload, {
      timeout: 10000,
      headers: { "Content-Type": "application/json" }
    });

    // Check Apps Script response
    if (response.data && response.data.success === false) {
      console.error("❌ Apps Script rejected the tech update:", response.data.error);
      console.error("📋 Rejected payload was:", JSON.stringify(payload.data, null, 2));
      return false;
    }

    console.log("✅ Tech data updated successfully:", response.data);
    return true;
  } catch (err) {
    console.error("❌ Failed to update tech data:", err.message);
    if (err.response) {
      console.error("📋 Response data:", err.response.data);
    }
    return false;
  }
}

// ============================================================
// TWILIO WEBHOOKS
// ============================================================

app.post("/voice-ops", (req, res) => {
  console.log("📞 Incoming call to OPS assistant");
  res.type("text/xml").send(`
<Response>
  <Connect>
    <Stream url="wss://${NGROK}/media-ops"/>
  </Connect>
</Response>
  `);
});

app.post("/voice-tech", (req, res) => {
  console.log("🔧 Incoming call to TECH assistant");
  res.type("text/xml").send(`
<Response>
  <Connect>
    <Stream url="wss://${NGROK}/media-tech"/>
  </Connect>
</Response>
  `);
});

app.post("/transfer-randy", (req, res) => {
  console.log("📞 Transferring to Randy:", RANDY_PHONE);
  res.type("text/xml").send(`
<Response>
  <Say voice="Polly.Matthew">Transferring you to Randy now.</Say>
  <Dial>${RANDY_PHONE}</Dial>
</Response>
  `);
});

// ============================================================
// WEBSOCKET CONNECTION HANDLER
// ============================================================

wss.on("connection", (twilioWs, req) => {
  console.log("🔌 Twilio WebSocket connected");
  console.log("📍 WebSocket URL:", req.url);

  // Determine assistant type from path (/media-ops or /media-tech)
  let assistantType = "ops";  // default
  if (req.url.includes("/media-tech")) {
    assistantType = "tech";
  } else if (req.url.includes("/media-ops")) {
    assistantType = "ops";
  }

  const instructions = assistantType === "tech" ? TECH_INSTRUCTIONS : OPS_INSTRUCTIONS;
  const voice = VOICES[assistantType];

  console.log("✅ Selected assistant type:", assistantType);
  console.log(`🤖 ${assistantType.toUpperCase()} assistant loading`);
  console.log(`🎙️  Voice: ${voice} (${assistantType === 'ops' ? 'Female' : 'Male'})`);

  let streamSid = null;
  let callSid = null;
  let conversationTranscript = [];
  let isCallActive = true;
  let sessionConfigured = false;
  let transferRequested = false;
  let loggedROs = new Set();

  // Response state tracking - prevents "conversation_already_has_active_response" errors
  let isResponseInProgress = false;
  let lastResponseId = null;

  // Function call deduplication - prevents duplicate function calls
  const recentFunctionCalls = new Map(); // key: "functionName:roPo", value: timestamp
  const FUNCTION_CALL_DEBOUNCE_MS = 3000; // 3 second debounce

  // Session state to persist data across multiple vehicles in same call
  let sessionState = {
    shop: null,        // Persist shop name across vehicles
    scheduled: null,   // Persist scheduled time if same for all vehicles
    opsConfirmationPending: false,  // Track if assistant just sent a confirmation summary
    language: "en",    // Track caller language: "en" or "es"
    firstUserMessage: null,  // Store first user message to detect initial language
    languageLocked: false,   // Once language is set from first message, lock it
    consecutiveOtherLang: 0, // Count consecutive messages in other language for switching
    // Prevent duplicate RO lookups within same session
    lastLookedUpRO: null,
    lastLookupFound: false,  // Track if last lookup was successful
    // Override confirmation flow for "Needs Attention" status
    awaitingOverrideConfirmation: false,
    pendingScheduleRO: null,  // RO waiting for override confirmation
    // FIX: Prevent double response during Spanish language switch
    switchingToSpanish: false,  // True while transitioning to Spanish greeting
    spanishGreetingSent: false,  // True after Spanish greeting has been sent
    // FIX: Track response state for interruption handling
    responseInProgress: false
  };

  // OPS Language detection - Spanish keywords trigger Spanish mode
  // PATCH: Enhanced to prevent junk phrases from locking to English
  function detectOpsLanguage(text) {
    const t = text.toLowerCase().trim();

    // First, check if text contains non-Latin characters (foreign noise) - return null to ignore
    const foreignPatterns = [
      /[\u0900-\u097F]/,  // Devanagari (Hindi)
      /[\u0B80-\u0BFF]/,  // Tamil
      /[\u0600-\u06FF]/,  // Arabic
      /[\u4E00-\u9FFF]/,  // Chinese
      /[\u3040-\u30FF]/,  // Japanese
      /[\uAC00-\uD7AF]/,  // Korean
      /[\u0400-\u04FF]/,  // Cyrillic
      /[\u00C4\u00E4\u00D6\u00F6]/  // Finnish/German umlauts (ä, ö)
    ];

    for (const pattern of foreignPatterns) {
      if (pattern.test(text)) {
        console.log(`🌐 Ignoring foreign/nonsense text: "${text}"`);
        return null; // Ignore - don't change language
      }
    }

    // JUNK/NOISE PHRASES - Return null, never lock language on these
    // These are typically transcription errors, background noise, or partial phrases
    // Use word-boundary matching to avoid false positives like "number" containing "um"
    const junkPhrases = [
      "phone from me", "do you want to cut it", "cut it", "phone from",
      "do you want", "want to cut", "the cut", "cut the",
      "continued", "tinued", "ontinued", "inued",
      "sequence", "handling", "peace"
    ];

    // Filler words that should match as whole words only
    const junkFillerWords = ["um", "uh", "hmm", "uh-huh", "mhm", "ah", "eh", "huh"];

    // Check phrase-based junk (substring match is OK for multi-word phrases)
    for (const junk of junkPhrases) {
      if (t === junk || t.includes(junk)) {
        console.log(`🗑️ Ignoring junk phrase: "${text}"`);
        return null; // Never lock on junk
      }
    }

    // Check filler words with word boundary matching
    for (const filler of junkFillerWords) {
      const wordBoundaryRegex = new RegExp(`\\b${filler}\\b`, 'i');
      if (wordBoundaryRegex.test(t) && t.split(/\s+/).length <= 3) {
        // Only reject if it's a short phrase (3 words or less) containing filler
        console.log(`🗑️ Ignoring filler word in short phrase: "${text}"`);
        return null;
      }
    }

    // Spanish keywords (full phrases and single distinctive words)
    // "bueno", "buenas" are distinctly Spanish - common phone greetings
    const spanishKeywords = [
      // Greetings - "buenas" (short form) and "bueno" are SPANISH phone greetings
      "hola", "buenos", "buenas", "buenos días", "buenas tardes", "buenas noches",
      "bueno", "sí bueno", "si bueno", "sí buenas", "si buenas",
      // "buenas" alone is distinctly Spanish (short for "buenas tardes/noches")
      // Common phrases
      "como estas", "cómo estás", "necesito", "puedes", "ayuda",
      "vehículo", "vehiculo", "calibración", "calibracion",
      "hablas español", "español", "en español",
      "taller", "por favor", "el carro", "el coche", "la camioneta",
      "número", "numero", "cuándo", "cuando", "dónde", "donde",
      "qué hora", "a qué hora", "para hoy", "para mañana",
      "me llamo", "mi nombre es", "estoy llamando",
      // Vehicle/status terms
      "listo", "está listo", "esta listo", "no está listo",
      // Common responses - "sí" with accent is distinctly Spanish
      "correcto", "exacto", "perfecto", "así es", "asi es",
      // Numbers/time in Spanish context
      "a las", "de la tarde", "de la mañana", "de la manana",
      // Question words
      "con quién", "con quien", "qué", "cuál", "cual",
      // Greetings that are DISTINCTLY Spanish (not English)
      "gracias", "muchas gracias", "mucho gusto",
      // PATCH: Spanish articles and prepositions in vehicle descriptions
      // "un Ford Mustang del 2025" should trigger Spanish detection
      "del 20", "del 19",  // "del 2025", "del 2024", "del 1999"
      "es un", "es una",   // "es un Ford Mustang"
      "para el", "para la"
    ];

    // Additional Spanish detection: "un [make]" pattern
    // Detect "un Ford", "un Toyota", etc. as Spanish
    const spanishUnPattern = /\bun\s+(ford|toyota|nissan|honda|chevrolet|chevy|kia|hyundai|mazda|bmw|mercedes|volkswagen|jeep|dodge|ram|mustang|camry|accord|altima|civic|corolla)\b/i;
    if (spanishUnPattern.test(t)) {
      return "es";
    }

    // Check for "buenas" alone first (very common Spanish phone greeting)
    if (/\bbuenas\b/i.test(t)) {
      return "es";
    }

    // Check for Spanish keywords
    for (const keyword of spanishKeywords) {
      if (t.includes(keyword)) {
        return "es";
      }
    }

    // Check for "sí" with accent - distinctly Spanish
    if (/\bsí\b/.test(t)) {
      return "es";
    }

    // Single words that are truly neutral (same in English and Spanish)
    const neutralWords = ["yes", "yeah", "yep", "no", "ok", "okay"];

    const words = t.split(/\s+/);
    if (words.length === 1 && neutralWords.includes(words[0])) {
      return null; // Neutral - don't change language
    }

    // Short phrases with only neutral/ambiguous content - return null
    if (words.length <= 2) {
      const ambiguousOnly = words.every(w =>
        neutralWords.includes(w) || w === "si" || w === "sure" || w === "right"
      );
      if (ambiguousOnly) {
        return null;
      }
    }

    // Noise words to ignore completely (call-ending, filler)
    const noiseWords = ["bye", "goodbye", "peace", "thanks", "thank", "um", "uh", "hmm"];
    if (words.length === 1 && noiseWords.includes(words[0])) {
      return null; // Ignore noise
    }

    // ENGLISH INDUSTRY TERMS - These should NOT trigger English lock when in Spanish mode
    // (Issue #12: language switching on industry words)
    const industryTerms = [
      "autosport", "auto sport", "paintmax", "paint max", "jmd", "ccnm", "reinaldo",
      "ford", "mustang", "toyota", "honda", "nissan", "chevrolet", "chevy", "gmc",
      "bmw", "mercedes", "audi", "volkswagen", "tesla", "kia", "hyundai", "mazda",
      "subaru", "jeep", "dodge", "ram", "chrysler", "lexus", "acura", "infiniti",
      "camry", "accord", "altima", "civic", "corolla", "f-150", "f150", "silverado",
      "ro", "po", "vin", "adas"
    ];

    // Check if the text is ONLY industry terms (should not trigger English lock)
    const wordsWithoutIndustry = words.filter(w => !industryTerms.includes(w.replace(/[.,!?]/g, '')));
    if (wordsWithoutIndustry.length === 0) {
      console.log(`🏭 Text only contains industry terms, not locking language: "${text}"`);
      return null;
    }

    // If it has multiple clear English words (not industry terms), it's English
    const englishIndicators = ["the", "is", "are", "what", "how", "can", "i'm", "my", "name", "from", "calling", "ready", "not ready", "vehicle", "shop"];
    let englishCount = 0;
    for (const eng of englishIndicators) {
      if (t.includes(eng)) {
        englishCount++;
      }
    }

    // Require at least 2 English indicators to lock to English (more conservative)
    if (englishCount >= 2) {
      return "en";
    }

    // If nothing clear, return null (don't change language)
    return null;
  }

  // Check if message is meaningful (not just noise)
  function isMeaningfulMessage(text) {
    const t = text.toLowerCase().trim();
    const noisePatterns = ["bye", "goodbye", "peace", "thanks", "thank you", "um", "uh", "hmm", "okay", "ok"];
    const words = t.split(/\s+/);

    // Single noise word
    if (words.length === 1 && noisePatterns.includes(words[0])) {
      return false;
    }
    // Very short unclear text
    if (t.length < 3) {
      return false;
    }
    return true;
  }

  // TECH session state - stores looked-up RO data
  let techSessionState = {
    currentRO: null,           // Current RO number being worked on
    roData: null,              // Full row data from sheet lookup
    vehicleInfo: null,         // Vehicle info for calibration guidance
    techName: null,            // Technician name
    existingTechNotes: "",     // Existing tech notes to append to
    assistanceSummaries: [],   // Track what help was provided this call
    calibrationPassed: false,  // Track if tech said calibration passed (for closure)
    calibrationRequired: [],   // Systems that need calibration (tracked during call)
    calibrationPerformed: [],  // Systems actually calibrated (tracked during call)
    calibrationType: null,     // "static", "dynamic", or "both"
    language: "en",            // Detected language: "en" or "es"
    askedForCalibrationInfo: false  // Track if we asked for missing calibration info
  };

  const openaiWs = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${OPENAI_MODEL}`,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    }
  );

  // Helper to safely send response.create without overlapping responses
  function safeCreateResponse(responseConfig, context = "") {
    if (isResponseInProgress) {
      console.log(`⏳ Skipping response.create (${context}) - response already in progress: ${lastResponseId}`);
      return false;
    }

    console.log(`📤 Sending response.create (${context})`);
    openaiWs.send(JSON.stringify({
      type: "response.create",
      ...responseConfig
    }));
    return true;
  }

  // Helper to cancel existing response before creating new one (for forced responses)
  function forceCreateResponse(responseConfig, context = "") {
    if (isResponseInProgress) {
      console.log(`🔄 Cancelling existing response before new one (${context})`);
      openaiWs.send(JSON.stringify({ type: "response.cancel" }));
      // Small delay to allow cancellation to process
      setTimeout(() => {
        openaiWs.send(JSON.stringify({
          type: "response.create",
          ...responseConfig
        }));
      }, 50);
      return true;
    }

    openaiWs.send(JSON.stringify({
      type: "response.create",
      ...responseConfig
    }));
    return true;
  }

  openaiWs.on("open", () => {
    console.log("✅ OpenAI connected");

    // Select tools based on assistant type
    const tools = assistantType === "tech" ? TECH_TOOLS : OPS_TOOLS;

    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: instructions,
        voice: voice,
        tools: tools,
        tool_choice: "auto",
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.85,           // INCREASED from 0.7 - less sensitive to noise on speakerphone
          prefix_padding_ms: 400,    // Slightly reduced
          silence_duration_ms: 1000, // INCREASED from 700 - wait longer before responding
          create_response: true
        },
        temperature: 0.7,
        max_response_output_tokens: 2048
      }
    }));
  });

  openaiWs.on("message", async (data) => {
    try {
      const event = JSON.parse(data.toString());

      if (event.type === "error") {
        console.error("❌ OpenAI error:", JSON.stringify(event, null, 2));
      }

      switch (event.type) {
        case "session.updated":
          console.log("🔄 Session configured");
          sessionConfigured = true;
          setTimeout(() => {
            if (isCallActive && openaiWs.readyState === WebSocket.OPEN) {
              // Use assistant-specific greeting (ONLY the greeting, nothing else)
              const greetingInstruction = assistantType === "tech"
                ? "Say ONLY this greeting, nothing else: 'AY-das First Tech Support, this is your calibration assistant. Before we begin, what's your name?' Do NOT ask for RO. Do NOT say anything else. Just greet and ask for their name."
                : "Greet warmly: 'Thank you for calling AY-das First. How can I help you today?'";

              openaiWs.send(JSON.stringify({
                type: "response.create",
                response: {
                  modalities: ["text", "audio"],
                  instructions: greetingInstruction
                }
              }));
            }
          }, 250);
          break;

        // Track response lifecycle to prevent "conversation_already_has_active_response" errors
        case "response.created":
          isResponseInProgress = true;
          sessionState.responseInProgress = true;
          lastResponseId = event.response?.id || null;
          console.log(`🎯 Response started: ${lastResponseId}`);
          break;

        case "response.done":
          isResponseInProgress = false;
          sessionState.responseInProgress = false;
          console.log(`✅ Response completed: ${lastResponseId}`);
          lastResponseId = null;
          break;

        case "response.cancelled":
          isResponseInProgress = false;
          console.log(`🚫 Response cancelled: ${lastResponseId}`);
          lastResponseId = null;
          break;

        case "response.audio.delta":
          if (event.delta && streamSid && isCallActive && !transferRequested) {
            twilioWs.send(JSON.stringify({
              event: "media",
              streamSid: streamSid,
              media: { payload: event.delta }
            }));
          }
          break;

        // Handle function/tool calls from the assistant
        case "response.function_call_arguments.done":
          if (event.name && event.arguments) {
            console.log(`🔧 Function call: ${event.name}`);
            try {
              const args = JSON.parse(event.arguments);
              const isSpanish = assistantType === "ops" ? sessionState.language === "es" : false;

              // DUPLICATE FUNCTION CALL PREVENTION
              // For set_schedule, prevent rapid duplicate calls to the same RO
              if (event.name === "set_schedule" && args.roPo) {
                const dedupKey = `${event.name}:${args.roPo}`;
                const lastCallTime = recentFunctionCalls.get(dedupKey);
                const now = Date.now();

                if (lastCallTime && (now - lastCallTime) < FUNCTION_CALL_DEBOUNCE_MS) {
                  console.log(`🚫 Suppressing duplicate ${event.name} for ${args.roPo} (called ${now - lastCallTime}ms ago)`);
                  // Still need to send function result to avoid hanging
                  openaiWs.send(JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                      type: "function_call_output",
                      call_id: event.call_id,
                      output: JSON.stringify({
                        success: true,
                        message: "Already processed",
                        deduplicated: true
                      })
                    }
                  }));
                  openaiWs.send(JSON.stringify({ type: "response.create" }));
                  break; // Skip the rest of the function handling
                }

                // Record this call
                recentFunctionCalls.set(dedupKey, now);

                // Clean up old entries periodically
                if (recentFunctionCalls.size > 20) {
                  for (const [key, time] of recentFunctionCalls) {
                    if (now - time > 30000) recentFunctionCalls.delete(key);
                  }
                }
              }

              // REMOVED: Explicit announcement blocks that cause overlapping responses
              // The assistant will naturally handle lookups/scheduling silently and respond with results
              // This improves natural conversation flow and prevents robotic "one moment" phrases

              // PATCH 1: Prevent duplicate RO lookups for OPS assistant (keep logic, remove announcement)
              if (assistantType === "ops" && (event.name === "get_ro_summary" || event.name === "compute_readiness") && args.roPo) {
                // Check if this is the same RO we already looked up (and it was found)
                if (sessionState.lastLookedUpRO === args.roPo && sessionState.lastLookupFound) {
                  console.log(`🔍 OPS: Suppressing duplicate RO lookup for ${args.roPo}`);
                  openaiWs.send(JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                      type: "function_call_output",
                      call_id: event.call_id,
                      output: JSON.stringify({
                        found: true,
                        cached: true,
                        message: "RO already looked up in this session"
                      })
                    }
                  }));
                  openaiWs.send(JSON.stringify({ type: "response.create" }));
                  break; // Skip the actual lookup
                }
                // New RO or previous lookup failed - proceed silently
                console.log(`🔍 OPS: Looking up RO ${args.roPo} silently`);
              }

              const handler = assistantType === "tech" ? handleTechToolCall : handleOpsToolCall;
              const result = await handler(event.name, args);

              // PATCH 1: Track successful lookups
              if (assistantType === "ops" && (event.name === "get_ro_summary" || event.name === "compute_readiness") && args.roPo) {
                sessionState.lastLookedUpRO = args.roPo;
                sessionState.lastLookupFound = result.found === true;
                console.log(`🔍 OPS: Cached RO ${args.roPo}, found=${result.found}`);
              }

              // PATCH 2: Check for "Needs Attention" status and require confirmation
              if (assistantType === "ops" && event.name === "compute_readiness" && result.ready === false) {
                const status = result.status || "";
                const needsAttention = status.toLowerCase().includes("needs attention") ||
                                       status.toLowerCase().includes("needs review") ||
                                       result.canScheduleWithOverride === true;

                if (needsAttention && !sessionState.awaitingOverrideConfirmation) {
                  console.log(`⚠️ OPS: Status requires confirmation before scheduling: ${status}`);
                  sessionState.awaitingOverrideConfirmation = true;
                  sessionState.pendingScheduleRO = args.roPo;

                  const confirmMsg = isSpanish
                    ? "Este trabajo requiere verificación porque hay diferencias entre el estimado y el reporte de calibración. ¿Confirmas que deseas programar la calibración con excepción?"
                    : "This job requires verification because there are differences between the estimate and the calibration report. Do you confirm you still want to schedule with an override?";

                  // Add the confirmation requirement to the result
                  result.awaitingConfirmation = true;
                  result.confirmationMessage = confirmMsg;
                }
              }

              console.log(`🔧 Function result:`, JSON.stringify(result, null, 2));

              // Send the function result back to OpenAI
              openaiWs.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: event.call_id,
                  output: JSON.stringify(result)
                }
              }));

              // POST-SCHEDULING FOLLOW-UP: Ensure assistant responds after successful scheduling
              // This prevents silence after scheduling by adding explicit instruction
              if (event.name === "set_schedule" && result.success) {
                const followUpInstruction = isSpanish
                  ? "El vehículo ha sido programado exitosamente. Confirma los detalles de la cita y pregunta si hay algo más en lo que puedas ayudar."
                  : "The vehicle has been scheduled successfully. Confirm the appointment details and ask if there's anything else you can help with.";

                openaiWs.send(JSON.stringify({
                  type: "response.create",
                  response: {
                    modalities: ["text", "audio"],
                    instructions: followUpInstruction
                  }
                }));
              } else {
                // Trigger a response so the assistant can speak the result
                openaiWs.send(JSON.stringify({
                  type: "response.create"
                }));
              }
            } catch (err) {
              console.error(`🔧 Function call error:`, err);
              openaiWs.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: event.call_id,
                  output: JSON.stringify({ success: false, error: err.message })
                }
              }));
              openaiWs.send(JSON.stringify({ type: "response.create" }));
            }
          }
          break;

        case "response.audio_transcript.done":
          if (event.transcript) {
            conversationTranscript.push({
              role: "assistant",
              content: event.transcript,
              timestamp: getESTISOTimestamp()
            });
            console.log("🤖 Assistant:", event.transcript);

            // OPS: Detect COMPLETE confirmation summary messages and set opsConfirmationPending
            // A COMPLETE summary must include ALL 7 fields: RO, shop, vehicle, VIN, status, scheduled, notes
            if (assistantType === "ops") {
              const transcriptLower = event.transcript.toLowerCase();

              // Check for confirmation phrase
              const hasConfirmPhrase = (
                transcriptLower.includes("let me confirm") ||
                transcriptLower.includes("to confirm") ||
                transcriptLower.includes("just to confirm") ||
                transcriptLower.includes("confirming") ||
                // Spanish
                transcriptLower.includes("déjame confirmar") ||
                transcriptLower.includes("dejame confirmar") ||
                transcriptLower.includes("para confirmar") ||
                transcriptLower.includes("confirmando")
              );

              // Check ALL required fields are present in the summary
              const hasRO = /\b(ro|r\.o\.|po|p\.o\.)\s*[\s#:]*\d+/i.test(event.transcript);
              const hasShop = (
                transcriptLower.includes("shop") ||
                transcriptLower.includes("taller") ||
                transcriptLower.includes("jmd") ||
                transcriptLower.includes("reinaldo") ||
                transcriptLower.includes("paintmax") ||
                transcriptLower.includes("autosport") ||
                transcriptLower.includes("ccnm")
              );
              const hasVehicle = (
                /\b(20\d{2})\b/.test(event.transcript) &&  // Year like 2024, 2025
                (transcriptLower.includes("nissan") || transcriptLower.includes("toyota") ||
                 transcriptLower.includes("honda") || transcriptLower.includes("ford") ||
                 transcriptLower.includes("chevrolet") || transcriptLower.includes("hyundai") ||
                 transcriptLower.includes("kia") || transcriptLower.includes("mazda") ||
                 transcriptLower.includes("subaru") || transcriptLower.includes("bmw") ||
                 transcriptLower.includes("mercedes") || transcriptLower.includes("audi") ||
                 transcriptLower.includes("volkswagen") || transcriptLower.includes("jeep") ||
                 transcriptLower.includes("ram") || transcriptLower.includes("dodge") ||
                 transcriptLower.includes("lexus") || transcriptLower.includes("acura") ||
                 transcriptLower.includes("infiniti") || transcriptLower.includes("genesis") ||
                 transcriptLower.includes("volvo") || transcriptLower.includes("porsche") ||
                 transcriptLower.includes("tesla") || transcriptLower.includes("buick") ||
                 transcriptLower.includes("cadillac") || transcriptLower.includes("gmc") ||
                 transcriptLower.includes("lincoln") || transcriptLower.includes("chrysler"))
              );
              const hasVIN = (
                transcriptLower.includes("vin") ||
                transcriptLower.includes("ending") ||
                /\b\d{4}\b/.test(event.transcript)  // 4 digit VIN ending
              );
              const hasStatus = (
                transcriptLower.includes("ready") ||
                transcriptLower.includes("not ready") ||
                transcriptLower.includes("listo") ||
                transcriptLower.includes("no listo") ||
                transcriptLower.includes("status")
              );
              const hasScheduled = (
                transcriptLower.includes("scheduled") ||
                transcriptLower.includes("programado") ||
                transcriptLower.includes("today") ||
                transcriptLower.includes("tomorrow") ||
                transcriptLower.includes("monday") ||
                transcriptLower.includes("tuesday") ||
                transcriptLower.includes("wednesday") ||
                transcriptLower.includes("thursday") ||
                transcriptLower.includes("friday") ||
                transcriptLower.includes("hoy") ||
                transcriptLower.includes("mañana") ||
                /\b\d{1,2}\s*(am|pm|a\.m\.|p\.m\.)\b/i.test(event.transcript) ||
                /\b(at|a las?)\s*\d/i.test(event.transcript)
              );
              const hasNotes = (
                transcriptLower.includes("notes") ||
                transcriptLower.includes("notas") ||
                transcriptLower.includes("none") ||
                transcriptLower.includes("nada") ||
                transcriptLower.includes("ninguna")
              );

              // Also check for FULL confirmation question (asking about everything, not just one field)
              // Single-field questions like "the shop is X, correct?" should NOT trigger this
              const hasConfirmationQuestion = (
                transcriptLower.includes("does everything sound correct") ||
                transcriptLower.includes("is that all correct") ||
                transcriptLower.includes("does all that sound") ||
                transcriptLower.includes("does that sound right") ||
                // Spanish - only FULL confirmation questions
                transcriptLower.includes("todo está correcto") ||
                transcriptLower.includes("todo correcto") ||
                transcriptLower.includes("está todo correcto") ||
                transcriptLower.includes("suena bien todo") ||
                transcriptLower.includes("todo suena bien")
              );

              // Check if this is a SINGLE-FIELD confirmation (shop only, etc.) - should NOT trigger pending
              const isSingleFieldConfirm = (
                // Shop-only confirmation patterns
                (transcriptLower.includes("shop") || transcriptLower.includes("taller")) &&
                (transcriptLower.includes("correct") || transcriptLower.includes("correcto")) &&
                !hasRO && !hasVehicle && !hasScheduled
              );

              // ONLY set pending if we have a COMPLETE summary with ALL fields AND it's not a single-field confirmation
              const isCompleteSummary = hasRO && hasShop && hasVehicle && hasVIN && hasStatus && hasScheduled && hasNotes;
              const shouldSetPending = hasConfirmPhrase && isCompleteSummary && hasConfirmationQuestion && !isSingleFieldConfirm;

              if (shouldSetPending) {
                sessionState.opsConfirmationPending = true;
                console.log("🔔 OPS: COMPLETE confirmation summary detected (all 7 fields), opsConfirmationPending = true");
                console.log("   Fields found: RO=" + hasRO + ", Shop=" + hasShop + ", Vehicle=" + hasVehicle +
                           ", VIN=" + hasVIN + ", Status=" + hasStatus + ", Scheduled=" + hasScheduled + ", Notes=" + hasNotes);
              } else if (hasConfirmPhrase) {
                console.log("⚠️  OPS: Partial confirmation detected but NOT complete summary");
                console.log("   Fields found: RO=" + hasRO + ", Shop=" + hasShop + ", Vehicle=" + hasVehicle +
                           ", VIN=" + hasVIN + ", Status=" + hasStatus + ", Scheduled=" + hasScheduled + ", Notes=" + hasNotes);
                console.log("   Has confirm question: " + hasConfirmationQuestion);
                // Do NOT set opsConfirmationPending - wait for complete summary
              }
            }

            // TRANSFER_TO_RANDY detection in assistant speech OR user request
            if (event.transcript.toLowerCase().includes("transferring you to randy") ||
                event.transcript.toLowerCase().includes("transfer_to_randy")) {
              console.log("🔄 TRANSFER TO RANDY TRIGGERED");
              transferRequested = true;

              // Close the OpenAI session immediately
              if (openaiWs.readyState === WebSocket.OPEN) {
                openaiWs.close();
              }

              // Stop the Twilio media stream
              if (streamSid) {
                twilioWs.send(JSON.stringify({
                  event: "stop",
                  streamSid: streamSid
                }));
              }

              console.log("📞 Initiating transfer to Randy:", RANDY_PHONE);

              // Use Twilio REST API to modify the call
              // The call will be redirected to /transfer-randy endpoint which dials Randy
              if (callSid) {
                try {
                  const twilioClient = (await import("twilio")).default(
                    process.env.TWILIO_ACCOUNT_SID,
                    process.env.TWILIO_AUTH_TOKEN
                  );
                  await twilioClient.calls(callSid).update({
                    url: `https://${NGROK}/transfer-randy`,
                    method: "POST"
                  });
                  console.log("✅ Call redirected to Randy");
                } catch (transferErr) {
                  console.error("❌ Transfer failed:", transferErr.message);
                }
              }
            }
          }
          break;

        case "conversation.item.input_audio_transcription.completed":
          if (event.transcript) {
            const text = event.transcript.toLowerCase().trim();
            const isNoise = text.length < 3 ||
                           /^(um|uh|hmm|mhm|ah|uh-huh|mm-hmm)+$/.test(text) ||
                           (text.split(" ").length === 1 && text.length < 4);

            if (isNoise) {
              console.log("🚫 Ignored:", text);
              return;
            }

            conversationTranscript.push({
              role: "user",
              content: event.transcript,
              timestamp: getESTISOTimestamp()
            });
            console.log("👤 User:", event.transcript);

            // OPS ASSISTANT: Override confirmation handler (PATCH 2)
            if (assistantType === "ops" && sessionState.awaitingOverrideConfirmation) {
              const isSpanish = sessionState.language === "es";
              const yesPattern = /^(yes|si|sí|correcto|ok|okay|adelante|continue|confirmo|afirmativo|dale|claro)/i;
              const noPattern = /^(no|negativo|nunca|cancel|cancelar|espera|wait)/i;

              if (yesPattern.test(text)) {
                console.log(`✅ OPS: Override confirmed for RO ${sessionState.pendingScheduleRO}`);
                sessionState.awaitingOverrideConfirmation = false;
                const proceedMsg = isSpanish
                  ? "Perfecto, procedo a programar la calibración. ¿Para qué fecha te gustaría?"
                  : "Perfect, I'll proceed with scheduling. What date works for you?";
                openaiWs.send(JSON.stringify({
                  type: "response.create",
                  response: {
                    modalities: ["text", "audio"],
                    instructions: `Say: "${proceedMsg}"`
                  }
                }));
                return; // Handled - don't process further
              }

              if (noPattern.test(text)) {
                console.log(`❌ OPS: Override declined for RO ${sessionState.pendingScheduleRO}`);
                sessionState.awaitingOverrideConfirmation = false;
                sessionState.pendingScheduleRO = null;
                const declineMsg = isSpanish
                  ? "Entendido, no programaré la calibración. ¿Deseas revisar los requisitos del vehículo?"
                  : "Understood. I won't schedule the calibration. Would you like to review the vehicle's requirements?";
                openaiWs.send(JSON.stringify({
                  type: "response.create",
                  response: {
                    modalities: ["text", "audio"],
                    instructions: `Say: "${declineMsg}"`
                  }
                }));
                return; // Handled - don't process further
              }

              // Unclear response - ask again
              console.log(`❓ OPS: Unclear override response: "${text}"`);
              const clarifyMsg = isSpanish
                ? "Solo necesito una confirmación: ¿Quieres programar con excepción? Sí o no."
                : "I just need confirmation: Do you want to schedule with override? Yes or no.";
              openaiWs.send(JSON.stringify({
                type: "response.create",
                response: {
                  modalities: ["text", "audio"],
                  instructions: `Say: "${clarifyMsg}"`
                }
              }));
              return; // Handled - don't process further
            }

            // OPS ASSISTANT: Language detection
            if (assistantType === "ops") {
              // FIX: Skip processing if we're already switching to Spanish (prevents double response)
              if (sessionState.switchingToSpanish) {
                console.log(`🌐 OPS: Skipping - already switching to Spanish`);
                return;
              }

              const detectedLang = detectOpsLanguage(event.transcript);

              // Special case: "hablas español" always triggers immediate Spanish switch
              if (text.includes("hablas español") || text.includes("hablas espanol")) {
                sessionState.language = "es";
                sessionState.languageLocked = true;
                sessionState.switchingToSpanish = true;
                console.log(`🌐 OPS: "Hablas español" detected - switching to Spanish`);

                // Cancel any in-flight response first
                openaiWs.send(JSON.stringify({ type: "response.cancel" }));

                // Send Spanish confirmation after brief delay
                setTimeout(() => {
                  sessionState.switchingToSpanish = false;
                  openaiWs.send(JSON.stringify({
                    type: "response.create",
                    response: {
                      modalities: ["text", "audio"],
                      instructions: `Say: "Sí, claro. Podemos continuar en español. ¿En qué puedo ayudarte?"`
                    }
                  }));
                }, 150);
                return; // Don't process further
              }
              // FIRST meaningful user message - set initial language (don't lock on noise)
              else if (!sessionState.languageLocked) {
                // Only set first message and lock if we got a clear language detection
                if (detectedLang) {
                  sessionState.firstUserMessage = event.transcript;
                  sessionState.language = detectedLang;
                  sessionState.languageLocked = true;
                  console.log(`🌐 OPS: Initial language LOCKED to ${detectedLang === "es" ? "Spanish" : "English"} from: "${event.transcript}"`);

                  // If Spanish detected on FIRST message, restart greeting in Spanish
                  if (detectedLang === "es") {
                    console.log(`🌐 OPS: Spanish detected on first message - restarting greeting in Spanish`);

                    // PATCH 1: Set flag to prevent duplicate responses during language switch
                    sessionState.switchingToSpanish = true;

                    // Cancel any active response before sending Spanish greeting
                    openaiWs.send(JSON.stringify({ type: "response.cancel" }));
                    console.log(`🌐 OPS: Sent response.cancel before Spanish greeting`);

                    // Wait for cancel to process, then send ONE Spanish greeting
                    setTimeout(() => {
                      // Only send if we haven't already sent the Spanish greeting
                      if (sessionState.switchingToSpanish) {
                        sessionState.switchingToSpanish = false;
                        sessionState.spanishGreetingSent = true;
                        openaiWs.send(JSON.stringify({
                          type: "response.create",
                          response: {
                            modalities: ["text", "audio"],
                            instructions: `Say EXACTLY: "Buenas noches. ¿Me puede dar el número de RO o PO, por favor?" Do NOT say anything else. Do NOT add follow-up phrases. Just ask for the RO/PO number and wait.`
                          }
                        }));
                        console.log(`🌐 OPS: Sent Spanish greeting response.create`);
                      }
                    }, 150);
                    return; // Don't process further - wait for Spanish flow to continue
                  }
                } else {
                  // No clear language - don't lock yet, wait for clearer message
                  console.log(`🌐 OPS: No clear language in message, not locking yet: "${event.transcript}"`);
                }
              }
              // PATCH 10: Language already locked - only switch if 2 consecutive FULL meaningful sentences in other language
              else if (sessionState.languageLocked && detectedLang && detectedLang !== sessionState.language) {
                // Only count FULL meaningful messages with multiple words (not short phrases)
                const words = event.transcript.split(/\s+/);
                const isFullSentence = isMeaningfulMessage(event.transcript) && words.length >= 3;

                if (isFullSentence) {
                  sessionState.consecutiveOtherLang++;
                  console.log(`🌐 OPS: Detected ${detectedLang === "es" ? "Spanish" : "English"} FULL sentence (${sessionState.consecutiveOtherLang}/2 for switch)`);

                  // PATCH 10: Require 2 consecutive full sentences to switch
                  if (sessionState.consecutiveOtherLang >= 2) {
                    sessionState.language = detectedLang;
                    sessionState.consecutiveOtherLang = 0;
                    console.log(`🌐 OPS: Language SWITCHED to ${detectedLang === "es" ? "Spanish" : "English"} after 2 consecutive full sentences`);
                  }
                } else {
                  console.log(`🌐 OPS: Short phrase detected in ${detectedLang === "es" ? "Spanish" : "English"}, not counting toward switch: "${event.transcript}"`);
                }
              }
              // Same language detected or null - reset counter
              else if (detectedLang === sessionState.language || detectedLang === null) {
                sessionState.consecutiveOtherLang = 0;
              }
            }

            // Call-ending detection - user says "bye", "goodbye", etc.
            const byePhrases = ["bye", "goodbye", "good bye", "have a good day", "talk later", "see ya", "take care", "adios", "adiós", "chao", "hasta luego"];
            if (byePhrases.includes(text) || byePhrases.some(phrase => text === phrase)) {
              console.log("👋 OPS: User said goodbye, ending call gracefully");
              const isSpanish = sessionState.language === "es";
              const goodbyeMessage = isSpanish
                ? `Say: "Gracias por llamar a AY-das First. ¡Que tenga un buen día!"`
                : `Say: "Thank you for calling AY-das First. Have a great day!"`;

              openaiWs.send(JSON.stringify({
                type: "response.create",
                response: {
                  modalities: ["text", "audio"],
                  instructions: goodbyeMessage
                }
              }));
              // Don't process further - just end gracefully
              return;
            }

            // Transfer detection
            const transferPhrases = ["transfer to randy", "talk to randy", "speak with randy", "get me randy", "connect me to randy"];
            if (transferPhrases.some(phrase => text.includes(phrase))) {
              console.log("🔄 User requested transfer");
              openaiWs.send(JSON.stringify({
                type: "response.create",
                response: {
                  modalities: ["text", "audio"],
                  instructions: "Say exactly: 'Transferring you to Randy now.'"
                }
              }));
            }

            // TECH ASSISTANT: RO Lookup when tech mentions an RO number
            if (assistantType === "tech" && !techSessionState.currentRO) {
              // FIXED: Use shared RO extraction that supports Spanish numbers
              // Converts "veinticuatro cinco seis siete" → "24567"
              // Also handles "RO is 24567", "RO number 24567", standalone digits

              const roNumber = extractROFromText(text);

              if (roNumber && roNumber.length >= 4) {
                console.log(`🔍 TECH: Detected RO number: ${roNumber}`);

                // STEP 1: Send a brief "looking up" message (no need to cancel first - just override)
                openaiWs.send(JSON.stringify({
                  type: "response.create",
                  response: {
                    modalities: ["text", "audio"],
                    instructions: `Say ONLY: "Got it, looking up RO ${roNumber} now." Say nothing else. Do NOT guess or make up any vehicle or shop information.`
                  }
                }));

                console.log(`⏸️  TECH: Sent interim response, now looking up RO ${roNumber}`);

                // STEP 2: Perform the actual lookup (async)
                const roData = await lookupRO(roNumber);

                // STEP 3: Send the actual result (new response will interrupt any ongoing speech)
                if (roData) {
                  techSessionState.currentRO = roNumber;
                  techSessionState.roData = roData;
                  techSessionState.vehicleInfo = roData.vehicle_info;
                  techSessionState.existingTechNotes = roData.tech_notes || "";

                  console.log(`✅ TECH: Loaded RO ${roNumber} - Vehicle: ${roData.vehicle_info}`);

                  openaiWs.send(JSON.stringify({
                    type: "response.create",
                    response: {
                      modalities: ["text", "audio"],
                      instructions: `LOOKUP COMPLETE. Say EXACTLY this and nothing else: "Got it, I found RO ${roNumber}. I see it's a ${roData.vehicle_info} from ${roData.shop}. What do you need help with today?" Use ONLY this exact vehicle info: ${roData.vehicle_info}. Use ONLY this exact shop: ${roData.shop}. Do NOT invent or guess any other information.`
                    }
                  }));
                } else {
                  // RO not found
                  console.log(`⚠️  TECH: RO ${roNumber} not found in system`);

                  openaiWs.send(JSON.stringify({
                    type: "response.create",
                    response: {
                      modalities: ["text", "audio"],
                      instructions: `LOOKUP COMPLETE - NOT FOUND. Say EXACTLY: "I don't see RO ${roNumber} in our system. The body shop needs to call our Ops line first to register this vehicle. But I can still help you with calibration guidance - what vehicle are you working on?"`
                    }
                  }));
                }

                // Return early to prevent any other processing
                return;
              }
            }

            // TECH ASSISTANT: Detect language from user speech
            if (assistantType === "tech") {
              const spanishIndicators = [
                /\b(hola|soy|estoy|necesito|ayuda|calibrar|calibración|cámara|radar|qué|cómo|cuál|gracias|bueno|bien|aquí|trabajo|tengo|puedo|quiero)\b/i
              ];
              if (spanishIndicators.some(p => p.test(text))) {
                techSessionState.language = "es";
                console.log(`🌐 TECH: Detected Spanish language`);
              }
            }

            // TECH ASSISTANT: Capture technician name if provided (English + Spanish)
            if (assistantType === "tech" && !techSessionState.techName) {
              // Look for name patterns in user speech (English AND Spanish)
              const namePatterns = [
                // English patterns
                /(?:my name is|this is|i'm|i am)\s+([a-z]+)/i,
                /(?:it's|its)\s+([a-z]+)\s+(?:here|calling)?/i,
                /^([a-z]+)$/i,  // Just a name by itself
                /^(?:hey |hi |hello )?([a-z]+)(?:\s+here)?$/i,  // "hey Mike" or "Mike here"
                // Spanish patterns
                /(?:mi nombre es|me llamo|soy)\s+([a-záéíóúñ]+)/i,  // "Mi nombre es Randy", "Soy Randy"
                /([a-záéíóúñ]+)\s+(?:por aquí|aquí|jefe)/i,  // "Randy por aquí", "Randy jefe"
                /(?:es|soy)\s+([a-záéíóúñ]+)/i  // "Es Randy", "Soy Randy"
              ];
              for (const pattern of namePatterns) {
                const match = text.match(pattern);
                if (match && match[1] && match[1].length > 2 && match[1].length < 15) {
                  // Avoid capturing common words as names (English + Spanish)
                  const notNames = [
                    'yes', 'yeah', 'yep', 'no', 'nope', 'okay', 'hey', 'hello', 'help', 'need', 'got', 'have', 'the', 'and', 'for',
                    'si', 'sí', 'hola', 'aqui', 'aquí', 'bien', 'bueno', 'gracias', 'que', 'qué', 'como', 'cómo', 'cual', 'cuál'
                  ];
                  if (!notNames.includes(match[1].toLowerCase())) {
                    techSessionState.techName = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
                    console.log(`👤 TECH: Captured technician name: ${techSessionState.techName}`);
                    break;
                  }
                }
              }
            }

            // TECH ASSISTANT: Detect calibration systems and track them (BILINGUAL)
            if (assistantType === "tech") {
              // Track specific ADAS systems mentioned (English + Spanish)
              const systemPatterns = [
                { pattern: /\b(radar|radar delantero|front radar|rear radar|radar trasero)\b/i, system: "radar" },
                { pattern: /\b(camera|cámara|front camera|cámara frontal|windshield camera)\b/i, system: "camera" },
                { pattern: /\b(acc|adaptive cruise|control crucero|crucero adaptativo)\b/i, system: "ACC" },
                { pattern: /\b(blind spot|bsm|punto ciego)\b/i, system: "BSM" },
                { pattern: /\b(lane|lka|lkas|lane keep|carril)\b/i, system: "LKA" },
                { pattern: /\b(360|surround|parking|estacionamiento|360 camera)\b/i, system: "360 camera" },
                { pattern: /\b(fcw|forward collision|colisión frontal)\b/i, system: "FCW" }
              ];

              for (const sp of systemPatterns) {
                if (sp.pattern.test(text)) {
                  if (!techSessionState.calibrationRequired.includes(sp.system)) {
                    techSessionState.calibrationRequired.push(sp.system);
                    console.log(`📝 TECH: Tracking calibration_required: ${sp.system}`);
                  }
                  if (!techSessionState.calibrationPerformed.includes(sp.system)) {
                    techSessionState.calibrationPerformed.push(sp.system);
                    console.log(`📝 TECH: Tracking calibration_performed: ${sp.system}`);
                  }
                }
              }

              // Track calibration type (static/dynamic/both) - BILINGUAL
              if (/\b(static|estática|estatica)\b/i.test(text)) {
                techSessionState.calibrationType = techSessionState.calibrationType === "dynamic" ? "both" : "static";
                console.log(`📝 TECH: Calibration type: ${techSessionState.calibrationType}`);
              }
              if (/\b(dynamic|dinámica|dinamica)\b/i.test(text)) {
                techSessionState.calibrationType = techSessionState.calibrationType === "static" ? "both" : "dynamic";
                console.log(`📝 TECH: Calibration type: ${techSessionState.calibrationType}`);
              }
              if (/\b(both|ambas|las dos)\b/i.test(text)) {
                techSessionState.calibrationType = "both";
                console.log(`📝 TECH: Calibration type: both`);
              }
            }

            // TECH ASSISTANT: Detect calibration help requests and track topics (BILINGUAL)
            if (assistantType === "tech" && techSessionState.currentRO) {
              const helpTopics = [
                { pattern: /radar|radar delantero|front radar|rear radar/i, summary: "radar calibration" },
                { pattern: /camera|cámara|front camera|cámara frontal|windshield camera/i, summary: "camera calibration" },
                { pattern: /blind spot|bsm|punto ciego/i, summary: "blind spot monitor calibration" },
                { pattern: /lane|lka|lkas|lane keep|carril/i, summary: "lane keep assist calibration" },
                { pattern: /dtc|code|fault|error|código|falla/i, summary: "DTC troubleshooting" },
                { pattern: /target|distance|setup|alignment|blanco|alineación/i, summary: "target setup" },
                { pattern: /360|surround|parking|estacionamiento/i, summary: "360 camera calibration" },
                { pattern: /no me deja|no entra|no coge|no conecta|no pasa|no abre/i, summary: "troubleshooting" }
              ];

              for (const topic of helpTopics) {
                if (topic.pattern.test(text) && !techSessionState.assistanceSummaries.includes(topic.summary)) {
                  techSessionState.assistanceSummaries.push(topic.summary);
                  console.log(`📝 TECH: Adding assistance topic: ${topic.summary}`);
                }
              }

              // Track when tech says calibration passed (for notes) - BILINGUAL
              const passPhrases = [
                // English
                "passed", "successful", "it passed", "calibration passed", "calibration successful",
                "we're good", "all good",
                // Spanish
                "pasó", "paso", "ya calibró", "ya calibro", "quedó bien", "quedo bien",
                "lo logré", "lo logre", "funcionó", "funciono", "ya funcionó", "ya funciono"
              ];
              const isPassStatement = passPhrases.some(phrase => text.includes(phrase));

              if (isPassStatement && !techSessionState.calibrationPassed) {
                techSessionState.calibrationPassed = true;
                console.log(`✅ TECH: Calibration PASSED noted for RO ${techSessionState.currentRO}`);
              }

              // CLOSURE CONFIRMATION PHRASES - These trigger IMMEDIATE closure and tech_update()
              // Tech is saying the job is done and ready to close - no more questions needed
              const closureConfirmationPhrases = [
                // English - explicit completion statements
                "it's completed", "its completed", "it is completed",
                "it's done", "its done", "it is done",
                "it's finished", "its finished", "it is finished",
                "we're done", "were done", "we are done",
                "all set", "that's completed", "thats completed",
                "that's finished", "thats finished", "that's done", "thats done",
                "finished", "nothing else",
                "it passed and we're done", "it passed and were done",
                "nothing else it's completed", "nothing else its completed",
                // Spanish - explicit completion statements
                "está completado", "esta completado",
                "está listo", "esta listo",
                "ya quedó", "ya quedo",
                "ya quedó listo", "ya quedo listo",
                "ya terminó", "ya termino",
                "ya acabó", "ya acabo",
                "ya quedó bien", "ya quedo bien",
                "terminado", "finalizado",
                "todo listo", "nada más", "nada mas",
                "está terminado", "esta terminado"
              ];
              const isClosureConfirmation = closureConfirmationPhrases.some(phrase => text.includes(phrase));

              // CLOSURE MODE PHRASES - Explicit "close" commands
              const closurePhrases = [
                // English
                "close this ro", "close this r.o", "close the ro", "close the r.o",
                "close this po", "close this p.o", "close the po", "close the p.o",
                "finalize this job", "finalize the job", "finalize this",
                "mark it completed", "mark it complete", "mark this completed", "mark this complete",
                "i'm closing this", "im closing this", "closing this one", "closing this out",
                "let's close this", "lets close this", "close this out", "close it out",
                "log this as complete", "log it as complete", "log this complete",
                "close it", "let's close", "lets close",
                // Spanish
                "ciérralo", "cierralo", "cierra esto", "cierra este",
                "vamos a cerrar", "cerrar este ro", "cerrar este po", "cerrar el ro", "cerrar el po",
                "quiero finalizarlo", "finalizar esto", "finalizar este",
                "márcalo como completado", "marcalo como completado", "marca completado",
                "voy a cerrar", "estoy cerrando", "cerrar el trabajo", "cerrar este trabajo",
                "registra esto", "loguea esto"
              ];

              // Trigger closure on EITHER closure confirmation OR explicit close command
              const isClosureRequest = isClosureConfirmation || closurePhrases.some(phrase => text.includes(phrase));

              // If closure confirmation detected, also mark calibration as passed
              if (isClosureConfirmation) {
                techSessionState.calibrationPassed = true;
                console.log(`✅ TECH: Closure confirmation detected - marking calibration as passed`);
              }

              if (isClosureRequest && !loggedROs.has(techSessionState.currentRO)) {
                console.log(`🔒 TECH: CLOSURE MODE triggered for RO ${techSessionState.currentRO}`);

                // Check if we need to ask for missing calibration info
                const hasCalibrationData = techSessionState.calibrationRequired.length > 0 ||
                  techSessionState.calibrationPerformed.length > 0 ||
                  techSessionState.assistanceSummaries.filter(s => !s.includes("troubleshooting")).length > 0;

                // If no calibration data AND we haven't asked yet, ask for it
                if (!hasCalibrationData && !techSessionState.askedForCalibrationInfo) {
                  techSessionState.askedForCalibrationInfo = true;
                  console.log(`❓ TECH: Missing calibration info - asking technician`);

                  const askMsg = techSessionState.language === "es"
                    ? `Para cerrar este RO necesito algunos detalles. ¿Qué sistemas calibraste? Por ejemplo: radar, cámara, ACC, punto ciego. ¿Y fue estática, dinámica o ambas?`
                    : `To close this RO I need a few details. What systems did you calibrate? For example: radar, camera, ACC, blind spot. And was it static, dynamic, or both?`;

                  openaiWs.send(JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                      type: "message",
                      role: "system",
                      content: [{ type: "input_text", text: `ASK FOR CALIBRATION INFO: ${askMsg}` }]
                    }
                  }));

                  openaiWs.send(JSON.stringify({
                    type: "response.create",
                    response: {
                      modalities: ["text", "audio"],
                      instructions: `Say EXACTLY: "${askMsg}"`
                    }
                  }));

                  return; // Wait for tech to provide info before closing
                }

                // Build calibration fields from tracked session data WITH DEFAULTS
                let calibRequired = techSessionState.calibrationRequired.length > 0
                  ? techSessionState.calibrationRequired.join(", ")
                  : techSessionState.assistanceSummaries.filter(s => !s.includes("troubleshooting")).join(", ");

                // DEFAULT if still empty: use a placeholder
                if (!calibRequired || calibRequired.trim() === "") {
                  calibRequired = techSessionState.language === "es"
                    ? "No especificado por técnico"
                    : "Not specified by technician";
                }

                let calibPerformed = techSessionState.calibrationPerformed.length > 0
                  ? techSessionState.calibrationPerformed.join(", ")
                  : calibRequired;

                // DEFAULT if still empty
                if (!calibPerformed || calibPerformed.trim() === "" || calibPerformed.includes("Not specified") || calibPerformed.includes("No especificado")) {
                  calibPerformed = techSessionState.language === "es"
                    ? "Completado"
                    : "Completed";
                }

                // Add calibration type if known
                const typeNote = techSessionState.calibrationType
                  ? ` (${techSessionState.calibrationType})`
                  : "";

                // Build summary note (max 3-4 sentences) - language-aware WITH DEFAULT
                let summaryNote = "";
                if (techSessionState.assistanceSummaries.length > 0) {
                  summaryNote = techSessionState.language === "es"
                    ? `Asistencia: ${techSessionState.assistanceSummaries.join(", ")}. `
                    : `Assisted with ${techSessionState.assistanceSummaries.join(", ")}. `;
                }
                // Always add completion note
                summaryNote += techSessionState.language === "es"
                  ? "Calibración completada exitosamente."
                  : "Calibration completed successfully.";

                // Build complete tech update payload - ALWAYS populate all fields
                const techUpdateData = {
                  ro_number: techSessionState.currentRO,
                  technician: techSessionState.techName || (techSessionState.language === "es" ? "No especificado" : "Not specified"),
                  calibration_required: calibRequired + typeNote,
                  calibration_performed: calibPerformed + typeNote,
                  status_from_tech: "Completed",
                  tech_notes: summaryNote || (techSessionState.language === "es" ? "Calibración completada exitosamente." : "Calibration completed successfully.")
                };

                console.log(`📤 TECH: Executing CLOSURE tech_update for RO ${techSessionState.currentRO}:`, JSON.stringify(techUpdateData, null, 2));

                // Execute tech_update with all fields - ALWAYS call this
                const success = await updateTechData(techUpdateData, techSessionState.existingTechNotes);

                if (success) {
                  loggedROs.add(techSessionState.currentRO);
                  console.log(`✅ TECH: CLOSURE completed for RO ${techSessionState.currentRO}`);

                  // Send confirmation to OpenAI so assistant confirms to user - language-aware
                  const confirmMsg = techSessionState.language === "es"
                    ? `CIERRE COMPLETO: RO ${techSessionState.currentRO} registrado como completado. Técnico: ${techSessionState.techName || "técnico"}. Sistemas: ${calibPerformed}. Confirma al técnico: "Listo, todo registrado. ¿Algo más?"`
                    : `CLOSURE COMPLETE: RO ${techSessionState.currentRO} has been logged as completed. Technician: ${techSessionState.techName || "technician"}. Systems: ${calibPerformed}. Confirm to the tech: "All logged. Anything else?"`;

                  openaiWs.send(JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                      type: "message",
                      role: "system",
                      content: [{ type: "input_text", text: confirmMsg }]
                    }
                  }));

                  // Also trigger a response so assistant speaks the confirmation
                  openaiWs.send(JSON.stringify({
                    type: "response.create",
                    response: {
                      modalities: ["text", "audio"],
                      instructions: techSessionState.language === "es"
                        ? `Say: "Listo, RO ${techSessionState.currentRO} registrado como completado. ¿Algo más?"`
                        : `Say: "All logged. RO ${techSessionState.currentRO} is now marked as completed. Anything else?"`
                    }
                  }));
                } else {
                  console.log(`❌ TECH: CLOSURE FAILED for RO ${techSessionState.currentRO}`);

                  // Inform the assistant about the failure
                  openaiWs.send(JSON.stringify({
                    type: "response.create",
                    response: {
                      modalities: ["text", "audio"],
                      instructions: techSessionState.language === "es"
                        ? `Say: "Hubo un problema guardando los datos. Por favor intenta de nuevo."`
                        : `Say: "There was an issue saving the data. Please try again."`
                    }
                  }));
                }
              }
            }

            // Extract and log data ONLY after confirmation - BILINGUAL
            const confirmationPhrases = [
              // English
              "yes", "correct", "that's right", "sounds good", "looks good", "yeah", "yep", "yup", "affirmative", "that's correct", "all good", "perfect",
              // Spanish
              "sí", "si", "correcto", "está bien", "esta bien", "así es", "asi es", "exacto", "perfecto", "bien", "ok", "dale", "eso es"
            ];
            const isConfirmation = confirmationPhrases.some(phrase => text.includes(phrase));

            const lastAssistantMsg = conversationTranscript.filter(t => t.role === "assistant").slice(-1)[0];
            const askedForConfirmation = lastAssistantMsg &&
              (lastAssistantMsg.content.toLowerCase().includes("does everything sound correct") ||
               lastAssistantMsg.content.toLowerCase().includes("is that correct") ||
               lastAssistantMsg.content.toLowerCase().includes("sound good") ||
               lastAssistantMsg.content.toLowerCase().includes("does that sound right") ||
               // Spanish confirmation questions
               lastAssistantMsg.content.toLowerCase().includes("está correcto") ||
               lastAssistantMsg.content.toLowerCase().includes("es correcto") ||
               lastAssistantMsg.content.toLowerCase().includes("suena bien") ||
               lastAssistantMsg.content.toLowerCase().includes("todo bien"));

            // TECH: If we asked for calibration info and user confirms OR provides systems, trigger closure
            if (assistantType === "tech" && techSessionState.askedForCalibrationInfo && techSessionState.currentRO && !loggedROs.has(techSessionState.currentRO)) {
              // Check if user provided calibration systems in their response
              const systemsInResponse = /\b(radar|camera|cámara|acc|bsm|blind spot|punto ciego|lka|lane|carril|fcw|360)\b/i.test(text);
              const confirmInResponse = isConfirmation;

              if (systemsInResponse || confirmInResponse) {
                console.log(`🔒 TECH: Post-calibration-info confirmation - triggering closure for RO ${techSessionState.currentRO}`);

                // Build final payload from session state ONLY
                const finalCalibRequired = techSessionState.calibrationRequired.length > 0
                  ? techSessionState.calibrationRequired.join(", ")
                  : (techSessionState.language === "es" ? "No especificado" : "Not specified");

                const finalCalibPerformed = techSessionState.calibrationPerformed.length > 0
                  ? techSessionState.calibrationPerformed.join(", ")
                  : (techSessionState.language === "es" ? "Completado" : "Completed");

                const typeNote = techSessionState.calibrationType ? ` (${techSessionState.calibrationType})` : "";

                const finalNote = techSessionState.language === "es"
                  ? "Calibración completada exitosamente."
                  : "Calibration completed successfully.";

                const techUpdateData = {
                  ro_number: techSessionState.currentRO,
                  technician: techSessionState.techName || (techSessionState.language === "es" ? "No especificado" : "Not specified"),
                  calibration_required: finalCalibRequired + typeNote,
                  calibration_performed: finalCalibPerformed + typeNote,
                  status_from_tech: "Completed",
                  tech_notes: finalNote
                };

                console.log(`📤 TECH: Final closure payload:`, JSON.stringify(techUpdateData, null, 2));

                const success = await updateTechData(techUpdateData, techSessionState.existingTechNotes);

                if (success) {
                  loggedROs.add(techSessionState.currentRO);
                  console.log(`✅ TECH: CLOSURE completed for RO ${techSessionState.currentRO}`);

                  openaiWs.send(JSON.stringify({
                    type: "response.create",
                    response: {
                      modalities: ["text", "audio"],
                      instructions: techSessionState.language === "es"
                        ? `Say: "Listo, RO ${techSessionState.currentRO} registrado como completado. ¿Algo más?"`
                        : `Say: "All logged. RO ${techSessionState.currentRO} is now marked as completed. Anything else?"`
                    }
                  }));
                }

                return; // Don't process further
              }
            }

            // OPS assistant - handle confirmation logging using opsConfirmationPending flag
            // This flag is set when the assistant sends a confirmation summary message
            if (assistantType === "ops" && isConfirmation && sessionState.opsConfirmationPending) {
              // CONFIRMATION SAFETY: Verify last assistant message was a complete confirmation summary
              const lastAssistantForOps = conversationTranscript.filter(t => t.role === "assistant").slice(-1)[0];
              const msgLower = lastAssistantForOps?.content?.toLowerCase() || "";

              // Check for key confirmation elements - don't require "vehicle" word since
              // confirmation may say "2025 Ford Mustang" without the word "vehicle"
              const hasConfirmWord = msgLower.includes("confirm") || msgLower.includes("confirmar");
              const hasROField = msgLower.includes("ro") || msgLower.includes("r.o.") || /\b\d{4,}\b/.test(msgLower);
              const hasShopField = msgLower.includes("shop") || msgLower.includes("taller") || msgLower.includes("autosport") || msgLower.includes("paintmax") || msgLower.includes("jmd") || msgLower.includes("reinaldo") || msgLower.includes("ccnm");
              const hasVINField = msgLower.includes("vin") || /\b\d{4}\b/.test(msgLower);  // VIN ending is 4 digits
              const hasStatusField = msgLower.includes("ready") || msgLower.includes("listo") || msgLower.includes("status") || msgLower.includes("estado");

              // Summary must have confirm word + at least 3 other key fields
              const fieldCount = [hasROField, hasShopField, hasVINField, hasStatusField].filter(Boolean).length;
              const isCompleteConfirmationSummary = lastAssistantForOps && hasConfirmWord && fieldCount >= 3;

              if (!isCompleteConfirmationSummary) {
                console.log("⚠️  OPS: Confirmation detected but last assistant message wasn't a complete summary, ignoring");
                console.log("📝 Last assistant message:", lastAssistantForOps?.content?.substring(0, 100));
                // Don't process - wait for proper confirmation summary
              } else {
                console.log("🔍 EXTRACTION DEBUG - Confirmation detected (opsConfirmationPending=true), extracting data...");
                console.log("📜 Conversation has", conversationTranscript.length, "messages");
                console.log("💾 Session state:", JSON.stringify(sessionState, null, 2));
                console.log("📝 Already logged ROs:", Array.from(loggedROs));

                // Use sessionState.language for response (already detected from caller)
                const isSpanish = sessionState.language === "es";
                console.log(`🌐 OPS: Response language is ${isSpanish ? "Spanish" : "English"}`);

                const extracted = extractOpsData(conversationTranscript, sessionState);
                console.log("📊 EXTRACTED DATA:", JSON.stringify(extracted, null, 2));

                const roKey = extracted.ro_number || "";
                if (roKey && !loggedROs.has(roKey)) {
                  console.log(`✓ RO ${roKey} is new, proceeding to log...`);
                  const success = await logOpsData(extracted, extracted.caller_name, sessionState.language);
                  if (success) {
                    loggedROs.add(roKey);
                    sessionState.opsConfirmationPending = false;  // Reset after successful log
                    console.log("✅ RO logged after confirmation:", roKey);
                    console.log("📝 Updated logged ROs:", Array.from(loggedROs));
                    console.log("🔔 OPS: opsConfirmationPending reset to false");

                    // ALWAYS send spoken response after successful logging
                    const successMessage = isSpanish
                      ? `Say: "Listo, el vehículo ha sido registrado. ¿Necesitas algo más?"`
                      : `Say: "Your vehicle has been logged successfully. Anything else you need?"`;

                    openaiWs.send(JSON.stringify({
                      type: "response.create",
                      response: {
                        modalities: ["text", "audio"],
                        instructions: successMessage
                      }
                    }));
                    console.log("🔊 OPS: Sent post-logging response");
                    return; // Stop processing after successful log
                  } else {
                    console.log("❌ Failed to log RO:", roKey);
                    // Keep opsConfirmationPending=true so user can retry
                    // CANCEL any in-progress response first to prevent assistant from saying "logged successfully"
                    openaiWs.send(JSON.stringify({ type: "response.cancel" }));

                    // Send error response
                    const errorMessage = isSpanish
                      ? `Say EXACTLY: "Hubo un problema al registrar. ¿Puedes confirmar la información otra vez?" Do NOT say the vehicle was logged or registered.`
                      : `Say EXACTLY: "There was an issue logging that. Can you confirm the information again?" Do NOT say the vehicle was logged.`;

                    openaiWs.send(JSON.stringify({
                      type: "response.create",
                      response: {
                        modalities: ["text", "audio"],
                        instructions: errorMessage
                      }
                    }));
                    console.log("🔊 OPS: Sent error response after failed logging");
                    return; // Stop processing - don't let assistant generate its own response
                  }
                } else if (!roKey) {
                  console.log("⚠️  No RO number extracted, cannot log");
                  console.log("🔍 Extraction returned null ro_number - check extraction patterns");
                  // Keep opsConfirmationPending=true - assistant may re-confirm with corrected info
                  return; // Stop processing - wait for better data
                } else {
                  console.log(`⚠️  RO ${roKey} already logged in this session, skipping`);
                  console.log("💡 If this is a new vehicle, ensure it has a different RO number");
                  sessionState.opsConfirmationPending = false;  // Reset since this RO is already done

                  // Still respond to the user
                  const alreadyLoggedMessage = isSpanish
                    ? `Say: "Ese RO ya está registrado. ¿Hay otro vehículo que necesites registrar?"`
                    : `Say: "That RO is already logged. Is there another vehicle you need to register?"`;

                  openaiWs.send(JSON.stringify({
                    type: "response.create",
                    response: {
                      modalities: ["text", "audio"],
                      instructions: alreadyLoggedMessage
                    }
                  }));
                  return; // Stop processing after handling already-logged case
                }
              }
            }

            // TECH + OPS generic confirmation handling (legacy fallback for TECH)
            if (isConfirmation && askedForConfirmation) {
              // TECH assistant - confirmations are handled by closure mode above
              // Do NOT duplicate the tech_update call here - closure mode is the single source of truth
            }
          }
          break;

        case "input_audio_buffer.speech_started":
          console.log("🎤 User speaking - checking for interruption");
          // If assistant is responding, cancel and let user speak
          if (sessionState.responseInProgress) {
            console.log("🛑 User interrupted - cancelling assistant response");
            openaiWs.send(JSON.stringify({ type: "response.cancel" }));
            sessionState.responseInProgress = false;
          }
          // Clear Twilio audio buffer to stop playback immediately
          if (streamSid) {
            twilioWs.send(JSON.stringify({ event: "clear", streamSid: streamSid }));
          }
          break;

        case "input_audio_buffer.speech_stopped":
          console.log("🔇 User stopped");
          break;

        default:
          break;
      }
    } catch (err) {
      console.error("❌ Error parsing OpenAI message:", err);
    }
  });

  openaiWs.on("error", (err) => {
    console.error("❌ OpenAI error:", err.message);
  });

  openaiWs.on("close", (code, reason) => {
    console.log(`🔴 OpenAI closed (${code}):`, reason.toString() || "No reason");
  });

  twilioWs.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.event) {
        case "start":
          streamSid = data.start.streamSid;
          callSid = data.start.callSid;
          console.log(`📞 Call started: ${callSid}`);
          break;

        case "media":
          if (data.media?.payload && isCallActive && !transferRequested) {
            if (openaiWs.readyState === WebSocket.OPEN && sessionConfigured) {
              openaiWs.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: data.media.payload
              }));
            }
          }
          break;

        case "stop":
          console.log("⏹️  Call ended");
          isCallActive = false;
          if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
          break;

        default:
          break;
      }
    } catch (err) {
      console.error("❌ Error parsing Twilio message:", err);
    }
  });

  twilioWs.on("close", () => {
    console.log("🔴 Twilio closed");
    isCallActive = false;
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
  });

  twilioWs.on("error", (err) => {
    console.error("❌ Twilio error:", err);
  });
});

// ============================================================
// SHUTDOWN
// ============================================================

process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

// ============================================================
// EMAIL LISTENER API ENDPOINTS
// Gmail: radarsolutionsus@gmail.com
// Label: "ADAS FIRST" only
// ============================================================

app.post("/email/start", async (req, res) => {
  try {
    const result = await emailListener.startListener();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/email/stop", (req, res) => {
  const result = emailListener.stopListener();
  res.json(result);
});

app.get("/email/status", (req, res) => {
  res.json(emailListener.getStatus());
});

app.post("/email/process/:messageId", async (req, res) => {
  try {
    const result = await emailListener.processMessageById(req.params.messageId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// OAuth setup endpoints for Gmail authentication
app.get("/email/auth-url", (req, res) => {
  const result = emailListener.getAuthUrl();
  res.json(result);
});

app.post("/email/auth-callback", async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Authorization code required" });
  }
  try {
    const result = await emailListener.exchangeCodeForToken(code);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/email/reset-processed", (req, res) => {
  try {
    emailListener.clearProcessedIds();
    res.json({ success: true, message: "Processed email IDs cleared" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reprocess a single email by removing the processed label
app.post("/email/reprocess/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;

    // Get the Gmail client from emailListener (we need to access processedLabelId)
    const { google } = await import("googleapis");

    // Load OAuth credentials
    const credentials = JSON.parse(
      process.env.GMAIL_OAUTH_CREDENTIALS_JSON ||
        fs.readFileSync("./credentials/google-oauth-client.json", "utf8")
    );
    const { client_id, client_secret, redirect_uris } =
      credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris?.[0] || "urn:ietf:wg:oauth:2.0:oob"
    );

    // Get token from sheets or env
    const token = await sheetWriter.getGmailTokenFromSheets();
    if (!token) {
      return res
        .status(500)
        .json({ success: false, error: "No Gmail OAuth token found" });
    }
    oauth2Client.setCredentials(token);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Find the ADAS_FIRST_PROCESSED label
    const labelsResponse = await gmail.users.labels.list({ userId: "me" });
    const processedLabel = labelsResponse.data.labels.find(
      (l) => l.name === "ADAS_FIRST_PROCESSED"
    );

    if (!processedLabel) {
      return res
        .status(404)
        .json({ success: false, error: "ADAS_FIRST_PROCESSED label not found" });
    }

    // Remove the processed label from the message
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        removeLabelIds: [processedLabel.id],
      },
    });

    // Also remove from local processed IDs
    emailListener.clearProcessedIds(); // This clears the Set

    console.log(
      `[REPROCESS] Removed ADAS_FIRST_PROCESSED label from message ${messageId}`
    );
    res.json({
      success: true,
      message: `Message ${messageId} queued for reprocessing on next poll`,
    });
  } catch (err) {
    console.error(`[REPROCESS] Error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List messages that may have failed processing (have ADAS_FIRST_PROCESSED but invalid RO)
app.get("/email/failed", async (req, res) => {
  try {
    const { google } = await import("googleapis");

    // Load OAuth credentials
    const credentials = JSON.parse(
      process.env.GMAIL_OAUTH_CREDENTIALS_JSON ||
        fs.readFileSync("./credentials/google-oauth-client.json", "utf8")
    );
    const { client_id, client_secret, redirect_uris } =
      credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris?.[0] || "urn:ietf:wg:oauth:2.0:oob"
    );

    const token = await sheetWriter.getGmailTokenFromSheets();
    if (!token) {
      return res
        .status(500)
        .json({ success: false, error: "No Gmail OAuth token found" });
    }
    oauth2Client.setCredentials(token);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Find the ADAS_FIRST_PROCESSED label
    const labelsResponse = await gmail.users.labels.list({ userId: "me" });
    const processedLabel = labelsResponse.data.labels.find(
      (l) => l.name === "ADAS_FIRST_PROCESSED"
    );

    if (!processedLabel) {
      return res
        .status(404)
        .json({ success: false, error: "ADAS_FIRST_PROCESSED label not found" });
    }

    // List messages with ADAS_FIRST_PROCESSED label
    const messagesResponse = await gmail.users.messages.list({
      userId: "me",
      labelIds: [processedLabel.id],
      maxResults: 50,
    });

    const messages = messagesResponse.data.messages || [];
    const details = [];

    for (const msg of messages) {
      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });

      const headers = fullMessage.data.payload.headers;
      details.push({
        id: msg.id,
        subject: headers.find((h) => h.name === "Subject")?.value || "",
        from: headers.find((h) => h.name === "From")?.value || "",
        date: headers.find((h) => h.name === "Date")?.value || "",
      });
    }

    res.json({
      success: true,
      count: details.length,
      messages: details,
      note: "Use POST /email/reprocess/:messageId to requeue any of these",
    });
  } catch (err) {
    console.error(`[EMAIL/FAILED] Error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reprocess all emails that have ADAS_FIRST_PROCESSED label
app.post("/email/reprocess-all", async (req, res) => {
  try {
    const { google } = await import("googleapis");

    const credentials = JSON.parse(
      process.env.GMAIL_OAUTH_CREDENTIALS_JSON ||
        fs.readFileSync("./credentials/google-oauth-client.json", "utf8")
    );
    const { client_id, client_secret, redirect_uris } =
      credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris?.[0] || "urn:ietf:wg:oauth:2.0:oob"
    );

    const token = await sheetWriter.getGmailTokenFromSheets();
    if (!token) {
      return res
        .status(500)
        .json({ success: false, error: "No Gmail OAuth token found" });
    }
    oauth2Client.setCredentials(token);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Find both labels
    const labelsResponse = await gmail.users.labels.list({ userId: "me" });
    const processedLabel = labelsResponse.data.labels.find(
      (l) => l.name === "ADAS_FIRST_PROCESSED"
    );
    const sourceLabel = labelsResponse.data.labels.find(
      (l) => l.name === "ADAS FIRST"
    );

    if (!processedLabel || !sourceLabel) {
      return res
        .status(404)
        .json({ success: false, error: "Required labels not found" });
    }

    // List messages with ADAS_FIRST_PROCESSED label
    const messagesResponse = await gmail.users.messages.list({
      userId: "me",
      labelIds: [processedLabel.id],
      maxResults: 100,
    });

    const messages = messagesResponse.data.messages || [];
    let reprocessedCount = 0;

    for (const msg of messages) {
      try {
        // Remove ADAS_FIRST_PROCESSED label, ensure ADAS FIRST label is present
        await gmail.users.messages.modify({
          userId: "me",
          id: msg.id,
          requestBody: {
            removeLabelIds: [processedLabel.id],
            addLabelIds: [sourceLabel.id],
          },
        });
        reprocessedCount++;
      } catch (modifyErr) {
        console.error(
          `[REPROCESS-ALL] Failed to modify message ${msg.id}:`,
          modifyErr.message
        );
      }
    }

    // Clear local processed IDs
    emailListener.clearProcessedIds();

    console.log(
      `[REPROCESS-ALL] Queued ${reprocessedCount}/${messages.length} messages for reprocessing`
    );
    res.json({
      success: true,
      message: `Queued ${reprocessedCount} messages for reprocessing`,
      total: messages.length,
      reprocessed: reprocessedCount,
    });
  } catch (err) {
    console.error(`[REPROCESS-ALL] Error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// BILLING ENDPOINTS
// ============================================================

// Manually trigger billing email for an RO
app.post("/billing/send/:roPo", async (req, res) => {
  try {
    const { roPo } = req.params;
    const { force } = req.query;
    const result = await billingMailer.triggerBillingEmail(roPo, force === "true");
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get shop info for billing
app.get("/billing/shop/:shopName", async (req, res) => {
  try {
    const shopInfo = await billingMailer.getShopInfo(req.params.shopName);
    if (shopInfo) {
      res.json({ success: true, shop: shopInfo });
    } else {
      res.status(404).json({ success: false, error: "Shop not found" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// SMS ENDPOINTS
// ============================================================

// Twilio SMS webhook - handles incoming text messages for scheduling
app.post("/sms", smsHandler.handleIncomingSMS);

// ============================================================
// STARTUP
// ============================================================

console.log("\n🎯 ADAS First Voice System Ready");
console.log(`📡 ${NGROK}`);
console.log(`🔗 Webhooks:`);
console.log(`   Ops:  https://${NGROK}/voice-ops`);
console.log(`   Tech: https://${NGROK}/voice-tech`);
console.log(`   Transfer: https://${NGROK}/transfer-randy`);
console.log(`📧 Email Pipeline (radarsolutionsus@gmail.com, label: "ADAS FIRST"):`);
console.log(`   Start:    POST /email/start`);
console.log(`   Stop:     POST /email/stop`);
console.log(`   Status:   GET  /email/status`);
console.log(`   Auth URL: GET  /email/auth-url`);
console.log(`💰 Billing:`);
console.log(`   Send:     POST /billing/send/:roPo`);
console.log(`   Shop:     GET  /billing/shop/:shopName`);
console.log(`📱 SMS Scheduling:`);
console.log(`   Webhook:  POST /sms (Twilio)`);
console.log(`🌐 Shop Portal:`);
console.log(`   Login:    https://${NGROK}/`);
console.log(`   API Auth: /api/auth/login, /api/auth/refresh`);
console.log(`   API:      /api/portal/vehicles, /api/portal/schedule`);

// Auto-start email listener if configured
if (process.env.AUTO_START_EMAIL_LISTENER === "true") {
  console.log("📧 Auto-starting email listener...");
  emailListener.startListener();
}
