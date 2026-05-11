/**
 * lib/doctor/watchers/cost.mjs — daily token-spend monitor.
 *
 * Reads the cost ledger and the existing ~/.cx/session-cost.jsonl. Audit-logs
 * the daily totals so the user has a visible trend; warns when any persona
 * hits 80% of its daily cap. Hard-stop enforcement lives in the gateway —
 * this watcher is for visibility, not enforcement.
 *
 * Tick: 10 min.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { record } from '../audit.mjs';
import {
  getTotalDailySpend,
  getDailySpend,
  personaBudget,
  totalBudget,
  dayKey,
  recordSpend,
} from '../../cost-ledger.mjs';

export const name = 'cost';
export const intervalMs = 10 * 60 * 1000;

const SESSION_COST_PATH = join(homedir(), '.cx', 'session-cost.jsonl');
let lastSeenLineCount = 0;

function ingestSessionCosts() {
  if (!existsSync(SESSION_COST_PATH)) return 0;
  const lines = readFileSync(SESSION_COST_PATH, 'utf8').split('\n').filter(Boolean);
  if (lines.length <= lastSeenLineCount) return 0;
  let ingested = 0;
  for (let i = lastSeenLineCount; i < lines.length; i++) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    const tokens = (entry.total_tokens) || ((entry.input_tokens || 0) + (entry.output_tokens || 0)) || (entry.tokens?.input || 0) + (entry.tokens?.output || 0);
    const costUsd = entry.cost_usd ?? entry.costUsd ?? entry.cost ?? 0;
    const rawAgent = entry.agent || entry.persona || entry.personaId || 'unknown';
    const personaId = String(rawAgent).replace(/^cx-/, '');
    if (tokens > 0 || costUsd > 0) {
      recordSpend({ personaId, tokens, costUsd, sessionId: entry.task_key || entry.sessionId || '' });
      ingested++;
    }
  }
  lastSeenLineCount = lines.length;
  return ingested;
}

export async function tick() {
  const actions = [];
  const notes = [];

  const ingested = ingestSessionCosts();
  if (ingested > 0) {
    actions.push({ type: 'ledger-sync', count: ingested });
  }

  const total = getTotalDailySpend();
  const totalCap = totalBudget();
  notes.push({ dayKey: dayKey(), totalSpentUsd: total.costUsd, totalCap, invocations: total.invocations });

  record({
    kind: 'sample',
    watcher: name,
    summary: `${dayKey()} total: $${total.costUsd.toFixed(4)} / $${totalCap.toFixed(2)} (${total.invocations} invocations)`,
    context: { total, totalCap, ingestedFromSessionCost: ingested },
  });

  const warnAt = 0.8;
  if (totalCap > 0 && total.costUsd / totalCap >= warnAt) {
    record({
      kind: 'warn',
      watcher: name,
      action: 'budget-warning',
      target: 'total',
      summary: `Daily total spend at ${Math.round((total.costUsd / totalCap) * 100)}% of $${totalCap.toFixed(2)} cap`,
      context: { total, totalCap },
    });
  }

  const onboarded = ['sre', 'qa', 'security', 'docs-keeper'];
  for (const personaId of onboarded) {
    const spend = getDailySpend({ personaId });
    const cap = personaBudget(personaId);
    if (cap > 0 && spend.costUsd / cap >= warnAt) {
      record({
        kind: 'warn',
        watcher: name,
        action: 'budget-warning',
        target: `cx-${personaId}`,
        summary: `cx-${personaId} at ${Math.round((spend.costUsd / cap) * 100)}% of $${cap.toFixed(2)} daily cap`,
        context: { spend, cap },
      });
    }
  }

  return { actions, escalations: [], notes };
}
