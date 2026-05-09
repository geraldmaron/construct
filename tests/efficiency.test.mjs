/**
 * tests/efficiency.test.mjs — validates Construct session efficiency summaries.
 *
 * Exercises healthy sessions, repeated-read sessions, byte-budget pressure, and
 * JSON-ready summary shape for the construct efficiency command.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { formatEfficiencyReport, readEfficiencyLog, summarizeEfficiencyData } from '../lib/efficiency.mjs';

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-efficiency-'));
}

function writeStats(homeDir, stats) {
  const filePath = path.join(homeDir, '.cx', 'session-efficiency.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(stats, null, 2)}\n`);
}

test('healthy efficiency stats recommend continuing', () => {
  const summary = summarizeEfficiencyData({
    readCount: 4,
    uniqueFileCount: 4,
    repeatedReadCount: 0,
    largeReadCount: 0,
    totalBytesRead: 12_000,
    files: {},
  });

  assert.equal(summary.status, 'healthy');
  assert.match(summary.recommendation, /Continue/);
  assert.equal(summary.topRepeatedFiles.length, 0);
});

test('repeated reads identify top repeated files and recommend narrowing', () => {
  const summary = summarizeEfficiencyData({
    readCount: 12,
    uniqueFileCount: 3,
    repeatedReadCount: 9,
    largeReadCount: 1,
    totalBytesRead: 80_000,
    files: {
      '/repo/bin/construct': { count: 7, size: 20_000 },
      '/repo/lib/status.mjs': { count: 3, size: 10_000 },
      '/repo/README.md': { count: 1, size: 2_000 },
    },
  });

  assert.equal(summary.status, 'degraded');
  assert.equal(summary.topRepeatedFiles[0].path, '/repo/bin/construct');
  assert.equal(summary.topRepeatedFiles[0].count, 7);
  assert.match(summary.recommendation, /rg|distill/);
});

test('high byte budgets recommend distillation or compaction', () => {
  const report = formatEfficiencyReport(summarizeEfficiencyData({
    readCount: 18,
    uniqueFileCount: 9,
    repeatedReadCount: 3,
    largeReadCount: 5,
    totalBytesRead: 900_000,
    files: {},
  }));

  assert.match(report, /Construct Efficiency Report/);
  assert.match(report, /879 KB/);
  assert.match(report, /distill|compact/i);
});

test('readEfficiencyLog loads session-efficiency.json', () => {
  const homeDir = tempHome();
  writeStats(homeDir, { readCount: 1, uniqueFileCount: 1, files: {} });

  assert.equal(readEfficiencyLog(homeDir).readCount, 1);
});
