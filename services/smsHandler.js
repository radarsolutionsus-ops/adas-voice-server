// ============================================================
// SMS HANDLER - Text-based Scheduling & Tech Notifications
// ============================================================

import twilio from "twilio";
import sheetWriter from "./sheetWriter.js";

// Initialize Twilio client for outbound SMS
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "+17868384497";

// Tech phone numbers (add to Railway env vars)
const TECH_PHONES = {
  randy: process.env.TECH_RANDY_PHONE || "+17206887666",
  felipe: process.env.TECH_FELIPE_PHONE,
  martin: process.env.TECH_MARTIN_PHONE,
  anthony: process.env.TECH_ANTHONY_PHONE
};

// Shop phone mapping (optional - for auto-detection)
const SHOP_PHONES = {
  // Add known shop numbers here, e.g.:
  // "+13051234567": "JMD Body Shop",
  // "+13059876543": "AutoSport",
};

// Conversation state (in-memory - persists during server uptime)
const conversations = new Map();

// Conversation timeout (30 minutes of inactivity)
const CONVERSATION_TIMEOUT = 30 * 60 * 1000;

// ============================================================
// SMS WEBHOOK ENDPOINT
// ============================================================

/**
 * Handle incoming SMS from Twilio
 */
export async function handleIncomingSMS(req, res) {
  const { From: from, Body: body } = req.body;

  console.log(`[SMS] Incoming from ${from}: "${body}"`);

  try {
    // Get or create conversation state
    let convo = conversations.get(from);

    if (!convo || Date.now() - convo.lastActivity > CONVERSATION_TIMEOUT) {
      // New conversation
      convo = {
        phone: from,
        shopName: SHOP_PHONES[from] || null,
        step: "greeting",
        data: {},
        history: [],
        lastActivity: Date.now()
      };
      conversations.set(from, convo);
    }

    convo.lastActivity = Date.now();
    convo.history.push({ role: "user", content: body });

    // Process message and get response
    const response = await processConversation(convo, body);

    console.log(`[SMS] Response to ${from}: "${response}"`);

    convo.history.push({ role: "assistant", content: response });

    // Send response via TwiML
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(response)}</Message>
</Response>`;

    console.log(`[SMS] Sending TwiML response`);

    res.type("text/xml");
    res.send(twiml);

  } catch (err) {
    console.error("[SMS] Error processing message:", err);

    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, I encountered an error. Please try again or call us directly.</Message>
</Response>`;

    res.type("text/xml");
    res.send(errorTwiml);
  }
}

// ============================================================
// CONVERSATION PROCESSOR
// ============================================================

