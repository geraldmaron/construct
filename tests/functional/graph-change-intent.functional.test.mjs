/**
 * tests/functional/graph-change-intent.functional.test.mjs —
 * Multi-component proof: change-intent storage, CLI, and
 * pre-change impact packets seeded from declared graph targets.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');
const TARGET = 'file:lib/graph/impact.mjs';
const TARGET_REL = 'lib/graph/impact.mjs';

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-intent-fn-home-'));
const createdIntents = [];

test.after(() => {
  for (const file of createdIntents) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
  rmTmpDir(SANDBOX_HOME);
});

function runConstruct(args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

test('construct graph intent declare writes durable intent and impact packet', () => {
  assert.equal(runConstruct(['graph', 'build', '--no-co-change']).status, 0);

  const declare = runConstruct(['graph', 'intent', 'declare', '--target', TARGET, '--json']);
  assert.equal(declare.status, 0, declare.stderr || declare.stdout);
  const intent = JSON.parse(declare.stdout);
  createdIntents.push(path.join(REPO_ROOT, '.construct', 'graph', 'intents', `${intent.id}.json`));

  assert.ok(intent.id.startsWith('intent-'));
  assert.equal(intent.status, 'declared');
  assert.deepEqual(intent.targets, [TARGET]);
  assert.ok(intent.packet?.graphPresent, 'packet should be computed against a built graph');
  assert.ok(Array.isArray(intent.packet.impactedWorkflows));
  assert.ok(Array.isArray(intent.packet.impactedTests));
  assert.ok(fs.existsSync(createdIntents[0]), 'intent record persisted under .construct/graph/intents/');
});

test('intent packet matches construct graph impacted for the same seed file', () => {
  const declare = runConstruct(['graph', 'intent', 'declare', '--target', TARGET, '--json']);
  assert.equal(declare.status, 0, declare.stderr || declare.stdout);
  const intent = JSON.parse(declare.stdout);
  createdIntents.push(path.join(REPO_ROOT, '.construct', 'graph', 'intents', `${intent.id}.json`));

  const impacted = runConstruct(['graph', 'impacted', '--changed', TARGET_REL, '--json']);
  assert.equal(impacted.status, 0, impacted.stderr || impacted.stdout);
  const postChange = JSON.parse(impacted.stdout);

  assert.deepEqual(intent.packet.impactedWorkflows, postChange.impactedWorkflows);
  assert.deepEqual(intent.packet.impactedTests, postChange.impactedTests);
  assert.deepEqual(intent.packet.impactedDocs, postChange.impactedDocs);
  assert.deepEqual(intent.packet.impactedCapabilities, postChange.impactedCapabilities);
});

test('unknown target exits non-zero without writing an empty packet', () => {
  const intentsDir = path.join(REPO_ROOT, '.construct', 'graph', 'intents');
  const before = fs.existsSync(intentsDir) ? fs.readdirSync(intentsDir).length : 0;
  const result = runConstruct(['graph', 'intent', 'declare', '--target', 'file:lib/does-not-exist.mjs', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown target/i);
  const after = fs.existsSync(intentsDir) ? fs.readdirSync(intentsDir).length : 0;
  assert.equal(after, before, 'failed declare must not create a new intent file');
});

test('construct graph intent show round-trips the stored packet unchanged', () => {
  const declare = runConstruct(['graph', 'intent', 'declare', '--target', TARGET, '--json']);
  assert.equal(declare.status, 0, declare.stderr || declare.stdout);
  const declared = JSON.parse(declare.stdout);
  createdIntents.push(path.join(REPO_ROOT, '.construct', 'graph', 'intents', `${declared.id}.json`));

  const show = runConstruct(['graph', 'intent', 'show', declared.id, '--json']);
  assert.equal(show.status, 0, show.stderr || show.stdout);
  const loaded = JSON.parse(show.stdout);

  assert.deepEqual(loaded.targets, declared.targets);
  assert.deepEqual(loaded.packet, declared.packet);
});
