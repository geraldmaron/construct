/**
 * tests/graph/build-from-corpus.test.mjs — @capability-annotation edge source
 * for the dependency graph must merge with (not fabricate around) the
 * registry and ledger id authorities.
 *
 * Runs against a synthetic tmp corpus (isolating from the live tests/ tree)
 * to pin: known registry ids produce validates edges without a duplicate
 * capability node, known ledger-only ids get their capability node created
 * here (since nothing else in the graph creates it), and unknown ids are
 * reported as orphaned rather than silently promoted to nodes.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFromCorpus } from '../../lib/graph/build-from-corpus.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function syntheticCorpus({ registryCapId, ledgerCapId, orphanCapId }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-from-corpus-'));
  tmpDirs.push(root);

  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'capabilities'), { recursive: true });

  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"synthetic"}\n');
  fs.writeFileSync(
    path.join(root, 'registry', 'capabilities.json'),
    JSON.stringify({ version: 1, capabilities: [{ id: registryCapId, kind: 'capability' }] }),
  );
  fs.writeFileSync(
    path.join(root, 'tests', 'capabilities', 'ledger.json'),
    JSON.stringify({ version: 1, capabilities: [{ id: ledgerCapId }] }),
  );
  fs.writeFileSync(
    path.join(root, 'tests', 'sample.test.mjs'),
    `/**\n * sample — synthetic fixture.\n *\n * @capability ${registryCapId}\n * @capability ${ledgerCapId}\n * @capability ${orphanCapId}\n */\nimport test from 'node:test';\ntest('noop', () => {});\n`,
  );
  return root;
}

test('a test file tagged with a registry capability id produces a validates edge and no duplicate capability node', () => {
  const root = syntheticCorpus({ registryCapId: 'reg.known', ledgerCapId: 'ledger.known', orphanCapId: 'orphan.unknown' });
  const { nodes, edges } = buildFromCorpus({ rootDir: root });

  const capNodes = nodes.filter((n) => n.type === 'capability' && n.id === 'capability:reg.known');
  assert.equal(capNodes.length, 0, 'registry-known ids are not re-created as nodes here — buildFromRegistry owns that node');

  const validates = edges.filter((e) => e.rel === 'validates' && e.to === 'capability:reg.known');
  assert.equal(validates.length, 1);
  assert.equal(validates[0].from, 'test:tests/sample.test.mjs');
  assert.equal(validates[0].source, 'corpus-annotation');
});

test('a test file tagged with a ledger-only capability id creates the capability node', () => {
  const root = syntheticCorpus({ registryCapId: 'reg.known', ledgerCapId: 'ledger.known', orphanCapId: 'orphan.unknown' });
  const { nodes, edges } = buildFromCorpus({ rootDir: root });

  const capNode = nodes.find((n) => n.id === 'capability:ledger.known');
  assert.ok(capNode, 'ledger-only capability gets a node from the corpus builder');
  assert.equal(capNode.attrs.source, 'ledger');

  const validates = edges.filter((e) => e.rel === 'validates' && e.to === 'capability:ledger.known');
  assert.equal(validates.length, 1);
});

test('a tag matching neither registry nor ledger is reported as orphaned, not fabricated into a node', () => {
  const root = syntheticCorpus({ registryCapId: 'reg.known', ledgerCapId: 'ledger.known', orphanCapId: 'orphan.unknown' });
  const { nodes, edges, orphanedCapabilityIds } = buildFromCorpus({ rootDir: root });

  assert.ok(orphanedCapabilityIds.includes('orphan.unknown'));
  assert.ok(!nodes.some((n) => n.id === 'capability:orphan.unknown'));
  assert.ok(!edges.some((e) => e.to === 'capability:orphan.unknown'));
});

test('ledger capabilities in the live repo all resolve to a corpus-sourced capability node', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tests', 'capabilities', 'ledger.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'registry', 'capabilities.json'), 'utf8'));
  const registryIds = new Set(registry.capabilities.map((c) => c.id));
  const { nodes } = buildFromCorpus({ rootDir: REPO_ROOT });
  const nodeIds = new Set(nodes.filter((n) => n.type === 'capability').map((n) => n.id));

  for (const cap of ledger.capabilities) {
    if (registryIds.has(cap.id)) continue;
    assert.ok(nodeIds.has(`capability:${cap.id}`), `ledger-only capability ${cap.id} must get a graph node from corpus annotations`);
  }
});

test('local.model.tier — the one registry capability with no functional/hostEmulation verification — gets a validates edge from its annotated unit/integration tests', () => {
  const { edges } = buildFromCorpus({ rootDir: REPO_ROOT });
  const validates = edges.filter((e) => e.rel === 'validates' && e.to === 'capability:local.model.tier');
  assert.ok(validates.length > 0, 'local.model.tier must be reachable via the corpus-annotation source since registry has no functional/hostEmulation pointer for it');
});
