/**
 * tests/functional/graph-build-from-cards.functional.test.mjs —
 * construct-4uxq0.11.7 multi-component proof: card and demo-manifest graph nodes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';
import { buildFromCards } from '../../lib/graph/build-from-cards.mjs';
import { nodeId, NODE_TYPES, EDGE_RELS, writeGraph, loadGraph } from '../../lib/graph/store.mjs';
import { runGraphCli } from '../../lib/graph/cli.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

const { sqliteAvailable } = await import('../../lib/graph/relational/sqlite-db.mjs');

function runConstruct(args, cwd, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

test('buildFromCards on the real repo emits provider card nodes with kind provider', () => {
  const built = buildFromCards({ rootDir: REPO_ROOT, cwd: REPO_ROOT });
  const providerCards = built.nodes.filter((n) => n.type === 'card' && n.attrs?.kind === 'provider');
  assert.ok(providerCards.length > 0, 'expected provider card nodes from registry/provider-cards.json');
  const d2 = providerCards.find((n) => n.name === 'd2');
  assert.ok(d2, 'expected d2 provider card node');
  assert.equal(d2.id, nodeId('card', 'provider:d2'));
});

test('buildFromCards wires documents and validates edges for d2 provider card references', () => {
  const built = buildFromCards({ rootDir: REPO_ROOT, cwd: REPO_ROOT });
  const cardId = nodeId('card', 'provider:d2');
  const fileEdge = built.edges.find((e) => e.from === cardId && e.rel === 'documents'
    && e.to === nodeId('file', 'lib/providers/d2.mjs'));
  assert.ok(fileEdge, 'expected documents edge to lib/providers/d2.mjs');
  const testEdge = built.edges.find((e) => e.from === cardId && e.rel === 'validates'
    && e.to === nodeId('test', 'tests/providers/d2-provider.test.mjs'));
  assert.ok(testEdge, 'expected validates edge to tests/providers/d2-provider.test.mjs');
});

test('buildFromCards emits demo-manifest nodes for shipped templates', () => {
  const built = buildFromCards({ rootDir: REPO_ROOT, cwd: REPO_ROOT });
  const manifests = built.nodes.filter((n) => n.type === 'demo-manifest');
  assert.ok(manifests.length >= 1, 'expected demo-manifest nodes from templates/demos/manifests');
  assert.ok(manifests.some((n) => n.id === nodeId('demo-manifest', 'capability-contract')));
});

test('buildFromCards succeeds with zero standalone cards in an empty fixture tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-cards-empty-'));
  try {
    fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
    fs.writeFileSync(path.join(root, 'registry', 'provider-cards.json'), JSON.stringify({ version: 1, providers: [] }));
    const built = buildFromCards({ rootDir: root, cwd: root });
    assert.equal(built.nodes.filter((n) => n.type === 'card').length, 0);
    assert.equal(built.nodes.filter((n) => n.type === 'demo-manifest').length, 0);
  } finally {
    rmTmpDir(root);
  }
});

test('fixture standalone pattern card produces card node and referential edges', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-cards-fixture-'));
  try {
    fs.mkdirSync(path.join(root, 'registry', 'cards', 'pattern'), { recursive: true });
    fs.mkdirSync(path.join(root, 'lib', 'sample'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'lib', 'sample', 'widget.mjs'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(root, 'tests', 'widget.test.mjs'), 'import test from "node:test";\ntest("x", () => {});\n');
    fs.writeFileSync(path.join(root, 'registry', 'provider-cards.json'), JSON.stringify({ version: 1, providers: [] }));
    fs.writeFileSync(path.join(root, 'registry', 'cards', 'pattern', 'widget.json'), JSON.stringify({
      schema: 'construct/pattern-card/1',
      id: 'widget-pattern',
      files: ['lib/sample/widget.mjs'],
      tests: ['tests/widget.test.mjs'],
    }));

    const built = buildFromCards({ rootDir: root, cwd: root });
    const card = built.nodes.find((n) => n.id === nodeId('card', 'pattern:widget-pattern'));
    assert.ok(card);
    assert.equal(card.attrs.kind, 'pattern');
    assert.ok(built.edges.some((e) => e.from === card.id && e.rel === 'documents'
      && e.to === nodeId('file', 'lib/sample/widget.mjs')));
    assert.ok(built.edges.some((e) => e.from === card.id && e.rel === 'validates'
      && e.to === nodeId('test', 'tests/widget.test.mjs')));
  } finally {
    rmTmpDir(root);
  }
});

test('card and demo-manifest node types are accepted by NODE_TYPES and EDGE_RELS', () => {
  assert.ok(NODE_TYPES.has('card'));
  assert.ok(NODE_TYPES.has('demo-manifest'));
  assert.ok(EDGE_RELS.has('documents'));
  assert.ok(EDGE_RELS.has('validates'));
});

if (sqliteAvailable()) {
  const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-cards-fn-home-'));
  const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-cards-fn-project-'));
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  const prevHome = process.env.HOME;
  process.env.CONSTRUCT_HOME_OVERRIDE = SANDBOX_HOME;
  process.env.HOME = SANDBOX_HOME;

  test.after(() => {
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmTmpDir(SANDBOX_HOME);
    rmTmpDir(PROJECT);
  });

  test('construct graph build + query --type card returns provider card nodes', () => {
    const build = runConstruct(['graph', 'build', '--no-co-change', '--json'], PROJECT, {
      HOME: SANDBOX_HOME,
      CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME,
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);
    const buildPayload = JSON.parse(build.stdout);
    assert.ok(buildPayload.ok);

    const query = runConstruct(['graph', 'query', '--type', 'card', '--json'], PROJECT, {
      HOME: SANDBOX_HOME,
      CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME,
    });
    assert.equal(query.status, 0, query.stderr || query.stdout);
    const queryPayload = JSON.parse(query.stdout);
    assert.ok(Array.isArray(queryPayload.nodes));
    assert.ok(queryPayload.nodes.some((row) => row.node?.attrs?.kind === 'provider'));
  });

  test('construct graph query --type demo-manifest returns manifest nodes', () => {
    const query = runConstruct(['graph', 'query', '--type', 'demo-manifest', '--json'], PROJECT, {
      HOME: SANDBOX_HOME,
      CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME,
    });
    assert.equal(query.status, 0, query.stderr || query.stdout);
    const payload = JSON.parse(query.stdout);
    assert.ok(payload.nodes.length >= 1);
  });

  test('merged graph validate --strict accepts card documents edges without dangling targets when targets exist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-cards-validate-'));
    try {
      const cardId = nodeId('card', 'provider:sample');
      const fileId = nodeId('file', 'lib/sample.mjs');
      fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(root, 'lib', 'sample.mjs'), 'export {};\n');
      writeGraph(root, {
        nodes: [
          { id: cardId, type: 'card', name: 'sample', attrs: { kind: 'provider' } },
          { id: fileId, type: 'file', name: 'lib/sample.mjs', attrs: { path: 'lib/sample.mjs', exists: true } },
        ],
        edges: [{ from: cardId, to: fileId, rel: 'documents', source: 'card-registry' }],
      });
      const code = runGraphCli(['validate', '--strict', '--json'], { rootDir: REPO_ROOT, projectDir: root });
      assert.equal(code, 0);
    } finally {
      rmTmpDir(root);
    }
  });
}
