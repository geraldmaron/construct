/**
 * tests/kernel/context/loop.test.ts — the context loop.
 *
 * The properties held here are the application disciplines: every delta and
 * proposal must cite a resolvable line of the exact note being applied,
 * deltas reach memory only through the admission gate (held is an outcome,
 * external and high-risk hold without a human), proposals land in the rung 0
 * queue pending rather than applied, and one bad citation rolls the whole
 * pass back. The summary is a deterministic restatement of the densified
 * reading, not a second paraphrase.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { recordNote, noteCitation } from '../../../src/kernel/store/notes.ts';
import { addSource, decisionOf, pendingProposals } from '../../../src/kernel/store/sources.ts';
import { getLesson } from '../../../src/kernel/store/lessons.ts';
import { operationalLessonsFor } from '../../../src/kernel/lessons/admission.ts';
import {
  applyContextLoop,
  confirmIntentSummary,
  type ContextLoopInput,
  type MemoryDelta,
  type PropagationProposal,
} from '../../../src/kernel/context/loop.ts';

const AT = '2026-08-05T00:00:00.000Z';

const DENSIFIED = {
  outcome: 'move the pilot to Q4',
  constraints: ['legal review before any customer email'],
  decisions: ['pricing stays flat for the pilot'],
  parked: ['revisit the onboarding video'],
  underspecified: '',
} as const;

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

function seed(store: ReturnType<typeof openStore>): void {
  recordNote(store, {
    id: 'n-1',
    workspace: 'acme',
    run: 'run-1',
    door: 'file-drop',
    body: 'they want the pilot in Q4\npricing stays flat\nupdate PROJ-14 with the new date',
    recordedAt: AT,
  });
  addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: 'PROJ', addedAt: AT });
}

function delta(overrides: Partial<MemoryDelta> = {}): MemoryDelta {
  return {
    id: 'delta-1',
    kind: 'process',
    domain: 'product-scoping',
    body: 'this client decides scope by quarter, not by feature list',
    citation: noteCitation('n-1', 1),
    external: false,
    basis: { kind: 'adversarial-pass', detail: 'checked against the two prior notes' },
    ...overrides,
  };
}

function proposal(overrides: Partial<PropagationProposal> = {}): PropagationProposal {
  return {
    id: 'prop-1',
    source: 'src-1',
    change: 'move PROJ-14 target date to Q4',
    justification: noteCitation('n-1', 3),
    risk: 'low',
    ...overrides,
  };
}

function input(overrides: Partial<ContextLoopInput> = {}): ContextLoopInput {
  return {
    workspace: 'acme',
    run: 'run-1',
    noteId: 'n-1',
    densified: DENSIFIED,
    deltas: [delta()],
    proposals: [proposal()],
    ...overrides,
  };
}

test('the confirm-intent summary restates the densified reading, sections only when present', () => {
  const summary = confirmIntentSummary(DENSIFIED);
  assert.match(summary, /confirm this reading first/);
  assert.match(summary, /Outcome: move the pilot to Q4/);
  assert.match(summary, /Decisions you already made:\n- pricing stays flat/);
  assert.match(summary, /Parked .*:\n- revisit the onboarding video/);
  const bare = confirmIntentSummary({ outcome: 'x', constraints: [], decisions: [], parked: [], underspecified: '' });
  assert.ok(!bare.includes('Constraints'));
  assert.ok(!bare.includes('Parked'));
});

test('a full pass lands: delta admitted through the gate, proposal pending in the rung 0 queue', () => {
  withStore((store) => {
    seed(store);
    const result = applyContextLoop(store, input(), AT);
    assert.equal(result.admissions[0]?.verdict, 'admitted');
    assert.equal(operationalLessonsFor(store, 'acme').length, 1);
    assert.deepEqual(result.filed, ['prop-1']);
    // Filed is not applied: the proposal waits for rung 0's decision machinery.
    assert.equal(decisionOf(store, 'prop-1'), null);
    assert.equal(pendingProposals(store, 'acme').length, 1);
  });
});

test('the gate is not bypassed: an external delta is held even in a low-risk domain', () => {
  withStore((store) => {
    seed(store);
    const result = applyContextLoop(
      store,
      input({ deltas: [delta({ external: true })], proposals: [] }),
      AT,
    );
    assert.equal(result.admissions[0]?.verdict, 'held');
    assert.match(result.admissions[0]?.reason ?? '', /external/);
    // Held, not lost: the lesson exists, it is just not operational.
    assert.ok(getLesson(store, 'delta-1'));
    assert.equal(operationalLessonsFor(store, 'acme').length, 0);
  });
});

test('a high-risk domain holds without a human, admits with one', () => {
  withStore((store) => {
    seed(store);
    const held = applyContextLoop(
      store,
      input({ deltas: [delta({ domain: 'privacy' })], proposals: [] }),
      AT,
    );
    assert.equal(held.admissions[0]?.verdict, 'held');
    const admitted = applyContextLoop(
      store,
      input({
        deltas: [
          delta({
            id: 'delta-2',
            domain: 'privacy',
            basis: { kind: 'human-approval', approver: 'gerald', detail: 'reviewed the note' },
          }),
        ],
        proposals: [],
      }),
      AT,
    );
    assert.equal(admitted.admissions[0]?.verdict, 'admitted');
  });
});

test('a citation that resolves to nothing, or to a different note, refuses the whole pass', () => {
  withStore((store) => {
    seed(store);
    recordNote(store, {
      id: 'n-2',
      workspace: 'acme',
      run: null,
      door: 'host-session',
      body: 'a different call entirely',
      recordedAt: AT,
    });
    assert.throws(
      () => applyContextLoop(store, input({ deltas: [delta({ citation: 'note:n-1#L9' })] }), AT),
      /resolves to no line/,
    );
    assert.throws(
      () =>
        applyContextLoop(
          store,
          input({ proposals: [proposal({ justification: noteCitation('n-2', 1) })] }),
          AT,
        ),
      /not the note being applied/,
    );
  });
});

test('one bad output rolls back the whole pass: no half-applied loop', () => {
  withStore((store) => {
    seed(store);
    assert.throws(
      () =>
        applyContextLoop(
          store,
          input({
            deltas: [delta()],
            proposals: [proposal({ source: 'src-missing' })],
          }),
          AT,
        ),
      /no source/,
    );
    // The delta ahead of the failing proposal did not survive on its own.
    assert.equal(getLesson(store, 'delta-1'), null);
    assert.equal(pendingProposals(store, 'acme').length, 0);
  });
});

test('a note from another workspace, or no note at all, is refused before anything runs', () => {
  withStore((store) => {
    seed(store);
    assert.throws(() => applyContextLoop(store, input({ noteId: 'n-none' }), AT), /no note/);
    assert.throws(
      () => applyContextLoop(store, input({ workspace: 'other' }), AT),
      /belongs to acme/,
    );
  });
});
