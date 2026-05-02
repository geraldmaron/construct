/**
 * tests/runtime-pressure.test.mjs — Unit tests for lib/runtime-pressure.mjs.
 *
 * Verifies pressure-guard defaults, environment serialization, and local
 * diagnostics for swap pressure, helper age, and stale index detection.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCleanupPlan,
  buildPressureGuardValues,
  installPressureGuardLaunchAgent,
  parseElapsedSeconds,
  parseSwapUsage,
  runPressureRelease,
} from '../lib/runtime-pressure.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('parseElapsedSeconds supports ps elapsed formats', () => {
  assert.equal(parseElapsedSeconds('59'), 59);
  assert.equal(parseElapsedSeconds('05:10'), 310);
  assert.equal(parseElapsedSeconds('01:05:10'), 3910);
  assert.equal(parseElapsedSeconds('2-01:05:10'), 176710);
  assert.equal(parseElapsedSeconds('bad'), 0);
});

test('parseSwapUsage extracts used and total bytes from macOS sysctl output', () => {
  const parsed = parseSwapUsage('vm.swapusage: total = 15360.00M  used = 14155.44M  free = 1204.56M  (encrypted)');
  assert.equal(parsed.totalBytes, 15360 * 1024 * 1024);
  assert.equal(parsed.usedBytes, Math.round(14155.44 * 1024 * 1024));
  assert.equal(parsed.freeBytes, Math.round(1204.56 * 1024 * 1024));
});

test('buildCleanupPlan targets stale helpers and duplicate opencode processes first', () => {
  const plan = buildCleanupPlan([
    { pid: 100, command: 'opencode', elapsedSeconds: 60 * 60 * 30, rssKb: 100000 },
    { pid: 101, command: 'opencode', elapsedSeconds: 60 * 60 * 12, rssKb: 110000 },
    { pid: 102, command: 'opencode web', elapsedSeconds: 60 * 60 * 40, rssKb: 80000 },
    { pid: 200, command: 'node /tmp/context7-mcp', elapsedSeconds: 60 * 60 * 6, rssKb: 40000 },
    { pid: 201, command: 'node /tmp/playwright-mcp', elapsedSeconds: 60 * 60 * 5, rssKb: 40000 },
    { pid: 202, command: 'node /tmp/mcp-server-sequential-thinking', elapsedSeconds: 60 * 60 * 4, rssKb: 20000 },
    { pid: 300, command: '/Users/gerald/.local/bin/cass index', elapsedSeconds: 60 * 60 * 10, rssKb: 300000 },
  ], {
    maxOpencodeProcesses: 2,
    maxOpencodeAgeHours: 24,
    maxHelperAgeHours: 2,
    maxCassIndexAgeHours: 8,
  });

  assert.deepEqual(plan.terminate.map((entry) => entry.pid), [102, 100, 101, 200, 201, 202]);
  assert.match(plan.summary, /6 processes/);
  assert.equal(plan.cassCandidates.length, 1);
  assert.equal(plan.cassCandidates[0].pid, 300);
});

test('runPressureRelease terminates cass only when pressure threshold is crossed', () => {
  const killed = [];
  const report = runPressureRelease({
    env: {
      CONSTRUCT_PRESSURE_GUARD_SWAP_GB: '6',
      CONSTRUCT_PRESSURE_GUARD_MAX_OPENCODE: '2',
      CONSTRUCT_PRESSURE_GUARD_MAX_OPENCODE_AGE_HOURS: '24',
      CONSTRUCT_PRESSURE_GUARD_MAX_HELPER_AGE_HOURS: '2',
      CONSTRUCT_PRESSURE_GUARD_MAX_CASS_INDEX_AGE_HOURS: '8',
    },
    processEntries: [
      { pid: 100, command: 'opencode', elapsedSeconds: 60 * 60 * 30, rssKb: 100000 },
      { pid: 101, command: 'opencode', elapsedSeconds: 60 * 60 * 12, rssKb: 110000 },
      { pid: 200, command: 'node /tmp/context7-mcp', elapsedSeconds: 60 * 60 * 6, rssKb: 40000 },
      { pid: 300, command: '/Users/gerald/.local/bin/cass index', elapsedSeconds: 60 * 60 * 10, rssKb: 300000 },
    ],
    swapUsage: {
      totalBytes: 15 * 1024 * 1024 * 1024,
      usedBytes: 10 * 1024 * 1024 * 1024,
      freeBytes: 5 * 1024 * 1024 * 1024,
    },
    killFn: (pid, signal) => killed.push({ pid, signal }),
  });

  assert.equal(report.pressureTriggered, true);
  assert.deepEqual(killed.map((entry) => entry.pid), [100, 200, 300]);
});

test('buildPressureGuardValues writes realistic default constraints', () => {
  const values = buildPressureGuardValues({ env: {} });
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_ENABLED, '1');
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_INTERVAL_SECONDS, '300');
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_SWAP_GB, '6');
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_MAX_OPENCODE, '2');
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_MAX_OPENCODE_AGE_HOURS, '24');
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_MAX_HELPER_AGE_HOURS, '2');
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_MAX_CASS_INDEX_AGE_HOURS, '8');
});

test('installPressureGuardLaunchAgent writes a launch agent plist', () => {
  const homeDir = tempDir('construct-pressure-agent-');
  const rootDir = tempDir('construct-pressure-root-');
  const result = installPressureGuardLaunchAgent({
    homeDir,
    rootDir,
    intervalSeconds: 300,
    nodePath: '/usr/local/bin/node',
  });

  assert.equal(result.installed, true);
  assert.equal(fs.existsSync(result.plistPath), true);
  const plist = fs.readFileSync(result.plistPath, 'utf8');
  assert.match(plist, /dev\.construct\.pressure-release/);
  assert.match(plist, /<string>cleanup<\/string>/);
  assert.match(plist, /<string>--pressure-release<\/string>/);
  assert.match(plist, /<string>--quiet<\/string>/);
  assert.match(plist, /<integer>300<\/integer>/);
  assert.match(plist, /\/usr\/local\/bin\/node/);
});
