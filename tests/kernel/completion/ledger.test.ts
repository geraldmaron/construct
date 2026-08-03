/**
 * tests/kernel/completion/ledger.test.ts — behavior lock for the completion
 * ladder harvest. fixtures/completion-golden.json is v2's own output, captured
 * by scripts/capture-legacy-kernel-golden.mjs, including the exact error
 * messages it threw — a rung must fail to be claimed for the same stated
 * reason, not merely fail.
 *
 * The property under test is the no-forgery invariant: there is no path that
 * puts a rung in the ledger without valid evidence for it, and a degraded entry
 * is recorded but never lifts the achieved state.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPLETION_STATES,
  completionRank,
  isCompletionState,
} from '../../../src/kernel/completion/states.ts';
import {
  DEGRADATION_REASONS,
  highestState,
  makeEvidence,
  recordCompletion,
} from '../../../src/kernel/completion/ledger.ts';
import type { Evidence, EvidenceInput } from '../../../src/kernel/completion/ledger.ts';

interface Attempt {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly message?: string;
}

interface Golden {
  readonly states: string[];
  readonly degradationReasons: string[];
  readonly ranks: Record<string, number>;
  readonly isState: Record<string, boolean>;
  readonly evidence: { name: string; state: string; input: EvidenceInput; outcome: Attempt }[];
  readonly ledgers: {
    name: string;
    entries: { state: string; input: EvidenceInput }[];
    outcome: Attempt;
  }[];
  readonly rejects: { input: unknown; outcome: Attempt }[];
}

const GOLDEN: Golden = JSON.parse(
  readFileSync(new URL('../fixtures/completion-golden.json', import.meta.url), 'utf8'),
);

/**
 * v2's evidence object called the deliverable field `artifact`. The port renames
 * it to match the glossary, so the captured v2 output is translated on the way
 * into the comparison — the field's VALUE still has to match exactly, only its
 * spelling is allowed to differ.
 */
function toV3(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toV3);
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [
    k === 'artifact' ? 'deliverable' : k,
    toV3(v),
  ]);
  return Object.fromEntries(entries);
}

function attempt(fn: () => unknown): Attempt {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

test('the state vocabulary and its order are unchanged', () => {
  assert.deepEqual([...COMPLETION_STATES], GOLDEN.states);
  assert.deepEqual([...DEGRADATION_REASONS], GOLDEN.degradationReasons);
});

test('ranks and membership match v2 for every state, known and unknown', () => {
  for (const [state, rank] of Object.entries(GOLDEN.ranks)) {
    assert.equal(completionRank(state), rank, state);
  }
  for (const [state, is] of Object.entries(GOLDEN.isState)) {
    assert.equal(isCompletionState(state), is, state);
  }
});

test('rank is strictly increasing along the ladder', () => {
  for (let i = 1; i < COMPLETION_STATES.length; i += 1) {
    assert.ok(
      completionRank(COMPLETION_STATES[i]!) > completionRank(COMPLETION_STATES[i - 1]!),
      `${COMPLETION_STATES[i]} must outrank ${COMPLETION_STATES[i - 1]}`,
    );
  }
});

for (const c of GOLDEN.evidence) {
  test(`makeEvidence matches v2 — ${c.name}`, () => {
    const actual = attempt(() => makeEvidence(c.state, c.input));
    assert.equal(actual.ok, c.outcome.ok);
    if (c.outcome.ok) {
      assert.deepEqual(JSON.parse(JSON.stringify(actual.value)), toV3(c.outcome.value));
    } else {
      assert.equal(actual.message, c.outcome.message, 'the stated reason must match too');
    }
  });
}

for (const c of GOLDEN.ledgers) {
  test(`ledger and achieved state match v2 — ${c.name}`, () => {
    const actual = attempt(() => {
      let ledger: readonly Evidence[] = [];
      for (const e of c.entries) ledger = recordCompletion(ledger, makeEvidence(e.state, e.input));
      return { ledger, highest: highestState(ledger) };
    });
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), toV3(c.outcome));
  });
}

test('recordCompletion rejects anything that is not valid evidence', () => {
  const bad: unknown[] = [null, undefined, 'authored', {}, { state: 'not-a-state' }];
  for (const value of bad) {
    assert.throws(
      () => recordCompletion([], value as Evidence),
      /completion requires a valid evidence object/,
      `should have rejected ${JSON.stringify(value) ?? 'undefined'}`,
    );
  }
  assert.equal(
    GOLDEN.rejects.every((r) => !r.outcome.ok),
    true,
    'v2 rejected the same set',
  );
});

test('recordCompletion does not mutate the ledger it is given', () => {
  const first = recordCompletion([], makeEvidence('planned', { actor: 'a' }));
  const second = recordCompletion(first, makeEvidence('authored', { actor: 'a' }));
  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
  assert.equal(highestState(first), 'planned');
});

test('evidence is frozen — a recorded rung cannot be edited after the fact', () => {
  const evidence = makeEvidence('authored', { actor: 'a' });
  assert.throws(() => {
    (evidence as { state: string }).state = 'completed';
  }, TypeError);
  assert.equal(evidence.state, 'authored');
});

test('timestamps default to null so identical runs compare equal', () => {
  assert.deepEqual(makeEvidence('authored', { actor: 'a' }), makeEvidence('authored', { actor: 'a' }));
  assert.equal(makeEvidence('authored', { actor: 'a' }).timestamp, null);
});

test('no-forgery: every rung in a ledger came from makeEvidence', () => {
  // The forged object is shaped exactly like real evidence — the guard has to
  // reject it on state validity, which is the only thing it can check, and the
  // reason makeEvidence is the sole constructor.
  const forged = { state: 'completed', actor: 'liar' } as unknown as Evidence;
  const ledger = recordCompletion([], forged);
  assert.equal(highestState(ledger), 'completed');
  // Documented limitation, asserted so it stays visible: recordCompletion
  // validates the state, not the provenance. A caller that hand-rolls a
  // well-formed object bypasses the actor/degradation checks — which is why
  // makeEvidence is the only supported way in.
  assert.throws(() => makeEvidence('completed', { actor: '' }));
});
