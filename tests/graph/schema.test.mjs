/**
 * tests/graph/schema.test.mjs — strict living-graph schema validation.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateSchema } from '../../lib/graph/schema.mjs';
import { writeGraph, loadGraph, nodeId } from '../../lib/graph/store.mjs';

const constructGraphTestHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-schema-home-'));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-schema-'));
  tmpDirs.push(root);
  return root;
}

test('invalid node type is reported by validateSchema', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [{ id: 'flie:bad', type: 'flie', name: 'bad' }],
    edges: [],
  });
  const graph = loadGraph(root);
  const result = validateSchema(graph);
  assert.ok(result.errors.some((e) => e.includes("unknown type 'flie'")));
});

test('invalid edge rel is reported by validateSchema', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('procedure', 'w1'), type: 'procedure', name: 'w1' },
      { id: nodeId('capability', 'c1'), type: 'capability', name: 'c1' },
    ],
    edges: [{ from: nodeId('capability', 'c1'), to: nodeId('procedure', 'w1'), rel: 'improts' }],
  });
  const graph = loadGraph(root);
  const result = validateSchema(graph);
  assert.ok(result.errors.some((e) => e.includes("unknown rel 'improts'")));
});

test('edge with empty provenance is reported by validateSchema', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('procedure', 'w1'), type: 'procedure', name: 'w1' },
      { id: nodeId('capability', 'c1'), type: 'capability', name: 'c1' },
    ],
    edges: [{ from: nodeId('capability', 'c1'), to: nodeId('procedure', 'w1'), rel: 'embeds' }],
  });
  const graph = loadGraph(root);
  const result = validateSchema(graph);
  assert.ok(result.errors.some((e) => e.includes('no provenance') || e.includes('empty sources')));
});

test('partial meta is preserved by writeGraph', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [{ id: nodeId('procedure', 'w1'), type: 'procedure', name: 'w1' }],
    edges: [],
    partial: true,
    partialReasons: ['fixture: builder stopped early'],
  });
  const graph = loadGraph(root);
  assert.equal(graph.meta?.partial, true);
  assert.deepEqual(graph.meta?.partialReasons, ['fixture: builder stopped early']);
});
