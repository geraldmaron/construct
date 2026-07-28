/**
 * tests/functional/graph-merge-release-evidence.functional.test.mjs —
 * construct-4uxq0.11.12 merge/release runtime-evidence edges.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';
import {
  buildMergeEvidence,
  buildReleaseEvidence,
  buildRuntimeEvidence,
} from '../../lib/graph/runtime-evidence.mjs';
import { nodeId, EDGE_RELS, writeGraph, loadGraph } from '../../lib/graph/store.mjs';

// The sqlite graph store resolves the machine state dir through
// lib/state-root.mjs, which anchors to the real user home unless
// CONSTRUCT_HOME_OVERRIDE is pinned — an unpinned run leaks a real
// ~/.construct/projects/<hash>/ key per tmpdir fixture repo.

const HOME_OVERRIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-merge-home-'));
const PREV_HOME_OVERRIDE = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = HOME_OVERRIDE;
test.after(() => {
  if (PREV_HOME_OVERRIDE === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = PREV_HOME_OVERRIDE;
  fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
});

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function initFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-merge-release-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test User']);

  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'tracked.mjs'), 'export const v = 1;\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2));
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);

  git(root, ['checkout', '-b', 'feature-a']);
  fs.writeFileSync(path.join(root, 'lib', 'tracked.mjs'), 'export const v = 2;\n');
  git(root, ['add', 'lib/tracked.mjs']);
  git(root, ['commit', '-m', 'feature a']);
  git(root, ['checkout', 'main']);
  git(root, ['merge', '--no-ff', 'feature-a', '-m', 'merge feature a']);
  const firstMerge = git(root, ['rev-parse', 'HEAD']);

  git(root, ['checkout', '-b', 'feature-b']);
  fs.writeFileSync(path.join(root, 'lib', 'tracked.mjs'), 'export const v = 3;\n');
  git(root, ['add', 'lib/tracked.mjs']);
  git(root, ['commit', '-m', 'feature b']);
  git(root, ['checkout', 'main']);
  git(root, ['merge', '--no-ff', 'feature-b', '-m', 'merge feature b']);
  const secondMerge = git(root, ['rev-parse', 'HEAD']);

  git(root, ['tag', 'v1.0.0']);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.1.0' }, null, 2));
  fs.writeFileSync(path.join(root, 'lib', 'tracked.mjs'), 'export const v = 4;\n');
  git(root, ['add', 'package.json', 'lib/tracked.mjs']);
  git(root, ['commit', '-m', 'release 1.1.0']);
  git(root, ['tag', 'v1.1.0']);

  return { root, firstMerge, secondMerge };
}

test('EDGE_RELS includes merged_in and released_in', () => {
  assert.ok(EDGE_RELS.has('merged_in'));
  assert.ok(EDGE_RELS.has('released_in'));
});

test('buildMergeEvidence creates distinct evidence nodes for repeated merges on the same file', () => {
  const { root, firstMerge, secondMerge } = initFixtureRepo();
  try {
    const merge = buildMergeEvidence({ repoRoot: root, mainRef: 'main', limit: 10 });
    const mergeNodes = merge.nodes.filter((n) => n.attrs?.kind === 'merge');
    assert.ok(mergeNodes.length >= 2, 'expected at least two merge evidence nodes');
    const ids = new Set(mergeNodes.map((n) => n.id));
    assert.equal(ids.size, mergeNodes.length, 'merge evidence node ids must be distinct');

    const fileTarget = nodeId('file', 'lib/tracked.mjs');
    const firstEdge = merge.edges.find((e) => e.from === nodeId('runtime-evidence', `merge:${firstMerge}`)
      && e.rel === 'merged_in' && e.to === fileTarget);
    const secondEdge = merge.edges.find((e) => e.from === nodeId('runtime-evidence', `merge:${secondMerge}`)
      && e.rel === 'merged_in' && e.to === fileTarget);
    assert.ok(firstEdge, 'first merge should link tracked file');
    assert.ok(secondEdge, 'second merge should link tracked file');
    assert.notEqual(firstEdge.from, secondEdge.from);
  } finally {
    rmTmpDir(root);
  }
});

test('buildReleaseEvidence creates released_in edges for version tags', () => {
  const { root } = initFixtureRepo();
  try {
    const release = buildReleaseEvidence({ repoRoot: root, limit: 5 });
    const releaseNode = release.nodes.find((n) => n.name === 'release:v1.1.0');
    assert.ok(releaseNode, 'expected release evidence node for v1.1.0');
    assert.equal(releaseNode.attrs.version, '1.1.0');
    assert.ok(release.edges.some((e) => e.from === releaseNode.id && e.rel === 'released_in'
      && e.to === nodeId('file', 'lib/tracked.mjs')));
  } finally {
    rmTmpDir(root);
  }
});

test('buildRuntimeEvidence combines workflow, merge, and release slices', () => {
  const { root } = initFixtureRepo();
  try {
    const evidence = buildRuntimeEvidence({ rootDir: root, repoRoot: root });
    assert.ok(evidence.nodes.some((n) => n.attrs?.kind === 'merge'));
    assert.ok(evidence.nodes.some((n) => n.attrs?.kind === 'release'));
    assert.ok(evidence.edges.some((e) => e.rel === 'merged_in'));
    assert.ok(evidence.edges.some((e) => e.rel === 'released_in'));
  } finally {
    rmTmpDir(root);
  }
});

test('merge and release evidence round-trip through writeGraph', () => {
  const { root, firstMerge } = initFixtureRepo();
  try {
    const merge = buildMergeEvidence({ repoRoot: root, mainRef: 'main', limit: 5 });
    const fileId = nodeId('file', 'lib/tracked.mjs');
    writeGraph(root, {
      nodes: [
        { id: fileId, type: 'file', name: 'lib/tracked.mjs', attrs: { path: 'lib/tracked.mjs', exists: true } },
        ...merge.nodes,
      ],
      edges: merge.edges,
    });
    const graph = loadGraph(root);
    assert.ok(graph.edges.some((e) => e.rel === 'merged_in' && e.to === fileId));
    assert.ok(graph.nodes.has(nodeId('runtime-evidence', `merge:${firstMerge}`)));
  } finally {
    rmTmpDir(root);
  }
});
