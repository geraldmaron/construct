/**
 * tests/graph/impact.test.mjs — change-impact selection over a synthetic graph.
 *
 * Pins the Test Impact Analysis contract: a changed file selects tests that
 * transitively import it and tests that validate a capability it realizes;
 * impacted capabilities roll up to workflows; a changed impl with no realizes
 * edge is reported as a coverage gap; unknown files are surfaced, not silently
 * dropped.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeGraph } from '../../lib/graph/store.mjs';
import { computeImpact } from '../../lib/graph/impact.mjs';

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

function graphRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-'));
  tmpDirs.push(root);

  // a.mjs <-imports- b.mjs <-imports- test_b ; a realizes cap:c which embeds wf:w
  // and is validated by test_cap. orphan.mjs realizes nothing.

  writeGraph(root, {
    nodes: [
      { id: 'file:lib/a.mjs', type: 'file' },
      { id: 'file:lib/b.mjs', type: 'file' },
      { id: 'file:lib/orphan.mjs', type: 'file' },
      { id: 'test:tests/b.test.mjs', type: 'test' },
      { id: 'test:tests/cap.test.mjs', type: 'test' },
      { id: 'capability:c', type: 'capability' },
      { id: 'procedure:w', type: 'procedure' },
    ],
    edges: [
      { from: 'file:lib/b.mjs', to: 'file:lib/a.mjs', rel: 'imports', source: 'import-graph' },
      { from: 'test:tests/b.test.mjs', to: 'file:lib/b.mjs', rel: 'imports', source: 'import-graph' },
      { from: 'file:lib/a.mjs', to: 'capability:c', rel: 'realizes', source: 'import-graph' },
      { from: 'test:tests/cap.test.mjs', to: 'capability:c', rel: 'validates', source: 'registry' },
      { from: 'capability:c', to: 'procedure:w', rel: 'embeds', source: 'registry' },
    ],
  });
  return root;
}

test('a changed file selects transitive-importer tests and validating tests', () => {
  const root = graphRoot();
  const r = computeImpact({ rootDir: root, changedFiles: ['lib/a.mjs'] });

  assert.ok(r.graphPresent);
  assert.deepEqual(r.affectedTests, ['tests/b.test.mjs', 'tests/cap.test.mjs']);
  assert.deepEqual(r.impactedCapabilities, ['c']);
  assert.deepEqual(r.impactedWorkflows, ['w']);
  assert.deepEqual(r.coverageGaps, []);
  assert.ok(Array.isArray(r.staleCapabilities));
});

test('a changed impl realizing no capability is a coverage gap', () => {
  const root = graphRoot();
  const r = computeImpact({ rootDir: root, changedFiles: ['lib/orphan.mjs'] });
  assert.deepEqual(r.coverageGaps, ['lib/orphan.mjs']);
  assert.deepEqual(r.impactedCapabilities, []);
  assert.deepEqual(r.affectedTests, []);
});

test('a changed test file selects itself', () => {
  const root = graphRoot();
  const r = computeImpact({ rootDir: root, changedFiles: ['tests/b.test.mjs'] });
  assert.ok(r.affectedTests.includes('tests/b.test.mjs'));
});

test('files not in the graph are surfaced as unknown, not dropped', () => {
  const root = graphRoot();
  const r = computeImpact({ rootDir: root, changedFiles: ['README.md', 'lib/a.mjs'] });
  assert.deepEqual(r.unknown, ['README.md']);
  assert.ok(r.impactedCapabilities.includes('c'));
});

test('missing graph reports graphPresent=false without throwing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-empty-'));
  tmpDirs.push(root);
  const r = computeImpact({ rootDir: root, changedFiles: ['lib/a.mjs'] });
  assert.equal(r.graphPresent, false);
  assert.deepEqual(r.affectedTests, []);
});
