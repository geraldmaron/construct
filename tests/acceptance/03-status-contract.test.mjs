/**
 * tests/acceptance/03-status-contract.test.mjs
 *
 * LMCP-L1 acceptance contract: construct status --json workflow.
 *
 * Verifies that `construct status --json` exits 0, emits valid JSON, and
 * the JSON contains the expected top-level fields from buildStatus output
 * (deployment.mode, system, features). Also verifies no MODULE_NOT_FOUND
 * errors appear in stderr.
 *
 * Run standalone:
 *   node --test tests/acceptance/03-status-contract.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const CONSTRUCT_BIN = new URL('../../bin/construct', import.meta.url).pathname;

// lib/paths.mjs resolves the ADR-0066 state root from process.env.HOME /
// CONSTRUCT_HOME_OVERRIDE in the CHILD's own env, not the test process's env — so
// every spawned `construct` call must be pinned to a throwaway sandbox home
// or it leaks project-key directories into the real developer machine's
// ~/.construct/projects/.

const SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'cx-status-test-home-'));

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
      CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME,
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

test('03-status-contract: construct status --json', { timeout: 60_000 }, async (t) => {
  let tmpDir = null;

  await t.test('create temp directory', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cx-status-test-'));
    assert.ok(existsSync(tmpDir), 'Temp directory should exist');
  });

  await t.test('construct status --json exits 0', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['status', '--json'], tmpDir);
    const output = combinedOutput(result);
    assertNoModuleNotFound(output, 'construct status --json');
    assert.equal(
      result.status,
      0,
      `construct status --json exited ${result.status}\n${output}`,
    );
  });

  await t.test('construct status --json outputs valid JSON', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['status', '--json'], tmpDir);
    let parsed;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch (err) {
      assert.fail(`construct status --json output is not valid JSON: ${err.message}\n${result.stdout}`);
    }
    assert.ok(parsed !== null && typeof parsed === 'object', 'Parsed JSON must be an object');
    // Attach for downstream subtests
    t.parsed = parsed;
  });

  await t.test('JSON contains deployment field with mode', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['status', '--json'], tmpDir);
    const parsed = JSON.parse(result.stdout.trim());
    // buildStatus returns { deployment: { mode, resourceMode, description, ... } }
    assert.ok(
      parsed.deployment && typeof parsed.deployment === 'object',
      `JSON must have a "deployment" object. Got keys: ${Object.keys(parsed).join(', ')}`,
    );
    assert.ok(
      typeof parsed.deployment.mode === 'string',
      `deployment.mode must be a string. Got: ${JSON.stringify(parsed.deployment?.mode)}`,
    );
  });

  await t.test('JSON contains system field', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['status', '--json'], tmpDir);
    const parsed = JSON.parse(result.stdout.trim());
    assert.ok(
      parsed.system && typeof parsed.system === 'object',
      `JSON must have a "system" field. Got keys: ${Object.keys(parsed).join(', ')}`,
    );
  });

  await t.test('no Cannot find module in stderr', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['status', '--json'], tmpDir);
    assertNoModuleNotFound(result.stderr ?? '', 'construct status --json stderr');
  });

  await t.test('construct status (human-readable) exits 0', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['status'], tmpDir);
    const output = combinedOutput(result);
    assertNoModuleNotFound(output, 'construct status (human)');
    assert.equal(
      result.status,
      0,
      `construct status exited ${result.status}\n${output}`,
    );
  });

  await t.test('cleanup temp directory', () => {
    if (tmpDir && existsSync(tmpDir)) {
      rmTmpDir(tmpDir);
    }
    rmTmpDir(SANDBOX_HOME);
  });
});
