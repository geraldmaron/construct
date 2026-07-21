/**
 * tests/validate-dep-intent.test.mjs — dependency-intent usage scan regressions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { auditDepIntent, auditDepBudget } from '../scripts/validate-dep-intent.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('auditDepIntent warns when a runtime npm dep has zero lib/bin imports', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'dep-intent-unused-'));
  t.after(() => rmTmpDir(root));
  writeJson(path.join(root, 'package.json'), {
    dependencies: { usedpkg: '1.0.0', driftpkg: '1.0.0' },
  });
  fs.mkdirSync(path.join(root, 'deps'), { recursive: true });
  writeJson(path.join(root, 'deps', 'intent.json'), [
    {
      id: 'usedpkg',
      kind: 'npm-dep',
      disposition: 'core',
      purpose: 'Used in lib',
    },
    {
      id: 'driftpkg',
      kind: 'npm-dep',
      disposition: 'optional',
      purpose: 'Declared but never imported',
    },
    {
      id: 'zod',
      kind: 'npm-optional',
      disposition: 'remove',
      purpose: 'Tombstone after removal',
    },
  ]);
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  writeFileSync(path.join(root, 'lib', 'app.mjs'), "import x from 'usedpkg';\nexport { x };\n", 'utf8');

  const result = auditDepIntent({
    rootDir: root,
    pkgPath: path.join(root, 'package.json'),
    intentPath: path.join(root, 'deps', 'intent.json'),
  });

  assert.deepEqual(result.declaredButUnused, ['driftpkg']);
  assert.equal(result.exitCode, 0);
});

test('auditDepIntent does not warn for imported runtime npm deps', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'dep-intent-used-'));
  t.after(() => rmTmpDir(root));
  writeJson(path.join(root, 'package.json'), {
    dependencies: { yaml: '1.0.0' },
  });
  fs.mkdirSync(path.join(root, 'deps'), { recursive: true });
  writeJson(path.join(root, 'deps', 'intent.json'), [
    {
      id: 'yaml',
      kind: 'npm-dep',
      disposition: 'core',
      purpose: 'YAML parsing',
    },
  ]);
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  writeFileSync(path.join(root, 'lib', 'load.mjs'), "import yaml from 'yaml';\nexport default yaml;\n", 'utf8');

  const result = auditDepIntent({
    rootDir: root,
    pkgPath: path.join(root, 'package.json'),
    intentPath: path.join(root, 'deps', 'intent.json'),
  });

  assert.deepEqual(result.declaredButUnused, []);
  assert.equal(result.exitCode, 0);
});

test('live repo zod tombstone is not flagged as declared-but-unused', () => {
  const repo = path.resolve(import.meta.dirname, '..');
  const result = auditDepIntent({ rootDir: repo });
  assert.ok(!result.declaredButUnused.includes('zod'));
});

test('live repo auditDepIntent reports declared-but-unused runtime npm deps', () => {
  const repo = path.resolve(import.meta.dirname, '..');
  const result = auditDepIntent({ rootDir: repo });
  assert.ok(
    result.declaredButUnused.length > 0,
    `expected at least one declared-but-unused runtime npm dep on the live tree, got ${result.declaredButUnused.length}`,
  );
});

test('auditDepBudget passes for the live repo inventory', () => {
  const repo = path.resolve(import.meta.dirname, '..');
  const result = auditDepBudget({
    pkgPath: path.join(repo, 'package.json'),
    intentPath: path.join(repo, 'deps', 'intent.json'),
    budgetPath: path.join(repo, 'deps', 'budget.json'),
  });
  assert.deepEqual(result.overBudget, []);
  assert.equal(result.exitCode, 0);
  assert.ok(result.counts.runtimeTotal > 0);
});

test('auditDepBudget warns when a tier exceeds its ceiling', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dep-budget-over-'));
  writeJson(path.join(root, 'package.json'), {
    dependencies: { alpha: '1.0.0', beta: '1.0.0' },
  });
  fs.mkdirSync(path.join(root, 'deps'), { recursive: true });
  writeJson(path.join(root, 'deps', 'intent.json'), [
    { id: 'alpha', disposition: 'core', kind: 'npm-dep' },
    { id: 'beta', disposition: 'core', kind: 'npm-dep' },
  ]);
  writeJson(path.join(root, 'deps', 'budget.json'), {
    warnFirst: true,
    ceilings: { core: 1, optional: 0, 'provider-plugin': 0, runtimeTotal: 2 },
  });

  const result = auditDepBudget({
    rootDir: root,
    pkgPath: path.join(root, 'package.json'),
    intentPath: path.join(root, 'deps', 'intent.json'),
    budgetPath: path.join(root, 'deps', 'budget.json'),
  });

  assert.equal(result.overBudget.length, 1);
  assert.equal(result.overBudget[0].tier, 'core');
  assert.equal(result.exitCode, 0);
  rmTmpDir(root);
});

test('auditDepBudget exits non-zero when warnFirst is false and over budget', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dep-budget-enforce-'));
  writeJson(path.join(root, 'package.json'), {
    dependencies: { alpha: '1.0.0', beta: '1.0.0' },
  });
  fs.mkdirSync(path.join(root, 'deps'), { recursive: true });
  writeJson(path.join(root, 'deps', 'intent.json'), [
    { id: 'alpha', disposition: 'core', kind: 'npm-dep' },
    { id: 'beta', disposition: 'core', kind: 'npm-dep' },
  ]);
  writeJson(path.join(root, 'deps', 'budget.json'), {
    warnFirst: false,
    ceilings: { core: 1, runtimeTotal: 2 },
  });

  const result = auditDepBudget({
    rootDir: root,
    pkgPath: path.join(root, 'package.json'),
    intentPath: path.join(root, 'deps', 'intent.json'),
    budgetPath: path.join(root, 'deps', 'budget.json'),
  });

  assert.equal(result.overBudget.length, 1);
  assert.equal(result.exitCode, 1);
  rmTmpDir(root);
});
