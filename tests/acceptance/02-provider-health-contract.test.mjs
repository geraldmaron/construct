/**
 * tests/acceptance/02-provider-health-contract.test.mjs
 *
 * LMCP-L1 acceptance contract: construct providers status workflow.
 *
 * Verifies that `construct providers status` exits cleanly (exit 0 or a
 * structured non-crash) and emits provider entry lines or a structured
 * "no providers" message. The binary must not crash with MODULE_NOT_FOUND
 * or an unhandled exception.
 *
 * Run standalone:
 *   node --test tests/acceptance/02-provider-health-contract.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONSTRUCT_BIN = new URL('../../bin/construct', import.meta.url).pathname;

function runConstruct(args, cwd) {
  return spawnSync(process.execPath, [CONSTRUCT_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
    env: { ...process.env, CONSTRUCT_DEPLOYMENT_MODE: 'solo' },
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

function assertNoUncaughtCrash(result, label) {
  const output = combinedOutput(result);
  assertNoModuleNotFound(output, label);
  const isHardCrash =
    result.status !== 0 &&
    result.stderr?.includes('Error:') &&
    !result.stdout?.trim();
  assert.ok(
    !isHardCrash,
    `${label}: appears to have crashed (status=${result.status})\n${output}`,
  );
}

test('02-provider-health-contract: construct providers status', { timeout: 60_000 }, async (t) => {
  let tmpDir = null;

  await t.test('create temp directory', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cx-providers-test-'));
    assert.ok(existsSync(tmpDir), 'Temp directory should exist');
  });

  await t.test('construct providers status does not crash', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['providers', 'status'], tmpDir);
    assertNoUncaughtCrash(result, 'construct providers status');
    // providers status exits 0 on success; we accept 0 or 1 but not a hard crash
    assert.ok(
      result.status === 0 || result.status === 1,
      `construct providers status exited with unexpected code ${result.status}`,
    );
  });

  await t.test('construct providers status output contains provider lines or "no providers" message', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    const result = runConstruct(['providers', 'status'], tmpDir);
    const output = combinedOutput(result);
    assertNoUncaughtCrash(result, 'construct providers status');
    // The command outputs a "Provider status" header or entry lines like "enabled=yes/no breaker=..."
    // In a minimal env with no providers configured, it may still print the header.
    // Assert non-empty output.
    assert.ok(
      output.length > 0,
      `construct providers status produced no output\n${output}`,
    );
    // Structural check: output either contains provider-status markers or a header
    const hasProviderContent =
      output.includes('enabled=') ||
      output.includes('breaker=') ||
      output.includes('Provider') ||
      output.includes('provider');
    assert.ok(
      hasProviderContent,
      `construct providers status output does not look like provider status\n${output}`,
    );
  });

  await t.test('construct providers (no subcommand) exits with usage info', () => {
    assert.ok(tmpDir, 'Temp dir must be created first');
    // `construct providers` with no args defaults to "status" per the source
    const result = runConstruct(['providers'], tmpDir);
    assertNoUncaughtCrash(result, 'construct providers');
    // Should not emit MODULE_NOT_FOUND
    assertNoModuleNotFound(combinedOutput(result), 'construct providers (bare)');
  });

  await t.test('cleanup temp directory', () => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
      assert.ok(!existsSync(tmpDir), 'Temp directory should be removed');
    }
  });
});
