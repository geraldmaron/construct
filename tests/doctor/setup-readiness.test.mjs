/**
 * tests/doctor/setup-readiness.test.mjs — pre-setup HOME advisory collapse.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isMachineSetupComplete,
  isPreSetupCollapsibleAdvisory,
  prepareChecksForPreSetupReport,
} from '../../lib/doctor/setup-readiness.mjs';
import { renderDoctorReport } from '../../lib/doctor/format-report.mjs';

test('isMachineSetupComplete is false for an empty HOME', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-setup-'));
  try {
    assert.equal(isMachineSetupComplete(home), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('isMachineSetupComplete is true when config.env exists', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-setup-'));
  try {
    const configRoot = path.join(home, '.config', 'construct');
    fs.mkdirSync(configRoot, { recursive: true });
    fs.writeFileSync(path.join(configRoot, 'config.env'), 'BOOTSTRAP_CHECKED=1\n');
    assert.equal(isMachineSetupComplete(home), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('prepareChecksForPreSetupReport collapses expected advisories before install', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-setup-'));
  try {
    const checks = [
      { label: 'Broken registry file', pass: false, optional: false },
      { label: 'User config not ready — run `construct install --footprint=user`', pass: false, optional: true },
      { label: 'Models — no tier configured (run `construct models --apply`)', pass: false, optional: true },
      { label: 'OpenCode config exists', pass: false, optional: true },
      { label: 'Workspace Preset: rnd (Software R&D) — `construct workspace-preset show`', pass: true, alwaysShow: true },
      { label: 'Node.js 20+ (recommended)', pass: true },
    ];

    const { checks: prepared, collapsedCount } = prepareChecksForPreSetupReport(checks, { homeDir: home });
    assert.equal(collapsedCount, 2);
    assert.ok(prepared.some((check) => check.label.includes('Pre-setup:')));
    assert.ok(!prepared.some((check) => check.label.startsWith('Models —')));
    assert.ok(!prepared.some((check) => check.label === 'OpenCode config exists'));
    assert.ok(prepared.some((check) => check.label.includes('Broken registry file')));
    assert.ok(prepared.some((check) => check.alwaysShow));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('renderDoctorReport hides pre-setup advisory flood on empty HOME', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-setup-'));
  try {
    const lines = [];
    renderDoctorReport({
      homeDir: home,
      checks: [
        { label: 'User config not ready — run `construct install --footprint=user`', pass: false, optional: true },
        { label: 'Models — no tier configured (run `construct models --apply`)', pass: false, optional: true },
        { label: 'OpenCode config exists', pass: false, optional: true },
        { label: 'Claude Code agents dir', pass: false, optional: true },
        { label: 'Node.js 20+ (recommended)', pass: true },
      ],
      println: (line) => lines.push(line),
    });

    const warnings = lines.filter((line) => line.includes('⚠'));
    assert.ok(warnings.length <= 3, `expected <=3 warnings, got ${warnings.length}: ${warnings.join(' | ')}`);
    assert.ok(lines.some((line) => line.includes('Pre-setup:')));
    assert.ok(!lines.some((line) => line.includes('OpenCode config exists')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('isPreSetupCollapsibleAdvisory ignores real failures', () => {
  assert.equal(
    isPreSetupCollapsibleAdvisory({ label: 'construct.config.json invalid: bad json', pass: false, optional: false }),
    false,
  );
});
