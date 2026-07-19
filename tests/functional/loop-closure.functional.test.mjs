/**
 * tests/functional/loop-closure.functional.test.mjs
 *
 * Regression guards for the Construct learning loop — the claims an audit
 * (docs/operations/audit/implementation-audit-20260601.md) validated empirically against a
 * clean, isolated instance. Each test pins one loop stage so a future change
 * that silently breaks closure fails CI instead of degrading in the field.
 *
 * Hermetic and offline-deterministic by design: no embed model, no Postgres, no
 * network. Observation search exercises the local hashing-bow fallback in
 * lib/observation-store.mjs; the role queue is isolated via CONSTRUCT_ROLES_ROOT.
 *
 * Stages covered:
 *   1. capture → search → consume   (observation store)
 *   2. outcome record → read-back   (outcomes/record)
 *   3. role-queue fixture guard + manual-resolve semantics (roles/gateway)
 *   4. intake classification is deterministic (intake/classify)
 *
 * Stage 1 resolves observation-store state through the machine-scoped state
 * root (ADR-0066), keyed by a hash of the tmp rootDir — so CONSTRUCT_HOME_OVERRIDE
 * is pinned for the whole file to keep that write off the real developer
 * machine's $HOME.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = join(REPO_ROOT, 'lib');

let homeOverride;
let prevHomeOverride;

before(() => {
  homeOverride = mkdtempSync(join(tmpdir(), 'cx-loop-closure-home-'));
  prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
});

after(() => {
  try { rmSync(homeOverride, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

function tmp(prefix, t) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmTmpDir(dir));
  return dir;
}

test('loop stage 1 — observation capture, search, and consume close offline', async (t) => {
  const root = tmp('loop-obs-', t);
  const { addObservation, searchObservations, listObservations } =
    await import(`${LIB}/observation-store.mjs`);

  // Ensure deterministic hashing mode
  process.env.CONSTRUCT_EMBEDDING_MODEL = 'hashing';
  t.after(() => { delete process.env.CONSTRUCT_EMBEDDING_MODEL; });

  // The observation store resolves the machine-scoped state root (ADR-0066)
  // via CONSTRUCT_HOME_OVERRIDE read in-process, not via the `root` argument above —
  // pin it or these calls write into the real developer machine's home.
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = root;
  t.after(() => {
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
  });

  const seeds = [
    'BM25 normalization merges with cosine in hybrid ranking',
    'Session-start hook injects top relevant observations',
    'Intake classifier is deterministic keyword matching, no LLM',
  ];
  for (const summary of seeds) {
    await addObservation(root, {
      role: 'engineer', category: 'pattern', summary,
      content: `${summary} — detail body for embedding.`, tags: ['loop-test'],
      project: 'looptest', confidence: 0.8, source: 'manual',
    });
  }

  const stored = listObservations(root, { project: 'looptest', limit: 50 }) || [];
  assert.equal(stored.length, seeds.length, 'all seeded observations are persisted');

  const hits = await searchObservations(root, 'BM25 ranking', {
    project: 'looptest', limit: 5,
  });
  assert.ok(hits.length > 0, 'search returns at least one hit via the offline path');
  assert.ok(
    hits.some((h) => /BM25/.test(h.summary || '')),
    'the relevant seeded observation is retrievable (consume half closes)',
  );
});

test('loop stage 2 — outcomes are recorded and read back', async (t) => {
  const root = tmp('loop-out-', t);
  const { recordOutcome, listOutcomes } = await import(`${LIB}/outcomes/record.mjs`);

  const file = recordOutcome(root, {
    role: 'engineer', success: true, durationMs: 1234,
    notes: 'loop-closure test', source: 'agent-tracker',
  });
  assert.ok(file, 'recordOutcome returns the file path it wrote');

  const outs = listOutcomes(root, 'engineer') || [];
  assert.equal(outs.length, 1, 'exactly one outcome line is read back');
  assert.equal(outs[0].success, true, 'the recorded outcome round-trips');
  assert.equal(outs[0].source, 'agent-tracker', 'source is preserved');
});

test('loop stage 3 — role queue rejects fixtures and clears only on explicit resolve', async (t) => {
  const root = tmp('loop-role-', t);
  process.env.CONSTRUCT_ROLES_ROOT = join(root, '.cx');
  t.after(() => { delete process.env.CONSTRUCT_ROLES_ROOT; });

  const { isTestFixturePath, shouldEscalate, listPending, markResolved } =
    await import(`${LIB}/roles/gateway.mjs`);

  assert.equal(isTestFixturePath('/tmp/cx-secrets-x/fixture.env'), true, 'tmp path flagged as fixture');
  assert.equal(isTestFixturePath('/Users/real/project'), false, 'real path is not flagged');

  const verdict = shouldEscalate(
    { type: 'secrets.detected', cwd: '/tmp/cx-secrets-x', fingerprint: 'fp-fixture' }, {},
  );
  assert.equal(verdict.escalate, false, 'fixture-path events do not escalate');
  assert.equal(verdict.reason, 'test-fixture-path', 'and the reason is the fixture guard');

  const pendingFile = join(root, '.cx', 'role-pending.jsonl');
  mkdirSync(join(root, '.cx'), { recursive: true });
  appendFileSync(pendingFile, JSON.stringify({
    ts: Date.now(), personaId: 'engineer', workerProfileId: 'engineer',
    fingerprint: 'fp-real', eventType: 'handoff.received', summary: 'loop test', source: 'manual',
  }) + '\n');

  assert.equal(listPending().length, 1, 'the entry is pending');
  assert.equal(markResolved('fp-real'), true, 'markResolved clears it');
  assert.equal(listPending().length, 0, 'pending only clears via explicit resolve — no silent drain');
});

test('loop stage 4 — intake classification is deterministic', async (t) => {
  await import(`${LIB}/intake/classify.mjs`);
  const { classifyRdIntake } = await import(`${LIB}/intake/classify.mjs`);

  const input = {
    sourcePath: 'session-timeout-bug.md',
    extractedText: 'Users hit a session timeout error after 30 minutes; stack trace attached.',
  };
  const a = classifyRdIntake(input);
  const b = classifyRdIntake(input);

  assert.ok(a.intakeType, 'a triage type is produced');
  assert.equal(a.intakeType, b.intakeType, 'classification is stable across runs (no LLM nondeterminism)');
  assert.equal(a.primaryOwner, b.primaryOwner, 'owner assignment is stable');
});
