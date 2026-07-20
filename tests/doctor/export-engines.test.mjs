/**
 * tests/doctor/export-engines.test.mjs — compact export engine doctor lines.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExportEngineChecks } from '../../lib/doctor/export-engines.mjs';

test('collapses missing engines into one optional skip line', () => {
  const checks = buildExportEngineChecks({
    detectFn: () => ({ missing: ['pandoc', 'libreoffice'], binaries: [] }),
  });
  assert.equal(checks.length, 1);
  assert.match(checks[0].label, /Document export engines: optional, not installed/);
  assert.equal(checks[0].pass, true);
});

test('summarizes ready engines in one line by default', () => {
  const checks = buildExportEngineChecks({
    detectFn: () => ({ missing: [], binaries: [{ name: 'pandoc' }, { name: 'typst' }] }),
  });
  assert.equal(checks.length, 1);
  assert.match(checks[0].label, /Document export engines: ready/);
});

test('verbose mode expands per-engine lines when engines are missing', () => {
  const checks = buildExportEngineChecks({
    verbose: true,
    detectFn: () => ({ missing: ['libreoffice'], binaries: [{ name: 'pandoc', version: '3.0' }] }),
  });
  assert.ok(checks.length > 1);
  assert.ok(checks.some((c) => c.label.includes("Export engine 'libreoffice'")));
});