async function processConversation(convo, message) {
  const lowerMsg = message.toLowerCase().trim();

  // Handle opt-out keywords (Twilio handles these automatically, but good to acknowledge)
  if (["stop", "cancel", "unsubscribe", "quit", "end"].includes(lowerMsg)) {
    conversations.delete(convo.phone);
    return "You've been unsubscribed from ADAS First notifications. Text START to resubscribe.";
  }

  // Handle help
  if (["help", "info"].includes(lowerMsg)) {
    return "ADAS First Scheduling:\n• Text your RO# to schedule\n• Include vehicle info (Year Make Model)\n• We'll confirm your appointment\n\nReply STOP to opt out.";
  }

  // Handle restart
  if (["start", "yes", "hi", "hello", "hey"].includes(lowerMsg)) {
    convo.step = "greeting";
    convo.data = {};
  }

  // State machine for scheduling conversation
  switch (convo.step) {
    case "greeting":
      if (convo.shopName) {
        convo.step = "get_ro";
        return `Hi ${convo.shopName}! What's the RO number you'd like to schedule?`;
      } else {
        convo.step = "get_shop";
        return "Hi, this is ADAS First scheduling. Which shop is this?";
      }

    case "get_shop":
      convo.shopName = message.trim();
      convo.data.shopName = convo.shopName;
      convo.step = "get_ro";
      return `Thanks ${convo.shopName}! What's the RO number?`;

    case "get_ro":
      // Extract RO number (4-8 digits)
      const roMatch = message.match(/\d{4,8}/);
      if (roMatch) {
        convo.data.roPo = roMatch[0];
        convo.step = "get_vehicle";
        return `RO ${convo.data.roPo}. What's the vehicle? (Year Make Model)`;
      } else {
        return "I need the RO number (4-8 digits). What's the RO?";
      }

    case "get_vehicle":
      convo.data.vehicle = message.trim();
      // Try to parse year/make/model
      const vehicleParts = parseVehicle(message);
      convo.data.year = vehicleParts.year;
      convo.data.make = vehicleParts.make;
      convo.data.model = vehicleParts.model;
      convo.step = "get_date";
      return "Got it. When do you need this done? (e.g., tomorrow, Monday, 12/15)";

    case "get_date":
      const dateInfo = parseDate(message);
      convo.data.preferredDate = dateInfo.formatted;
      convo.data.dateDisplay = dateInfo.display;
      convo.step = "confirm";

      const summary = `Please confirm:\n• Shop: ${convo.data.shopName}\n• RO: ${convo.data.roPo}\n• Vehicle: ${convo.data.vehicle}\n• Date: ${convo.data.dateDisplay}\n\nReply YES to confirm or NO to start over.`;
      return summary;

    case "confirm":
      if (["yes", "y", "confirm", "correct", "si", "sí"].includes(lowerMsg)) {
        // Log to sheet and confirm
        const result = await logScheduleRequest(convo.data);

        if (result.success) {
          // Reset conversation
          convo.step = "done";
          conversations.delete(convo.phone);

          return `Confirmed! RO ${convo.data.roPo} is scheduled for ${convo.data.dateDisplay}. We'll send updates as the appointment approaches. Thanks!`;
        } else {
          return `Sorry, there was an issue: ${result.error}. Please try again or call us.`;
        }
      } else if (["no", "n", "cancel", "restart"].includes(lowerMsg)) {
        convo.step = "greeting";
        convo.data = {};
        return "No problem, let's start over. What's the RO number?";
      } else {
        return "Please reply YES to confirm or NO to start over.";
      }

    default:
      // Use freeform handler for messages that don't fit the flow
      return await handleFreeformMessage(convo, message);
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function parseVehicle(text) {
  // Extract year (4 digits starting with 19 or 20)
  const yearMatch = text.match(/(19|20)\d{2}/);
  const year = yearMatch ? yearMatch[0] : "";

  // Common makes
  const makes = ["toyota", "honda", "nissan", "ford", "chevy", "chevrolet", "gmc", "bmw", "mercedes", "audi", "volkswagen", "vw", "hyundai", "kia", "subaru", "mazda", "lexus", "acura", "infiniti", "jeep", "dodge", "ram", "chrysler", "buick", "cadillac", "lincoln", "tesla", "volvo", "porsche", "jaguar", "land rover"];

  const lowerText = text.toLowerCase();
  let make = "";
  for (const m of makes) {
    if (lowerText.includes(m)) {
      make = m.charAt(0).toUpperCase() + m.slice(1);
      if (make === "Vw") make = "Volkswagen";
      if (make === "Chevy") make = "Chevrolet";
      break;
    }
  }

  // Model is everything else (rough extraction)
  let model = text
    .replace(/\d{4}/, "")
    .replace(new RegExp(make, "i"), "")
    .trim();

  return { year, make, model };
}

function parseDate(text) {
  const lowerText = text.toLowerCase();
  const today = new Date();
  let targetDate = new Date();

  if (lowerText.includes("today")) {
    // Keep as today
  } else if (lowerText.includes("tomorrow")) {
    targetDate.setDate(today.getDate() + 1);
  } else if (lowerText.includes("monday")) {
    targetDate = getNextDayOfWeek(1);
  } else if (lowerText.includes("tuesday")) {
    targetDate = getNextDayOfWeek(2);
  } else if (lowerText.includes("wednesday")) {
    targetDate = getNextDayOfWeek(3);
  } else if (lowerText.includes("thursday")) {
    targetDate = getNextDayOfWeek(4);
  } else if (lowerText.includes("friday")) {
    targetDate = getNextDayOfWeek(5);
  } else if (lowerText.includes("saturday")) {
    targetDate = getNextDayOfWeek(6);
  } else {
    // Try to parse as date (12/15, 12-15, Dec 15, etc.)
    const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1]) - 1;
      const day = parseInt(dateMatch[2]);
      targetDate = new Date(today.getFullYear(), month, day);
      if (targetDate < today) {
        targetDate.setFullYear(today.getFullYear() + 1);
      }
    }
  }

  const formatted = targetDate.toISOString().split("T")[0]; // YYYY-MM-DD
  const display = targetDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });

  return { formatted, display };
}

