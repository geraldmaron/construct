/**
 * tests/graph/build-co-change.test.mjs — co-change layer derives module nodes,
 * contains anchors, and git-history co_changes edges, and revives
 * captureDependencyPatterns (which also writes the entity store).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { buildCoChange } from '../../lib/graph/build-co-change.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function gitRepoWithCoChange() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'co-change-'));
  tmpDirs.push(root);
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: root, stdio: 'ignore' });
  git('init -q');
  git('config user.email test@example.com');
  git('config user.name Test');
  fs.mkdirSync(path.join(root, 'lib', 'a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib', 'b'), { recursive: true });

  // Four commits that touch lib/a and lib/b together clear the >=3 threshold.

  for (let i = 0; i < 4; i++) {
    fs.writeFileSync(path.join(root, 'lib', 'a', 'x.mjs'), `export const x = ${i};\n`);
    fs.writeFileSync(path.join(root, 'lib', 'b', 'y.mjs'), `export const y = ${i};\n`);
    git('add -A');
    git(`commit -q -m change-${i}`);
  }
  return root;
}

test('module nodes and contains edges anchor source files', () => {
  const root = gitRepoWithCoChange();

  // moduleOf groups by the first two path segments to stay aligned with the
  // co_changes keys, so anchors use directory-bearing (3-segment) paths.

  const { nodes, edges } = buildCoChange({ rootDir: root, sourceRels: ['lib/a/x.mjs', 'lib/b/y.mjs', 'tests/graph/z.test.mjs'] });
  const moduleIds = new Set(nodes.filter((n) => n.type === 'module').map((n) => n.id));
  assert.ok(moduleIds.has('module:lib/a'));
  assert.ok(moduleIds.has('module:tests/graph'));

  const contains = edges.filter((e) => e.rel === 'contains');
  assert.ok(contains.some((e) => e.from === 'module:lib/a' && e.to === 'file:lib/a/x.mjs'));
  assert.ok(contains.some((e) => e.from === 'module:tests/graph' && e.to === 'test:tests/graph/z.test.mjs'));
});

test('co_changes edge is derived from git history above the threshold', () => {
  const root = gitRepoWithCoChange();
  const { edges } = buildCoChange({ rootDir: root, sourceRels: [] });
  const co = edges.filter((e) => e.rel === 'co_changes');
  const ab = co.find((e) => e.from === 'module:lib/a' && e.to === 'module:lib/b');
  assert.ok(ab, 'lib/a and lib/b co-change');
  assert.ok(ab.weight >= 3, `weight should clear threshold, got ${ab.weight}`);
});

test('reviving captureDependencyPatterns also writes the entity store', () => {
  const root = gitRepoWithCoChange();
  buildCoChange({ rootDir: root, sourceRels: [] });
  const entitiesFile = path.join(root, '.cx', 'observations', 'entities.json');
  assert.ok(fs.existsSync(entitiesFile), 'entity store written by captureDependencyPatterns');
  const entities = JSON.parse(fs.readFileSync(entitiesFile, 'utf8'));
  assert.ok(entities.some((e) => e.type === 'file-group'), 'file-group entities recorded');
});

test('no git history yields no co_changes but still anchors modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'co-change-nogit-'));
  tmpDirs.push(root);
  const { nodes, edges } = buildCoChange({ rootDir: root, sourceRels: ['lib/a/x.mjs'] });
  assert.equal(edges.filter((e) => e.rel === 'co_changes').length, 0);
  assert.ok(nodes.some((n) => n.id === 'module:lib/a'));
});
