/**
 * tests/doctor/format-report.test.mjs — doctor report sorting, summary, and next steps.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sortChecksBySeverity,
  summarizeChecks,
  extractNextSteps,
  renderDoctorReport,
  symbolForCheck,
} from '../../lib/doctor/format-report.mjs';

test('sortChecksBySeverity orders fail, warn, then pass', () => {
  const checks = [
    { label: 'pass-a', pass: true },
    { label: 'fail-a', pass: false, optional: false },
    { label: 'warn-a', pass: false, optional: true },
    { label: 'pass-b', pass: true },
    { label: 'fail-b', pass: false, optional: false },
  ];
  const sorted = sortChecksBySeverity(checks).map((c) => c.label);
  assert.deepEqual(sorted, ['fail-a', 'fail-b', 'warn-a', 'pass-a', 'pass-b']);
});

test('symbolForCheck maps severity icons', () => {
  assert.equal(symbolForCheck({ pass: true }), '✓');
  assert.equal(symbolForCheck({ pass: false, optional: true }), '⚠');
  assert.equal(symbolForCheck({ pass: false, optional: false }), '✗');
});

test('extractNextSteps dedupes backtick commands from failing checks', () => {
  const steps = extractNextSteps([
    { pass: false, optional: true, label: 'Models — run `construct models --apply`' },
    { pass: false, optional: true, label: 'Again `construct models --apply`' },
    { pass: true, label: 'ok `construct doctor --fix`' },
  ], [{ id: 'adapter-prune' }]);
  assert.deepEqual(steps, ['construct models --apply', 'construct sync --reconcile=adapter-prune']);
});

test('alwaysShow passes remain visible in --summary mode', () => {
  const lines = [];
  renderDoctorReport({
    checks: [
      { label: 'Healthy thing', pass: true },
      { label: 'Workspace Preset: rnd (R&D) — `construct workspace-preset show`', pass: true, alwaysShow: true },
      { label: 'Advisory — run `construct models --apply`', pass: false, optional: true },
    ],
    showPasses: false,
    println: (line) => lines.push(line),
  });
  assert.ok(lines.some((l) => l.includes('Workspace Preset: rnd')));
  assert.ok(!lines.some((l) => l.includes('Healthy thing')));
});

test('renderDoctorReport prints failures before passes and suggests --fix', () => {
  const lines = [];
  const { failCount, warnCount, okCount } = renderDoctorReport({
    checks: [
      { label: 'Healthy thing', pass: true },
      { label: 'Broken thing — run `construct sync`', pass: false, optional: false },
      { label: 'Advisory — run `construct models --apply`', pass: false, optional: true },
    ],
    reconcileDrift: [],
    println: (line) => lines.push(line),
  });

  assert.equal(failCount, 1);
  assert.equal(warnCount, 1);
  assert.equal(okCount, 1);

  const brokenIdx = lines.findIndex((l) => l.includes('Broken thing'));
  const healthyIdx = lines.findIndex((l) => l.includes('Healthy thing'));
  assert.ok(brokenIdx >= 0 && healthyIdx >= 0);
  assert.ok(brokenIdx < healthyIdx, 'failures should print before passes');

  assert.ok(lines.some((l) => l.includes('Suggested next steps')));
  assert.ok(lines.some((l) => l.includes('construct doctor --fix')));
});
