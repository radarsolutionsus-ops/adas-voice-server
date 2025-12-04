/**
 * llmScrubber.js - Hybrid Knowledge Base + LLM + RevvADAS Scrub
 *
 * Philosophy: All three sources are EQUAL contributors. None is the absolute truth.
 *
 * | Source          | Strengths                                    | Can Miss                              |
 * |-----------------|----------------------------------------------|---------------------------------------|
 * | Knowledge Base  | OEM-specific rules, prerequisites, quirks    | New model years, uncommon configs     |
 * | LLM (GPT-4o)    | Reads actual estimate, understands context   | May misinterpret unclear line items   |
 * | RevvADAS        | VIN-decoded equipment, manufacturer data     | Technician edits, aftermarket parts   |
 *
 * When sources AGREE → High confidence, verified
 * When sources DISAGREE → Flag for technician review
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { getOEMRules } from '../utils/oem/index.js';

const LOG_TAG = '[HYBRID_SCRUB]';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HYBRID SCRUB FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hybrid scrub using Knowledge Base + LLM + RevvADAS
 * All three sources weighted equally
 * @param {string} estimatePath - Path to estimate PDF/image
 * @param {object} revvData - RevvADAS recommendations
 * @param {object} vehicleInfo - { year, make, model, vin }
 * @returns {Promise<object>} - Reconciled scrub results
 */
export async function hybridScrubEstimate(estimatePath, revvData, vehicleInfo) {
  console.log(`${LOG_TAG} Starting hybrid scrub for ${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}`);

  // ═══════════════════════════════════════════════════════════════════════
  // SOURCE 1: KNOWLEDGE BASE
  // ═══════════════════════════════════════════════════════════════════════
  const kbRules = getOEMRules(vehicleInfo.make);
  console.log(`${LOG_TAG} Loaded KB rules for ${kbRules.brand} (${kbRules.calibrationTriggers.length} triggers)`);

  // ═══════════════════════════════════════════════════════════════════════
  // SOURCE 2: REVVADAS
  // ═══════════════════════════════════════════════════════════════════════
  const revvCalibrations = parseRevvCalibrations(revvData);
  console.log(`${LOG_TAG} RevvADAS recommends ${revvCalibrations.length} calibrations`);

  // ═══════════════════════════════════════════════════════════════════════
  // SOURCE 3: LLM ANALYSIS (with KB context)
  // ═══════════════════════════════════════════════════════════════════════
  const llmResult = await analyzeWithLLM(estimatePath, vehicleInfo, kbRules, revvCalibrations);
  console.log(`${LOG_TAG} LLM found ${llmResult.llm_calibrations?.length || 0} calibrations`);

  // ═══════════════════════════════════════════════════════════════════════
  // RECONCILE ALL THREE SOURCES
  // ═══════════════════════════════════════════════════════════════════════
  const reconciled = reconcileAllSources(kbRules, revvCalibrations, llmResult, vehicleInfo);

  return reconciled;
}

// ═══════════════════════════════════════════════════════════════════════════
// REVVADAS PARSING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse RevvADAS calibrations from report data
 * @param {object} revvData - RevvADAS data (can be object or text)
 * @returns {Array} - Parsed calibrations
 */
