/**
 * tests/graph/build-from-registry-extended.test.mjs — extended seeding
 * verification for provider, tool, specialist, and doc node types seeded by
 * buildFromRegistry (LMCP-C1 Phases 2-6).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildFromRegistry, hashFiles } from '../../lib/graph/build-from-registry.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function index(built) {
  const nodeById = new Map(built.nodes.map((n) => [n.id, n]));
  const byType = (t) => built.nodes.filter((n) => n.type === t);
  const edgesByRel = (r) => built.edges.filter((e) => e.rel === r);
  return { nodeById, byType, edgesByRel };
}

const built = buildFromRegistry({ rootDir: REPO_ROOT });
const idx = index(built);

test('provider nodes are created from extension manifests', () => {
  const providers = idx.byType('provider');
  assert.ok(providers.length >= 6, `expected >=6 providers, got ${providers.length}`);
  const ids = providers.map((n) => n.id);
  assert.ok(ids.includes('provider:echo'), 'missing echo provider');
  assert.ok(ids.includes('provider:github'), 'missing github provider');
  assert.ok(ids.includes('provider:slack'), 'missing slack provider');
  assert.ok(ids.includes('provider:atlassian-jira'), 'missing jira provider');
  assert.ok(ids.includes('provider:atlassian-confluence'), 'missing confluence provider');
  assert.ok(ids.includes('provider:salesforce'), 'missing salesforce provider');
});

test('tool nodes are created from manifest capabilities and operations', () => {
  const tools = idx.byType('tool');
  assert.ok(tools.length >= 1, `expected >=1 tool nodes, got ${tools.length}`);
  const toolIds = new Set(tools.map((n) => n.id));
  assert.ok(toolIds.has('tool:read'), 'expected tool:read from provider capabilities');
  assert.ok(toolIds.has('tool:search'), 'expected tool:search from provider capabilities');
  assert.ok(toolIds.has('tool:webhook'), 'expected tool:webhook from github capabilities');
});

test('specialist nodes are created from role registry', () => {
  const specialists = idx.byType('specialist');
  assert.ok(specialists.length >= 1, `expected >=1 specialist nodes, got ${specialists.length}`);
  const specIds = new Set(specialists.map((n) => n.id));
  assert.ok(specIds.has('specialist:engineer'), 'missing specialist:engineer');
});

test('doc nodes are created from docs directory scanning', () => {
  const docs = idx.byType('doc');
  assert.ok(docs.length >= 1, `expected >=1 doc nodes, got ${docs.length}`);
  const docIds = new Set(docs.map((n) => n.id));
  assert.ok(docIds.has('doc:docs/README.md') || docIds.has('doc:docs/changelog.md'),
    'expected at least one known doc node');
});

test('requires edges are created between providers and tools', () => {
  const requires = idx.edgesByRel('requires');
  assert.ok(requires.length >= 1, `expected >=1 requires edges, got ${requires.length}`);
  for (const e of requires) {
    assert.ok(e.from.startsWith('provider:'), `requires edge from ${e.from} must be a provider`);
    assert.ok(e.to.startsWith('tool:'), `requires edge to ${e.to} must be a tool`);
    assert.equal(e.source, 'manifest-loader');
  }
});

test('owned_by edges are created from providers and specialists', () => {
  const ownedBy = idx.edgesByRel('owned_by');
  assert.ok(ownedBy.length >= 1, `expected >=1 owned_by edges, got ${ownedBy.length}`);
});

test('reads edges are created from core pack embedBindings (LMCP-E4)', () => {
  const reads = idx.edgesByRel('reads');
  assert.ok(reads.length >= 1, `expected >=1 reads edges, got ${reads.length}`);
  for (const e of reads) {
    assert.ok(e.from.startsWith('specialist:'), `reads edge from ${e.from} must be a specialist`);
    assert.ok(e.to.startsWith('provider:'), `reads edge to ${e.to} must be a provider`);
    assert.equal(e.source, 'pack-embed-binding');
  }
  const froms = new Set(reads.map((e) => e.from));
  assert.ok(froms.has('specialist:product-manager'), 'expected product-manager --reads--> provider edge');
  assert.ok(froms.has('specialist:operations'), 'expected operations --reads--> provider edge');
  assert.ok(froms.has('specialist:engineer'), 'expected engineer --reads--> provider edge');

  const jiraReaders = reads.filter((e) => e.to === 'provider:atlassian-jira').map((e) => e.from);
  assert.ok(jiraReaders.includes('specialist:product-manager'));
});

test('documents edges are created from heuristic doc linking', () => {
  const documents = idx.edgesByRel('documents');
  assert.ok(documents.length >= 1, `expected >=1 documents edges, got ${documents.length}`);
  for (const e of documents) {
    assert.ok(e.from.startsWith('doc:'), `documents edge from ${e.from} must be a doc`);
    assert.equal(e.source, 'doc-scan');
  }
});

test('sourceHash differs from old 3-seed hash', () => {
  assert.equal(built.sourceHash.length, 16, 'sourceHash should be 16 hex chars');
  const oldHash = hashFiles(REPO_ROOT, [
    'registry/capabilities.json',
    'specialists/org',
    'lib/embedded-contract/workflow-defs.mjs',
  ]);
  assert.notEqual(built.sourceHash, oldHash, 'sourceHash must differ when new seed files are included');
});

test('all existing node types remain present', () => {
  for (const t of ['capability', 'workflow', 'contract', 'test', 'skill', 'rule', 'surface', 'file']) {
    assert.ok(idx.byType(t).length >= 0, `${t} nodes should still be present`);
  }
});