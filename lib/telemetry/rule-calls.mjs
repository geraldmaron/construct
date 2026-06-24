/**
 * lib/telemetry/rule-calls.mjs — record when a rule path is referenced at runtime.
 *
 * Mirrors hook-calls telemetry: append-only JSONL at <doctorRoot>/rule-calls.jsonl.
 * Consumed by `construct rules usage` for consolidation decisions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { appendBounded } from '../logging/rotate.mjs';
import { doctorRoot } from '../config/xdg.mjs';

export const DEFAULT_LOG_PATH = path.join(doctorRoot(), 'rule-calls.jsonl');

/**
 * @param {object} event
 * @param {string} event.rulePath — e.g. rules/common/no-fabrication.md
 * @param {string} event.source — mcp | hook | prompt-composer | validation | other
 * @param {string} [event.callerContext]
 */
export function logRuleCall(event, { logPath = DEFAULT_LOG_PATH, env = process.env } = {}) {
  if (env.CONSTRUCT_RULE_TELEMETRY === 'off') return;
  const entry = {
    ts: new Date().toISOString(),
    rulePath: event.rulePath,
    source: event.source || 'other',
    callerContext: event.callerContext || null,
  };
  try {
    appendBounded('rule-calls', logPath, `${JSON.stringify(entry)}\n`);
  } catch {
    /* non-fatal */
  }
}

export function summarizeRuleCalls({ logPath = DEFAULT_LOG_PATH, since = '30d' } = {}) {
  if (!fs.existsSync(logPath)) return { rules: {}, total: 0 };
  const ms = since.endsWith('d') ? parseInt(since, 10) * 86400000 : 30 * 86400000;
  const cutoff = Date.now() - ms;
  const rules = {};
  let total = 0;
  for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (Date.parse(row.ts) < cutoff) continue;
      total += 1;
      rules[row.rulePath] = (rules[row.rulePath] || 0) + 1;
    } catch { /* skip */ }
  }
  return { rules, total, since };
}
