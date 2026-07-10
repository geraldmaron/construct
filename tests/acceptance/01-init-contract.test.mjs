/**
 * tests/acceptance/01-init-contract.test.mjs
 *
 * LMCP-L1 acceptance contract: construct init workflow.
 *
 * Verifies that `construct init` runs against a fresh tmpdir, creates the
 * expected .cx/ directory structure, and that `construct status --json`
 * subsequently returns valid JSON with a deploymentMode field.
 *
 * Run standalone:
 *   node --test tests/acceptance/01-init-contract.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const CONSTRUCT_BIN = new URL('../../bin/construct', import.meta.url).pathname;

// lib/paths.mjs resolves the ADR-0066 state root from process.env.HOME /
// CX_HOME_OVERRIDE in the CHILD's own env, not the test process's env — so
// every spawned `construct` call must be pinned to a throwaway sandbox home
// or it leaks project-key directories into the real developer machine's
// ~/.construct/projects/.

const SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'cx-init-test-home-'));

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

function assertNoUncaughtCrash(result, label) {
  const output = combinedOutput(result);
  const forbidden = ['Cannot find module', 'MODULE_NOT_FOUND'];
  for (const pattern of forbidden) {
    assert.ok(
      !output.includes(pattern),
      `${label}: output contains "${pattern}"\n---\n${output}\n---`,
    );
  }
  // Unhandled rejection or uncaught exception with no stdout is a hard crash
  const isHardCrash =
    result.status !== 0 &&
    result.stderr?.includes('Error:') &&
    !result.stdout?.trim();
  assert.ok(
    !isHardCrash,
    `${label}: appears to have crashed (status=${result.status})\n${output}`,
  );
}

test('01-init-contract: construct init creates .cx/ structure', { timeout: 60_000 }, async (t) => {
  let tmpDir = null;

  await t.test('create temp directory', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cx-init-test-'));
    assert.ok(existsSync(tmpDir), 'Temp directory should exist');
  });

  await t.test('git init in temp directory', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = spawnSync('git', ['init'], { cwd: tmpDir, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, `git init exited ${result.status}: ${result.stderr}`);
  });

  await t.test('construct init exits 0 in fresh directory', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['init', '--yes'], tmpDir);
    const output = combinedOutput(result);
    assertNoUncaughtCrash(result, 'construct init');
    assert.equal(
      result.status,
      0,
      `construct init exited ${result.status}\n${output}`,
    );
  });

  await t.test('.cx/ directory created after init', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const cxDir = join(tmpDir, '.construct');
    assert.ok(existsSync(cxDir), `.cx/ directory should exist at ${cxDir}`);
  });

  await t.test('.cx/context.md created after init', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const contextMd = join(tmpDir, '.construct', 'context.md');
    assert.ok(existsSync(contextMd), `.cx/context.md should exist at ${contextMd}`);
  });

  await t.test('construct status --json returns valid JSON with deployment field', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['status', '--json'], tmpDir);
    const output = combinedOutput(result);
    assertNoUncaughtCrash(result, 'construct status --json');
    assert.equal(
      result.status,
      0,
      `construct status --json exited ${result.status}\n${output}`,
    );
    let parsed;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch (err) {
      assert.fail(`construct status --json output is not valid JSON: ${err.message}\n${result.stdout}`);
    }
    assert.ok(parsed !== null && typeof parsed === 'object', 'Parsed JSON must be an object');
    // buildStatus returns { deployment: { mode: ... } } — check both field shapes
    const hasDeploymentMode =
      typeof parsed.deploymentMode === 'string' ||
      (parsed.deployment && typeof parsed.deployment.mode === 'string');
    assert.ok(
      hasDeploymentMode,
      `JSON must contain deploymentMode or deployment.mode. Got keys: ${Object.keys(parsed).join(', ')}`,
    );
  });

  await t.test('cleanup temp directory', () => {
    if (tmpDir && existsSync(tmpDir)) {
      rmTmpDir(tmpDir);
    }
    rmTmpDir(SANDBOX_HOME);
  });
});
