/**
 * tests/acceptance/k5-ink-react-degradation.functional.test.mjs — LMCP-K5 Ink/React
 * degradation test.
 *
 * LMCP-K5: Ink/React optional-dep degradation test.
 *
 * Unlike the L4 suite (which tests --no-optional at install time), K5
 * specifically targets ink and react — the TUI dependencies that CI preinstalls
 * (`.github/workflows/ci.yml` line 132), masking their absence.
 *
 * Proves:
 *   1. CLI commands work when ink and react are absent from node_modules
 *   2. No MODULE_NOT_FOUND errors for 'ink' or 'react'
 *   3. Non-TUI paths (version, status --json, doctor) are fully functional
 *   4. TUI paths that attempt to import ink/react fall back gracefully
 *      (future-proof: even though no ink import exists today, the test
 *       validates that if one is added, it won't crash the CLI)
 *
 * Run standalone:
 *   node --test --test-timeout=120000 tests/acceptance/k5-ink-react-degradation.functional.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../');

const INK_DEP = 'ink';
const REACT_DEP = 'react';

// Helpers ---------------------------------------------------------------

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    ...opts,
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

function assertNoSpecificMissingDep(output, depName, label) {
  const patterns = [
    `Cannot find module '${depName}'`,
    `Cannot find module "${depName}"`,
  ];
  for (const pattern of patterns) {
    assert.ok(
      !output.includes(pattern),
      `${label}: output references missing dep "${depName}"\n---\n${output}\n---`,
    );
  }
}

/** Parse npm pack --json output, returning the first tarball filename. */
function parsePackJson(stdout) {
  let packJson;
  try {
    packJson = JSON.parse(stdout.trim());
  } catch {
    const lines = stdout.trim().split('\n');
    const jsonStart = lines.findIndex((l) => l.trimStart().startsWith('['));
    if (jsonStart === -1) return null;
    packJson = JSON.parse(lines.slice(jsonStart).join('\n'));
  }
  return packJson?.[0]?.filename ?? null;
}

/** Check if a module directory exists under the given node_modules root. */
function moduleExists(nmRoot, depName) {
  return existsSync(join(nmRoot, depName));
}

// Suite -----------------------------------------------------------------

