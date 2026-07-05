/**
 * tests/functional/gate-worker-backend-visibility.functional.test.mjs
 *
 * DEFAULT_WORKER_BACKEND is 'inline' (prepare-only per ADR-0020). Every
 * pre-run gate a user consults — preflight, doctor, and the run completion
 * line — must surface the resolved backend so a green gate never precedes a
 * silently prepare-only run (construct-1yhp.2).
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-worker-backend-vis-'));
  return {
    home,
    env: {
      ...process.env,
      HOME: home,
      CX_HOME_OVERRIDE: home,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
    },
    cleanup() { fs.rmSync(home, { recursive: true, force: true }); },
  };
}

test('preflight --json reports workerBackend=inline (prepare-only) with no config', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [
      BIN, 'orchestrate', 'preflight', '--json', '--no-probe',
      '--observed-tools=orchestration_policy,orchestration_run',
    ], { cwd: REPO, env: ctx.env, encoding: 'utf8', timeout: 20_000 });
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.workerBackend, 'inline');
  } finally {
    ctx.cleanup();
  }
});

test('construct doctor prints the effective worker backend as an advisory line', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [BIN, 'doctor'], {
      cwd: REPO, env: ctx.env, encoding: 'utf8', timeout: 60_000,
    });
    const line = result.stdout.split('\n').find((l) => l.includes('Worker backend:'));
    assert.ok(line, `doctor output should include a Worker backend line.\nstdout: ${result.stdout.slice(0, 800)}`);
    assert.match(line, /inline/);
    assert.match(line, /prepare-only/);
    assert.match(line, /✓/, 'the worker backend line is advisory and must never fail the gate');
  } finally {
    ctx.cleanup();
  }
});

test('construct doctor prints the effective provider timeout/retry settings (construct-5wkl)', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [BIN, 'doctor'], {
      cwd: REPO, env: ctx.env, encoding: 'utf8', timeout: 60_000,
    });
    const line = result.stdout.split('\n').find((l) => l.includes('Provider timeout:'));
    assert.ok(line, `doctor output should include a Provider timeout line.\nstdout: ${result.stdout.slice(0, 800)}`);
    assert.match(line, /120000ms/, 'default timeout must be the real 120s floor, not a stale test-scale value');
    assert.match(line, /retry attempts: 3/);
    assert.match(line, /✓/, 'the provider reliability line is advisory and must never fail the gate');
  } finally {
    ctx.cleanup();
  }
});

test('construct doctor reflects a CONSTRUCT_PROVIDER_TIMEOUT_MS override, not the default', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [BIN, 'doctor'], {
      cwd: REPO, env: { ...ctx.env, CONSTRUCT_PROVIDER_TIMEOUT_MS: '45000' }, encoding: 'utf8', timeout: 60_000,
    });
    const line = result.stdout.split('\n').find((l) => l.includes('Provider timeout:'));
    assert.ok(line, `doctor output should include a Provider timeout line.\nstdout: ${result.stdout.slice(0, 800)}`);
    assert.match(line, /45000ms/);
  } finally {
    ctx.cleanup();
  }
});

test('construct orchestrate run completion line names the resolved backend', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [
      BIN, 'orchestrate', 'run', 'fix a flaky test', '--no-execute',
    ], { cwd: REPO, env: ctx.env, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /backend=inline/);
  } finally {
    ctx.cleanup();
  }
});