function getNextDayOfWeek(dayOfWeek) {
  const today = new Date();
  const resultDate = new Date();
  resultDate.setDate(today.getDate() + ((dayOfWeek + 7 - today.getDay()) % 7 || 7));
  return resultDate;
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ============================================================
// SHEET INTEGRATION
// ============================================================

async function logScheduleRequest(data) {
  try {
    console.log("[SMS] Schedule request:", data);

    // Use sheetWriter to upsert the schedule entry
    await sheetWriter.upsertScheduleRowByRO(data.roPo, {
      shopName: data.shopName,
      year: data.year,
      make: data.make,
      model: data.model,
      vehicle: data.vehicle,
      scheduledDate: data.preferredDate,
      status: "Scheduled",
      notes: `Scheduled via SMS on ${new Date().toLocaleDateString()}`
    });

    return { success: true };
  } catch (err) {
    console.error("[SMS] Error logging schedule:", err);
    return { success: false, error: err.message };
  }
}

async function handleFreeformMessage(convo, message) {
  // For messages that don't fit the flow, provide helpful response
  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes("status") || lowerMsg.includes("update")) {
    return "To check status, please provide the RO number and I'll look it up.";
  }

  if (lowerMsg.includes("cancel")) {
    return "To cancel an appointment, please call us directly or provide the RO number.";
  }

  if (lowerMsg.includes("reschedule")) {
    return "To reschedule, please provide the RO number and new preferred date.";
  }

  // Default
  return "I can help you schedule ADAS calibrations. Text an RO number to get started, or reply HELP for options.";
}

// ============================================================
// TECH NOTIFICATIONS
// ============================================================

/**
 * Send SMS notification to technician
 * @param {string} techName - Technician name (randy, felipe, martin, anthony)
 * @param {string} message - Message to send
 */
export async function notifyTech(techName, message) {
  const techPhone = TECH_PHONES[techName.toLowerCase()];

  if (!techPhone) {
    console.warn(`[SMS] No phone number for tech: ${techName}`);
    return { success: false, error: "Tech phone not configured" };
  }

  try {
    const result = await twilioClient.messages.create({
      body: `ADAS F1rst: ${message}`,
      from: TWILIO_PHONE_NUMBER,
      to: techPhone
    });

    console.log(`[SMS] Sent to ${techName} (${techPhone}): ${message}`);
    return { success: true, sid: result.sid };
  } catch (err) {
    console.error(`[SMS] Failed to notify ${techName}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Notify tech of new job assignment
 */
export async function notifyJobAssigned(techName, roData) {
  const message = `New job assigned - RO #${roData.roPo}, ${roData.vehicle || 'Vehicle TBD'} at ${roData.shopName}${roData.scheduledDate ? `, scheduled ${roData.scheduledDate}` : ''}.`;
  return notifyTech(techName, message);
}

/**
 * Notify tech of job reschedule
 */
export async function notifyJobRescheduled(techName, roData, oldDate, newDate) {
  const message = `RO #${roData.roPo} rescheduled from ${oldDate} to ${newDate}.`;
  return notifyTech(techName, message);
}

/**
 * Notify tech of job cancellation
 */
export async function notifyJobCancelled(techName, roData) {
  const message = `RO #${roData.roPo} at ${roData.shopName} has been cancelled.`;
  return notifyTech(techName, message);
}

/**
 * Notify shop of confirmation
 */
export async function notifyShop(shopPhone, message) {
  if (!shopPhone) return { success: false, error: "No shop phone" };

  try {
    const result = await twilioClient.messages.create({
      body: `ADAS First: ${message}`,
      from: TWILIO_PHONE_NUMBER,
      to: shopPhone
    });

    console.log(`[SMS] Sent to shop (${shopPhone}): ${message}`);
    return { success: true, sid: result.sid };
  } catch (err) {
    console.error(`[SMS] Failed to notify shop:`, err);
    return { success: false, error: err.message };
  }
}

export default {
  handleIncomingSMS,
  notifyTech,
  notifyJobAssigned,
  notifyJobRescheduled,
  notifyJobCancelled,
  notifyShop
};
