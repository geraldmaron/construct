/**
 * lib/telemetry/skill-calls.mjs — measure which skill files actually get loaded.
 *
 * Appends one JSON line per skill load to ~/.cx/skill-calls.jsonl so
 * `construct skills usage/orphans/hot/correlate-quality` can answer:
 * which skills have no load events in a 30-day window (pruning candidates),
 * which skills are loaded from many agents (hot paths), and which skills
 * correlate with high-quality sessions.
 *
 * Extended payload (Workstream H): latencyMs, agentId, sessionId, tokensReturned
 * are all optional and backward-compatible with earlier log files.
 *
 * Disable with `CONSTRUCT_SKILL_TELEMETRY=off`.
 * Errors here are non-fatal — telemetry must never break the skill load.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendBounded } from '../logging/rotate.mjs';
import { resolveProjectScope } from '../project-root.mjs';

// Skill calls are CROSS-PROJECT telemetry — a single log lets you see which
// skills load hot across every project the user has run Construct in. Stays
// at user scope; each entry is tagged with `projectId` so a reader can
// attribute usage to a specific project without losing the global view.

export const DEFAULT_LOG_PATH = path.join(os.homedir(), '.cx', 'skill-calls.jsonl');

/**
 * Fire-and-forget log of a skill load event.
 *
 * @param {object} event
 * @param {string} event.skillId — path-relative-to-skills/ without the .md, e.g. "roles/engineer.platform"
 * @param {'mcp'|'prompt-composer'|'role-preload'|'pattern-promotion'|'validation'|'other'} event.source
 * @param {string} [event.callerContext] — optional free-form context (agent name, MCP client id, etc.)
 * @param {object} [opts]
 * @param {string} [opts.logPath] — override the default log path (tests pass a tmpdir)
 * @param {NodeJS.ProcessEnv} [opts.env] — override env for the disable check (tests)
 */
export function logSkillCall(event, opts = {}) {
  const env = opts.env || process.env;
  if (env.CONSTRUCT_SKILL_TELEMETRY === 'off') return;
  if (!event || !event.skillId || !event.source) return;

  const logPath = opts.logPath || DEFAULT_LOG_PATH;
  const scope = resolveProjectScope();
  const entry = {
    ts: new Date().toISOString(),
    skillId: event.skillId,
    source: event.source,
    ...(scope?.projectId ? { projectId: scope.projectId } : {}),
    ...(event.callerContext ? { callerContext: event.callerContext } : {}),
    ...(event.latencyMs != null ? { latencyMs: event.latencyMs } : {}),
    ...(event.agentId ? { agentId: event.agentId } : {}),
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.tokensReturned != null ? { tokensReturned: event.tokensReturned } : {}),
  };

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    appendBounded('skill-calls', logPath, JSON.stringify(entry) + '\n');
  } catch {
    // Append-only telemetry; an unwritable home dir is a silent skip
    // rather than a break on the skill load that triggered the call.
  }
}

/**
 * Read every event from a skill-calls log and roll it up into per-skill stats:
 * load count, distinct sources, most-recent timestamp, latency percentiles,
 * distinct agents, distinct sessions.
 */
export function summarizeSkillCalls({ logPath = DEFAULT_LOG_PATH, since, agentId: filterAgent, source: filterSource } = {}) {
  if (!fs.existsSync(logPath)) return { totalEvents: 0, skills: {} };
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const sinceTs = since ? _parseSince(since) : null;
  const skills = {};
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry?.skillId) continue;
    if (sinceTs && entry.ts && entry.ts < sinceTs) continue;
    if (filterAgent && entry.agentId !== filterAgent) continue;
    if (filterSource && entry.source !== filterSource) continue;
    const slot = skills[entry.skillId] ||= {
      calls: 0,
      sources: new Set(),
      agents: new Set(),
      sessions: new Set(),
      latencies: [],
      lastCalledAt: null,
    };
    slot.calls += 1;
    if (entry.source) slot.sources.add(entry.source);
    if (entry.agentId) slot.agents.add(entry.agentId);
    if (entry.sessionId) slot.sessions.add(entry.sessionId);
    if (entry.latencyMs != null) slot.latencies.push(entry.latencyMs);
    if (entry.ts && (!slot.lastCalledAt || entry.ts > slot.lastCalledAt)) {
      slot.lastCalledAt = entry.ts;
    }
  }
  const result = {};
  for (const [id, slot] of Object.entries(skills)) {
    result[id] = {
      calls: slot.calls,
      sources: [...slot.sources].sort(),
      agents: [...slot.agents].sort(),
      sessions: slot.sessions.size,
      lastCalledAt: slot.lastCalledAt,
      ...(slot.latencies.length ? _latencyStats(slot.latencies) : {}),
    };
  }
  return { totalEvents: lines.length, skills: result };
}

/**
 * Return skills that have zero load events in the given window — pruning candidates.
 */
export function findOrphanSkills({ logPath = DEFAULT_LOG_PATH, since = '30d', allSkillIds = [] } = {}) {
  const { skills } = summarizeSkillCalls({ logPath, since });
  const active = new Set(Object.keys(skills));
  return allSkillIds.filter(id => !active.has(id));
}

/**
 * Return the top-K hottest skills by call count in the window.
 */
export function hotSkills({ logPath = DEFAULT_LOG_PATH, since = '30d', limit = 20 } = {}) {
  const { skills } = summarizeSkillCalls({ logPath, since });
  return Object.entries(skills)
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, limit)
    .map(([id, stats]) => ({ skillId: id, ...stats }));
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