function parseRevvCalibrations(revvData) {
  if (!revvData) {
    return [];
  }

  // Handle string input (raw text from column J)
  if (typeof revvData === 'string') {
    return revvData
      .split(/[;,\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(name => ({
        name: name,
        type: name.toLowerCase().includes('dynamic') ? 'Dynamic' : 'Static',
        trigger: null,
        location: null,
        source: 'RevvADAS'
      }));
  }

  // Handle object input
  const operations = revvData.adas_operations ||
                     revvData.calibrations ||
                     revvData.required_calibrations ||
                     [];

  if (!Array.isArray(operations)) {
    return [];
  }

  return operations.map(op => ({
    name: op.name || op.system || op.calibration || 'Unknown',
    type: op.procedure_type || op.type || op.calibrationType || 'Static',
    trigger: op.trigger || null,
    location: op.location || null,
    source: 'RevvADAS'
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LLM Analysis with KB context
 * @param {string} estimatePath - Path to estimate file
 * @param {object} vehicleInfo - Vehicle details
 * @param {object} kbRules - Knowledge base rules
 * @param {Array} revvCalibrations - RevvADAS calibrations
 * @returns {Promise<object>} - LLM analysis result
 */
async function analyzeWithLLM(estimatePath, vehicleInfo, kbRules, revvCalibrations) {

  const imageBase64 = await getEstimateImage(estimatePath);

  if (!imageBase64) {
    console.error(`${LOG_TAG} Failed to get estimate image`);
    return { error: 'Could not process estimate image', llm_calibrations: [] };
  }

  const systemPrompt = buildSystemPrompt(kbRules);
  const userPrompt = buildUserPrompt(vehicleInfo, revvCalibrations);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 2500,
      temperature: 0.1
    });

    const content = response.choices[0].message.content;
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      parsed.tokens_used = response.usage?.total_tokens || 0;
      return parsed;
    }

    return { error: "Could not parse LLM response", raw: content, llm_calibrations: [] };

  } catch (error) {
    console.error(`${LOG_TAG} LLM Error:`, error.message);
    return { error: error.message, llm_calibrations: [] };
  }
}

/**
 * Build system prompt with KB context
 */
function buildSystemPrompt(kbRules) {
  return `You are an ADAS calibration expert. You have THREE jobs:

1. READ the estimate image and identify ACTUAL REPAIR OPERATIONS (not vehicle features)
2. APPLY the OEM knowledge base rules provided to determine calibrations
3. COMPARE your findings with RevvADAS recommendations (provided below)

## OEM KNOWLEDGE BASE FOR ${kbRules.brand.toUpperCase()}:

### Calibration Triggers:
${formatTriggers(kbRules.calibrationTriggers)}

### Calibration Types:
${formatMethods(kbRules.calibrationMethods)}

### Prerequisites:
${formatPrereqs(kbRules.prerequisites)}

### Known Quirks:
${kbRules.quirks?.map(q => '• ' + q).join('\n') || 'None documented'}

### Non-ADAS Items (ALWAYS EXCLUDE):
${kbRules.nonAdasItems?.join(', ') || 'SRS Unit, Seat Weight Sensor, TPMS, Battery Registration'}

## CRITICAL RULES:

1. Vehicle FEATURES ≠ Repairs. "BLIND SPOT DETECTION" in features list is NOT a repair.
2. Only flag calibrations triggered by ACTUAL REPAIR LINES (Replace, R&R, R&I, Repair)
3. Report what YOU find independently - don't just copy RevvADAS
4. If you disagree with RevvADAS, say so and explain why
5. Non-ADAS items (SRS, Seat Weight, TPMS) should be EXCLUDED regardless of what RevvADAS says

## OUTPUT FORMAT (JSON):
{
  "repair_operations": [
    { "line": 2, "operation": "Replace", "component": "RT Mirror base", "triggers_calibration": true }
  ],
  "llm_calibrations": [
    {
      "name": "Surround View Monitor Cameras",
      "type": "Dynamic",
      "triggered_by": "Line 2 - Mirror replacement",
      "confidence": "HIGH",
      "reasoning": "KB rule: side mirror replace triggers surround view calibration"
    }
  ],
  "revv_agreements": ["Surround View Monitor Cameras"],
  "revv_disagreements": [
    {
      "item": "SRS Unit",
      "revv_says": "Required",
      "llm_says": "Exclude",
      "reason": "Not an ADAS calibration - safety system reset"
    }
  ],
  "excluded_items": [
    { "name": "SRS Unit", "reason": "Non-ADAS - airbag system reset" },
    { "name": "Seat Weight Sensor", "reason": "Non-ADAS - occupant classification" }
  ]
}`;
}

/**
 * Build user prompt with vehicle info and RevvADAS data
 */
function buildUserPrompt(vehicleInfo, revvCalibrations) {
  return `Analyze this collision repair estimate.

VEHICLE: ${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}
VIN: ${vehicleInfo.vin || 'Not provided'}

REVVADAS RECOMMENDATIONS (for comparison):
${revvCalibrations.map(c => `• ${c.name} (${c.type})`).join('\n') || 'None provided'}

Instructions:
1. Look at the estimate image
2. Find the REPAIR LINES (ignore vehicle features list)
3. Apply the OEM knowledge base rules
4. Tell me what calibrations YOU think are required
5. Compare with RevvADAS - agree or disagree with reasoning
6. Exclude any non-ADAS items

Return your analysis as JSON.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILIATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reconcile all 3 sources and determine confidence levels
 * @param {object} kbRules - Knowledge base rules
 * @param {Array} revvCalibrations - RevvADAS calibrations
 * @param {object} llmResult - LLM analysis result
 * @param {object} vehicleInfo - Vehicle details
 * @returns {object} - Reconciled result
 */
function reconcileAllSources(kbRules, revvCalibrations, llmResult, vehicleInfo) {

  const result = {
    vehicle: vehicleInfo,
    calibrations: [],
    excluded: [],
    conflicts: [],
    summary: '',
    status: 'VERIFIED',
    sources: {
      knowledgeBase: kbRules.brand,
      revvCount: revvCalibrations.length,
      llmCount: llmResult.llm_calibrations?.length || 0
    }
  };

  // Collect all unique calibration names from all sources
  const allCalibrations = new Map();

  // Add RevvADAS calibrations
  for (const cal of revvCalibrations) {
    const key = normalizeCalName(cal.name);
    if (!allCalibrations.has(key)) {
      allCalibrations.set(key, {
        name: cal.name,
        type: cal.type,
        sources: [],
        excluded: false,
        excludeReason: null
      });
    }
    allCalibrations.get(key).sources.push('RevvADAS');
  }

  // Add LLM calibrations
  if (llmResult.llm_calibrations) {
    for (const cal of llmResult.llm_calibrations) {
      const key = normalizeCalName(cal.name);
      if (!allCalibrations.has(key)) {
        allCalibrations.set(key, {
          name: cal.name,
          type: cal.type,
          triggeredBy: cal.triggered_by,
          sources: [],
          excluded: false,
          excludeReason: null
        });
      }
      allCalibrations.get(key).sources.push('LLM');
      allCalibrations.get(key).triggeredBy = cal.triggered_by;
      allCalibrations.get(key).reasoning = cal.reasoning;
    }
  }

  // Check KB for additional triggers based on repair operations
  if (llmResult.repair_operations) {
    for (const repair of llmResult.repair_operations) {
      if (repair.triggers_calibration) {
        const kbCals = getKBCalibrationsForRepair(repair, kbRules);
        for (const cal of kbCals) {
          const key = normalizeCalName(cal.name);
          if (!allCalibrations.has(key)) {
            allCalibrations.set(key, {
              name: cal.name,
              type: cal.type,
              triggeredBy: `${repair.operation} ${repair.component}`,
              sources: [],
              excluded: false
            });
          }
          if (!allCalibrations.get(key).sources.includes('Knowledge Base')) {
            allCalibrations.get(key).sources.push('Knowledge Base');
          }
        }
      }
    }
  }

  // Mark excluded items
  const nonAdasItems = kbRules.nonAdasItems || [
    'SRS Unit', 'Seat Weight Sensor', 'TPMS', 'Battery Registration',
    'Occupant Classification', 'Tire Pressure Monitoring'
  ];

  for (const [key, cal] of allCalibrations) {
    // Check if this is a non-ADAS item
    const isNonAdas = nonAdasItems.some(item =>
      key.includes(normalizeCalName(item)) || normalizeCalName(item).includes(key)
    );

    if (isNonAdas) {
      cal.excluded = true;
      cal.excludeReason = 'Non-ADAS item - vehicle reset, not calibration';
    }

    // Check LLM exclusions
    if (llmResult.excluded_items) {
      const llmExcluded = llmResult.excluded_items.find(e =>
        normalizeCalName(e.name) === key
      );
      if (llmExcluded) {
        cal.excluded = true;
        cal.excludeReason = llmExcluded.reason;
      }
    }
  }

  // Build final lists with confidence levels
  for (const [key, cal] of allCalibrations) {
    if (cal.excluded) {
      result.excluded.push({
        name: cal.name,
        reason: cal.excludeReason,
        foundBy: cal.sources.join(', ')
      });
      continue;
    }

    // Determine confidence based on source agreement
    const sourceCount = cal.sources.length;
    let confidence, verificationText;

    if (sourceCount >= 3) {
      confidence = 'HIGH';
      verificationText = '✓ Verified by RevvADAS, LLM & Knowledge Base';
    } else if (sourceCount === 2) {
      confidence = 'HIGH';
      verificationText = `✓ Verified by ${cal.sources.join(' & ')}`;
    } else if (sourceCount === 1) {
      confidence = 'MEDIUM';
      verificationText = `⚠ Found by ${cal.sources[0]} only - Review recommended`;
      result.status = 'NEEDS_REVIEW';
    } else {
      confidence = 'LOW';
      verificationText = '⚠ Needs manual verification';
      result.status = 'NEEDS_REVIEW';
    }

    result.calibrations.push({
      name: cal.name,
      type: cal.type || 'Static',
      triggeredBy: cal.triggeredBy || null,
      confidence: confidence,
      sources: cal.sources,
      verificationText: verificationText,
      reasoning: cal.reasoning || null
    });
  }

  // Check for conflicts (LLM disagreed with RevvADAS)
  if (llmResult.revv_disagreements) {
    for (const disagreement of llmResult.revv_disagreements) {
      result.conflicts.push({
        item: disagreement.item,
        revvSays: disagreement.revv_says,
        llmSays: disagreement.llm_says,
        reason: disagreement.reason
      });
    }
  }

  // Build summary
  const highConf = result.calibrations.filter(c => c.confidence === 'HIGH').length;
  const needsReview = result.calibrations.filter(c => c.confidence !== 'HIGH').length;
  const excluded = result.excluded.length;

  result.summary = `${result.calibrations.length} calibrations identified. `;
  if (highConf > 0) result.summary += `${highConf} verified. `;
  if (needsReview > 0) result.summary += `${needsReview} need review. `;
  if (excluded > 0) result.summary += `${excluded} excluded (non-ADAS).`;

  result.scrubTimestamp = new Date().toISOString();

  return result;
}

/**
 * Get KB calibrations for a repair operation
 */
function getKBCalibrationsForRepair(repair, kbRules) {
  const cals = [];
  const componentLower = (repair.component || '').toLowerCase();

  for (const trigger of (kbRules.calibrationTriggers || [])) {
    if (componentLower.includes((trigger.component || '').toLowerCase())) {
      cals.push({
        name: trigger.calibration,
        type: trigger.type
      });
    }
  }

  return cals;
}

/**
 * Normalize calibration name for comparison
 */
function normalizeCalName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/calibration/gi, '')
    .replace(/\(static\)/gi, '')
    .replace(/\(dynamic\)/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatTriggers(triggers) {
  if (!triggers || triggers.length === 0) return "No specific triggers defined.";
  return triggers.slice(0, 15).map(t =>
    `• ${t.component} ${t.operation || ''} → ${t.calibration} (${t.type})`
  ).join('\n');
}

function formatMethods(methods) {
  if (!methods || Object.keys(methods).length === 0) return "Refer to OEM procedures.";
  return Object.entries(methods).slice(0, 10).map(([k, v]) => `• ${k}: ${v}`).join('\n');
}

function formatPrereqs(prereqs) {
  if (!prereqs) return "Check OEM requirements.";
  const lines = [];
  if (prereqs.alignment) lines.push(`• Alignment: ${prereqs.alignment}`);
  if (prereqs.rideHeight) lines.push(`• Ride Height: ${prereqs.rideHeight}`);
  if (prereqs.battery) lines.push(`• Battery: ${prereqs.battery}`);
  if (prereqs.criticalNotes?.length > 0) {
    lines.push('• Critical Notes:');
    prereqs.criticalNotes.slice(0, 3).forEach(n => lines.push(`  - ${n}`));
  }
  return lines.length > 0 ? lines.join('\n') : 'Standard pre-calibration checks.';
}

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE HANDLING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get estimate as base64 image
 */
async function getEstimateImage(input) {
  try {
    // Already base64 string
    if (typeof input === 'string' && !input.includes('/') && !input.includes('\\')) {
      if (input.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(input.substring(0, 100))) {
        return input;
      }
    }

    // File path
    if (typeof input === 'string') {
      const ext = path.extname(input).toLowerCase();

      if (ext === '.pdf') {
        try {
          const { convertPdfToImage } = await import('../utils/pdfToImage.js');
          return await convertPdfToImage(input);
        } catch (pdfError) {
          console.error(`${LOG_TAG} PDF conversion not available:`, pdfError.message);
          const pdfBuffer = fs.readFileSync(input);
          return pdfBuffer.toString('base64');
        }
      }

      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        const imageBuffer = fs.readFileSync(input);
        return imageBuffer.toString('base64');
      }
    }

    // Buffer
    if (Buffer.isBuffer(input)) {
      return input.toString('base64');
    }

    console.error(`${LOG_TAG} Unknown input type for estimate image`);
    return null;

  } catch (error) {
    console.error(`${LOG_TAG} Error getting estimate image:`, error.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT FORMATTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format scrub results for Notes column (short)
 * @param {object} result - Hybrid scrub result
 * @returns {string} - Short notes text
 */
export function formatScrubNotes(result) {
  if (!result) return 'No scrub data.';
  if (result.error) return `Error: ${result.error}`;

  const total = result.calibrations?.length || 0;
  const verified = result.calibrations?.filter(c => c.confidence === 'HIGH').length || 0;
  const review = result.calibrations?.filter(c => c.confidence !== 'HIGH').length || 0;
  const excluded = result.excluded?.length || 0;

  let note = `${total} calibrations`;
  if (verified > 0) note += `, ${verified} verified`;
  if (review > 0) note += `, ${review} need review`;
  if (excluded > 0) note += `. Excluded: ${result.excluded.map(e => e.name).join(', ')}`;

  return note;
}

/**
 * Format full scrub text for Column T / Sidebar
 * @param {object} result - Hybrid scrub result
 * @returns {string} - Full scrub text
 */
export function formatFullScrubText(result) {
  if (!result) return 'No scrub data available.';
  if (result.error) return `HYBRID SCRUB ERROR: ${result.error}`;

  let output = `═══════════════════════════════════════════\n`;
  output += `    HYBRID SCRUB ANALYSIS\n`;
  output += `═══════════════════════════════════════════\n`;
  output += `Vehicle: ${result.vehicle?.year || ''} ${result.vehicle?.make || ''} ${result.vehicle?.model || ''}\n`;
  output += `VIN: ${result.vehicle?.vin || 'Not provided'}\n`;
  output += `Status: ${result.status}\n`;
  output += `Scrubbed: ${result.scrubTimestamp || new Date().toISOString()}\n\n`;

  output += `─── SOURCES ───\n`;
  output += `Knowledge Base: ${result.sources?.knowledgeBase || 'N/A'}\n`;
  output += `RevvADAS Items: ${result.sources?.revvCount || 0}\n`;
  output += `LLM Items: ${result.sources?.llmCount || 0}\n\n`;

  output += `─── REQUIRED CALIBRATIONS (${result.calibrations?.length || 0}) ───\n`;
  if (result.calibrations && result.calibrations.length > 0) {
    for (const cal of result.calibrations) {
      output += `\n  ${cal.name} (${cal.type})\n`;
      output += `    Confidence: ${cal.confidence}\n`;
      output += `    Sources: ${cal.sources?.join(', ') || 'Unknown'}\n`;
      output += `    ${cal.verificationText}\n`;
      if (cal.triggeredBy) output += `    Triggered by: ${cal.triggeredBy}\n`;
      if (cal.reasoning) output += `    Reasoning: ${cal.reasoning}\n`;
    }
  } else {
    output += `  No calibrations required\n`;
  }

  if (result.excluded && result.excluded.length > 0) {
    output += `\n─── EXCLUDED (Non-ADAS) ───\n`;
    for (const item of result.excluded) {
      output += `  ✗ ${item.name}: ${item.reason}\n`;
    }
  }

  if (result.conflicts && result.conflicts.length > 0) {
    output += `\n─── CONFLICTS TO REVIEW ───\n`;
    for (const conflict of result.conflicts) {
      output += `  ⚠ ${conflict.item}\n`;
      output += `    RevvADAS says: ${conflict.revvSays}\n`;
      output += `    LLM says: ${conflict.llmSays}\n`;
      output += `    Reason: ${conflict.reason}\n`;
    }
  }

  output += `\n─── SUMMARY ───\n`;
  output += `${result.summary || 'No summary available'}\n`;

  output += `\n═══════════════════════════════════════════\n`;

  return output;
}

/**
 * Generate HTML for sidebar calibration cards with confidence styling
 * @param {object} result - Hybrid scrub result
 * @returns {string} - HTML string
 */
export function generateCalibrationCardsHTML(result) {
  if (!result || !result.calibrations) {
    return '<p>No calibrations identified.</p>';
  }

  let html = '';

  for (const cal of result.calibrations) {
    // Determine card style based on confidence
    let cardClass, icon;

    if (cal.confidence === 'HIGH') {
      cardClass = 'verified';
      icon = '✓';
    } else if (cal.confidence === 'MEDIUM') {
      cardClass = 'review';
      icon = '⚠';
    } else {
      cardClass = 'low-confidence';
      icon = '?';
    }

    html += `
      <div class="calibration-card ${cardClass}">
        <div class="cal-name">${escapeHtml(cal.name)}</div>
        <span class="cal-type">${escapeHtml(cal.type)}</span>
        <div class="cal-source">${icon} ${escapeHtml(cal.verificationText)}</div>
        ${cal.triggeredBy ? `<div class="cal-trigger">Trigger: ${escapeHtml(cal.triggeredBy)}</div>` : ''}
      </div>
    `;
  }

  // Show excluded items
  if (result.excluded && result.excluded.length > 0) {
    html += `<div class="section-divider">Excluded (Non-ADAS)</div>`;

    for (const item of result.excluded) {
      html += `
        <div class="calibration-card excluded">
          <div class="cal-name">${escapeHtml(item.name)}</div>
          <div class="cal-source">✗ ${escapeHtml(item.reason)}</div>
        </div>
      `;
    }
  }

  return html;
}

/**
 * Get CSS for calibration cards
 * @returns {string} - CSS string
 */
export function getCalibrationCardCSS() {
  return `
/* HIGH confidence - Green */
.calibration-card.verified {
  border-left: 4px solid #137333;
  background: #fff;
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.calibration-card.verified .cal-source {
  color: #137333;
  font-size: 12px;
  margin-top: 4px;
}

/* MEDIUM confidence - Yellow/Orange (needs review) */
.calibration-card.review {
  border-left: 4px solid #ea8600;
  background: #fff;
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.calibration-card.review .cal-name {
  color: #b45309;
}
.calibration-card.review .cal-source {
  color: #ea8600;
  font-size: 12px;
  margin-top: 4px;
}

/* LOW confidence */
.calibration-card.low-confidence {
  border-left: 4px solid #9ca3af;
  background: #f9fafb;
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 4px;
}

/* Excluded items - Gray with strikethrough */
.calibration-card.excluded {
  border-left: 4px solid #9ca3af;
  background: #f3f4f6;
  opacity: 0.7;
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 4px;
}
.calibration-card.excluded .cal-name {
  text-decoration: line-through;
  color: #6b7280;
}

.cal-name {
  font-weight: 600;
  font-size: 14px;
  color: #1f2937;
}

.cal-type {
  display: inline-block;
  background: #e5e7eb;
  color: #4b5563;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  margin-top: 4px;
}

.cal-trigger {
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
}

.section-divider {
  font-size: 12px;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 16px 0 8px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid #e5e7eb;
}
`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY - Original llmScrubEstimate function
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Original LLM-powered estimate scrub (for backward compatibility)
 * @param {string|Buffer} estimateInput - Path to estimate or buffer
 * @param {object} revvData - RevvADAS data
 * @param {object} vehicleInfo - Vehicle details
 * @param {object} options - Additional options
 * @returns {Promise<object>} - Scrub result
 */
export async function llmScrubEstimate(estimateInput, revvData, vehicleInfo = {}, options = {}) {
  console.log(`${LOG_TAG} Starting LLM scrub (legacy mode)...`);

  try {
    const imageBase64 = await getEstimateImage(estimateInput);

    if (!imageBase64) {
      console.error(`${LOG_TAG} Failed to get estimate image`);
      return {
        success: false,
        error: 'Could not process estimate image'
      };
    }

    const revvContext = formatRevvForPrompt(revvData);
    const userPrompt = buildLegacyUserPrompt(vehicleInfo, revvContext);

    console.log(`${LOG_TAG} Sending to GPT-4o Vision...`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: LEGACY_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 3000,
      temperature: 0.1
    });

    const content = response.choices[0].message.content;
    console.log(`${LOG_TAG} Received response from GPT-4o`);

    const parsed = parseJsonResponse(content);

    if (parsed) {
      console.log(`${LOG_TAG} Successfully parsed LLM response`);
      return {
        success: true,
        source: 'LLM_VISION',
        ...parsed,
        raw_response: content,
        tokens_used: response.usage?.total_tokens || 0
      };
    }

    console.error(`${LOG_TAG} Could not parse LLM response as JSON`);
    return {
      success: false,
      error: "Could not parse LLM response",
      raw_response: content
    };

  } catch (error) {
    console.error(`${LOG_TAG} Error:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

const LEGACY_SYSTEM_PROMPT = `You are an ADAS calibration expert analyzing collision repair estimates. Your job is to:

1. IDENTIFY ACTUAL REPAIR OPERATIONS from the estimate (Replace, R&R, R&I, Repair lines)
2. IGNORE the vehicle features/equipment list (these are NOT repairs - they just list what the vehicle HAS)
3. DETERMINE which ADAS calibrations are required based on the repair work
4. CROSS-REFERENCE with RevvADAS recommendations provided
5. FILTER OUT non-ADAS items like SRS Unit resets, Seat Weight Sensors, Tire Pressure resets

CRITICAL RULES:
- Only flag calibrations that are TRIGGERED by actual repair work in the estimate
- A vehicle HAVING blind spot detection doesn't mean it needs calibration
- Vehicle features/equipment lists show what the car HAS - NOT what needs calibration

NON-ADAS ITEMS TO EXCLUDE:
- SRS Unit / Airbag diagnostics
- Seat Weight Sensor / Occupant Classification
- TPMS reset
- Battery registration
- Key fob programming

OUTPUT FORMAT (JSON):
{
  "vehicle": { "year": "", "make": "", "model": "", "vin": "" },
  "repair_operations_found": [
    { "line_number": 2, "operation_type": "Replace", "component": "", "triggers_calibration": true }
  ],
  "required_calibrations": [
    { "name": "", "type": "Static", "triggered_by": "", "in_revv": true, "confidence": "HIGH", "notes": "" }
  ],
  "excluded_items": [{ "name": "", "reason": "" }],
  "revv_comparison": { "revv_total": 0, "matched": 0, "revv_only": 0, "estimate_only": 0 },
  "discrepancies": [],
  "status": "VERIFIED",
  "summary": ""
}`;

function buildLegacyUserPrompt(vehicleInfo, revvContext) {
  return `Analyze this collision repair estimate for ADAS calibration requirements.

VEHICLE INFO:
- VIN: ${vehicleInfo.vin || 'Not provided'}
- Year/Make/Model: ${vehicleInfo.year || ''} ${vehicleInfo.make || ''} ${vehicleInfo.model || ''}

REVVADAS RECOMMENDATIONS FOR THIS VEHICLE:
${revvContext}

Please analyze the estimate and determine:
1. What REPAIR OPERATIONS are in the estimate (look for Replace, R&R, R&I, Repair lines - NOT vehicle features)
2. Which ADAS calibrations are actually required based on those repairs
3. Cross-reference with RevvADAS - confirm their recommendations based on the repair work
4. Exclude any non-ADAS items (SRS, Seat Weight, TPMS, etc.)

IMPORTANT: The vehicle features/equipment section lists what the car HAS - this does NOT mean those items need calibration.

Return your analysis as JSON.`;
}

function formatRevvForPrompt(revvData) {
  if (!revvData) {
    return "No RevvADAS report available for this vehicle.";
  }

  if (typeof revvData === 'string') {
    return revvData || "No calibrations listed.";
  }

  const operations = revvData.adas_operations ||
                     revvData.calibrations ||
                     revvData.required_calibrations ||
                     [];

  if (operations.length === 0) {
    return "RevvADAS report found but no calibrations listed.";
  }

  let output = `RevvADAS identified ${operations.length} calibration(s):\n`;

  for (const op of operations) {
    const name = op.name || op.calibration || op.system || 'Unknown';
    const type = op.procedure_type || op.type || op.calibrationType || 'Static';
    output += `- ${name} (${type})\n`;
  }

  return output;
}

function parseJsonResponse(content) {
  try {
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    const rawJsonMatch = content.match(/\{[\s\S]*\}/);
    if (rawJsonMatch) {
      return JSON.parse(rawJsonMatch[0]);
    }
    return null;
  } catch (error) {
    console.error(`${LOG_TAG} JSON parse error:`, error.message);
    return null;
  }
}

/**
 * LLM scrub from text content (no image)
 */
export async function llmScrubFromText(estimateText, revvData, vehicleInfo = {}) {
  console.log(`${LOG_TAG} Starting LLM text scrub...`);

  try {
    const revvContext = formatRevvForPrompt(revvData);

    const textPrompt = `Analyze this collision repair estimate TEXT for ADAS calibration requirements.

VEHICLE INFO:
- VIN: ${vehicleInfo.vin || 'Not provided'}
- Year/Make/Model: ${vehicleInfo.year || ''} ${vehicleInfo.make || ''} ${vehicleInfo.model || ''}

REVVADAS RECOMMENDATIONS FOR THIS VEHICLE:
${revvContext}

ESTIMATE TEXT:
---
${(estimateText || '').substring(0, 8000)}
---

Please analyze and determine:
1. What REPAIR OPERATIONS are in the estimate (not vehicle features)
2. Which ADAS calibrations are actually required based on those repairs
3. Cross-reference with RevvADAS - confirm or dispute their recommendations
4. Exclude any non-ADAS items (SRS, Seat Weight, TPMS, etc.)

Return your analysis as JSON matching the specified format.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: LEGACY_SYSTEM_PROMPT },
        { role: "user", content: textPrompt }
      ],
      max_tokens: 3000,
      temperature: 0.1
    });

    const content = response.choices[0].message.content;
    const parsed = parseJsonResponse(content);

    if (parsed) {
      return {
        success: true,
        source: 'LLM_TEXT',
        ...parsed,
        raw_response: content
      };
    }

    return {
      success: false,
      error: "Could not parse LLM response",
      raw_response: content
    };

  } catch (error) {
    console.error(`${LOG_TAG} Text scrub error:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Format LLM scrub results for the notes column (Column S)
 */
export function formatLLMScrubAsNotes(scrubResult) {
  if (!scrubResult.success) {
    return `LLM Scrub failed: ${scrubResult.error}`;
  }

  const cals = scrubResult.required_calibrations || [];
  const excluded = scrubResult.excluded_items || [];
  const status = scrubResult.status || 'UNKNOWN';

  let note = `Revv: ${cals.length} calibration(s).`;

  if (excluded.length > 0) {
    const excludedNames = excluded.map(e => e.name).join(', ');
    note += ` Excluded: ${excludedNames}.`;
  }

  note += ` Status: ${status}.`;

  return note;
}

/**
 * Format LLM scrub results for the full scrub column (Column T)
 */
export function formatLLMScrubFull(scrubResult) {
  if (!scrubResult.success) {
    return `--- LLM SCRUB FAILED ---\nError: ${scrubResult.error}\n--- END ---`;
  }

  let output = `═══════════════════════════════════════════\n`;
  output += `    LLM ESTIMATE SCRUB REPORT\n`;
  output += `═══════════════════════════════════════════\n`;
  output += `Source: ${scrubResult.source || 'LLM'}\n`;
  output += `Status: ${scrubResult.status || 'UNKNOWN'}\n\n`;

  if (scrubResult.vehicle) {
    output += `─── VEHICLE ───\n`;
    output += `${scrubResult.vehicle.year || ''} ${scrubResult.vehicle.make || ''} ${scrubResult.vehicle.model || ''}\n`;
    output += `VIN: ${scrubResult.vehicle.vin || 'N/A'}\n\n`;
  }

  const repairs = scrubResult.repair_operations_found || [];
  output += `─── REPAIR OPERATIONS FOUND (${repairs.length}) ───\n`;
  if (repairs.length === 0) {
    output += `  No repair operations identified\n`;
  } else {
    for (const op of repairs) {
      output += `  Line ${op.line_number || '?'}: ${op.operation_type || ''} ${op.component || ''}\n`;
      if (op.triggers_calibration) {
        output += `    → Triggers: ${op.calibration_triggered || 'Calibration needed'}\n`;
      }
    }
  }
  output += '\n';

  const cals = scrubResult.required_calibrations || [];
  output += `─── REQUIRED CALIBRATIONS (${cals.length}) ───\n`;
  if (cals.length === 0) {
    output += `  No calibrations required\n`;
  } else {
    for (const cal of cals) {
      const inRevv = cal.in_revv ? '✓ In RevvADAS' : '⚠ Not in RevvADAS';
      output += `  ✓ ${cal.name} (${cal.type || 'Static'})\n`;
      output += `    Triggered by: ${cal.triggered_by || 'N/A'}\n`;
      output += `    ${inRevv} | Confidence: ${cal.confidence || 'MEDIUM'}\n`;
      if (cal.notes) {
        output += `    Note: ${cal.notes}\n`;
      }
    }
  }
  output += '\n';

  const excluded = scrubResult.excluded_items || [];
  if (excluded.length > 0) {
    output += `─── EXCLUDED (Non-ADAS) ───\n`;
    for (const item of excluded) {
      output += `  ✗ ${item.name}\n`;
      output += `    Reason: ${item.reason}\n`;
    }
    output += '\n';
  }

  if (scrubResult.revv_comparison) {
    const rc = scrubResult.revv_comparison;
    output += `─── REVV COMPARISON ───\n`;
    output += `  RevvADAS Total: ${rc.revv_total || 0}\n`;
    output += `  Matched: ${rc.matched || 0}\n`;
    output += `  Revv-only: ${rc.revv_only || 0}\n`;
    output += `  Estimate-only: ${rc.estimate_only || 0}\n\n`;
  }

  output += `─── SUMMARY ───\n`;
  output += `${scrubResult.summary || 'No summary available'}\n`;

  output += `\n═══════════════════════════════════════════\n`;

  return output;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  // NEW Hybrid Scrub (Recommended)
  hybridScrubEstimate,
  formatScrubNotes,
  formatFullScrubText,
  generateCalibrationCardsHTML,
  getCalibrationCardCSS,

  // Legacy compatibility
  llmScrubEstimate,
  llmScrubFromText,
  formatLLMScrubAsNotes,
  formatLLMScrubFull
};
