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

const fixture = JSON.parse(
  readFileSync(new URL('fixtures/labeled-outcomes.json', import.meta.url), 'utf8'),
) as { outcomes: Labeled[] };

test('the labeled set keeps the Phase 2 distribution quota', () => {
  const total = fixture.outcomes.length;
  const nonEngineering = fixture.outcomes.filter((o) => o.category !== 'engineering').length;
  const legal = fixture.outcomes.filter((o) => o.category === 'legal').length;
  assert.ok(
    nonEngineering / total >= 0.4,
    `labeled set is ${nonEngineering}/${total} non-engineering, below the 40% quota`,
  );
  assert.ok(
    legal / total >= 0.2,
    `labeled set is ${legal}/${total} legal/compliance, below the 20% quota`,
  );
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
  let expected = 0;
  let missed = 0;
  let surfaced = 0;
  let over = 0;
  const misses: string[] = [];

  for (const item of fixture.outcomes) {
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

  const missRate = missed / expected;
  const overRate = surfaced === 0 ? 0 : over / surfaced;

  // Printed so a regression shows what moved, not just that something did.
  process.stdout.write(
    `\n  implication map: miss ${missed}/${expected} = ${missRate.toFixed(3)} ` +
      `(target <= ${MISS_RATE_TARGET}), over ${over}/${surfaced} = ${overRate.toFixed(3)} ` +
      `(target <= ${OVER_RATE_TARGET})\n`,
  );
  for (const miss of misses) process.stdout.write(`    ${miss}\n`);

  assert.ok(missRate <= MISS_RATE_TARGET, `miss rate ${missRate.toFixed(3)} exceeds ${MISS_RATE_TARGET}`);
  assert.ok(overRate <= OVER_RATE_TARGET, `over rate ${overRate.toFixed(3)} exceeds ${OVER_RATE_TARGET}`);
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
