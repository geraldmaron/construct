/**
 * tests/doctor-engine-health.test.mjs — `construct doctor` export-engine health
 * check (LMCP-K3).
 *
 * Covers lib/doctor/engine-health.mjs: an absent pandoc/typst/libreoffice/
 * pptxgenjs reports as a graceful (optional) finding naming the missing binary
 * and its owning export workflow, via PATH manipulation rather than assuming
 * anything about the host running the suite; a stubbed binary on PATH reports
 * present with its version. Also covers the consistency watcher wiring
 * (lib/doctor/watchers/consistency.mjs) surfacing absence as an actionable
 * warning finding.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkEngineHealthForDoctor, checkEngineHealthAllForDoctor, EXPORT_ENGINES } from '../lib/doctor/engine-health.mjs';
import { runAllChecks } from '../lib/doctor/watchers/consistency.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function emptyPathEnv(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return { ...process.env, PATH: dir, CONSTRUCT_LIBREOFFICE_BIN: '', SOFFICE_BIN: '' };
}

function stubBinaryPath(name, versionLine, prefix = 'cx-engine-health-stub-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  const binPath = path.join(dir, process.platform === 'win32' ? `${name}.cmd` : name);
  if (process.platform === 'win32') {
    fs.writeFileSync(binPath, `@echo off\necho ${versionLine}\n`);
  } else {
    fs.writeFileSync(binPath, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(versionLine)});\nprocess.exit(0);\n`);
    fs.chmodSync(binPath, 0o755);
  }
  return dir;
}

test('EXPORT_ENGINES names exactly the four export toolchain binaries', () => {
  assert.deepEqual(EXPORT_ENGINES.map((p) => p.id).sort(), ['libreoffice', 'pandoc', 'pptxgenjs', 'typst']);
});

test('checkEngineHealthForDoctor: absent pandoc is a graceful finding naming the binary and install hint', () => {
  const env = emptyPathEnv('cx-engine-health-pandoc-');
  const check = checkEngineHealthForDoctor('pandoc', { env });
  assert.equal(check.ok, true);
  assert.equal(check.installed, false);
  assert.equal(check.optional, true);
  assert.match(check.label, /Export engine 'pandoc' not installed/);
  assert.match(check.label, /document-export/);
  assert.match(check.label, /Install pandoc/);
});

test('checkEngineHealthForDoctor: absent typst is a graceful finding naming the binary and install hint', () => {
  const env = emptyPathEnv('cx-engine-health-typst-');
  const check = checkEngineHealthForDoctor('typst', { env });
  assert.equal(check.ok, true);
  assert.equal(check.installed, false);
  assert.match(check.label, /Export engine 'typst' not installed/);
  assert.match(check.label, /Install typst/);
});

// libreoffice's own presence probe (lib/libreoffice-export.mjs, out of K3's file
// scope) resolves candidates via an internal `which` call that does not forward
// the injected env, so it always searches the real process PATH regardless of
// what PATH this suite sets — on a dev machine with LibreOffice installed,
// PATH manipulation alone cannot force it absent. The injectable detectFn seam
// exercises the absent-branch formatting deterministically instead.

test('checkEngineHealthForDoctor: absent libreoffice is a graceful finding naming the binary and install hint', () => {
  const fakeDetect = (format) => ({ ok: true, format, missing: ['libreoffice'], binaries: [{ name: 'libreoffice', path: null, version: null }] });
  const check = checkEngineHealthForDoctor('libreoffice', { detectFn: fakeDetect });
  assert.equal(check.ok, true);
  assert.equal(check.installed, false);
  assert.match(check.label, /Export engine 'libreoffice' not installed/);
});

test('checkEngineHealthForDoctor: unknown engine id throws rather than reporting a silent pass', () => {
  assert.throws(() => checkEngineHealthForDoctor('not-a-real-engine'), /Unknown export engine/);
});

test('checkEngineHealthForDoctor: present binary reports installed with version', () => {
  const stubDir = stubBinaryPath('pandoc', 'pandoc 3.0.0-test');
  const env = { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH || ''}` };
  const check = checkEngineHealthForDoctor('pandoc', { env });
  assert.equal(check.ok, true);
  assert.equal(check.installed, true);
  assert.match(check.label, /Export engine 'pandoc'/);
  assert.match(check.label, /pandoc 3\.0\.0-test/);
});

test('checkEngineHealthAllForDoctor: reports one finding per engine, never throws when every engine is absent', () => {
  const missingByFormat = { html: 'pandoc', pdf: 'typst', doc: 'libreoffice', pptx: 'pptxgenjs' };
  const fakeDetect = (format) => ({ ok: true, format, missing: [missingByFormat[format]], binaries: [] });
  const findings = checkEngineHealthAllForDoctor({ detectFn: fakeDetect });
  assert.equal(findings.length, 4);
  assert.ok(findings.every((f) => f.ok === true && f.installed === false && f.optional === true));
});

test('consistency watcher: absent export engines surface as actionable warning findings, never blocking', async () => {
  const env = emptyPathEnv('cx-engine-health-consistency-');
  const preserved = { PATH: process.env.PATH, CONSTRUCT_LIBREOFFICE_BIN: process.env.CONSTRUCT_LIBREOFFICE_BIN, SOFFICE_BIN: process.env.SOFFICE_BIN };
  process.env.PATH = env.PATH;
  process.env.CONSTRUCT_LIBREOFFICE_BIN = '';
  process.env.SOFFICE_BIN = '';
  try {
    const result = await runAllChecks({ repoRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..') });
    const engineFindings = result.findings.filter((f) => f.category === 'export-engine-health');
    assert.ok(engineFindings.length > 0, 'expected export-engine-health findings with an empty PATH');
    assert.ok(engineFindings.every((f) => f.severity === 'warning'));
    assert.ok(engineFindings.every((f) => f.tier === 'actionable'));
  } finally {
    for (const [key, value] of Object.entries(preserved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
