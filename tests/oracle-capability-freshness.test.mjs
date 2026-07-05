/**
 * tests/oracle-capability-freshness.test.mjs — capability-freshness gate
 * precision (construct-r8wr.6).
 *
 * Proves two coupled mechanism fixes in lib/oracle/read-model.mjs:
 * (1) a checkout-style mtime bump with unchanged content does not flag a
 * capability as changed (content identity replaces the mtime > stamp gate);
 * (2) the freshness/untested consumer only trusts direct, registry-sourced
 * realizes edges, not the over-inclusive advisory closure emitted by
 * lib/graph/build-import-graph.mjs, so a change to one capability's direct
 * realizer never flags unrelated capabilities reachable only through the
 * advisory closure.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { collectDependencyGraph } from '../lib/oracle/read-model.mjs';
import { writeGraph } from '../lib/graph/store.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function sleepSync(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* busy-wait: git commit timestamps are second-granularity */ }
}

function git(rootDir, args) {
  const res = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

function initGitRepo(rootDir) {
  git(rootDir, ['init', '-q']);
  git(rootDir, ['config', 'user.email', 'test@example.com']);
  git(rootDir, ['config', 'user.name', 'Test']);
}

function commitAll(rootDir, message) {
  git(rootDir, ['add', '-A']);
  git(rootDir, ['commit', '-q', '-m', message]);
}

// Fixture: two capabilities, each with one direct (registry-sourced) realizer
// file, plus a shared file reachable only via an over-inclusive advisory
// (import-graph-sourced) realizes edge into capA — mirroring the 308-edge
// closure pattern from build-import-graph.mjs that must not leak into the
// freshness gate.

function seedFixture(rootDir) {
  fs.mkdirSync(path.join(rootDir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'lib', 'capA-impl.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(rootDir, 'lib', 'capB-impl.mjs'), 'export const b = 1;\n');
  fs.writeFileSync(path.join(rootDir, 'lib', 'shared-advisory-only.mjs'), 'export const s = 1;\n');
  commitAll(rootDir, 'seed fixture files');

  // lastValidated must postdate the seed commit itself, or `git log --since`
  // would count the seed commit as "changed after validation" for every
  // capability regardless of any later edit.

  const lastValidated = new Date(Date.now() + 1000).toISOString();
  const nodes = [
    { id: 'capability:capA', type: 'capability', name: 'capA', attrs: { lastValidated } },
    { id: 'capability:capB', type: 'capability', name: 'capB', attrs: { lastValidated } },
    { id: 'file:lib/capA-impl.mjs', type: 'file', name: 'lib/capA-impl.mjs', attrs: { path: 'lib/capA-impl.mjs' } },
    { id: 'file:lib/capB-impl.mjs', type: 'file', name: 'lib/capB-impl.mjs', attrs: { path: 'lib/capB-impl.mjs' } },
    { id: 'file:lib/shared-advisory-only.mjs', type: 'file', name: 'lib/shared-advisory-only.mjs', attrs: { path: 'lib/shared-advisory-only.mjs' } },
  ];
  const edges = [
    { from: 'file:lib/capA-impl.mjs', to: 'capability:capA', rel: 'realizes', source: 'registry' },
    { from: 'file:lib/capB-impl.mjs', to: 'capability:capB', rel: 'realizes', source: 'registry' },
    { from: 'file:lib/shared-advisory-only.mjs', to: 'capability:capA', rel: 'realizes', source: 'import-graph' },
  ];
  writeGraph(rootDir, { nodes, edges, generatedAt: new Date().toISOString(), sourceHash: 'fixture' });
  return { lastValidated };
}

function freshRepoDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  initGitRepo(dir);
  return dir;
}

describe('capability-freshness gate: content identity replaces mtime', () => {
  it('touch-only mtime bump with unchanged content flags zero capabilities', () => {
    const rootDir = freshRepoDir('oracle-freshness-touch-');
    seedFixture(rootDir);

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(rootDir, 'lib', 'capA-impl.mjs'), future, future);
    fs.utimesSync(path.join(rootDir, 'lib', 'capB-impl.mjs'), future, future);

    const dg = collectDependencyGraph(rootDir, rootDir);
    assert.equal(dg.untested.length, 0, 'mtime-only bump must not flag any capability');
  });

  it('fresh-checkout-style mtime rewrite across all realizers flags zero capabilities', () => {
    const rootDir = freshRepoDir('oracle-freshness-checkout-');
    seedFixture(rootDir);

    const now = new Date();
    for (const rel of ['lib/capA-impl.mjs', 'lib/capB-impl.mjs', 'lib/shared-advisory-only.mjs']) {
      fs.utimesSync(path.join(rootDir, rel), now, now);
    }

    const dg = collectDependencyGraph(rootDir, rootDir);
    assert.equal(dg.untested.length, 0, 'simulated fresh checkout must not flag any capability');
  });

  it('a real content change to a direct realizer flags exactly its own capability', () => {
    const rootDir = freshRepoDir('oracle-freshness-realchange-');
    seedFixture(rootDir);

    fs.writeFileSync(path.join(rootDir, 'lib', 'capA-impl.mjs'), 'export const a = 2;\n');

    const dg = collectDependencyGraph(rootDir, rootDir);
    assert.equal(dg.untested.length, 1, 'exactly one capability should be flagged');
    assert.equal(dg.untested[0].capability, 'capA');
  });

  it('a committed change after lastValidated flags the capability', () => {
    const rootDir = freshRepoDir('oracle-freshness-committed-');
    seedFixture(rootDir);
    sleepSync(1200);

    fs.writeFileSync(path.join(rootDir, 'lib', 'capB-impl.mjs'), 'export const b = 2;\n');
    commitAll(rootDir, 'change capB impl');

    const dg = collectDependencyGraph(rootDir, rootDir);
    assert.equal(dg.untested.length, 1);
    assert.equal(dg.untested[0].capability, 'capB');
  });
});

describe('capability-freshness gate: advisory closure is not authoritative', () => {
  it('a content change to a file reachable only via the advisory closure does not flag capA', () => {
    const rootDir = freshRepoDir('oracle-freshness-advisory-');
    seedFixture(rootDir);

    // shared-advisory-only.mjs realizes capA only through the over-inclusive
    // import-graph-sourced edge; changing it must not trip capA's gate.
    fs.writeFileSync(path.join(rootDir, 'lib', 'shared-advisory-only.mjs'), 'export const s = 2;\n');

    const dg = collectDependencyGraph(rootDir, rootDir);
    assert.equal(dg.untested.length, 0, 'advisory-only realizer changes must not leak into the freshness gate');
  });
});
