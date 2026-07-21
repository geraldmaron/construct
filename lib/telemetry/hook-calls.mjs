/**
 * lib/telemetry/hook-calls.mjs — measure which hooks fire and which actually block.
 *
 * Hooks carry @p95ms latency budgets but no record of how often each one fires or
 * blocks, so a hook that gates real mistakes and one that has never fired once look
 * identical. The central dispatcher (`construct hook <name>`) appends one JSON line
 * per invocation to ~/.construct/hook-calls.jsonl with the hook id, the outcome derived
 * from its exit code, and latency, so `construct hooks:usage` can answer which hooks
 * earn their keep before any are consolidated.
 *
 * Outcome is what the dispatcher can observe centrally: exit 0 = ok, exit 2 = blocked
 * (the Claude Code convention for a refused tool call — see block-no-verify), any
 * other non-zero = error. A hook that mutates state without blocking reads as `ok`
 * here; per-hook mutation reporting is a separate, opt-in signal.
 *
 * Disable with CONSTRUCT_HOOK_TELEMETRY=off. Errors here are non-fatal — telemetry
 * must never change a hook's exit code or add a failure mode to the hot path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { appendBounded } from '../logging/rotate.mjs';
import { resolveProjectScope } from '../project-root.mjs';
import { constructDir } from '../paths.mjs';

// constructDir() (not os.homedir()) so the test home override isolates the log and the
// path stays consistent with the rest of ~/.construct. Resolved per-call so an override
// set after import still takes effect.

export function defaultLogPath() {
  return path.join(constructDir(), 'hook-calls.jsonl');
}

// Exit-code → outcome, using the Claude Code hook convention (2 = block a tool
// call). Anything else non-zero is a hook that errored rather than deliberately
// gated, which is itself a value signal (a hook erroring every fire is noise).

export function outcomeFromExit(code) {
  if (code === 0 || code == null) return 'ok';
  if (code === 2) return 'blocked';
  return 'error';
}

/**
 * Fire-and-forget log of one hook invocation.
 *
 * @param {object} event
 * @param {string} event.hookId — the hook name, e.g. "block-no-verify"
 * @param {number} [event.exitCode] — the hook's process exit code
 * @param {'ok'|'blocked'|'error'} [event.outcome] — derived from exitCode if omitted
 * @param {number} [event.latencyMs]
 * @param {object} [opts]
 * @param {string} [opts.logPath]
 * @param {NodeJS.ProcessEnv} [opts.env]
 */
export function logHookCall(event, opts = {}) {
  const env = opts.env || process.env;
  if (env.CONSTRUCT_HOOK_TELEMETRY === 'off') return;
  if (!event || !event.hookId) return;

  const logPath = opts.logPath || defaultLogPath();
  const outcome = event.outcome || outcomeFromExit(event.exitCode);
  const scope = resolveProjectScope();
  const entry = {
    ts: new Date().toISOString(),
    hookId: event.hookId,
    outcome,
    ...(event.exitCode != null ? { exitCode: event.exitCode } : {}),
    ...(scope?.projectId ? { projectId: scope.projectId } : {}),
    ...(event.latencyMs != null ? { latencyMs: event.latencyMs } : {}),
  };

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    appendBounded('hook-calls', logPath, JSON.stringify(entry) + '\n');
  } catch {
    // Append-only telemetry; an unwritable home dir is a silent skip rather than
    // a new failure mode on the hook that triggered the call.
  }
}

/**
 * Roll a hook-calls log up into per-hook stats: fire count, blocked/error counts,
 * most-recent timestamp, latency percentiles. A hook with calls but zero blocks/
 * errors over a long window is a pure observer — a demotion candidate.
 */
export function summarizeHookCalls({ logPath = defaultLogPath(), since } = {}) {
  if (!fs.existsSync(logPath)) return { totalEvents: 0, hooks: {} };
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const sinceTs = since ? _parseSince(since) : null;
  const hooks = {};
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry?.hookId) continue;
    if (sinceTs && entry.ts && entry.ts < sinceTs) continue;
    const slot = hooks[entry.hookId] ||= { calls: 0, blocked: 0, errors: 0, latencies: [], lastCalledAt: null };
    slot.calls += 1;
    if (entry.outcome === 'blocked') slot.blocked += 1;
    if (entry.outcome === 'error') slot.errors += 1;
    if (entry.latencyMs != null) slot.latencies.push(entry.latencyMs);
    if (entry.ts && (!slot.lastCalledAt || entry.ts > slot.lastCalledAt)) slot.lastCalledAt = entry.ts;
  }
  const result = {};
  for (const [id, slot] of Object.entries(hooks)) {
    result[id] = {
      calls: slot.calls,
      blocked: slot.blocked,
      errors: slot.errors,
      lastCalledAt: slot.lastCalledAt,
      ...(slot.latencies.length ? _latencyStats(slot.latencies) : {}),
    };
  }
  return { totalEvents: lines.length, hooks: result };
}

/**
 * Hooks with zero fire events in the window — they cost a settings entry and a
 * spawn budget but have never run, so they are consolidation candidates.
 */
export function findIdleHooks({ logPath = defaultLogPath(), since = '30d', allHookIds = [] } = {}) {
  const { hooks } = summarizeHookCalls({ logPath, since });
  const active = new Set(Object.keys(hooks));
  return allHookIds.filter((id) => !active.has(id));
}

function _parseSince(since) {
  const m = String(since).match(/^(\d+)(d|h|m)$/);
  if (!m) return null;
  const ms = parseInt(m[1], 10) * ({ d: 86400000, h: 3600000, m: 60000 }[m[2]]);
  return new Date(Date.now() - ms).toISOString();
}

function _latencyStats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const p = (pct) => sorted[Math.floor((pct / 100) * (sorted.length - 1))];
  return { p50LatencyMs: p(50), p95LatencyMs: p(95) };
}
