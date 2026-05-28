/**
 * lib/telemetry/skill-calls.mjs — measure which skill files actually get loaded.
 *
 * Appends one JSON line per skill load to ~/.cx/skill-calls.jsonl so a future
 * `construct skills:audit` can answer two questions: which skills have no
 * load events in a 30-day window (pruning candidates), and which skills
 * receive load events from many sources (hot paths). Without this signal
 * the 131-file skills tree grows without a pruning gate.
 *
 * Disable with `CONSTRUCT_SKILL_TELEMETRY=off` for users who don't want the
 * append-only log. Errors here are non-fatal — telemetry must never break the
 * skill load it is observing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  const entry = {
    ts: new Date().toISOString(),
    skillId: event.skillId,
    source: event.source,
    ...(event.callerContext ? { callerContext: event.callerContext } : {}),
  };

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Append-only telemetry; if the user's home dir is unwritable we silently
    // skip rather than break the skill load that triggered us.
  }
}

/**
 * Read every event from a skill-calls log and roll it up into per-skill stats:
 * load count, distinct sources, most-recent timestamp.
 */
export function summarizeSkillCalls({ logPath = DEFAULT_LOG_PATH } = {}) {
  if (!fs.existsSync(logPath)) return { totalEvents: 0, skills: {} };
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const skills = {};
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry?.skillId) continue;
    const slot = skills[entry.skillId] ||= { calls: 0, sources: new Set(), lastCalledAt: null };
    slot.calls += 1;
    if (entry.source) slot.sources.add(entry.source);
    if (entry.ts && (!slot.lastCalledAt || entry.ts > slot.lastCalledAt)) {
      slot.lastCalledAt = entry.ts;
    }
  }
  const result = {};
  for (const [id, slot] of Object.entries(skills)) {
    result[id] = { calls: slot.calls, sources: [...slot.sources].sort(), lastCalledAt: slot.lastCalledAt };
  }
  return { totalEvents: lines.length, skills: result };
}
