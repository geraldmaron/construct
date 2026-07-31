/**
 * tests/functional/graph-verify.functional.test.mjs —
 * Multi-component proof: graph verify CLI, pre-commit
 * hook wiring, and CI job registration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { runGraphVerify } from '../../scripts/run-graph-verify.mjs';
import { writeGraph, nodeId } from '../../lib/graph/store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');
const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-verify-fn-home-'));
process.env.CONSTRUCT_HOME_OVERRIDE = SANDBOX_HOME;

test.after(() => {
  try { fs.rmSync(SANDBOX_HOME, { recursive: true, force: true }); } catch {}
});

function runConstruct(args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

test('construct graph verify exits non-zero on partial graph and names the violation', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-verify-partial-'));
  fs.mkdirSync(path.join(projectDir, '.construct'), { recursive: true });
  writeGraph(projectDir, {
    nodes: [{ id: nodeId('procedure', 'w1'), type: 'procedure', name: 'w1' }],
    edges: [],
    partial: true,
    partialReasons: ['fixture: partial builder'],
  });

  const result = runConstruct(['graph', 'verify'], projectDir);
  assert.notEqual(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /living graph is partial: fixture: partial builder/);
});

test('construct graph verify exits 0 on clean non-partial graph', () => {
  assert.equal(runConstruct(['graph', 'build', '--no-co-change']).status, 0);
  const result = runConstruct(['graph', 'verify']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /graph verify passed/);
});

test('pre-commit hook invokes graph verify as a thin wrapper', () => {
  const hook = fs.readFileSync(path.join(REPO_ROOT, '.beads', 'hooks', 'pre-commit'), 'utf8');
  assert.match(hook, /construct graph verify/);
});

test('ci-required depends on graph verify job', () => {
  const ci = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /^\s*graph-verify:\s*$/m);
  assert.match(ci, /needs:\s*\[[^\]]*graph-verify/m);
});

test('runGraphVerify surfaces schema violations from a broken fixture graph', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-verify-schema-'));
  fs.mkdirSync(path.join(projectDir, '.construct'), { recursive: true });
  writeGraph(projectDir, {
    nodes: [{ id: 'flie:bad', type: 'flie', name: 'bad' }],
    edges: [],
  });
  const verdict = runGraphVerify({ cwd: projectDir });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.violations.some((v) => v.message.includes("unknown type 'flie'")));
});
