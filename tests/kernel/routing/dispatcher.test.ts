/**
 * tests/kernel/routing/dispatcher.test.ts — the behavior lock for the route-scoring
 * harvest. fixtures/dispatcher-golden.json is v2's own output, captured by
 * scripts/capture-legacy-dispatcher-golden.mjs; a diff here is a real scoring
 * change and needs justifying in the commit.
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
