#!/usr/bin/env node
/**
 * hooks/hook-health.mjs — self-monitors the other hooks. A hook that fails
 * repeatedly gets recorded and surfaced via `construct doctor`; it is never
 * allowed to block tool use. This is the direct fix for the predecessor's
 * broken-hook outages, where a crashing hook wedged every tool call in the
 * session. Tracks failures in a per-repo state file, not global state.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Overridable so a test can point it somewhere disposable. Without this the
// only way to exercise a hook end to end is to let it write into the real repo,
// which is the sterile-discipline hole tests/harness/sterile.ts exists to close.
// Env-reading is a scripts/ liberty, not a kernel one — src/kernel/paths.ts is
// still the only module inside the kernel permitted to do it.
const stateFile =
  process.env.CONSTRUCT_HOOK_HEALTH_FILE ?? join(repoRoot, '.claude', '.hook-health.json');

export function recordHookOutcome(hookName, ok) {
  let state = {};
  if (existsSync(stateFile)) {
    try {
      state = JSON.parse(readFileSync(stateFile, 'utf8'));
    } catch {
      state = {};
    }
  }
  const entry = state[hookName] ?? { failures: 0, total: 0 };
  entry.total += 1;
  entry.failures = ok ? 0 : entry.failures + 1; // consecutive failures only
  state[hookName] = entry;

  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  return entry;
}

export function healthReport() {
  if (!existsSync(stateFile)) return [];
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  return Object.entries(state).map(([hookName, entry]) => ({
    hookName,
    ...entry,
    disabled: entry.failures >= 3,
  }));
}
