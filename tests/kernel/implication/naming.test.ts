/**
 * tests/kernel/implication/naming.test.ts — the model-primary naming seam.
 *
 * The properties under test are the ones that make the inversion safe to
 * ship: with a namer supplied it reads every outcome (including ones keywords
 * would have answered), it cannot invent a domain, an empty answer from it
 * stands as an answer, and only a namer that throws falls back to keywords —
 * with the failure stated, never silent. A namer is a stub here on purpose:
 * the kernel must be provably host-ignorant, and a test that reached for a
 * real host would be testing the host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapImplicationsNamed } from '../../../src/kernel/implication/naming.ts';
import type { DomainNamer, NamingCache } from '../../../src/kernel/implication/naming.ts';
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

/** An outcome this catalog's keywords answer, and one they are silent on. */
const ANSWERED = 'Put out a press release this week';
const SILENT = 'We want to run a raffle for anyone who joins before Friday';

function namer(namings: Array<{ domain: string; why: string }>): {
  fn: DomainNamer;
  calls: string[];
  catalogs: (readonly Domain[])[];
} {
  const calls: string[] = [];
  const catalogs: (readonly Domain[])[] = [];
  const fn: DomainNamer = async (outcome, catalog) => {
    calls.push(outcome);
    catalogs.push(catalog);
    return namings;
  };
  return { fn, calls, catalogs };
}

function memoryCache(): NamingCache & { entries: Map<string, readonly Implication[]> } {
  const entries = new Map<string, readonly Implication[]>();
  return {
    entries,
    get: (outcome) => entries.get(outcome),
    set: (outcome, implications) => void entries.set(outcome, implications),
  };
}

test('the namer reads every outcome, including ones keywords would answer', async () => {
  const stub = namer([{ domain: 'privacy', why: 'the announcement quotes user counts drawn from account data' }]);
  const result = await mapImplicationsNamed({ catalog: CATALOG, outcome: ANSWERED, namer: stub.fn });
  assert.deepEqual(stub.calls, [ANSWERED], 'a supplied namer is primary, not a fallback for silence');
  assert.equal(result.inferredBy, 'namer');
  assert.deepEqual(
    result.implicated.map((i) => i.domain),
    ['privacy'],
    'the namer decides; the keyword answer must not be merged in — that union was never measured',
  );
});

test('the reason travels with the answer', async () => {
  const stub = namer([{ domain: 'marketing-claims', why: 'a raffle is a regulated promotion' }]);
  const result = await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: stub.fn });
  assert.equal(result.inferredBy, 'namer');
  assert.deepEqual(
    result.implicated.map((i) => [i.domain, i.signals]),
    [['marketing-claims', ['a raffle is a regulated promotion']]],
  );
});

test('with no namer the keyword map answers exactly as it always has', async () => {
  const answered = await mapImplicationsNamed({ catalog: CATALOG, outcome: ANSWERED });
  assert.equal(answered.inferredBy, 'keywords');
  assert.ok(answered.implicated.length > 0);

  const silent = await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT });
  assert.equal(silent.inferredBy, 'none');
  assert.deepEqual(silent.implicated, []);
});

test('a namer cannot invent a domain the catalog does not define', async () => {
  const stub = namer([
    { domain: 'astrology', why: 'the stars say so' },
    { domain: 'marketing-claims', why: 'a raffle is a regulated promotion' },
  ]);
  const result = await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: stub.fn });
  assert.deepEqual(result.implicated.map((i) => i.domain), ['marketing-claims']);
});

test('a naming with no stated reason does not surface', async () => {
  // Same bar as the keyword path, where a domain with nothing to cite is
  // suppressed: an inference nobody can argue with is not an inference.
  const stub = namer([
    { domain: 'marketing-claims', why: '   ' },
    { domain: 'privacy', why: 'a signup list is personal data' },
  ]);
  const result = await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: stub.fn });
  assert.deepEqual(result.implicated.map((i) => i.domain), ['privacy']);
});

test('a namer that throws falls back to keywords, and the failure is stated', async () => {
  const exploding: DomainNamer = async () => {
    throw new Error('host unreachable');
  };
  const result = await mapImplicationsNamed({ catalog: CATALOG, outcome: ANSWERED, namer: exploding });
  assert.equal(result.inferredBy, 'keywords', 'a broken host must not take routing with it');
  assert.ok(result.implicated.length > 0);
  assert.equal(result.namerFailure, 'host unreachable', 'a keyword answer standing in for a model must say so');
});

test('a namer that throws on an outcome keywords cannot answer reports none, still stating the failure', async () => {
  const exploding: DomainNamer = async () => {
    throw new Error('host unreachable');
  };
  const result = await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: exploding });
  assert.equal(result.inferredBy, 'none');
  assert.deepEqual(result.implicated, []);
  assert.equal(result.namerFailure, 'host unreachable');
});

test('a namer that names nothing is an answer, not a failure — keywords do not second-guess it', async () => {
  const stub = namer([]);
  const result = await mapImplicationsNamed({ catalog: CATALOG, outcome: ANSWERED, namer: stub.fn });
  assert.equal(result.inferredBy, 'none');
  assert.deepEqual(result.implicated, [], 'the model considered the catalog and said nothing applies');
  assert.equal(result.namerFailure, undefined);
});

test('duplicate namings collapse rather than dispatching a role twice', async () => {
  const stub = namer([
    { domain: 'marketing-claims', why: 'first reason' },
    { domain: 'marketing-claims', why: 'second reason' },
  ]);
  const result = await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: stub.fn });
  assert.equal(result.implicated.length, 1);
});

test('the namer is shown the full catalog, never a narrowed one', async () => {
  const stub = namer([{ domain: 'marketing-claims', why: 'a raffle is a regulated promotion' }]);
  await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: stub.fn });
  assert.deepEqual(stub.catalogs, [CATALOG], 'the measured figures were taken on the full catalog');
});

test('the same outcome does not pay for a consultation twice', async () => {
  const stub = namer([{ domain: 'marketing-claims', why: 'a raffle is a regulated promotion' }]);
  const cache = memoryCache();
  const first = await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: stub.fn, cache });
  const second = await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: stub.fn, cache });
  assert.equal(first.inferredBy, 'namer');
  assert.equal(second.inferredBy, 'cache');
  assert.deepEqual(stub.calls, [SILENT], 'the second call must not reach the namer');
  assert.deepEqual(second.implicated, first.implicated);
});

test('a cached nothing is still nothing, and still does not re-consult', async () => {
  const stub = namer([]);
  const cache = memoryCache();
  await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: stub.fn, cache });
  const again = await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: stub.fn, cache });
  assert.equal(again.inferredBy, 'none');
  assert.deepEqual(stub.calls, [SILENT]);
});

test('the limit applies to named implications exactly as it does to keyword ones', async () => {
  const stub = namer([
    { domain: 'marketing-claims', why: 'a raffle is a regulated promotion' },
    { domain: 'privacy', why: 'entrant details are personal data' },
  ]);
  const result = await mapImplicationsNamed({ catalog: CATALOG, outcome: SILENT, namer: stub.fn, limit: 1 });
  assert.equal(result.implicated.length, 1);
});
