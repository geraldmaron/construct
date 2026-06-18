/**
 * spawn.mjs — isolated invocation of the real construct binary for audit phases.
 *
 * Mirrors the isolation contract proven in cli-help-safety: a throwaway HOME plus the
 * probe-suppressing env vars, so smoke/visual/install phases can run the real bin
 * without touching the developer's machine. Reused by Phases 1, 4, and 5.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BIN_PATH } from './handlers.mjs';

export function isolatedEnv(extra = {}) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-audit-'));
  return {
    fakeHome,
    env: {
      ...process.env,
      HOME: fakeHome,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
      ...extra,
    },
  };
}

export function runConstruct(args, { env, timeout = 8000, input } = {}) {
  const start = Date.now();
  const result = spawnSync(BIN_PATH, args, {
    env: env || process.env,
    encoding: 'utf8',
    timeout,
    input,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    timedOut: result.error?.code === 'ETIMEDOUT' || Boolean(result.signal),
    elapsedMs: Date.now() - start,
  };
}

export function cleanup(fakeHome) {
  fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
