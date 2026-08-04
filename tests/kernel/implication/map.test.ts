/**
 * tests/kernel/implication/map.test.ts — the measured gate on the implication
 * map.
 *
 * STRATEGY risk 1: "The implication map underdelivers. Then the whole vision is
 * a routing demo. Mitigation: it is Phase 2 and measured — a labeled outcome set
 * with a pre-agreed miss-rate target, not assumed." This file is that
 * mitigation. The targets below are the pre-agreed numbers; moving one is a
 * decision that shows up in the diff, which is the point.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapImplications, implicatedDomains } from '../../../src/kernel/implication/map.ts';
import { DOMAINS } from '../../../src/kernel/implication/domains.ts';

/**
 * Pre-agreed targets.
 *
 * MISS_RATE is the headline number: of every domain a human said an outcome
 * genuinely implicates, what fraction did the map fail to surface? A miss is the
 * expensive failure — it is the ambush the whole product promises to prevent.
 *
 * OVER_RATE is tracked as well, because a map that fires every domain on every
 * outcome would score a perfect miss rate and be useless. It is deliberately
 * looser: surfacing a domain that turns out not to apply costs a paragraph in a
 * work log, while missing one costs the user a surprise they were promised they
 * would not get.
 */
const MISS_RATE_TARGET = 0.15;
const OVER_RATE_TARGET = 0.6;

interface Labeled {
  readonly id: string;
  readonly category: string;
  readonly outcome: string;
  readonly expect: string[];
}

function load(name: string): { outcomes: Labeled[] } {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as {
    outcomes: Labeled[];
  };
}

const fixture = load('labeled-outcomes.json');

/**
 * The held-out set (construct-gsf). The corpus above was written alongside the
 * keyword catalog and scored a 0.000 miss rate that did not survive wording it
 * had not authored — the Phase 2 dogfood scored 0.556, and this set scored
 * 0.632 before any of the work that followed. A corpus and a catalog authored
 * by the same mind cannot measure each other, so the headline number is this
 * one and the corpus above is kept as a non-regression check.
 */
const heldOut = load('held-out-outcomes.json');

function quota(name: string, set: { outcomes: Labeled[] }): void {
  const total = set.outcomes.length;
  const nonEngineering = set.outcomes.filter((o) => o.category !== 'engineering').length;
  const legal = set.outcomes.filter((o) => o.category === 'legal').length;
  assert.ok(
    nonEngineering / total >= 0.4,
    `${name} is ${nonEngineering}/${total} non-engineering, below the 40% quota`,
  );
  assert.ok(
    legal / total >= 0.2,
    `${name} is ${legal}/${total} legal/compliance, below the 20% quota`,
  );
}

interface Score {
  readonly expected: number;
  readonly missed: number;
  readonly surfaced: number;
  readonly over: number;
  readonly missRate: number;
  readonly overRate: number;
  readonly misses: readonly string[];
}

function score(set: { outcomes: Labeled[] }): Score {
  let expected = 0;
  let missed = 0;
  let surfaced = 0;
  let over = 0;
  const misses: string[] = [];

  for (const item of set.outcomes) {
    const found = new Set(implicatedDomains({ outcome: item.outcome }));
    expected += item.expect.length;
    surfaced += found.size;
    for (const domain of item.expect) {
      if (!found.has(domain)) {
        missed += 1;
        misses.push(`${item.id} missed "${domain}" — ${item.outcome}`);
      }
    }
    for (const domain of found) {
      if (!item.expect.includes(domain)) over += 1;
    }
  }

  return {
    expected,
    missed,
    surfaced,
    over,
    missRate: missed / expected,
    overRate: surfaced === 0 ? 0 : over / surfaced,
    misses,
  };
}

/** Printed so a regression shows what moved, not just that something did. */
function report(name: string, s: Score, missTarget: number, overTarget: number): void {
  process.stdout.write(
    `\n  implication map [${name}]: miss ${s.missed}/${s.expected} = ${s.missRate.toFixed(3)} ` +
      `(target <= ${missTarget}), over ${s.over}/${s.surfaced} = ${s.overRate.toFixed(3)} ` +
      `(target <= ${overTarget})\n`,
  );
  for (const miss of s.misses) process.stdout.write(`    ${miss}\n`);
}

test('the labeled set keeps the Phase 2 distribution quota', () => {
  quota('labeled set', fixture);
});

test('the held-out set keeps the Phase 2 distribution quota', () => {
  quota('held-out set', heldOut);
});

test('the held-out set does not reuse the labeled set', () => {
  const authored = new Set(fixture.outcomes.map((o) => o.outcome.toLowerCase()));
  for (const item of heldOut.outcomes) {
    assert.ok(
      !authored.has(item.outcome.toLowerCase()),
      `${item.id} is copied from the labeled set — a held-out set that reuses it measures nothing`,
    );
  }
});

/**
 * The headline gate. Held to the same target as the authored corpus, because a
 * looser one for the harder set would be the measurement excusing itself.
 */
