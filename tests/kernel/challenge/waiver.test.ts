/**
 * tests/kernel/challenge/waiver.test.ts — setting a challenge aside, once, on
 * the record.
 *
 * Commitment 13's last sentence is the specification: waivers are the user's
 * alone, per deliverable, per challenge, and are logged — never a global
 * off-switch. Each clause is a test here, and the one that matters most is the
 * one about scope: a waiver granted on one deliverable must do nothing at all
 * to the next one, because a waiver that outlives its deliverable is the
 * off-switch arriving under another name.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { enqueueTask } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { promotionOf, recordVerdict, waiveChallenge } from '../../../src/kernel/run/promotion.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const AT = '2026-08-05T00:00:00.000Z';

function brief(id: string): Brief {
  return {
    id,
    outcome: 'Launch a paid beta to EU users',
    role: 'privacy',
    inputs: [],
    capabilities: [],
    postconditions: [],
    challenges: ['legal-issue-spot'],
  };
}

function withStore<T>(body: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
  try {
    return body(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

function seed(store: ReturnType<typeof openStore>, id: string): void {
  enqueueTask(store, { id, run: 'run-1', role: 'privacy', brief: brief(id), at: AT });
}

test('a waiver unblocks the one deliverable it names, and nothing else', () => {
  withStore((store) => {
    seed(store, 't-one');
    seed(store, 't-two');

    // Both are held by the same unanswerable challenge.
    assert.equal(promotionOf(store, 't-one')?.state, 'draft');
    assert.equal(promotionOf(store, 't-two')?.state, 'draft');

    const record = waiveChallenge(store, {
      task: 't-one',
      challenge: 'legal-issue-spot',
      by: 'user',
      reason: 'Internal draft; no external party relies on it.',
      at: AT,
    });
    assert.equal(record.recorded, true);

    const one = promotionOf(store, 't-one');
    assert.equal(one?.state, 'final');
    assert.deepEqual(one?.waived, ['legal-issue-spot']);

    // The second deliverable is untouched. This is the whole property.
    assert.equal(promotionOf(store, 't-two')?.state, 'draft');
    assert.deepEqual(promotionOf(store, 't-two')?.waived, []);
  });
});

test('a waived deliverable never reads like one that survived the challenge', () => {
  withStore((store) => {
    seed(store, 't-waived');
    seed(store, 't-passed');
    waiveChallenge(store, {
      task: 't-waived',
      challenge: 'legal-issue-spot',
      by: 'user',
      reason: 'Internal draft.',
      at: AT,
    });
    recordVerdict(store, {
      task: 't-passed',
      challenge: 'legal-issue-spot',
      outcome: 'passed',
      by: 'legal',
      at: AT,
    });

    const waived = promotionOf(store, 't-waived');
    const passed = promotionOf(store, 't-passed');
    // Same state, and the record still tells them apart.
    assert.equal(waived?.state, 'final');
    assert.equal(passed?.state, 'final');
    assert.deepEqual(waived?.waived, ['legal-issue-spot']);
    assert.deepEqual(passed?.waived, []);
  });
});

test('a waiver without a stated reason is refused, and the refusal is recorded', () => {
  withStore((store) => {
    seed(store, 't-one');
    const record = waiveChallenge(store, {
      task: 't-one',
      challenge: 'legal-issue-spot',
      by: 'user',
      reason: '   ',
      at: AT,
    });

    assert.equal(record.recorded, false);
    assert.equal(record.refusal, 'unreasoned-waiver');
    assert.equal(promotionOf(store, 't-one')?.state, 'draft', 'a refused waiver waives nothing');

    // Refused, and visible. A refusal nobody can see is a refusal nobody learns from.
    const refusals = readWorkLog(store, 'run-1').filter((e) => e.action === 'verdict-refused');
    assert.equal(refusals.length, 1);
    assert.equal((refusals[0].detail as { refusal: string }).refusal, 'unreasoned-waiver');
  });
});

test('the reason travels with the waiver, in the append-only log', () => {
  withStore((store) => {
    seed(store, 't-one');
    waiveChallenge(store, {
      task: 't-one',
      challenge: 'legal-issue-spot',
      by: 'user',
      reason: 'Internal draft; no external party relies on it.',
      at: AT,
    });

    const verdict = readWorkLog(store, 'run-1').find((e) => e.action === 'verdict-recorded');
    assert.ok(verdict);
    const detail = verdict.detail as { outcome: string; by: string; reason: string };
    assert.equal(detail.outcome, 'waived');
    assert.equal(detail.by, 'user');
    assert.equal(detail.reason, 'Internal draft; no external party relies on it.');
  });
});

test('a role cannot waive its own challenge', () => {
  withStore((store) => {
    seed(store, 't-one');
    const record = waiveChallenge(store, {
      task: 't-one',
      challenge: 'legal-issue-spot',
      // The producing role, trying to clear its own path.
      by: 'privacy',
      reason: 'I am confident this is fine.',
      at: AT,
    });
    assert.equal(record.recorded, false);
    assert.equal(record.refusal, 'self-verdict');
    assert.equal(promotionOf(store, 't-one')?.state, 'draft');
  });
});
