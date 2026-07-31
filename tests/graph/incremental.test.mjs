/**
 * tests/graph/incremental.test.mjs — scoped graph refresh on edit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');
const { sqliteAvailable } = await import('../../lib/graph/relational/sqlite-db.mjs');
const {
  resolveSourceGroupsForPath,
  resolveSourceGroupsForFiles,
  updateGraphForFiles,
  markGraphSourceStale,
} = await import('../../lib/graph/incremental.mjs');
const { checkGraphStaleness } = await import('../../lib/graph/staleness.mjs');
const { writeGraph, loadGraph } = await import('../../lib/graph/store.mjs');

const tmpDirs = [];
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
const prevHome = process.env.HOME;
const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-inc-home-'));
process.env.CONSTRUCT_HOME_OVERRIDE = sandboxHome;
process.env.HOME = sandboxHome;
tmpDirs.push(sandboxHome);

test.after(() => {
  for (const dir of tmpDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
});

function freshProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-inc-'));
  tmpDirs.push(root);
  return root;
}

function graphKeys(graph) {
  return {
    nodeIds: [...graph.nodes.keys()].sort(),
    edgeKeys: graph.edges.map((e) => `${e.from}|${e.rel}|${e.to}`).sort(),
  };
}

test('resolveSourceGroupsForPath maps registry/capabilities.json to registry group', () => {
  const groups = resolveSourceGroupsForPath(REPO_ROOT, 'registry/capabilities.json');
  assert.ok(groups.includes('registry'));
});

test('resolveSourceGroupsForFiles unions groups across files', () => {
  const groups = resolveSourceGroupsForFiles(REPO_ROOT, [
    'registry/capabilities.json',
    'lib/embedded-contract/procedure-definitions.mjs',
  ]);
  assert.ok(groups.includes('registry'));
  assert.ok(groups.includes('workflowManifests'));
});

test('unknown path marks graph stale via freshness guard', { skip: !sqliteAvailable() ? 'node:sqlite unavailable' : false }, () => {
  const project = freshProject();
  writeGraph(project, { nodes: [{ id: 'capability:a', type: 'capability', name: 'a', attrs: {} }], edges: [], generatedAt: new Date().toISOString(), sourceHashes: {} });
  const result = updateGraphForFiles(project, ['README.md'], { rootDir: REPO_ROOT });
  assert.equal(result.stale, true);
  const stale = checkGraphStaleness(project);
  assert.equal(stale.stale, true);
  assert.match(stale.staleReason, /freshness|source_drift/);
});

test('markGraphSourceStale sets source_drift freshness', { skip: !sqliteAvailable() ? 'node:sqlite unavailable' : false }, () => {
  const project = freshProject();
  writeGraph(project, { nodes: [], edges: [], generatedAt: new Date().toISOString(), sourceHashes: {} });
  markGraphSourceStale(project, { reason: 'test' });
  const stale = checkGraphStaleness(project);
  assert.equal(stale.stale, true);
});

test('import-graph edit updates only import-graph sourced edges', { skip: !sqliteAvailable() ? 'node:sqlite unavailable' : false }, () => {
  const project = freshProject();
  writeGraph(project, {
    nodes: [
      { id: 'capability:fixture-cap', type: 'capability', name: 'fixture-cap', attrs: {} },
      { id: 'file:lib/graph/incremental.mjs', type: 'file', name: 'lib/graph/incremental.mjs', attrs: {} },
    ],
    edges: [
      { from: 'file:lib/graph/incremental.mjs', to: 'capability:fixture-cap', rel: 'realizes', source: 'import-graph' },
      { from: 'capability:fixture-cap', to: 'workflow:demo', rel: 'embeds', source: 'registry' },
    ],
    generatedAt: new Date().toISOString(),
    sourceHashes: {},
  });

  const before = loadGraph(project);
  const beforeRegistryEdges = before.edges.filter((e) => (e.sources || []).includes('registry') || e.source === 'registry');

  const result = updateGraphForFiles(project, ['lib/graph/cli.mjs'], { rootDir: REPO_ROOT, coChange: false });
  assert.equal(result.ok, true);
  assert.ok(result.importSlice);

  const after = loadGraph(project);
  const afterRegistryEdges = after.edges.filter((e) => (e.sources || []).includes('registry') || e.source === 'registry');
  assert.deepEqual(afterRegistryEdges, beforeRegistryEdges);
});

test('full rebuild matches incremental state for the same import-graph edit', { skip: !sqliteAvailable() ? 'node:sqlite unavailable' : false, timeout: 240_000 }, () => {
  const project = freshProject();
  const build = spawnSync(process.execPath, [BIN, 'graph', 'build', '--no-co-change'], {
    cwd: project,
    env: { ...process.env, HOME: sandboxHome, CONSTRUCT_HOME_OVERRIDE: sandboxHome },
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  updateGraphForFiles(project, ['lib/graph/cli.mjs'], { rootDir: REPO_ROOT, coChange: false });
  const incremental = graphKeys(loadGraph(project));

  const rebuild = spawnSync(process.execPath, [BIN, 'graph', 'build', '--no-co-change'], {
    cwd: project,
    env: { ...process.env, HOME: sandboxHome, CONSTRUCT_HOME_OVERRIDE: sandboxHome },
    encoding: 'utf8',
  });
  assert.equal(rebuild.status, 0, rebuild.stderr || rebuild.stdout);
  const full = graphKeys(loadGraph(project));

  assert.deepEqual(incremental.nodeIds, full.nodeIds);
  assert.deepEqual(incremental.edgeKeys, full.edgeKeys);
});
