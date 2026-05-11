/**
 * lib/roles/hook-emit.mjs — synchronous one-liner hooks call to publish events.
 *
 * Wraps event-bus.emit with auto-detection of project + branch from the hook
 * input. Never throws — hooks must stay on the hot path. Returns the event or
 * null on failure. Use `emitRoleEvent({ type, summary, hookInput, context })`.
 */

import { execSync } from 'node:child_process';
import { emit } from './event-bus.mjs';

function gitInfo(cwd) {
  try {
    const project = execSync('git rev-parse --show-toplevel 2>/dev/null', { cwd, timeout: 1000 }).toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, timeout: 1000 }).toString().trim();
    return { project, branch };
  } catch {
    return { project: cwd || '', branch: '' };
  }
}

export function emitRoleEvent({ type, summary, hookInput = {}, context = null }) {
  if (process.env.CONSTRUCT_ROLES === 'off') return null;
  try {
    const cwd = hookInput.cwd || process.cwd();
    const { project, branch } = gitInfo(cwd);
    return emit(type, {
      project,
      branch,
      cwd,
      summary: String(summary || '').slice(0, 4096),
      context,
    });
  } catch {
    return null;
  }
}
