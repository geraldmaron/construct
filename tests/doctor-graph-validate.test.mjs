/**
 * tests/doctor-graph-validate.test.mjs — `construct doctor` graph-validate check.
 *
 * Covers lib/doctor/graph-validate.mjs: the check passes on a valid graph,
 * fails on a graph with structural errors, and reports a warning (not a hard
 * failure) when no graph has been built yet — matching validateGraph's own
 * no-graph-found handling in lib/graph/validate.mjs.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkGraphValidateForDoctor } from '../lib/doctor/graph-validate.mjs';
import { writeGraph, nodeId } from '../lib/graph/store.mjs';

// the relational graph store (lib/graph/relational/)
// resolves graph.db under the machine-scoped state root (resolveStateDir)
// whenever writeGraph/loadGraph touch the host graph on Node
// >=22.5. Pin CONSTRUCT_HOME_OVERRIDE so this suite never provisions state under
// the real developer machine's ~/.construct/projects/ (the isolation
// contract, tests/functional/README.md) — the same pattern
// tests/orchestration-run-store-sqlite.test.mjs already established.

const constructGraphTestHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-test-home-'));
const constructGraphTestPrevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestHomeOverride;
test.after(() => {
  try { fs.rmSync(constructGraphTestHomeOverride, { recursive: true, force: true }); } catch {}
  if (constructGraphTestPrevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestPrevHomeOverride;
});


const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-graph-validate-'));
  tmpDirs.push(root);
  return root;
}

test('checkGraphValidateForDoctor: no graph built yet is a soft warning, not a failure', () => {
  const root = freshRoot();
  const check = checkGraphValidateForDoctor({ rootDir: root });
  assert.equal(check.ok, true);
  assert.equal(check.warning, true);
  assert.match(check.label, /not built yet/);
});

test('checkGraphValidateForDoctor: valid graph passes with zero errors', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('procedure', 'w1'), type: 'procedure', name: 'w1' },
      { id: nodeId('capability', 'c1'), type: 'capability', name: 'c1' },
    ],
    edges: [
      { from: nodeId('capability', 'c1'), to: nodeId('procedure', 'w1'), rel: 'embeds', source: 'registry' },
    ],
  });
  const check = checkGraphValidateForDoctor({ rootDir: root });
  assert.equal(check.ok, true);
  assert.match(check.label, /Living graph valid/);
  assert.equal(check.errors.length, 0);
});

test('checkGraphValidateForDoctor: structural error in strict mode fails the check', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('doc', 'docs/missing.md'), type: 'doc', name: 'docs/missing.md', attrs: { path: 'docs/missing.md' } },
    ],
    edges: [],
  });
  const check = checkGraphValidateForDoctor({ rootDir: root, strict: true });
  assert.equal(check.ok, false);
  assert.match(check.label, /Living graph invalid/);
  assert.ok(check.errors.some((e) => e.includes('docs/missing.md')));
});

test('checkGraphValidateForDoctor: same warning in non-strict mode still passes', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('doc', 'docs/missing.md'), type: 'doc', name: 'docs/missing.md', attrs: { path: 'docs/missing.md' } },
    ],
    edges: [],
  });
  const check = checkGraphValidateForDoctor({ rootDir: root, strict: false });
  assert.equal(check.ok, true);
  assert.ok(check.warnings.some((w) => w.includes('docs/missing.md')));
});
