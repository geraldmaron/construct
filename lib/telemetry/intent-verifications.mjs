/**
 * lib/telemetry/intent-verifications.mjs — offline log of LLM-vs-keyword
 * routing agreement.
 *
 * Each entry pins the keyword classifier's verdict alongside the fast-tier
 * LLM's verdict so disagreements can be analyzed without gating dispatch
 * on the LLM round-trip. A future tuning pass can replay this log to find
 * flavors with low LLM agreement (candidates for keyword rewording or a
 * confidence-thresholded re-introduction of inline verification).
 *
 * Disable with `CONSTRUCT_INTENT_VERIFY=off` to skip the background call
 * entirely; the dispatch path itself is unaffected either way.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendBounded } from '../logging/rotate.mjs';
import { resolveProjectScopedPath } from '../project-root.mjs';

// intent-verifications are PROJECT-SCOPED — a verification belongs to a
// specific routing decision in a specific project. DEFAULT_LOG_PATH stays
// at the legacy user-scope location for back-compat with readers that
// imported the constant; the writer below resolves per-call so each
// invocation lands in the project's .cx/ when one is detected.

export const DEFAULT_LOG_PATH = path.join(os.homedir(), '.cx', 'intent-verifications.jsonl');

/**
 * Fire-and-forget append of one verification event.
 *
 * @param {object} event
 * @param {string} event.request — the user request that hit the classifier
 * @param {string} event.specialist — cx-* slug the keyword classifier picked
 * @param {string} event.flavor — flavor the keyword classifier matched
 * @param {boolean} event.keywordVerdict — always true at the call site (the
 *   classifier matched; this is the baseline we're comparing against)
 * @param {boolean} event.llmVerdict — what the LLM judge returned
 * @param {boolean} event.agreed — convenience: keywordVerdict === llmVerdict
 * @param {number} event.confidence — 0-1 from the LLM judge
 * @param {string} event.reason — LLM's one-sentence justification
 * @param {string} event.source — 'llm' | 'cache' | 'fallback' | 'disabled' | 'no-flavor'
 * @param {number} event.latencyMs — wall-clock of the LLM call
 * @param {object} [opts]
 * @param {string} [opts.logPath]
 */
export function logIntentVerification(event, opts = {}) {
  if (!event) return;
  // Resolve per-call: callers that explicitly pass opts.logPath win;
  // otherwise prefer the project-scoped path when cwd is inside a
  // Construct project, falling back to DEFAULT_LOG_PATH (~/.cx) outside.

  const logPath = opts.logPath
    || resolveProjectScopedPath('intent-verifications.jsonl', { ensureDir: false });
  const entry = {
    ts: new Date().toISOString(),
    requestExcerpt: String(event.request || '').slice(0, 200),
    specialist: event.specialist,
    flavor: event.flavor,
    keywordVerdict: event.keywordVerdict !== false,
    llmVerdict: Boolean(event.llmVerdict),
    agreed: event.agreed === undefined
      ? (event.keywordVerdict !== false) === Boolean(event.llmVerdict)
      : Boolean(event.agreed),
    confidence: typeof event.confidence === 'number' ? event.confidence : null,
    reason: String(event.reason || '').slice(0, 240),
    source: event.source || 'unknown',
    latencyMs: typeof event.latencyMs === 'number' ? event.latencyMs : null,
  };

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    appendBounded('intent-verifications', logPath, JSON.stringify(entry) + '\n');
  } catch {
    // Telemetry must never throw — the routing path doesn't await anyway.
  }
}

/**
 * Aggregate a verifications log into agreement stats per (specialist, flavor).
 * Useful for the audit CLI and tests.
 */
export function summarizeIntentVerifications({ logPath = DEFAULT_LOG_PATH } = {}) {
  if (!fs.existsSync(logPath)) return { totalEvents: 0, byFlavor: {} };
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const byFlavor = {};
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry?.specialist || !entry?.flavor) continue;
    const key = `${entry.specialist}/${entry.flavor}`;
    const slot = byFlavor[key] ||= { matches: 0, agreed: 0, disagreed: 0, lastSeen: null };
    slot.matches += 1;
    if (entry.agreed) slot.agreed += 1;
    else slot.disagreed += 1;
    if (entry.ts && (!slot.lastSeen || entry.ts > slot.lastSeen)) slot.lastSeen = entry.ts;
  }
  return { totalEvents: lines.length, byFlavor };
}
