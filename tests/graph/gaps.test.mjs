/**
 * tests/graph/gaps.test.mjs — missing-tests gap query over a synthetic graph.
 *
 * Pins: a capability with zero inbound validates edges is flagged; a
 * capability validated by any source (registry or corpus-annotation) is not;
 * a workflow is flagged only when every capability that embeds it is
 * untested — a mixed workflow (one tested capability, one untested) is not
 * flagged, since it is a partial, not total, coverage gap; a missing graph
 * reports graphPresent=false without throwing.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeGraph } from '../../lib/graph/store.mjs';
import { findMissingTestCapabilities } from '../../lib/graph/gaps.mjs';

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-gaps-'));
  tmpDirs.push(root);
  return root;
}

test('a capability with zero inbound validates edges is flagged', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:tested', type: 'capability' },
      { id: 'capability:untested', type: 'capability' },
      { id: 'test:tests/tested.test.mjs', type: 'test' },
    ],
    edges: [
      { from: 'test:tests/tested.test.mjs', to: 'capability:tested', rel: 'validates', source: 'registry' },
    ],
  });
  const gaps = findMissingTestCapabilities(root);
  assert.deepEqual(gaps.capabilities, ['capability:untested']);
});

test('a capability validated only via corpus-annotation is not flagged', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:annotated', type: 'capability' },
      { id: 'test:tests/annotated.test.mjs', type: 'test' },
    ],
    edges: [
      { from: 'test:tests/annotated.test.mjs', to: 'capability:annotated', rel: 'validates', source: 'corpus-annotation' },
    ],
  });
  const gaps = findMissingTestCapabilities(root);
  assert.deepEqual(gaps.capabilities, []);
});

test('a workflow is flagged only when every embedding capability is untested', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'procedure:mixed', type: 'procedure' },
      { id: 'procedure:fully-untested', type: 'procedure' },
      { id: 'capability:mixed-a', type: 'capability' },
      { id: 'capability:mixed-b', type: 'capability' },
      { id: 'capability:untested-only', type: 'capability' },
      { id: 'test:tests/mixed-a.test.mjs', type: 'test' },
    ],
    edges: [
      { from: 'capability:mixed-a', to: 'procedure:mixed', rel: 'embeds', source: 'registry' },
      { from: 'capability:mixed-b', to: 'procedure:mixed', rel: 'embeds', source: 'registry' },
      { from: 'capability:untested-only', to: 'procedure:fully-untested', rel: 'embeds', source: 'registry' },
      { from: 'test:tests/mixed-a.test.mjs', to: 'capability:mixed-a', rel: 'validates', source: 'registry' },
    ],
  });
  const gaps = findMissingTestCapabilities(root);
  assert.ok(gaps.capabilities.includes('capability:mixed-b'));
  assert.ok(gaps.capabilities.includes('capability:untested-only'));
  assert.ok(!gaps.workflows.includes('procedure:mixed'), 'mixed workflow has at least one tested embedding capability');
  assert.ok(gaps.workflows.includes('procedure:fully-untested'));
});

test('a workflow with no embedding capabilities at all is not flagged', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [{ id: 'procedure:orphan', type: 'procedure' }],
    edges: [],
  });
  const gaps = findMissingTestCapabilities(root);
  assert.deepEqual(gaps.workflows, []);
});

test('missing graph reports graphPresent=false without throwing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-gaps-empty-'));
  tmpDirs.push(root);
  const gaps = findMissingTestCapabilities(root);
  assert.equal(gaps.graphPresent, false);
  assert.deepEqual(gaps.capabilities, []);
  assert.deepEqual(gaps.workflows, []);
});
