/**
 * tests/kernel/implication/escalate.test.ts — the escalation seam
 * (construct-4jq).
 *
 * The properties under test are the ones that make escalation safe to add at
 * all: it never runs when keywords answered, it cannot invent a domain, and it
 * degrades to silence rather than to a guess. A namer is a stub here on
 * purpose — the kernel must be provably host-ignorant, and a test that reached
 * for a real host would be testing the host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapImplicationsEscalating } from '../../../src/kernel/implication/escalate.ts';
import type { DomainNamer, EscalationCache } from '../../../src/kernel/implication/escalate.ts';
import type { Implication } from '../../../src/kernel/implication/map.ts';
import type { Domain } from '../../../src/kernel/implication/domains.ts';

/**
 * A fixed catalog, so these tests measure the seam rather than the live
 * keyword lists. Pinning "silent" against the real catalog was wrong twice
 * over: the first attempt was not actually silent (a raffle outcome fires
 * program-sequencing on the word "before"), and any outcome that IS silent
 * today stops being silent the moment someone adds a keyword.
 */
const CATALOG: readonly Domain[] = [
  {
    path: 'marketing-claims',
    domain: 'marketing-claims',
    concern: 'what you say publicly and whether you can back it up',
    keywords: ['press release'],
  },
  {
    path: 'privacy',
    domain: 'privacy',
    concern: 'personal data, consent, and cross-border transfer',
    keywords: ['personal data'],
  },
];

/** An outcome this catalog answers, and one it is silent on. */
const ANSWERED = 'Put out a press release this week';
const SILENT = 'We want to run a raffle for anyone who joins before Friday';

function namer(namings: Array<{ domain: string; why: string }>): {
  fn: DomainNamer;
  calls: string[];
} {
  const calls: string[] = [];
  const fn: DomainNamer = async (outcome) => {
    calls.push(outcome);
    return namings;
  };
  return { fn, calls };
}

function memoryCache(): EscalationCache & { entries: Map<string, readonly Implication[]> } {
  const entries = new Map<string, readonly Implication[]>();
  return {
    entries,
    get: (outcome) => entries.get(outcome),
    set: (outcome, implications) => void entries.set(outcome, implications),
  };
}

test('keywords answering means the namer is never consulted', async () => {
  const stub = namer([{ domain: 'privacy', why: 'should not be reached' }]);
  const result = await mapImplicationsEscalating({ catalog: CATALOG, outcome: ANSWERED, namer: stub.fn });
  assert.equal(result.inferredBy, 'keywords');
  assert.deepEqual(stub.calls, [], 'the deterministic pass answered; escalation must cost nothing');
  assert.ok(result.implicated.length > 0);
});

test('silence is what escalates, and the reason travels with the answer', async () => {
  const stub = namer([{ domain: 'marketing-claims', why: 'a raffle is a regulated promotion' }]);
  const result = await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT, namer: stub.fn });
  assert.equal(result.inferredBy, 'escalation');
  assert.deepEqual(stub.calls, [SILENT]);
  assert.deepEqual(
    result.implicated.map((i) => [i.domain, i.signals]),
    [['marketing-claims', ['a raffle is a regulated promotion']]],
  );
});

test('with no namer the map behaves exactly as it always has', async () => {
  const result = await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT });
  assert.equal(result.inferredBy, 'none');
  assert.deepEqual(result.implicated, []);
});

test('a namer cannot invent a domain the catalog does not define', async () => {
  const stub = namer([
    { domain: 'astrology', why: 'the stars say so' },
    { domain: 'marketing-claims', why: 'a raffle is a regulated promotion' },
  ]);
  const result = await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT, namer: stub.fn });
  assert.deepEqual(result.implicated.map((i) => i.domain), ['marketing-claims']);
});

test('a naming with no stated reason does not surface', async () => {
  // Same bar as the keyword path, where a domain with nothing to cite is
  // suppressed: an inference nobody can argue with is not an inference.
  const stub = namer([
    { domain: 'marketing-claims', why: '   ' },
    { domain: 'privacy', why: 'a signup list is personal data' },
  ]);
  const result = await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT, namer: stub.fn });
  assert.deepEqual(result.implicated.map((i) => i.domain), ['privacy']);
});

test('a namer that throws degrades to silence, never to a guess', async () => {
  const exploding: DomainNamer = async () => {
    throw new Error('host unreachable');
  };
  const result = await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT, namer: exploding });
  assert.equal(result.inferredBy, 'none');
  assert.deepEqual(result.implicated, []);
});

test('a namer that names nothing is reported as nothing, not as an escalation', async () => {
  const stub = namer([]);
  const result = await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT, namer: stub.fn });
  assert.equal(result.inferredBy, 'none');
});

test('duplicate namings collapse rather than dispatching a role twice', async () => {
  const stub = namer([
    { domain: 'marketing-claims', why: 'first reason' },
    { domain: 'marketing-claims', why: 'second reason' },
  ]);
  const result = await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT, namer: stub.fn });
  assert.equal(result.implicated.length, 1);
});

test('the same outcome does not pay for escalation twice', async () => {
  const stub = namer([{ domain: 'marketing-claims', why: 'a raffle is a regulated promotion' }]);
  const cache = memoryCache();
  const first = await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT, namer: stub.fn, cache });
  const second = await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT, namer: stub.fn, cache });
  assert.equal(first.inferredBy, 'escalation');
  assert.equal(second.inferredBy, 'cache');
  assert.deepEqual(stub.calls, [SILENT], 'the second call must not reach the namer');
  assert.deepEqual(second.implicated, first.implicated);
});

test('a cached silence is still silence, and still does not re-escalate', async () => {
  const stub = namer([]);
  const cache = memoryCache();
  await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT, namer: stub.fn, cache });
  const again = await mapImplicationsEscalating({ catalog: CATALOG, outcome: SILENT, namer: stub.fn, cache });
  assert.equal(again.inferredBy, 'none');
  assert.deepEqual(stub.calls, [SILENT]);
});
