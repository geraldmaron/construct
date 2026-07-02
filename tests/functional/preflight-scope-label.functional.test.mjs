/**
 * tests/functional/preflight-scope-label.functional.test.mjs
 *
 * Proves `construct orchestrate preflight` labels its observationScope by
 * where the tool list actually came from: a self-spawned local probe reports
 * 'local-probe', not 'host-session' (which implies a real host/IDE attached
 * to the calling process observed the tools). Caller-supplied
 * --observed-tools/--reachable-tools still yield 'host-session'.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

function env() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-preflight-scope-'));
  return {
    home,
    env: {
      ...process.env,
      HOME: home,
      CX_HOME_OVERRIDE: home,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
    },
    cleanup() { fs.rmSync(home, { recursive: true, force: true }); },
  };
}

test('default preflight self-probe reports local-probe, never host-session', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [BIN, 'orchestrate', 'preflight', '--json', '--timeout-ms=8000'], {
      cwd: REPO,
      env: ctx.env,
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.observationScope, 'local-probe');
    assert.notEqual(payload.observationScope, 'host-session');
  } finally {
    ctx.cleanup();
  }
});

test('caller-supplied --observed-tools yields host-session scope', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [
      BIN,
      'orchestrate',
      'preflight',
      '--json',
      '--observed-tools=orchestration_policy,orchestration_run',
    ], {
      cwd: REPO,
      env: ctx.env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.observationScope, 'host-session');
  } finally {
    ctx.cleanup();
  }
});

test('default preflight summary line prints scope=local-probe', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [BIN, 'orchestrate', 'preflight', '--timeout-ms=8000'], {
      cwd: REPO,
      env: ctx.env,
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /scope=local-probe/);
    assert.doesNotMatch(result.stdout, /scope=host-session/);
  } finally {
    ctx.cleanup();
  }
});
