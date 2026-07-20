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
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

// A deterministic, fake-but-materialized model/credential config so preflight
// can reach reasonCode 'attached' on any host — a bare `...process.env`
// spread only reaches 'attached' on a machine that happens to carry real
// provider credentials or ambient fallbacks (a local Ollama daemon, a
// signed-in `gh`/`op` session); a fresh CI runner has none of those, so the
// first test below (which asserts reasonCode === 'attached') would otherwise
// always see model_unresolved instead. The second test's tool_unlisted
// assertion fires from an earlier check in the reasonCode priority chain and
// is unaffected by model resolution either way.

function env() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-ready-'));
  return {
    home,
    env: {
      ...process.env,
      HOME: home,
      CONSTRUCT_HOME_OVERRIDE: home,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_MODEL_REASONING: 'anthropic/claude-sonnet-4-6',
      CONSTRUCT_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
      CONSTRUCT_MODEL_FAST: 'anthropic/claude-sonnet-4-6',
      ANTHROPIC_API_KEY: 'sk-test-canary',
    },
    cleanup() { rmTmpDir(home); },
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
    assert.ok(payload.observedTools.includes('orchestration_run'), 'dispatch tool is flat (observed), not behind the gateway');
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
    assert.equal(payload.expectedUntilHostSync, true);
    assert.match(payload.nextStep, /construct sync/);
    assert.match(payload.diagnosticBundle.detail, /fresh project|tarball|Missing required tool/);
  } finally {
    ctx.cleanup();
  }
});

test('construct orchestrate preflight human output teaches sync path for missing tools', () => {
  const ctx = env();
  try {
    const result = spawnSync(process.execPath, [
      BIN,
      'orchestrate',
      'preflight',
      '--no-probe',
      '--observation-scope=local-config',
    ], {
      cwd: REPO,
      env: ctx.env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /expected-until-host-sync|Setup note/);
    assert.match(result.stdout, /construct sync/);
    assert.match(result.stdout, /not that the Construct install itself failed/);
  } finally {
    ctx.cleanup();
  }
});