test('implication map meets its miss-rate target on wording it did not author', () => {
  const s = score(heldOut);
  report('held-out', s, MISS_RATE_TARGET, OVER_RATE_TARGET);
  assert.ok(s.missRate <= MISS_RATE_TARGET, `miss rate ${s.missRate.toFixed(3)} exceeds ${MISS_RATE_TARGET}`);
  assert.ok(s.overRate <= OVER_RATE_TARGET, `over rate ${s.overRate.toFixed(3)} exceeds ${OVER_RATE_TARGET}`);
});

test('every expected domain in the labeled set exists in the catalog', () => {
  const known = new Set(DOMAINS.map((d) => d.domain));
  for (const item of fixture.outcomes) {
    for (const domain of item.expect) {
      assert.ok(known.has(domain), `${item.id} expects unknown domain "${domain}"`);
    }
  }
});

test('implication map meets its pre-agreed miss-rate target', () => {
  const s = score(fixture);
  report('labeled', s, MISS_RATE_TARGET, OVER_RATE_TARGET);
  assert.ok(s.missRate <= MISS_RATE_TARGET, `miss rate ${s.missRate.toFixed(3)} exceeds ${MISS_RATE_TARGET}`);
  assert.ok(s.overRate <= OVER_RATE_TARGET, `over rate ${s.overRate.toFixed(3)} exceeds ${OVER_RATE_TARGET}`);
});

/**
 * The evidence-honesty regression (construct-gsf, secondary finding): "sign"
 * as a contracts keyword fired on "single sign-on" and "sign in", and the map
 * then CITED "sign" as the evidence for a contracts inference. A wrongly-cited
 * signal is worse than a lower score, because signals exist so the inference
 * can be argued with. Signing language always travels with the thing signed —
 * agreement, contract, terms — so removing the bare verb costs almost nothing.
 */
test('sign-on and sign-in language does not conscript the contracts domain', () => {
  for (const outcome of [
    'Replace the login system with single sign-on before the enterprise pilot',
    'Let people sign in with their work Google account',
  ]) {
    const domains = implicatedDomains({ outcome });
    assert.ok(!domains.includes('contracts'), `contracts inferred from ${JSON.stringify(outcome)}`);
    assert.ok(domains.includes('security'), `security expected in ${JSON.stringify(domains)} for ${JSON.stringify(outcome)}`);
  }
  // And the real thing still fires: signing an actual agreement is contracts.
  assert.ok(
    implicatedDomains({ outcome: 'Sign the reseller agreement with the Dutch distributor' }).includes('contracts'),
  );
});

test('the canonical STRATEGY outcome infers its roles without being told them', () => {
  // The example the strategy document itself leads with.
  const domains = implicatedDomains({
    outcome: 'I want to launch a paid beta to EU users next month',
  });
  for (const expected of ['privacy', 'commerce-tax', 'program-sequencing']) {
    assert.ok(domains.includes(expected), `expected ${expected} in ${JSON.stringify(domains)}`);
  }
});

test('an implication carries the evidence that produced it', () => {
  const map = mapImplications({ outcome: 'Launch a paid beta to EU users next month' });
  const privacy = map.implicated.find((i) => i.domain === 'privacy');
  assert.ok(privacy, 'privacy should be implicated');
  assert.ok(privacy.signals.length > 0, 'an inference must show its signals');

  // Evidence must not overstate itself: a partial match ("next week" firing on
  // "next month") may raise the score but is not a signal the map may cite.
  const sequencing = map.implicated.find((i) => i.domain === 'program-sequencing');
  assert.ok(sequencing);
  assert.ok(sequencing.signals.includes('next month'));
  assert.ok(
    !sequencing.signals.includes('next week'),
    'a partially-matched keyword must never be reported as evidence',
  );
  assert.ok(privacy.concern.length > 0);
  assert.ok(privacy.score >= 10);
});

test('an outcome that implicates nothing returns nothing, not a default', () => {
  assert.deepEqual(implicatedDomains({ outcome: 'xyzzy plugh frobnicate' }), []);
  assert.deepEqual(implicatedDomains({ outcome: '' }), []);
});

test('results are ordered strongest first', () => {
  const map = mapImplications({ outcome: 'Launch a paid beta to EU users next month' });
  const scores = map.implicated.map((i) => i.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('the signal floor is what suppresses incidental matches', () => {
  // "audit" alone is a partial signal for compliance; the floor is why a single
  // incidental word does not conscript a domain and its role into the run.
  const loose = implicatedDomains({ outcome: 'Ship the release by Friday', minSignal: 1 });
  const strict = implicatedDomains({ outcome: 'Ship the release by Friday' });
  assert.ok(loose.length >= strict.length);
});

test('the catalog is caller-replaceable without forking the kernel', () => {
  const domains = implicatedDomains({
    outcome: 'renew the widget franchise',
    catalog: [
      {
        path: 'franchise',
        domain: 'franchise',
        concern: 'franchise disclosure obligations',
        keywords: ['franchise', 'renew'],
      },
    ],
  });
  assert.deepEqual(domains, ['franchise']);
});