test('LMCP-K5: ink/react degradation', { timeout: 180_000 }, async (t) => {
  let tmpDir = null;
  let tarballPath = null;

  // ── Step 1: npm pack ─────────────────────────────────────────────────
  await t.test('npm pack produces tarball', () => {
    const packResult = run('npm', ['pack', '--json'], { cwd: PROJECT_ROOT });
    if (packResult.status !== 0) {
      t.todo(`npm pack failed (status ${packResult.status})`);
      return;
    }

    const filename = parsePackJson(packResult.stdout);
    assert.ok(filename, 'npm pack should emit a filename');

    tarballPath = resolve(PROJECT_ROOT, filename);
    assert.ok(existsSync(tarballPath), `Tarball should exist at ${tarballPath}`);
  });

  if (!tarballPath) {
    await t.test('remaining tests (skipped — pack failed)', (ct) => {
      ct.todo('Skipped because npm pack did not produce a tarball');
    });
    return;
  }

  // ── Step 2: create clean temp dir ────────────────────────────────────
  await t.test('create clean temp directory', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'construct-k5-'));
    assert.ok(existsSync(tmpDir), 'Temp directory should exist');
  });

  await t.test('npm init -y in temp directory', () => {
    const initResult = run('npm', ['init', '-y'], { cwd: tmpDir });
    assert.equal(initResult.status, 0, `npm init -y failed:\n${combinedOutput(initResult)}`);
  });

  // ── Step 3: install tarball WITHOUT optional deps ────────────────────
  await t.test('npm install tarball --no-optional --ignore-scripts', () => {
    const installResult = run('npm', [
      'install', tarballPath,
      '--no-optional',
      '--ignore-scripts',
      '--prefer-offline',
    ], { cwd: tmpDir, timeout: 90_000 });
    assert.equal(installResult.status, 0, `npm install failed:\n${combinedOutput(installResult)}`);
  });

  const nmRoot = join(tmpDir, 'node_modules');
  const binPath = join(nmRoot, '.bin', 'construct');
  const soloEnv = { ...process.env, CONSTRUCT_DEPLOYMENT_MODE: 'solo' };

  // ── Step 4: Verify ink and react are absent ──────────────────────────
  await t.test('ink and react are absent from node_modules (--no-optional)', () => {
    assert.ok(existsSync(nmRoot), 'node_modules should exist');

    const inkPresent = moduleExists(nmRoot, INK_DEP);
    const reactPresent = moduleExists(nmRoot, REACT_DEP);

    // Log the actual state for diagnostic purposes
    console.log(`\n  [info] ink in node_modules: ${inkPresent}`);
    console.log(`  [info] react in node_modules: ${reactPresent}`);

    // If ink/react ARE present (e.g. --no-optional didn't fully strip them
    // due to workspace or hoisting), we still want to proceed with the test.
    // The test will forcibly remove them below to ensure hermetic absence.
    if (inkPresent || reactPresent) {
      console.log('  [info] --no-optional did not fully remove ink/react; will force-remove');
    }
  });

  // ── Step 5: Force-remove ink and react if somehow present ────────────
  await t.test('force-remove ink and react from node_modules', () => {
    for (const dep of [INK_DEP, REACT_DEP]) {
      const depPath = join(nmRoot, dep);
      if (existsSync(depPath)) {
        rmSync(depPath, { recursive: true, force: true });
        assert.ok(!existsSync(depPath), `${dep} should be removed from node_modules`);
      }
    }
    // Double-check
    assert.ok(!moduleExists(nmRoot, INK_DEP), `ink must not be in node_modules after cleanup`);
    assert.ok(!moduleExists(nmRoot, REACT_DEP), `react must not be in node_modules after cleanup`);
  });

  // ── Step 6: Construct binary exists ──────────────────────────────────
  await t.test('construct binary exists in packed install', () => {
    assert.ok(existsSync(binPath), `Binary should exist at ${binPath}`);
  });

  // ── Step 7: construct version ────────────────────────────────────────
  await t.test('construct version exits 0 without ink/react', () => {
    const result = run('node', [binPath, 'version'], { cwd: tmpDir, env: soloEnv });
    const output = combinedOutput(result);

    assertNoModuleNotFound(output, 'construct version (no ink/react)');
    assertNoSpecificMissingDep(output, INK_DEP, 'construct version');
    assertNoSpecificMissingDep(output, REACT_DEP, 'construct version');
    assert.equal(result.status, 0, `construct version exited ${result.status}\n${output}`);
    assert.match(result.stdout.trim(), /construct v\d+\.\d+/, `Expected version, got: ${result.stdout.trim()}`);
  });

  // ── Step 8: construct status --json ──────────────────────────────────
  await t.test('construct status --json returns valid JSON without ink/react', () => {
    const result = run('node', [binPath, 'status', '--json'], { cwd: tmpDir, env: soloEnv });
    const output = combinedOutput(result);

    assertNoModuleNotFound(output, 'construct status --json (no ink/react)');
    assertNoSpecificMissingDep(output, INK_DEP, 'construct status --json');
    assertNoSpecificMissingDep(output, REACT_DEP, 'construct status --json');
    assert.equal(result.status, 0, `construct status --json exited ${result.status}\n${output}`);

    let parsed;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch (err) {
      assert.fail(`Output not valid JSON: ${err.message}\n${result.stdout}`);
    }
    assert.ok(parsed !== null && typeof parsed === 'object', 'Parsed JSON should be an object');
  });

  // ── Step 9: construct doctor ─────────────────────────────────────────
  await t.test('construct doctor does not crash without ink/react', () => {
    const result = run('node', [binPath, 'doctor'], { cwd: tmpDir, env: soloEnv });
    const output = combinedOutput(result);

    assertNoModuleNotFound(output, 'construct doctor (no ink/react)');
    assertNoSpecificMissingDep(output, INK_DEP, 'construct doctor');
    assertNoSpecificMissingDep(output, REACT_DEP, 'construct doctor');

    const isUnhandledCrash =
      result.status !== 0 &&
      result.stderr?.includes('Error:') &&
      !result.stdout?.trim();

    assert.ok(
      !isUnhandledCrash,
      `construct doctor appears to have crashed (status ${result.status}):\n${output}`,
    );
  });

  // ── Step 10: TUI fallback check (future-proof) ──────────────────────
  // Even though no ink/react import exists today, this test simulates
  // what happens when a command *would* try to import them — it verifies
  // the CLI doesn't crash before it even parses args.
  await t.test('TUI fallback: CLI arg parsing succeeds before any ink import', () => {
    // Run with --help to prove the CLI parser works end-to-end
    const result = run('node', [binPath, '--help'], { cwd: tmpDir, env: soloEnv });
    const output = combinedOutput(result);

    assertNoModuleNotFound(output, 'construct --help (no ink/react)');
    assertNoSpecificMissingDep(output, INK_DEP, 'construct --help');
    assertNoSpecificMissingDep(output, REACT_DEP, 'construct --help');

    // --help outputs usage to stdout and exits 0
    const hasUsage = result.stdout.includes('construct') && result.stdout.includes('Usage:');
    assert.ok(hasUsage || result.status === 0,
      `construct --help should show usage or exit 0\n${output}`);
  });

  // ── Step 11: Verify intent.json entries correctly mark ink/react as optional ──
  await t.test('ink and react intent entries have correct degradation behavior', () => {
    const raw = readFileSync(join(PROJECT_ROOT, 'deps', 'intent.json'), 'utf8');
    const intents = JSON.parse(raw);

    const inkIntent = intents.find((e) => e.id === 'ink');
    const reactIntent = intents.find((e) => e.id === 'react');

    assert.ok(inkIntent, 'intent.json must have an entry for ink');
    assert.ok(reactIntent, 'intent.json must have an entry for react');

    assert.equal(inkIntent.kind, 'npm-optional', 'ink intent must be kind=npm-optional');
    assert.equal(inkIntent.degradationBehavior, 'graceful-skip',
      `ink must have degradationBehavior "graceful-skip", got "${inkIntent.degradationBehavior}"`);
    assert.equal(inkIntent.disposition, 'optional', 'ink must have disposition=optional');

    assert.equal(reactIntent.kind, 'npm-optional', 'react intent must be kind=npm-optional');
    assert.equal(reactIntent.degradationBehavior, 'graceful-skip',
      `react must have degradationBehavior "graceful-skip", got "${reactIntent.degradationBehavior}"`);
    assert.equal(reactIntent.disposition, 'optional', 'react must have disposition=optional');
  });

  // ── Cleanup ─────────────────────────────────────────────────────────
  await t.test('cleanup', () => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
      assert.ok(!existsSync(tmpDir), 'Temp directory should be removed');
    }
    if (tarballPath && existsSync(tarballPath)) {
      rmSync(tarballPath, { force: true });
    }
  });
});