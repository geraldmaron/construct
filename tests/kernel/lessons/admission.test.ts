/**
 * tests/kernel/lessons/admission.test.ts — the admission gate's order of
 * authority.
 *
 * The properties held here are the gate's reason for existing: an external
 * source cannot be outvoted by a low risk tier, a high-risk domain cannot be
 * admitted by anything but a named human, and every verdict — including the
 * holds — leaves a recorded reason. The external-source test deliberately
 * hands the gate the lowest-risk domain there is, because the failure being
 * prevented is exactly "the risk score talked us past the source".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { recordLesson } from '../../../src/kernel/store/lessons.ts';
import {
  admissionOf,
  decideAdmission,
  operationalLessonsFor,
  riskTierFor,
} from '../../../src/kernel/lessons/admission.ts';
import { DOMAINS } from '../../../src/kernel/implication/domains.ts';

const AT = '2026-08-05T00:00:00.000Z';

// Derived from the catalog so the test tracks it: the lowest-risk domain is
// one with no licensed-review requirement.
const LOW_RISK = DOMAINS.find((d) => !d.licensedReview)?.domain;
const HIGH_RISK = DOMAINS.find((d) => d.licensedReview)?.domain;

function withStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

function lesson(id: string, external: boolean) {
  return {
    id,
    workspace: 'client-a',
    kind: 'technique' as const,
    body: 'ask for the source document before summarizing it',
    citation: external ? 'ingested:vendor-handbook.pdf' : 'run:2026-08-05',
    external,
    createdAt: AT,
  };
}

test('the risk tier is derived, and an unknown domain is high-risk', () => {
  assert.ok(LOW_RISK, 'catalog has a domain without licensed review');
  assert.ok(HIGH_RISK, 'catalog has a domain requiring licensed review');
  assert.equal(riskTierFor(LOW_RISK as string), 'low');
  assert.equal(riskTierFor(HIGH_RISK as string), 'high');
  assert.equal(riskTierFor('a-domain-nobody-rated'), 'high');
});

test('a low-risk lesson admits only through a recorded adversarial pass', () => {
  withStore((store) => {
    recordLesson(store, lesson('l-low', false));
    const decision = decideAdmission(store, {
      lessonId: 'l-low',
      domain: LOW_RISK as string,
      basis: { kind: 'adversarial-pass', detail: 'refutation attempted, claim held' },
      decidedAt: AT,
    });
    assert.equal(decision.verdict, 'admitted');
    assert.match(decision.reason, /adversarial pass/);
    assert.equal(admissionOf(store, 'l-low')?.verdict, 'admitted');
  });
});

test('a lesson with no verdict at all is not operational', () => {
  withStore((store) => {
    recordLesson(store, lesson('l-undecided', false));
    assert.deepEqual(operationalLessonsFor(store, 'client-a'), []);
  });
});

test('a high-risk lesson cannot admit without a recorded human approval', () => {
  withStore((store) => {
    recordLesson(store, lesson('l-high', false));
    const held = decideAdmission(store, {
      lessonId: 'l-high',
      domain: HIGH_RISK as string,
      basis: { kind: 'adversarial-pass', detail: 'passed, for whatever that is worth' },
      decidedAt: AT,
    });
    assert.equal(held.verdict, 'held');
    assert.match(held.reason, /human approval/);
    assert.deepEqual(operationalLessonsFor(store, 'client-a'), []);

    const admitted = decideAdmission(store, {
      lessonId: 'l-high',
      domain: HIGH_RISK as string,
      basis: { kind: 'human-approval', approver: 'gerald', detail: 'reviewed the doctrine claim' },
      decidedAt: AT,
    });
    assert.equal(admitted.verdict, 'admitted');
    assert.equal(admitted.reviewer, 'gerald');
    assert.deepEqual(operationalLessonsFor(store, 'client-a').map((l) => l.id), ['l-high']);
  });
});

test('an externally-sourced lesson is held even in the lowest-risk domain', () => {
  withStore((store) => {
    recordLesson(store, lesson('l-ext', true));
    const decision = decideAdmission(store, {
      lessonId: 'l-ext',
      domain: LOW_RISK as string,
      basis: { kind: 'adversarial-pass', detail: 'a model read the document and saw nothing wrong' },
      decidedAt: AT,
    });
    assert.equal(decision.verdict, 'held');
    assert.match(decision.reason, /external/);

    const human = decideAdmission(store, {
      lessonId: 'l-ext',
      domain: LOW_RISK as string,
      basis: { kind: 'human-approval', approver: 'gerald', detail: 'read the ingested source myself' },
      decidedAt: AT,
    });
    assert.equal(human.verdict, 'admitted');
  });
});

test('every decision is recorded with its reason, and the record cannot be edited', () => {
  withStore((store) => {
    recordLesson(store, lesson('l-rec', true));
    decideAdmission(store, {
      lessonId: 'l-rec',
      domain: LOW_RISK as string,
      basis: { kind: 'adversarial-pass', detail: 'attempted' },
      decidedAt: AT,
    });
    const rows = store.db.prepare('SELECT * FROM lesson_admissions WHERE lesson = ?').all('l-rec');
    assert.equal(rows.length, 1);
    assert.throws(() =>
      store.db.prepare("UPDATE lesson_admissions SET verdict = 'admitted' WHERE lesson = ?").run('l-rec'),
    );
    assert.throws(() => store.db.prepare('DELETE FROM lesson_admissions WHERE lesson = ?').run('l-rec'));
  });
});

test('revoking an admitted lesson is a newer held row, and the newest verdict wins', () => {
  withStore((store) => {
    recordLesson(store, lesson('l-revoke', false));
    decideAdmission(store, {
      lessonId: 'l-revoke',
      domain: LOW_RISK as string,
      basis: { kind: 'adversarial-pass', detail: 'held up at the time' },
      decidedAt: AT,
    });
    assert.equal(admissionOf(store, 'l-revoke')?.verdict, 'admitted');

    decideAdmission(store, {
      lessonId: 'l-revoke',
      domain: HIGH_RISK as string,
      basis: { kind: 'adversarial-pass', detail: 'redecided under the domain it actually teaches' },
      decidedAt: '2026-08-05T02:00:00.000Z',
    });
    assert.equal(admissionOf(store, 'l-revoke')?.verdict, 'held');
    assert.deepEqual(operationalLessonsFor(store, 'client-a'), []);
  });
});
