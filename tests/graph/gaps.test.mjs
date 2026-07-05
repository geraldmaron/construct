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
      { id: 'workflow:mixed', type: 'workflow' },
      { id: 'workflow:fully-untested', type: 'workflow' },
      { id: 'capability:mixed-a', type: 'capability' },
      { id: 'capability:mixed-b', type: 'capability' },
      { id: 'capability:untested-only', type: 'capability' },
      { id: 'test:tests/mixed-a.test.mjs', type: 'test' },
    ],
    edges: [
      { from: 'capability:mixed-a', to: 'workflow:mixed', rel: 'embeds', source: 'registry' },
      { from: 'capability:mixed-b', to: 'workflow:mixed', rel: 'embeds', source: 'registry' },
      { from: 'capability:untested-only', to: 'workflow:fully-untested', rel: 'embeds', source: 'registry' },
      { from: 'test:tests/mixed-a.test.mjs', to: 'capability:mixed-a', rel: 'validates', source: 'registry' },
    ],
  });
  const gaps = findMissingTestCapabilities(root);
  assert.ok(gaps.capabilities.includes('capability:mixed-b'));
  assert.ok(gaps.capabilities.includes('capability:untested-only'));
  assert.ok(!gaps.workflows.includes('workflow:mixed'), 'mixed workflow has at least one tested embedding capability');
  assert.ok(gaps.workflows.includes('workflow:fully-untested'));
});

test('a workflow with no embedding capabilities at all is not flagged', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [{ id: 'workflow:orphan', type: 'workflow' }],
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
