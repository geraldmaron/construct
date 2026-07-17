/**
 * tests/graph/build-source-links.test.mjs — unit coverage for
 * lib/graph/build-source-links.mjs (construct-wjap9.2).
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildSourceLinks } from '../../lib/graph/build-source-links.mjs';

function freshProject(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cx-build-source-links-'));
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  return dir;
}

test('returns empty nodes/edges when none of the artifact dirs exist', (t) => {
  const rootDir = freshProject(t);
  const result = buildSourceLinks({ rootDir });
  assert.deepEqual(result, { nodes: [], edges: [] });
});

test('a PRD with a sources: block produces a doc node, a source node, and a derived_from edge', (t) => {
  const rootDir = freshProject(t);
  mkdirSync(join(rootDir, 'docs', 'specs', 'prd'), { recursive: true });
  writeFileSync(
    join(rootDir, 'docs', 'specs', 'prd', 'checkout.md'),
    '---\nsources:\n  - target: platform-docs\n    pinned: abc1234\n---\n# Checkout PRD\n',
  );

  const { nodes, edges } = buildSourceLinks({ rootDir });
  const docNode = nodes.find((n) => n.type === 'doc');
  const sourceNode = nodes.find((n) => n.type === 'source');
  assert.ok(docNode, 'expected a doc node');
  assert.equal(docNode.id, 'doc:docs/specs/prd/checkout.md');
  assert.ok(sourceNode, 'expected a source node');
  assert.equal(sourceNode.id, 'source:platform-docs');
  assert.equal(sourceNode.name, 'platform-docs');

  assert.equal(edges.length, 1);
  assert.equal(edges[0].from, docNode.id);
  assert.equal(edges[0].to, sourceNode.id);
  assert.equal(edges[0].rel, 'derived_from');
  assert.equal(edges[0].source, 'source-link');
  assert.equal(edges[0].attrs.pinned, 'abc1234');
});

test('a sources: entry with no pinned field omits attrs entirely', (t) => {
  const rootDir = freshProject(t);
  mkdirSync(join(rootDir, 'docs', 'decisions', 'adr'), { recursive: true });
  writeFileSync(
    join(rootDir, 'docs', 'decisions', 'adr', '0099-example.md'),
    '---\nsources:\n  - target: platform-docs\n---\n# ADR\n',
  );

  const { edges } = buildSourceLinks({ rootDir });
  assert.equal(edges.length, 1);
  assert.equal(edges[0].attrs, undefined);
});

test('a plain string entry in sources: (no object form) still links by target id', (t) => {
  const rootDir = freshProject(t);
  mkdirSync(join(rootDir, '.construct', 'knowledge'), { recursive: true });
  writeFileSync(
    join(rootDir, '.construct', 'knowledge', 'note.md'),
    '---\nsources:\n  - platform-docs\n---\n# Note\n',
  );

  const { nodes, edges } = buildSourceLinks({ rootDir });
  assert.ok(nodes.some((n) => n.id === 'source:platform-docs'));
  assert.equal(edges.length, 1);
  assert.equal(edges[0].to, 'source:platform-docs');
});

test('two artifacts linking the same target share one source node, not a duplicate', (t) => {
  const rootDir = freshProject(t);
  mkdirSync(join(rootDir, 'docs', 'specs', 'prd'), { recursive: true });
  writeFileSync(join(rootDir, 'docs', 'specs', 'prd', 'a.md'), '---\nsources:\n  - target: shared\n---\n# A\n');
  writeFileSync(join(rootDir, 'docs', 'specs', 'prd', 'b.md'), '---\nsources:\n  - target: shared\n---\n# B\n');

  const { nodes, edges } = buildSourceLinks({ rootDir });
  const sourceNodes = nodes.filter((n) => n.id === 'source:shared');
  assert.equal(sourceNodes.length, 1, 'exactly one source node, not one per referencing artifact');
  assert.equal(edges.length, 2);
});

test('an artifact with no frontmatter at all is skipped, not an error', (t) => {
  const rootDir = freshProject(t);
  mkdirSync(join(rootDir, 'docs', 'specs', 'prd'), { recursive: true });
  writeFileSync(join(rootDir, 'docs', 'specs', 'prd', 'plain.md'), '# Plain PRD, no frontmatter\n');

  const { nodes, edges } = buildSourceLinks({ rootDir });
  assert.deepEqual(nodes, []);
  assert.deepEqual(edges, []);
});

test('an artifact with frontmatter but no sources: field is skipped', (t) => {
  const rootDir = freshProject(t);
  mkdirSync(join(rootDir, 'docs', 'specs', 'prd'), { recursive: true });
  writeFileSync(join(rootDir, 'docs', 'specs', 'prd', 'other.md'), '---\ntitle: Other PRD\n---\n# Other\n');

  const { nodes, edges } = buildSourceLinks({ rootDir });
  assert.deepEqual(nodes, []);
  assert.deepEqual(edges, []);
});

test('malformed YAML frontmatter is skipped without throwing', (t) => {
  const rootDir = freshProject(t);
  mkdirSync(join(rootDir, 'docs', 'specs', 'prd'), { recursive: true });
  writeFileSync(join(rootDir, 'docs', 'specs', 'prd', 'broken.md'), '---\nsources: [unterminated\n---\n# Broken\n');

  assert.doesNotThrow(() => buildSourceLinks({ rootDir }));
  const { nodes, edges } = buildSourceLinks({ rootDir });
  assert.deepEqual(nodes, []);
  assert.deepEqual(edges, []);
});

test('non-markdown files in an artifact dir are ignored', (t) => {
  const rootDir = freshProject(t);
  mkdirSync(join(rootDir, 'docs', 'specs', 'prd'), { recursive: true });
  writeFileSync(join(rootDir, 'docs', 'specs', 'prd', 'meta.json'), JSON.stringify({ sources: [{ target: 'x' }] }));

  const { nodes, edges } = buildSourceLinks({ rootDir });
  assert.deepEqual(nodes, []);
  assert.deepEqual(edges, []);
});
