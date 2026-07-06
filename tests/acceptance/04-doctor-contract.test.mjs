/**
 * tests/acceptance/04-doctor-contract.test.mjs
 *
 * LMCP-L1 acceptance contract: construct doctor workflow.
 *
 * Verifies that `construct doctor` does not crash with MODULE_NOT_FOUND or
 * an unhandled exception stack trace. The doctor command may exit non-zero
 * in a minimal environment (missing config, no .cx/ dir) but it must emit
 * structured diagnostic output — not a hard crash.
 *
 * Run standalone:
 *   node --test tests/acceptance/04-doctor-contract.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONSTRUCT_BIN = new URL('../../bin/construct', import.meta.url).pathname;

// lib/paths.mjs resolves the ADR-0066 state root from process.env.HOME /
// CX_HOME_OVERRIDE in the CHILD's own env, not the test process's env — so
// every spawned `construct` call must be pinned to a throwaway sandbox home
// or it leaks project-key directories into the real developer machine's
// ~/.construct/projects/.

const SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'cx-doctor-test-home-'));

function runConstruct(args, cwd) {
  return spawnSync(process.execPath, [CONSTRUCT_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
    env: {
      ...process.env,
      CONSTRUCT_DEPLOYMENT_MODE: 'solo',
      HOME: SANDBOX_HOME,
      CX_HOME_OVERRIDE: SANDBOX_HOME,
    },
  });
}

function combinedOutput(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
}

function assertNoModuleNotFound(output, label) {
  const forbidden = ['Cannot find module', 'MODULE_NOT_FOUND'];
  for (const pattern of forbidden) {
    assert.ok(
      !output.includes(pattern),
      `${label}: output contains "${pattern}"\n---\n${output}\n---`,
    );
  }
}

test('04-doctor-contract: construct doctor', { timeout: 60_000 }, async (t) => {
  let tmpDir = null;

  await t.test('create temp directory', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cx-doctor-test-'));
    assert.ok(existsSync(tmpDir), 'Temp directory should exist');
  });

  await t.test('construct doctor does not crash with MODULE_NOT_FOUND', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['doctor'], tmpDir);
    const output = combinedOutput(result);
    assertNoModuleNotFound(output, 'construct doctor');
  });

  await t.test('construct doctor does not produce an unhandled exception', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['doctor'], tmpDir);
    const output = combinedOutput(result);
    // A hard crash: exits non-zero, stderr has Error:, stdout is empty
    const isHardCrash =
      result.status !== 0 &&
      result.stderr?.includes('Error:') &&
      !result.stdout?.trim();
    assert.ok(
      !isHardCrash,
      `construct doctor appears to have crashed (status=${result.status})\n${output}`,
    );
  });

  await t.test('construct doctor output contains diagnostic results line', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['doctor'], tmpDir);
    const output = combinedOutput(result);
    // doctor always emits "Results: N passed, N warnings, N failed"
    const hasResultsLine =
      output.includes('Results:') ||
      output.includes('passed') ||
      output.includes('Construct Health');
    assert.ok(
      hasResultsLine,
      `construct doctor output does not contain expected diagnostic results\n${output}`,
    );
  });

  await t.test('construct doctor exit code is 0 or 1 (not a crash code)', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['doctor'], tmpDir);
    // exit 0 = all checks pass; exit 1 = some checks failed; anything else is abnormal
    assert.ok(
      result.status === 0 || result.status === 1,
      `construct doctor exited with unexpected code ${result.status}\n${combinedOutput(result)}`,
    );
  });

  await t.test('cleanup temp directory', () => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
      assert.ok(!existsSync(tmpDir), 'Temp directory should be removed');
    }
    rmSync(SANDBOX_HOME, { recursive: true, force: true });
  });
});
