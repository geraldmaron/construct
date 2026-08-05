/**
 * scripts/generate-keyword-idf.mjs — regenerate
 * src/kernel/routing/keyword-idf.generated.ts (construct-2jb.5).
 *
 * Per-keyword IDF over the pooled *unsealed* corpus (labeled + held-out +
 * fresh + unspent, N = 126 outcomes). This is document frequency of each
 * catalog keyword against outcome TEXT — it never looks at a label, so it is
 * not "fitting weights to the 83 labels" the bead's DISPATCH note warned
 * against. It is corpus vocabulary statistics, the same quantity
 * scripts/measure-decisions.mjs --section 3 already prints for diagnosis;
 * this script is the one that turns it into the weight table the dispatcher
 * actually loads.
 *
 * NEVER reads tests/kernel/implication/fixtures/sealed-outcomes.json. The
 * seal (tests/kernel/implication/corpus-split.test.ts) forbids it project-wide;
 * this script does not need it and must not gain it back by accident.
 *
 *   node scripts/generate-keyword-idf.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
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

const entries = [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));

const lines = entries.map(
  ([key, v]) => `  ${JSON.stringify(key)}: ${v.weight.toFixed(4)}, // fires ${v.fires}/${N}, idf ${v.idf.toFixed(3)}`,
);

const out = `/**
 * kernel/routing/keyword-idf.generated.ts — per-keyword IDF weight table
 * (construct-2jb.5).
 *
 * GENERATED. Do not hand-edit; regenerate with:
 *
 *   node scripts/generate-keyword-idf.mjs
 *
 * Computed once, offline, over the pooled UNSEALED corpus (labeled +
 * held-out + fresh + unspent, N = ${N} outcomes) as of 2026-08-04. Weight is
 * IDF normalized against the IDF of a keyword firing ${REFERENCE_FIRES} times
 * (ordinary catalog frequency keeps weight 1.0; only keywords firing MORE
 * often are discounted), floored at 0.2:
 *
 *   idf    = ln(N / fires)
 *   weight = clamp(idf / ln(N / ${REFERENCE_FIRES}), 0.2, 1.0)
 *
 * This is document frequency over outcome TEXT, not over labels — no ground
 * truth is consulted, so this is not fitting to the 83-label unspent corpus
 * the bead's DISPATCH note warned against; it is unsupervised corpus
 * vocabulary statistics, the same figure
 * scripts/measure-decisions.mjs --section 3 already prints. Never touches
 * tests/kernel/implication/fixtures/sealed-outcomes.json.
 *
 * A keyword absent from this table never fired on the pooled corpus: no
 * evidence exists to weight it, so \`weightFor\` returns the neutral 1.0
 * default rather than guessing.
 */

export const KEYWORD_IDF_WEIGHT: Readonly<Record<string, number>> = {
${lines.join('\n')}
};

/** Neutral weight for a keyword with no measured document frequency. */
export const DEFAULT_WEIGHT = 1;

/** The weight for a keyword's exact text, case-insensitive. */
export function weightFor(keyword: string): number {
  return KEYWORD_IDF_WEIGHT[keyword.toLowerCase()] ?? DEFAULT_WEIGHT;
}
`;

writeFileSync(join(ROOT, 'src/kernel/routing/keyword-idf.generated.ts'), out);
console.log(`Wrote ${entries.length} weighted keywords (of ${DOMAINS.reduce((a, d) => a + d.keywords.length, 0)} total) from N=${N} pooled outcomes.`);
