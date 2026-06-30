/**
 * tests/functional/orchestration-readiness.functional.test.mjs
 *
 * Drives the public CLI preflight surface against the real Construct MCP server
 * and a synthetic missing-tool fixture, proving operators get a typed readiness
 * verdict and deterministic recovery step.
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-ready-'));
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

test('construct orchestrate preflight --json probes local MCP readiness', () => {
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
    assert.equal(payload.reasonCode, 'attached');
    assert.equal(payload.attached, true);
    assert.ok(payload.observedTools.includes('orchestration_readiness'));
    assert.ok(payload.reachableTools.includes('orchestration_run'));
    assert.ok(payload.eventPath, 'preflight records a local readiness event');
  } finally {
    ctx.cleanup();
  }
});

test('construct orchestrate preflight --json returns typed missing-tool failure', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [
      BIN,
      'orchestrate',
      'preflight',
      '--json',
      '--no-probe',
      '--observed-tools=orchestration_policy,call',
      '--reachable-tools=workflow_invoke',
    ], {
      cwd: REPO,
      env: ctx.env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.reasonCode, 'tool_unlisted');
    assert.deepEqual(payload.missingTools, ['orchestration_run']);
    assert.match(payload.nextStep, /construct sync/);
  } finally {
    ctx.cleanup();
  }
});
