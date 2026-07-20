/**
 * lib/doctor/watchers/cost.mjs — daily token-spend monitor.
 *
 * Reads the cost ledger and the existing ~/.construct/session-cost.jsonl. Audit-logs
 * the daily totals so the user has a visible trend; warns when any Worker Profile
 * hits 80% of its daily cap. Hard-stop enforcement lives in the gateway —
 * the watcher's role is visibility, not enforcement.
 *
 * Tick: 10 min.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { record } from '../audit.mjs';
import { doctorRoot } from '../../config/xdg.mjs';
import {
  getTotalDailySpend,
  getDailySpend,
  workerProfileBudget,
  totalBudget,
  dayKey,
  recordSpend,
} from '../../cost-ledger.mjs';

export const name = 'cost';
export const intervalMs = 10 * 60 * 1000;

const SESSION_COST_PATH = join(doctorRoot(), 'session-cost.jsonl');
const STATE_PATH = join(doctorRoot(), 'cost-watcher-state.json');

function loadState() {
  if (!existsSync(STATE_PATH)) return { lastIngestedTsMs: 0 };
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return { lastIngestedTsMs: 0 }; }
}
function saveState(state) {
  const dir = doctorRoot();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state));
}

function ingestSessionCosts() {
  if (!existsSync(SESSION_COST_PATH)) return { ingested: 0, sources: {} };
  const lines = readFileSync(SESSION_COST_PATH, 'utf8').split('\n').filter(Boolean);
  if (lines.length === 0) return { ingested: 0, sources: {} };
  const state = loadState();
  const cutoffMs = state.lastIngestedTsMs || 0;
  let ingested = 0;
  let maxTsMs = cutoffMs;
  const sources = {};
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const tsMs = entry.ts ? Date.parse(entry.ts) : 0;
    if (!Number.isFinite(tsMs) || tsMs <= cutoffMs) continue;
    const tokens = (entry.total_tokens) || ((entry.input_tokens || 0) + (entry.output_tokens || 0)) || (entry.tokens?.input || 0) + (entry.tokens?.output || 0);
    const costUsd = entry.cost_usd ?? entry.costUsd ?? entry.cost ?? 0;
    const rawAgent = entry.agent || entry.workerProfileId || 'unknown';
    const workerProfileId = String(rawAgent).replace(/^cx-/, '');
    const source = entry.cost_source || 'unknown';
    if (tokens > 0 || costUsd > 0) {
      recordSpend({ workerProfileId, tokens, costUsd, sessionId: entry.task_key || entry.sessionId || '', ts: tsMs });
      ingested++;
      sources[source] = (sources[source] || 0) + 1;
    }
    if (tsMs > maxTsMs) maxTsMs = tsMs;
  }
  if (maxTsMs > cutoffMs) saveState({ lastIngestedTsMs: maxTsMs });
  return { ingested, sources };
}

export async function tick() {
  const actions = [];
  const notes = [];

  const ingestResult = ingestSessionCosts();
  if (ingestResult.ingested > 0) {
    actions.push({ type: 'ledger-sync', count: ingestResult.ingested, sources: ingestResult.sources });
    const sourcesStr = Object.entries(ingestResult.sources).map(([s, n]) => `${s}=${n}`).join(', ');
    record({
      kind: 'action',
      watcher: name,
      action: 'ledger-sync',
      target: 'session-cost.jsonl',
      summary: `ingested ${ingestResult.ingested} entries — sources: ${sourcesStr}`,
      context: ingestResult,
    });
  }

  const total = getTotalDailySpend();
  const totalCap = totalBudget();
  notes.push({ dayKey: dayKey(), totalSpentUsd: total.costUsd, totalCap, invocations: total.invocations, sources: ingestResult.sources });

  record({
    kind: 'sample',
    watcher: name,
    summary: `${dayKey()} total: $${total.costUsd.toFixed(4)} / $${totalCap.toFixed(2)} (${total.invocations} invocations)`,
    context: { total, totalCap, ingestedFromSessionCost: ingestResult.ingested, sources: ingestResult.sources },
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
  for (const workerProfileId of onboarded) {
    const spend = getDailySpend({ workerProfileId });
    const cap = workerProfileBudget(workerProfileId);
    if (cap > 0 && spend.costUsd / cap >= warnAt) {
      record({
        kind: 'warn',
        watcher: name,
        action: 'budget-warning',
        target: `${workerProfileId}`,
        summary: `${workerProfileId} at ${Math.round((spend.costUsd / cap) * 100)}% of $${cap.toFixed(2)} daily cap`,
        context: { spend, cap },
      });
    }
  }

  return { actions, escalations: [], notes };
}
