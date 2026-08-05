#!/usr/bin/env node
/**
 * scripts/measure-keyword-idf.mjs — per-keyword document frequency and IDF over
 * the pooled unsealed corpora.
 *
 * THIS SCRIPT MEASURES. It does not generate a table the kernel imports, and
 * that is the result of the bead rather than an omission.
 *
 * IDF-weighted keyword scoring was implemented behind
 * dispatcher.ts's existing seam and measured it on all four corpora. Every
 * after-interval sat inside its own before-interval, on every corpus, and under
 * the project's own asymmetric loss framing the pooled point estimate moved the
 * wrong way (E[L] at 4:1, 1.704 -> 1.728). The weighting was reverted: a change
 * that adds a generated table, a scoring multiply and a regeneration step, and
 * demonstrates no effect, is complexity nobody measured a reason for.
 *
 * The measurement is kept because it is the useful half. It names which
 * keywords fire disproportionately often ("before" 14/126, "contract" 5/126)
 * and is what any future weighting scheme would have to start from.
 *
 * ONE THING THE REVERTED IMPLEMENTATION GOT WRONG, recorded so it is not
 * repeated: the weights were document frequency over outcome TEXT and consulted
 * no labels, but the normalization pivot (REFERENCE_FIRES below) was chosen by
 * observing that a pivot of 1 collapsed recall on the LABELED corpora. That is
 * one hyperparameter selected against ground truth, including the only unspent
 * corpus, while the code claimed to be fitted to no label at all. Narrower than
 * tuning a dictionary, the same shape, and the claim was the defect as much as
 * the choice was. Any future pivot must come from the frequency distribution
 * alone, or be declared in-sample and spend the corpus it was chosen on.
 *
 *   node scripts/measure-keyword-idf.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DOMAINS } from '../src/kernel/implication/domains.ts';
import { matchingKeywords } from '../src/kernel/routing/dispatcher.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tests/kernel/implication/fixtures');

const CORPORA = [
  'labeled-outcomes.json',
  'held-out-outcomes.json',
  'fresh-outcomes.json',
  'unspent-outcomes.json',
];

const FULL_MATCH = 7;

function load(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

const pooled = CORPORA.flatMap((name) => load(name).outcomes);
const N = pooled.length;
// A keyword that fires on up to REFERENCE_FIRES outcomes is treated as
// ordinarily rare and keeps full weight; only keywords firing MORE than that
// are discounted. Normalizing against ln(N/1) (weight=1 only for a keyword
// firing exactly once) was tried first and discounted the majority of the
// live catalog — including every ordinary single-word full-adjacency match
// firing 2-3 times, which pushed scores that used to clear MIN_SIGNAL=10
// below it and collapsed recall on every corpus (measured, not asserted: see
// the bead's NOTES). REFERENCE_FIRES=3 leaves keywords in the catalog's
// typical frequency range untouched and reserves the discount for the
// keywords the corpus actually shows firing disproportionately often
// ("before" 14/126, "contract" 5/126, historically "customers" 17/126).
const REFERENCE_FIRES = 3;
const idfReference = Math.log(N / REFERENCE_FIRES);

const seen = new Map(); // keyword (lowercased) -> { fires, idf, weight }
for (const domain of DOMAINS) {
  for (const keyword of domain.keywords) {
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue; // same keyword text, first domain to declare it wins
    let fires = 0;
    for (const o of pooled) {
      if (matchingKeywords([keyword], o.outcome).some((m) => m.score >= FULL_MATCH)) fires += 1;
    }
    if (fires === 0) continue; // never fired: unmeasured, unweightable, left at the default (1.0)
    const idf = Math.log(N / fires);
    // Weight 1.0 (unchanged) for a keyword firing at or below REFERENCE_FIRES
    // times; beyond that, weight falls off monotonically with document
    // frequency. Floor at 0.2 so no keyword's contribution is fully erased by
    // frequency alone.
    const weight = Math.max(0.2, Math.min(1, idf / idfReference));
    seen.set(key, { fires, idf, weight });
  }
}

const entries = [...seen.entries()].sort((a, b) => b[1].fires - a[1].fires || a[0].localeCompare(b[0]));

// Printed, not written. A table nothing imports is a measurement; a table the
// kernel imports is a behaviour change, and construct-2jb.5 measured that
// change and found no effect.
console.log(`\nPer-keyword document frequency over ${N} pooled outcomes (unsealed corpora only).`);
console.log(`Keywords that never fired are omitted: no evidence exists to weight them.\n`);
console.log('  keyword                  fires     idf   weight-if-weighted');
for (const [key, v] of entries) {
  console.log(
    `  ${key.padEnd(24)} ${String(v.fires).padStart(5)}   ${v.idf.toFixed(3)}   ${v.weight.toFixed(4)}`,
  );
}
console.log(
  `\n${entries.length} keywords fired at least once, of ` +
    `${DOMAINS.reduce((a, d) => a + d.keywords.length, 0)} in the catalog.`,
);
console.log(
  'The weight column is what an IDF scheme WOULD apply, normalized against a pivot of ' +
    `${REFERENCE_FIRES}. It is reported for anyone designing the next scheme, and is not ` +
    'applied by\nthe kernel — see this file\'s header for why, and for what was wrong with ' +
    'how that pivot was chosen.',
);
