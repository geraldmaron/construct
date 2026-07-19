/**
 * lib/hooks/_lib/specialist-agent.mjs — Detect whether a Construct specialist
 * sub-agent is currently active.
 *
 * A specialist is "active" when one of:
 *   - process.env.CONSTRUCT_AGENT_ID is set (explicit fence dispatch)
 *   - ~/.construct/last-agent-<id>.json or ~/.construct/last-agent.json carries a
 *     timestamp inside the 10-minute fence window (mirrors guard-bash.mjs)
 *
 * Differentiates "subagent driving the session, hold the line" from "main
 * session (likely a human), warn but allow".
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FENCE_WINDOW_MS = 10 * 60 * 1000;

export function isSpecialistAgentActive({ now = Date.now, home = homedir, env = process.env } = {}) {
  if (env.CONSTRUCT_AGENT_ID) return true;
  try {
    const constructDir = join(home(), '.construct');
    const id = String(env.CONSTRUCT_AGENT_ID || '').replace(/^cx-/, '');
    const candidates = [];
    if (id) candidates.push(join(constructDir, `last-agent-${id.replace(/[^a-z0-9._-]/gi, '_')}.json`));
    candidates.push(join(constructDir, 'last-agent.json'));
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const data = JSON.parse(readFileSync(path, 'utf8'));
      const lastTs = data?.ts ? Date.parse(data.ts) : 0;
      if (lastTs && (now() - lastTs) < FENCE_WINDOW_MS) return true;
    }
  } catch { /* tracker missing or unreadable — treat as no agent active */ }
  return false;
}
