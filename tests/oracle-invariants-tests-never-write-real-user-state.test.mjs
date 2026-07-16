/**
 * tests/oracle-invariants-tests-never-write-real-user-state.test.mjs — the
 * `tests-never-write-real-user-state` Layer 1 invariant: doctorRoot() write-site
 * scanning, coverage derivation from the real sterile-host-env guard, and the
 * covered/uncovered rollup, all against a real hermetic fixture tree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  id,
  layer,
  scanLibForDoctorRootSegments,
  loadCoveredSegments,
  check,
} from '../lib/oracle/invariants/tests-never-write-real-user-state.mjs';

function makeFixtureRepo(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-user-state-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const libDir = path.join(cwd, 'lib');
  fs.mkdirSync(path.join(libDir, 'nested'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'tests', 'helpers'), { recursive: true });

  fs.writeFileSync(
    path.join(libDir, 'direct-write.mjs'),
    "import { join } from 'node:path';\nimport { doctorRoot } from './xdg.mjs';\nexport const P = join(doctorRoot(), 'covered-class', 'file.json');\n",
  );
  fs.writeFileSync(
    path.join(libDir, 'nested', 'aliased-write.mjs'),
    "import path from 'node:path';\nimport { doctorRoot } from '../xdg.mjs';\nconst CX_DIR = doctorRoot();\nexport const P = path.join(CX_DIR, 'uncovered-class', 'other.json');\n",
  );

  fs.writeFileSync(
    path.join(cwd, 'tests', 'helpers', 'sterile-host-env.mjs'),
    [
      "export function fingerprintRealConfigs(home) {",
      "  return {",
      "    'doctorRoot:covered-class': 'x',",
      "  };",
      "}",
    ].join('\n'),
  );

  return cwd;
}

test('invariant module exports id/layer per the registry contract', () => {
  assert.equal(id, 'tests-never-write-real-user-state');
  assert.equal(layer, 1);
});

test('scanLibForDoctorRootSegments finds both direct and variable-aliased doctorRoot() write sites', (t) => {
  const cwd = makeFixtureRepo(t);
  const found = scanLibForDoctorRootSegments(path.join(cwd, 'lib'));
  assert.ok(found.has('covered-class'));
  assert.ok(found.has('uncovered-class'));
  assert.match(found.get('covered-class')[0], /direct-write\.mjs:\d+/);
  assert.match(found.get('uncovered-class')[0], /aliased-write\.mjs:\d+/);
});

test('scanLibForDoctorRootSegments excludes its own directory to avoid self-matching its docstring examples', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-user-state-self-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const invariantsDir = path.join(cwd, 'lib', 'oracle', 'invariants');
  fs.mkdirSync(invariantsDir, { recursive: true });
  fs.writeFileSync(
    path.join(invariantsDir, 'self-referential.mjs'),
    "// example: join(doctorRoot(), 'should-not-be-scanned')\n",
  );
  const found = scanLibForDoctorRootSegments(path.join(cwd, 'lib'));
  assert.equal(found.size, 0, 'text under lib/oracle/invariants/ must not be scanned as a production write site');
});

test('loadCoveredSegments derives coverage from the real fingerprintRealConfigs export, not a hardcoded list', async (t) => {
  const cwd = makeFixtureRepo(t);
  const covered = await loadCoveredSegments(cwd);
  assert.ok(covered.has('covered-class'));
  assert.ok(!covered.has('uncovered-class'));
});

test('loadCoveredSegments credits audit-trail.jsonl and approvals only when the guard still defines their marker functions', async (t) => {
  const cwd = makeFixtureRepo(t);
  let covered = await loadCoveredSegments(cwd);
  assert.ok(!covered.has('audit-trail.jsonl'));
  assert.ok(!covered.has('approvals'));

  fs.appendFileSync(
    path.join(cwd, 'tests', 'helpers', 'sterile-host-env.mjs'),
    '\nfunction countAuditTrailTestLeaks() {}\nfunction countApprovalQueueTestLeaks() {}\n',
  );
  covered = await loadCoveredSegments(cwd);
  assert.ok(covered.has('audit-trail.jsonl'));
  assert.ok(covered.has('approvals'));
});

test('check(): a doctorRoot() write site absent from the guard coverage is a violation', async (t) => {
  const cwd = makeFixtureRepo(t);
  const result = await check({ cwd });
  assert.equal(result.status, 'failed');
  const uncovered = result.violations.find((v) => v.segment === 'uncovered-class');
  assert.ok(uncovered);
  const covered = result.results.find((r) => r.segment === 'covered-class');
  assert.equal(covered.status, 'passed');
});

test('check(): every write site covered rolls up to passed', async (t) => {
  const cwd = makeFixtureRepo(t);
  fs.rmSync(path.join(cwd, 'lib', 'nested'), { recursive: true, force: true });
  const result = await check({ cwd });
  assert.equal(result.status, 'passed');
  assert.equal(result.violations.length, 0);
});

test('check(): a missing sterile-host-env.mjs degrades to collection-error, not a crash', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-user-state-missing-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, 'lib'), { recursive: true });
  const result = await check({ cwd });
  assert.equal(result.status, 'collection-error');
});
