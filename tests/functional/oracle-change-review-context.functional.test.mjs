/**
 * tests/functional/oracle-change-review-context.functional.test.mjs —
 * construct-4uxq0.12.7 multi-component proof: Oracle consumes change-intent
 * impact packets and card context in review verdicts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { collectChangeReviewContext } from '../../lib/oracle/change-review-context.mjs';
import { synthesizeVerdict } from '../../lib/oracle/synthesize.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const { sqliteAvailable } = await import('../../lib/graph/relational/sqlite-db.mjs');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');
const SCOPE_FILE = 'lib/graph/impact.mjs';

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-intent-fn-home-'));
const createdIntents = [];
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
const prevHome = process.env.HOME;
process.env.CONSTRUCT_HOME_OVERRIDE = SANDBOX_HOME;
process.env.HOME = SANDBOX_HOME;

test.after(() => {
  for (const file of createdIntents) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmTmpDir(SANDBOX_HOME);
});

function runConstruct(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, HOME: SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

test('Oracle context includes declared change-intent impact packet for review scope', () => {
  assert.equal(runConstruct(['graph', 'build', '--no-co-change']).status, 0);
  const declare = runConstruct(['graph', 'intent', 'declare', '--target', `file:${SCOPE_FILE}`, '--json']);
  assert.equal(declare.status, 0, declare.stderr || declare.stdout);
  const intent = JSON.parse(declare.stdout);
  createdIntents.push(path.join(REPO_ROOT, '.construct', 'graph', 'intents', `${intent.id}.json`));

  const context = collectChangeReviewContext({
    rootDir: REPO_ROOT,
    projectDir: REPO_ROOT,
    scopeFiles: [SCOPE_FILE],
  });

  assert.ok(context.changeIntent.intents?.length, 'expected matching change intent');
  assert.equal(context.changeIntent.intents[0].id, intent.id);
  assert.deepEqual(context.changeIntent.intents[0].impactPacket.impactedTests, intent.packet.impactedTests);

  const { context: verdictContext } = synthesizeVerdict({
    projectDir: REPO_ROOT,
    changeReviewContext: context,
  });
  assert.equal(verdictContext.changeIntent.intents[0].id, intent.id);
});

test('Oracle context includes card identity when scope touches a card-backed file', () => {
  assert.equal(runConstruct(['graph', 'build', '--no-co-change']).status, 0);
  const context = collectChangeReviewContext({
    rootDir: REPO_ROOT,
    projectDir: REPO_ROOT,
    scopeFiles: ['lib/providers/d2.mjs'],
  });

  assert.ok(context.cards.cards?.length, 'expected provider card coverage for d2 implementation file');
  assert.ok(context.cards.cards.some((card) => card.id === 'card:provider:d2'));
  assert.equal(context.cards.cards[0].claims.kind, 'provider');
});

test('Oracle context states explicit notes when intent and card coverage are absent', () => {
  const context = collectChangeReviewContext({
    rootDir: REPO_ROOT,
    projectDir: REPO_ROOT,
    scopeFiles: ['README.md'],
  });

  assert.equal(context.changeIntent.note, 'no impact packet available');
  assert.equal(context.cards.note, 'no card coverage');

  const { context: verdictContext } = synthesizeVerdict({
    projectDir: REPO_ROOT,
    changeReviewContext: context,
  });
  assert.equal(verdictContext.changeIntent.note, 'no impact packet available');
  assert.equal(verdictContext.cards.note, 'no card coverage');
});

test('Oracle context notes when Layer 2 impact is unavailable on unsupported runtimes', () => {
  if (sqliteAvailable()) {
    assert.equal(runConstruct(['graph', 'build', '--no-co-change']).status, 0);
    const context = collectChangeReviewContext({
      rootDir: REPO_ROOT,
      projectDir: REPO_ROOT,
      scopeFiles: [SCOPE_FILE],
    });
    assert.equal(context.layer2Impact.available, true);
    return;
  }

  const context = collectChangeReviewContext({
    rootDir: REPO_ROOT,
    projectDir: REPO_ROOT,
    scopeFiles: [SCOPE_FILE],
  });
  assert.equal(context.layer2Impact.available, false);
  assert.match(context.layer2Impact.note, /Layer 2 impact analysis unavailable/i);
});
