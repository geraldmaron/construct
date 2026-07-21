/**
 * tests/graph/verify.test.mjs — graph verify guardrail unit tests.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { verifyGraph } from '../../lib/graph/verify.mjs';
import { writeGraph, nodeId } from '../../lib/graph/store.mjs';

const constructGraphTestHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-verify-home-'));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-verify-'));
  tmpDirs.push(root);
  return root;
}

test('verify fails on partial graph and names the reason', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [{ id: nodeId('workflow', 'w1'), type: 'workflow', name: 'w1' }],
    edges: [],
    partial: true,
    partialReasons: ['buildFromRegistry: modular org not found'],
  });
  const result = verifyGraph(root);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.kind === 'partial-graph' && v.message.includes('modular org not found')));
});

test('verify fails on schema violation and names the bad type', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [{ id: 'flie:bad', type: 'flie', name: 'bad' }],
    edges: [],
  });
  const result = verifyGraph(root);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.kind === 'schema' && v.message.includes("unknown type 'flie'")));
});

test('verify passes on a minimal valid non-partial graph', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('workflow', 'demo'), type: 'workflow', name: 'demo' },
      { id: nodeId('capability', 'demo'), type: 'capability', name: 'demo' },
      { id: nodeId('test', 'demo.test.mjs'), type: 'test', name: 'demo.test.mjs' },
    ],
    edges: [
      { from: nodeId('capability', 'demo'), to: nodeId('workflow', 'demo'), rel: 'embeds', source: 'registry' },
      { from: nodeId('test', 'demo.test.mjs'), to: nodeId('capability', 'demo'), rel: 'validates', source: 'corpus-annotation' },
    ],
    partial: false,
  });
  const result = verifyGraph(root);
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});
