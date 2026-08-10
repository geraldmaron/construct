/**
 * tests/kernel/routing/dispatcher.test.ts — the behavior lock for the route-scoring
 * harvest. fixtures/dispatcher-golden.json is v2's own output, captured by
 * scripts/capture-legacy-dispatcher-golden.mjs; a diff here is a real scoring
 * change and needs justifying in the commit.
 *
 * One golden case diverges from v2 deliberately, and the lock was what surfaced
 * it. v2 withheld the adjacency bonus from a keyword whose parts are separated
 * in the text only by a stopword the keyword itself dropped — so "write a prd"
 * scored as non-adjacent inside "please write a prd for this", where the phrase
 * appears verbatim. Any keyword carrying an internal stopword therefore sat
 * under the signal floor permanently, and the shipped catalog had two such
 * keywords firing on nothing. Adjacency is now judged against the stopword-
 * filtered text as well as the raw text; a keyword whose parts are genuinely
 * far apart still has the bonus withheld, and that case is locked below.
 *
 * Entitlement filtering is tested separately from the corpus: v2 could only
 * derive entitlements by loading a registry off disk, so there is nothing to
 * dual-run against — the port takes them as an argument, and these tests assert
 * the argument's semantics directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suggestRoutes } from '../../../src/kernel/routing/dispatcher.ts';
import type { Route, SuggestResult } from '../../../src/kernel/routing/dispatcher.ts';

interface GoldenCase {
  readonly name: string;
  readonly intent: string;
  readonly routes: Route[];
  readonly limit: number;
  readonly result: SuggestResult;
}

const GOLDEN: GoldenCase[] = JSON.parse(
  readFileSync(new URL('./fixtures/dispatcher-golden.json', import.meta.url), 'utf8'),
);

test('golden corpus is non-trivial', () => {
  assert.ok(GOLDEN.length >= 14, `expected a real corpus, got ${GOLDEN.length} cases`);
});

for (const c of GOLDEN) {
  test(`scoring matches v2 — ${c.name}`, () => {
    const actual = suggestRoutes({ intent: c.intent, routes: c.routes, limit: c.limit });
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), c.result);
  });
}

test('omitting entitlements marks every suggestion entitled', () => {
  const { suggestions } = suggestRoutes({
    intent: 'rotate the secrets',
    routes: [{ path: 'skills/a.md', keywords: ['secret'] }],
  });
  assert.deepEqual(
    suggestions.map((s) => [s.path, s.entitled]),
    [['skills/a.md', true]],
  );
});

test('entitlements mark, but never filter — an unentitled route still surfaces', () => {
  const routes: Route[] = [
    { path: 'skills/a.md', keywords: ['secret'] },
    { path: 'skills/b.md', keywords: ['secret'] },
  ];
  const { suggestions } = suggestRoutes({
    intent: 'secret',
    routes,
    entitlements: ['skills/a.md'],
  });
  assert.deepEqual(
    suggestions.map((s) => [s.path, s.entitled]),
    [
      ['skills/a.md', true],
      ['skills/b.md', false],
    ],
    'the caller decides what an unentitled suggestion means; the kernel only reports it',
  );
});

test('an empty entitlement list entitles nothing (distinct from omitting it)', () => {
  const { suggestions } = suggestRoutes({
    intent: 'secret',
    routes: [{ path: 'skills/a.md', keywords: ['secret'] }],
    entitlements: [],
  });
  assert.equal(suggestions[0]!.entitled, false);
});

test('no filesystem, no ambient root — an empty route list is simply empty', () => {
  assert.deepEqual(suggestRoutes({ intent: 'anything', routes: [] }), {
    intent: 'anything',
    suggestions: [],
  });
});

test('scoring is deterministic across repeated runs', () => {
  for (const c of GOLDEN) {
    const args = { intent: c.intent, routes: c.routes, limit: c.limit };
    assert.deepEqual(suggestRoutes(args), suggestRoutes(args), c.name);
  }
});

test('the same routes score identically regardless of call order — no cross-call cache', () => {
  const a: Route[] = [{ path: 'skills/a.md', keywords: ['secret'] }];
  const b: Route[] = [{ path: 'skills/b.md', keywords: ['kubernetes'] }];
  const first = suggestRoutes({ intent: 'secret', routes: a });
  suggestRoutes({ intent: 'kubernetes', routes: b });
  assert.deepEqual(suggestRoutes({ intent: 'secret', routes: a }), first);
});

/**
 * Number folding. The prefix rule runs one way — a keyword stem
 * reaches its own inflected forms — so a keyword written PLURAL could never
 * match a singular token. "students" missed "student records" while "student"
 * would have matched both, which made a catalog author's arbitrary choice of
 * number decide whether a domain fired at all. The implication catalog had been
 * paying for it by hand, listing "contractor" and "contractors", "employee" and
 * "employees", "refund" and "refunds".
 */
test('a plural keyword matches a singular token, and the reverse still works', () => {
  const routes: Route[] = [{ path: 'p', keywords: ['students'] }];
  assert.equal(suggestRoutes({ intent: 'a letter about student records', routes }).suggestions.length, 1);
  assert.equal(suggestRoutes({ intent: 'enrolling students', routes }).suggestions.length, 1);
});

test('irregular and short words survive folding intact', () => {
  // "access" must not be mauled into "acces" by a rule meant for plurals, and a
  // three-letter word has nothing to gain and a syllable to lose.
  const routes: Route[] = [{ path: 'p', keywords: ['access'] }];
  assert.equal(suggestRoutes({ intent: 'grant access to the store', routes }).suggestions.length, 1);
  assert.equal(suggestRoutes({ intent: 'the gas bill', routes: [{ path: 'q', keywords: ['gas'] }] }).suggestions.length, 1);
});

test('folding does not reopen the substring false-positive class', () => {
  // The rule this replaced let "rag" reach "storage" and "drag". Folding is
  // exact-only after singularizing, so a short fragment still reaches nothing.
  const routes: Route[] = [{ path: 'p', keywords: ['rag'] }];
  assert.deepEqual(suggestRoutes({ intent: 'increase the storage average', routes }).suggestions, []);
});
