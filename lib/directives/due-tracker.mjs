/**
 * lib/directives/due-tracker.mjs — per-directive last-run bookkeeping.
 *
 * A directive's cadence lives in project config (committed, shared across
 * machines); when it last actually fired is machine-local run state, so it
 * belongs under the state root (~/.construct/projects/<key>/) like
 * source-watch state and orchestration runs, never under the project tree.
 */

import fs from 'node:fs';

import { resolveStatePath } from '../state-root.mjs';

function statePath(projectRoot, directiveId) {
  return resolveStatePath(projectRoot, 'directives', `${directiveId}.state.json`);
}

/**
 * @param {string} projectRoot
 * @param {string} directiveId
 * @returns {{ lastRunAt: string|null }}
 */
export function readDirectiveState(projectRoot, directiveId) {
  try {
    const raw = fs.readFileSync(statePath(projectRoot, directiveId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { lastRunAt: null };
  }
}

/**
 * @param {string} projectRoot
 * @param {string} directiveId
 * @param {string} lastRunAt - ISO timestamp
 */
export function writeDirectiveState(projectRoot, directiveId, { lastRunAt }) {
  fs.writeFileSync(statePath(projectRoot, directiveId), JSON.stringify({ lastRunAt }, null, 2) + '\n');
}

/**
 * A directive is due when its trigger has never fired, or enough time has
 * elapsed since the last run to satisfy its configured cadence.
 * `trigger.kind === 'on-demand'` directives are never due on a tick — they
 * only run via an explicit `construct directives run <id>`.
 *
 * @param {object} directive - normalized directive (lib/directives/directive-config.mjs)
 * @param {{ lastRunAt: string|null }} state
 * @param {number} [now]
 * @returns {boolean}
 */
export function isDirectiveDue(directive, state, now = Date.now()) {
  if (directive.trigger?.kind !== 'interval') return false;
  if (!state?.lastRunAt) return true;
  const elapsedMs = now - new Date(state.lastRunAt).getTime();
  return elapsedMs >= directive.trigger.intervalMinutes * 60_000;
}
