/**
 * tests/functional/dependency-matrix.functional.test.mjs — end-to-end coverage
 * for the living dependency matrix.
 *
 * Drives the real `construct` binary in an isolated project dir (graph build →
 * impact) and exercises the real Oracle synthesis module, asserting on durable
 * artifacts (.construct/graph/*) and the gap/route signals the overseer emits. Per
 * CLAUDE.md, multi-component features (graph builder + CLI + Oracle collector +
 * synthesis) require a functional test that spawns the binary / imports the
 * real module in a tmpdir.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { synthesizeVerdict } from '../../lib/oracle/synthesize.mjs';
import { routeGap } from '../../lib/oracle/routing.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-matrix-fn-'));
  tmpDirs.push(dir);
  return dir;
}

// lib/paths.mjs resolves the machine-scoped state root from
// process.env directly, so the spawned `construct` needs its own sandboxed
// HOME to avoid leaking test projects into the real developer machine's
// ~/.construct/projects/.

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-matrix-fn-home-'));
after(() => { try { rmTmpDir(SANDBOX_HOME); } catch {} });

function runConstruct(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME },
  });
}

test('construct graph build writes a durable graph with capability nodes', () => {
  const project = tmpProject();
  const res = runConstruct(['graph', 'build', '--no-co-change'], project);
  assert.equal(res.status, 0, res.stderr);

  const nodesFile = path.join(project, '.construct', 'graph', 'nodes.jsonl');
  assert.ok(fs.existsSync(nodesFile), 'nodes.jsonl persisted under the project .construct/graph');
  const ids = new Set(fs.readFileSync(nodesFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).id));
  assert.ok(ids.has('capability:oracle.meta-review'), 'capability nodes are present');
  assert.ok([...ids].some((id) => id.startsWith('file:lib/')), 'file nodes from import derivation are present');
});

test('construct impact reverse-traces a changed file to its capability tests', () => {
  const project = tmpProject();
  assert.equal(runConstruct(['graph', 'build', '--no-co-change'], project).status, 0);

  const res = runConstruct(['impact', 'lib/oracle/synthesize.mjs', '--json'], project);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
  assert.ok(out.impactedCapabilities.includes('oracle.meta-review'), 'oracle.meta-review is impacted');
  assert.ok(
    out.affectedTests.includes('tests/functional/oracle-bounded-auto.functional.test.mjs'),
    'the capability\'s declared functional test is selected',
  );
});

test('Oracle synthesis emits and routes the dependency-matrix gaps', () => {
  const readModel = {
    projectDir: '/tmp/x',
    dependencyGraph: {
      present: true,
      stale: true,
      staleReason: 'seeds changed',
      coverage: {
        capabilitiesWithoutTest: ['cap.a', 'cap.b'],
        capabilitiesWithoutImpl: ['cap.c'],
        workflowsUncovered: ['wf.x', 'wf.y'],
        orphanFileCount: 10,
      },
      untested: [{ capability: 'cap.d', changedFiles: 2, lastValidated: '2026-01-01T00:00:00.000Z' }],
    },
  };

  const { gaps } = synthesizeVerdict(readModel);
  const ids = new Set(gaps.map((g) => g.id));
  assert.ok(ids.has('graph-stale'), 'stale gap emitted');
  assert.ok(ids.has('matrix-coverage-gap'), 'coverage gap emitted');
  assert.ok(ids.has('impact-untested'), 'freshness gap emitted');

  assert.equal(routeGap({ id: 'matrix-coverage-gap' }).workerProfileId, 'architect');
  assert.equal(routeGap({ id: 'impact-untested' }).workerProfileId, 'qa');
  assert.equal(routeGap({ id: 'graph-stale' }).workerProfileId, 'engineer');

  for (const g of gaps) assert.ok(g.remediationRoute, `gap ${g.id} carries a remediation route`);
});

test('absent dependency graph yields no matrix gaps', () => {
  const { gaps } = synthesizeVerdict({ projectDir: '/tmp/x', dependencyGraph: { present: false } });
  const ids = new Set(gaps.map((g) => g.id));
  assert.ok(!ids.has('matrix-coverage-gap'));
  assert.ok(!ids.has('impact-untested'));
  assert.ok(!ids.has('graph-stale'));
});
