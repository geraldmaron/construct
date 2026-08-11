/**
 * scripts/measure-decisions.mjs — regenerate every number quoted in
 * RESEARCH-DECISIONS.md.
 *
 * The document is prose, and prose is where unchecked numbers go to become
 * folklore. This script is the document's gate: a figure that appears there and
 * cannot be printed here is a figure nobody measured. Same discipline as
 * probe-*-conformance.mjs, applied to statistics instead of to a host.
 *
 * Reads the real corpora and the real catalog. Writes nothing unless asked to:
 * §10's --namer-record persists that run's per-outcome answers, and nothing
 * else in the script writes at all.
 *
 *   node scripts/measure-decisions.mjs
 *   node scripts/measure-decisions.mjs --section 3
 *
 * Comparing two §10 arms is a PAIRED question — both score the same outcomes
 * against the same gold — so the arms are recorded per outcome and compared
 * with McNemar rather than by reading two aggregate rates off two runs. On
 * these corpora the intervals around a single rate are wide enough to hide
 * every difference worth acting on, while the discordant pairs are few enough
 * to count by hand:
 *
 *   ... --namer --section 10 --namer-arm shipped  --namer-record fixtures/namer-arms/shipped.json
 *   ... --namer --section 10 --namer-arm no-nots  --namer-record fixtures/namer-arms/no-nots.json \
 *                                                 --namer-compare fixtures/namer-arms/shipped.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  clopperPearson,
  clopperPearsonLowerBound,
  formatRate,
  mcnemarExact,
  requiredTrials,
  sequentialOperatingCharacteristics,
  sequentialPassBoundary,
  wilson,
} from '../src/kernel/metrics/intervals.ts';
import {
  krippendorffAlpha,
  masiDistance,
  nominalSetDistance,
} from '../src/kernel/metrics/krippendorff.ts';
import { DOMAINS } from '../src/kernel/implication/domains.ts';
import { implicatedDomains } from '../src/kernel/implication/map.ts';
import { matchingKeywords } from '../src/kernel/routing/dispatcher.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tests/kernel/implication/fixtures');
/**
 * The corpora, in the order they were authored. `unspent-outcomes.json` is the
 * measured half of the expanded corpus; its sealed half is deliberately
 * absent from this list and from every other reader in the repo, which is what
 * makes it still worth something (tests/kernel/implication/corpus-split.test.ts
 * enforces that absence).
 */
const CORPORA = [
  'labeled-outcomes.json',
  'held-out-outcomes.json',
  'fresh-outcomes.json',
  'unspent-outcomes.json',
];

/** Only whole-keyword matches count as a firing, matching map.ts's evidence bar. */
const FULL_MATCH = 7;

const only = process.argv.includes('--section')
  ? Number(process.argv[process.argv.indexOf('--section') + 1])
  : null;

function load(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

const corpora = CORPORA.map((name) => ({ name, ...load(name) }));
const pooled = corpora.flatMap((c) => c.outcomes);

function heading(n, title) {
  if (only !== null && only !== n) return false;
  console.log(`\n${'='.repeat(72)}\n§${n}. ${title}\n${'='.repeat(72)}`);
  return true;
}

/** Score a corpus with the live map at a given signal floor. */
function score(outcomes, minSignal) {
  let expected = 0;
  let missed = 0;
  let surfaced = 0;
  let over = 0;
  let silent = 0;
  for (const o of outcomes) {
    const got = implicatedDomains({ outcome: o.outcome, ...(minSignal === undefined ? {} : { minSignal }) });
    if (got.length === 0) silent += 1;
    expected += o.expect.length;
    missed += o.expect.filter((e) => !got.includes(e)).length;
    surfaced += got.length;
    over += got.filter((g) => !o.expect.includes(g)).length;
  }
  return { expected, missed, surfaced, over, silent, outcomes: outcomes.length };
}

// ---------------------------------------------------------------------------
if (heading(1, 'The measurement floor')) {
  console.log('\nCorpus inventory (measured, not quoted):\n');
  console.log('  corpus                       outcomes   labels   labels/outcome');
  for (const c of corpora) {
    const labels = c.outcomes.reduce((a, o) => a + o.expect.length, 0);
    console.log(
      `  ${c.name.padEnd(28)} ${String(c.outcomes.length).padStart(8)} ${String(labels).padStart(8)}` +
        `   ${(labels / c.outcomes.length).toFixed(2)}`,
    );
  }
  const totalLabels = pooled.reduce((a, o) => a + o.expect.length, 0);
  console.log(`  ${'TOTAL'.padEnd(28)} ${String(pooled.length).padStart(8)} ${String(totalLabels).padStart(8)}`);

  console.log('\nEvery rate the project quotes, with its Wilson 95% interval:\n');
  for (const c of corpora) {
    const s = score(c.outcomes);
    console.log(`  ${c.name}`);
    console.log(`    miss  ${formatRate(s.missed, s.expected)}`);
    console.log(`    over  ${formatRate(s.over, s.surfaced)}`);
  }
  const p = score(pooled);
  console.log('  POOLED');
  console.log(`    miss  ${formatRate(p.missed, p.expected)}`);
  console.log(`    over  ${formatRate(p.over, p.surfaced)}`);

  console.log('\nThe claim that motivated this pass:\n');
  const fresh = wilson(3, 10);
  console.log(`  fresh corpus with escalation: 3 misses of 10 labels = 0.300`);
  console.log(`  Wilson 95% CI = [${fresh.low.toFixed(3)}, ${fresh.high.toFixed(3)}]`);
  console.log(`  contains the 0.15 target? ${fresh.low < 0.15 && fresh.high > 0.15 ? 'YES' : 'no'}`);
  console.log(`  0.400 -> 0.300 is one discordant pair; McNemar exact p = ${mcnemarExact(1, 0).toFixed(3)}`);

  console.log('\nHow many labels would settle it (one-sample, two-sided 5%, 80% power):\n');
  console.log('  distinguish            labels needed   have    shortfall');
  for (const [b, t] of [[0.30, 0.15], [0.25, 0.15], [0.20, 0.15], [0.175, 0.15]]) {
    const n = requiredTrials({ baseline: b, target: t });
    console.log(
      `  ${b.toFixed(3)} from ${t.toFixed(2)}${' '.repeat(9)}${String(n).padStart(8)} ${String(totalLabels).padStart(7)}` +
        `   ${n > totalLabels ? `${n - totalLabels} short` : 'sufficient'}`,
    );
  }
  const est = requiredTrials({ baseline: 0.15, target: 0.20, power: 0.8 });
  console.log(`\n  To estimate a rate near 0.15 to +/- 0.05 rather than test it: ~${est} labels.`);
}

// ---------------------------------------------------------------------------
if (heading(2, 'The annotation ceiling')) {
  console.log('\nAuthorship of each corpus, from its own recorded note:\n');
  for (const c of corpora) {
    console.log(`  ${c.name}: ${c.note ? `${c.note.slice(0, 110)}...` : '(no note)'}`);
  }
  console.log('\n  Independent coders per corpus: 1 for the first three, 2 for unspent-outcomes.json.');
  console.log('  For the first three, Krippendorff alpha is UNMEASURABLE at one coder.');

  // The expanded corpus is the first one labeled twice at authoring time,
  // so its agreement is a property of the corpus rather than a later study.
  // Only the measured half is read here. The sealed half carries the same two
  // coders' raw sets, but nothing in the repo may open it — its own note records
  // the whole-corpus agreement figure as a one-time fact instead.
  const twice = corpora.find((c) => c.name === 'unspent-outcomes.json');
  const observations = [];
  for (const o of twice.outcomes) {
    observations.push({ unit: o.id, coder: 'coder1', value: new Set(o.provenance.coder1) });
    observations.push({ unit: o.id, coder: 'coder2', value: new Set(o.provenance.coder2) });
  }
  const masi = krippendorffAlpha(observations, masiDistance);
  const nominal = krippendorffAlpha(observations, nominalSetDistance);
  const exact = twice.outcomes.filter(
    (o) => o.provenance.resolution === 'both coders agreed',
  ).length;
  console.log(
    `\n  expanded corpus, measured half (${observations.length / 2} outcomes, 2 coders):`,
  );
  console.log(`    exact set agreement: ${exact}/${observations.length / 2}`);
  console.log(`    Krippendorff alpha (MASI):    ${masi.alpha.toFixed(4)}  (Do ${masi.Do.toFixed(4)}, De ${masi.De.toFixed(4)})`);
  console.log(`    Krippendorff alpha (nominal): ${nominal.alpha.toFixed(4)}`);
  console.log('    CAVEAT: both coders, both adjudicator and all eight authors are models of');
  console.log('    one family. Observed agreement is an UPPER BOUND on independent agreement');
  console.log('    (correlated error — the same-family caveat, unchanged).');
  console.log('\n  Implied Bayes error floor: still unknown at model coders alone, so 0.15');
  console.log('  remains unvalidated as reachable — but a stable ground truth is now evidence');
  console.log('  that residual miss is the MAP\'s, not the labels\'.');
}

// ---------------------------------------------------------------------------
if (heading(3, 'Keyword scoring as an unweighted linear model')) {
  const N = pooled.length;
  const rows = [];
  for (const domain of DOMAINS) {
    for (const keyword of domain.keywords) {
      let fires = 0;
      let trueFires = 0;
      for (const o of pooled) {
        const hit = matchingKeywords([keyword], o.outcome).some((m) => m.score >= FULL_MATCH);
        if (!hit) continue;
        fires += 1;
        if (o.expect.includes(domain.domain)) trueFires += 1;
      }
      rows.push({
        domain: domain.domain,
        keyword,
        fires,
        trueFires,
        precision: fires === 0 ? null : trueFires / fires,
        idf: fires === 0 ? null : Math.log(N / fires),
      });
    }
  }

  const live = rows.filter((r) => r.fires > 0);
  console.log(`\n  catalog keywords: ${rows.length}`);
  console.log(`  fire at least once on the ${N}-outcome pooled corpus: ${live.length}`);
  console.log(`  never fire (unmeasurable, and unweightable): ${rows.length - live.length}`);

  console.log('\nKeywords that fire most and discriminate least (IDF is lowest here):\n');
  console.log('  domain              keyword                fires  correct  precision    IDF');
  for (const r of [...live].sort((a, b) => b.fires - a.fires).slice(0, 12)) {
    console.log(
      `  ${r.domain.padEnd(19)} ${r.keyword.padEnd(22)} ${String(r.fires).padStart(5)} ` +
        `${String(r.trueFires).padStart(8)}   ${r.precision.toFixed(3)}   ${r.idf.toFixed(3)}`,
    );
  }

  console.log('\nKeywords whose firings are mostly wrong (precision < 0.5, 2+ firings):\n');
  const bad = live.filter((r) => r.fires >= 2 && r.precision < 0.5).sort((a, b) => a.precision - b.precision);
  if (bad.length === 0) console.log('  (none)');
  for (const r of bad) {
    console.log(
      `  ${r.domain.padEnd(19)} ${r.keyword.padEnd(22)} ${String(r.fires).padStart(5)} ` +
        `${String(r.trueFires).padStart(8)}   ${r.precision.toFixed(3)}   ${r.idf.toFixed(3)}`,
    );
  }

  console.log('\nThe two keywords already removed by hand, re-measured where they would have fired:\n');
  for (const kw of ['users', 'customers']) {
    let fires = 0;
    let scoped = 0;
    for (const o of pooled) {
      if (!matchingKeywords([kw], o.outcome).some((m) => m.score >= FULL_MATCH)) continue;
      fires += 1;
      if (o.expect.includes('product-scoping')) scoped += 1;
    }
    console.log(
      `  "${kw}": fires on ${fires}/${N} outcomes, of which ${scoped} genuinely implicate ` +
        `product-scoping (precision ${fires ? (scoped / fires).toFixed(3) : 'n/a'}, IDF ${fires ? Math.log(N / fires).toFixed(3) : 'n/a'})`,
    );
  }
}

// ---------------------------------------------------------------------------
if (heading(4, 'Threshold selection as expected-loss minimization')) {
  console.log('\nSignal-floor sweep over the pooled corpus (MIN_SIGNAL is 10 today):\n');
  console.log('  floor    miss     over   silent   E[L] @ 4:1   E[L] @ 10:1');
  const sweep = [];
  for (const floor of [0, 3, 5, 7, 8, 9, 10, 11, 13, 14, 17, 20, 24, 27, 30]) {
    const s = score(pooled, floor);
    const miss = s.missed / s.expected;
    const over = s.surfaced === 0 ? 0 : s.over / s.surfaced;
    sweep.push({ floor, miss, over, silent: s.silent, l4: 4 * miss + over, l10: 10 * miss + over });
  }
  const best4 = Math.min(...sweep.map((r) => r.l4));
  const best10 = Math.min(...sweep.map((r) => r.l10));
  for (const r of sweep) {
    console.log(
      `  ${String(r.floor).padStart(5)}  ${r.miss.toFixed(3)}  ${r.over.toFixed(3)}   ${String(r.silent).padStart(6)}` +
        `      ${r.l4.toFixed(3)}${r.l4 === best4 ? ' *' : '  '}        ${r.l10.toFixed(3)}${r.l10 === best10 ? ' *' : ''}`,
    );
  }
  console.log('\n  * = minimum expected loss at that cost ratio. The current targets');
  console.log('    (miss 0.15, over 0.6) imply a 4:1 asymmetry that was never derived.');

  // Why the sweep is a step and not a curve: what signal scores actually occur.
  const tally = new Map();
  for (const o of pooled) {
    for (const domain of DOMAINS) {
      const evidence = matchingKeywords(domain.keywords, o.outcome).filter((m) => m.score >= FULL_MATCH);
      if (evidence.length === 0) continue;
      let s = 0;
      for (const kw of domain.keywords) {
        const m = matchingKeywords([kw], o.outcome)[0];
        if (m) s += m.score;
      }
      tally.set(s, (tally.get(s) ?? 0) + 1);
    }
  }
  const scores = [...tally.keys()].sort((a, b) => a - b);
  console.log('\n  Signal scores that actually occur, among domains with whole-keyword evidence:\n');
  for (const s of scores) console.log(`    score ${String(s).padStart(3)}: ${tally.get(s)} occurrence(s)`);
  console.log(`\n    lowest occurring score: ${scores[0]}`);
  console.log(`    MIN_SIGNAL is 10. Any floor in [0, ${scores[0]}] admits exactly the same set.`);
  console.log('    The floor is therefore inert: the whole-keyword evidence filter added in');
  console.log('    the generalization gate is what actually gates admission, and MIN_SIGNAL sits one');
  console.log('    step below a cliff rather than at a tuned optimum.');

  // -------------------------------------------------------------------------
  // The precision-recall curve the sweep above implies. Precision and recall
  // are just the miss/over rates read the other way round (precision = 1 -
  // over, recall = 1 - miss) — printed explicitly because the acceptance
  // criteria ask for a PR curve, not because it is new information.
  console.log('\nThe same sweep, read as a precision-recall curve:\n');
  console.log('  floor    recall (1-miss)   precision (1-over)');
  for (const r of sweep) {
    console.log(
      `  ${String(r.floor).padStart(5)}    ${(1 - r.miss).toFixed(3).padStart(9)}         ${(1 - r.over).toFixed(3).padStart(9)}`,
    );
  }
  const flatLow = sweep.filter((r) => r.miss === sweep[0].miss && r.over === sweep[0].over);
  const flatHigh = sweep.filter(
    (r) => r.floor >= 8 && r.miss === score(pooled, 8).missed / score(pooled, 8).expected,
  );
  console.log(
    `\n  Flat region: floors [${flatLow[0].floor}, ${flatLow[flatLow.length - 1].floor}] are one plateau` +
      ` (identical precision/recall), floors [${flatHigh[0].floor}, ${flatHigh[flatHigh.length - 1].floor}]` +
      ' are a second, adjacent plateau one point better on precision at the same recall.',
  );
  console.log(
    `  Combined flat region width, 0 through the last point before the cliff at 11: ` +
      `${flatHigh[flatHigh.length - 1].floor - flatLow[0].floor} floor-units (0-10), all strictly` +
      ' dominating or tying every point in it — there is no curve to trade along inside the plateau.',
  );

  // -------------------------------------------------------------------------
  // Sensitivity analysis. c_miss/c_over is Gerald's judgment call, never
  // derived here — this reports the implied optimal floor across a RANGE of
  // plausible ratios and states plainly which ratios would change the
  // verdict on MIN_SIGNAL = 10, rather than asserting a single ratio.
  console.log('\nSensitivity: implied optimal floor across a range of c_miss/c_over ratios.');
  console.log('  The ratio itself is NOT derived here — it is a judgment call left to Gerald.');
  console.log('  This table reports what floor that judgment would imply, for each candidate ratio:\n');
  console.log('  c_miss/c_over ratio     best floor(s)     E[L]');
  const ratios = [0.1, 0.2, 0.264, 0.3, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30];
  for (const ratio of ratios) {
    let bestL = Infinity;
    let bestFloors = [];
    for (const r of sweep) {
      const l = ratio * r.miss + r.over;
      if (l < bestL - 1e-9) {
        bestL = l;
        bestFloors = [r.floor];
      } else if (Math.abs(l - bestL) < 1e-9) {
        bestFloors.push(r.floor);
      }
    }
    console.log(
      `  ${ratio.toFixed(3).padStart(6)}                  ${bestFloors.join(',').padEnd(15)}   ${bestL.toFixed(3)}`,
    );
  }
  console.log(
    '\n  CAVEAT on the low-ratio rows (<= 0.3): floor 30 "wins" there only because it surfaces',
  );
  console.log(
    '  just 7 routes on the whole pooled corpus (all 7 happen to be correct, over = 0/7 = 0.000',
  );
  console.log(
    '  exactly) — a tiny-n artifact, not a demonstrated precision advantage. It is printed rather',
  );
  console.log(
    '  than dropped, per this document\'s own rule, but should not be read as a real candidate.',
  );

  // The exact crossover ratio between floor 10 (the current value, tied with
  // 8-9 on the plateau) and floor 11 (the far side of the cliff), solved
  // algebraically from the live sweep rather than hardcoded.
  const f10 = sweep.find((r) => r.floor === 10);
  const f11 = sweep.find((r) => r.floor === 11);
  const crossover = (f11.over - f10.over) / (f10.miss - f11.miss);
  console.log(
    `\n  Crossover ratio (floor 10 vs floor 11): c_miss/c_over = ${crossover.toFixed(3)}.`,
  );
  console.log(
    '  Below that ratio (over-inclusion costed at MORE than roughly 3.8x a miss),',
  );
  console.log(
    '  floor 11 wins; at or above it, floor 10 (tied with 8-9) wins. The project\'s own',
  );
  console.log(
    '  stated framing (a miss is unrecoverable, an over is recoverable and priced) puts',
  );
  console.log(
    '  every plausible ratio on the miss-costs-more side, i.e. ratio >= 1, which is on the',
  );
  console.log(
    '  floor-10 side of that crossover by a wide margin. Only a ratio judgment that says an',
  );
  console.log(
    '  over-inclusion costs MORE than a miss would change the verdict — a position nobody',
  );
  console.log('  in this project has argued for.');
  console.log(
    '\n  VERDICT: KEEP MIN_SIGNAL = 10. It sits on the plateau that dominates every floor',
  );
  console.log(
    '  below the cliff at 11, for every ratio in the range this project has ever stated',
  );
  console.log('  (4:1 and 10:1 both land on floor 8-10). c_miss/c_over itself remains open,');
  console.log('  awaiting Gerald — nothing above should be read as having picked it.');
}

// ---------------------------------------------------------------------------
if (heading(5, 'Escalation as value of information')) {
  console.log('\n  COST is the escalation rate under today\'s rule (escalate iff the keyword');
  console.log('  pass is silent): the fraction of outcomes that trigger a namer call, per');
  console.log('  corpus, each with its own Wilson 95% interval — pooling would let a corpus');
  console.log('  at 0 silence hide one that is not.');
  console.log('\n  REACH is what the trigger hands the namer, not what the namer recovers:');
  console.log('  reaching a miss only means the outcome that missed it is now escalated. What');
  console.log('  a real namer NAMES CORRECTLY from there is unmeasured here (that is §5.6\'s');
  console.log('  oracle-floor / credulous-ceiling sweep, live-embedder only). Any per-miss count');
  console.log('  below is a REACH count, not a recovery count.');

  console.log('\n  Per-corpus escalation cost (silence rate) and reach (share of missed labels');
  console.log('  reachable by escalate-on-silence), each with Wilson 95% CI:\n');
  for (const c of corpora) {
    const cs = score(c.outcomes);
    const costCi = wilson(cs.silent, cs.outcomes);
    const reachable = c.outcomes
      .filter((o) => implicatedDomains({ outcome: o.outcome }).length === 0)
      .reduce((a, o) => a + o.expect.length, 0);
    const reachCi = wilson(reachable, cs.missed);
    console.log(`    ${c.name}`);
    console.log(
      `      cost (silent/outcomes):  ${(cs.silent / cs.outcomes || 0).toFixed(3)} ` +
        `(${cs.silent}/${cs.outcomes}, 95% CI [${costCi.low.toFixed(3)}, ${costCi.high.toFixed(3)}])`,
    );
    console.log(
      `      reach (of missed labels): ${cs.missed === 0 ? 'n/a (0 misses)' :
        `${(reachable / cs.missed).toFixed(3)} (${reachable}/${cs.missed}, 95% CI ` +
        `[${reachCi.low.toFixed(3)}, ${reachCi.high.toFixed(3)}])`}`,
    );
  }
  console.log('\n  The held-out corpus alone (0/24 silent) is the corpus least like unseen');
  console.log('  wording — it is one of the two spent, tuned-against corpora — so quoting its');
  console.log('  cost figure pooled or alone hides the unspent corpus\'s 0.458 silence rate');
  console.log('  behind two zeros. Read the table above per row, not as one number.');
}

// ---------------------------------------------------------------------------
// §5e requires a live local embedding model and is skipped without --embeddings:
// the rest of this script is deterministic and must stay runnable offline.
if (process.argv.includes('--embeddings') && heading(5.5, 'Embedding similarity as the escalation shortlist (live, local)')) {
  const { rankBySimilarity, domainText } = await import('../src/kernel/implication/similarity.ts');
  const EMBED_MODEL = 'nomic-embed-text';
  const embedRaw = async (text) => {
    const res = await fetch('http://127.0.0.1:11434/api/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status} — is ollama running with ${EMBED_MODEL} pulled?`);
    return (await res.json()).embedding;
  };
  // Cache domain vectors: they change on catalog edits, not per outcome.
  const cache = new Map();
  const embedder = async (text) => {
    if (!cache.has(text)) cache.set(text, await embedRaw(text));
    return cache.get(text);
  };
  for (const d of DOMAINS) await embedder(domainText(d));

  const positives = [];
  const negatives = [];
  const missRows = [];
  for (const o of pooled) {
    const got = implicatedDomains({ outcome: o.outcome });
    const ranked = await rankBySimilarity({ outcome: o.outcome, catalog: DOMAINS, embedder });
    for (const r of ranked) {
      (o.expect.includes(r.domain) ? positives : negatives).push(r.similarity);
      if (o.expect.includes(r.domain) && !got.includes(r.domain)) {
        missRows.push({ id: o.id, domain: r.domain, sim: r.similarity, rank: r.rank });
      }
    }
  }
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  console.log(`\n  model: ${EMBED_MODEL} (similarities are not comparable across embedders)`);
  console.log(`  pairs: ${positives.length} labeled, ${negatives.length} unlabeled`);
  console.log(`  AUC (P[random labeled pair outscores random unlabeled]): ${(wins / (positives.length * negatives.length)).toFixed(3)}`);
  console.log('\n  The labels the keyword pass misses, ranked by similarity among 10 domains:\n');
  let worst = 0;
  for (const r of missRows) {
    worst = Math.max(worst, r.rank);
    console.log(`    ${r.id.padEnd(4)} ${r.domain.padEnd(18)} sim ${r.sim.toFixed(3)}  rank ${r.rank}/10`);
  }
  console.log(`\n  smallest k covering every keyword-missed label: ${worst}`);
  console.log('  A shortlist is a candidate list for the namer, never an implication —');
  console.log('  AUC this size separates populations, not individual pairs.');
}

// ---------------------------------------------------------------------------
// §5.6 also requires the live local embedder, and is skipped without
// --embeddings for the same reason as §5.5.
if (process.argv.includes('--embeddings') && heading(5.6, 'Margin-triggered escalation: what a similarity margin WOULD have done')) {
  const { rankBySimilarity, domainText, shortlist } = await import('../src/kernel/implication/similarity.ts');
  const { SHORTLIST_K } = await import('../src/kernel/implication/escalate.ts');
  const EMBED_MODEL = 'nomic-embed-text';
  const embedRaw = async (text) => {
    const res = await fetch('http://127.0.0.1:11434/api/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status} — is ollama running with ${EMBED_MODEL} pulled?`);
    return (await res.json()).embedding;
  };
  const cache = new Map();
  const embedder = async (text) => {
    if (!cache.has(text)) cache.set(text, await embedRaw(text));
    return cache.get(text);
  };
  for (const d of DOMAINS) await embedder(domainText(d));

  console.log('\n  CAVEAT, attached to every number below (do not quote without it):');
  console.log('  UNFITTED. Every threshold in this sweep is evaluated on corpora that are');
  console.log('  already spent: single-author labels, and two of the three corpora were');
  console.log('  tuned against during the generalization measurement. Nothing here is derived or validated;');
  console.log('  it is what each threshold WOULD have done, on data that cannot vouch for');
  console.log('  it. Believing any row requires the expanded corpus.');

  console.log('\n  The margin statistic: for an outcome the keyword pass answered,');
  console.log('    margin = max similarity among IMPLICATED domains');
  console.log('           - max similarity among UNIMPLICATED domains');
  console.log('  Escalate when margin < t (or, when the pass is silent, always — today\'s');
  console.log('  rule is the t = -Infinity row). A silent outcome has no margin.');

  // Precompute, once per outcome: the keyword answer, the ranking, the margin,
  // and the SHORTLIST_K candidate list a margin-fired escalation would hand the
  // namer (excluding what keywords already implicated, per shortlist()).
  const evaluated = [];
  for (const c of corpora) {
    for (const o of c.outcomes) {
      const got = implicatedDomains({ outcome: o.outcome });
      const ranked = await rankBySimilarity({ outcome: o.outcome, catalog: DOMAINS, embedder });
      const impSims = ranked.filter((r) => got.includes(r.domain)).map((r) => r.similarity);
      const unimpSims = ranked.filter((r) => !got.includes(r.domain)).map((r) => r.similarity);
      const margin = got.length === 0 ? null : Math.max(...impSims) - Math.max(...unimpSims);
      const candidates = shortlist(ranked, got, SHORTLIST_K).map((r) => r.domain);
      evaluated.push({ corpus: c.name, expect: o.expect, got, margin, candidates });
    }
  }

  const margins = evaluated.filter((e) => e.margin !== null).map((e) => e.margin).sort((a, b) => a - b);
  console.log(`\n  Margin distribution over the ${margins.length} non-silent outcomes:`);
  console.log(`    min ${margins[0].toFixed(3)}, median ${margins[Math.floor(margins.length / 2)].toFixed(3)}, max ${margins[margins.length - 1].toFixed(3)}`);
  console.log(`    negative (an unimplicated domain outranks every implicated one): ${margins.filter((m) => m < 0).length}`);

  /**
   * Score one threshold. The namer cannot be run inside a deterministic sweep,
   * so the two sides are bounded, not simulated:
   *   miss  — BEST case: an oracle namer that names exactly the expected labels
   *           present in the shortlist. Real misses can only be higher.
   *   over  — WORST case: a credulous namer that names the whole shortlist.
   *           Real over-inclusion can only be lower.
   * Cost is exact, not bounded: escalations fire on the trigger, not the namer.
   */
  const scoreAt = (rows, t) => {
    let expected = 0;
    let missed = 0;
    let surfaced = 0;
    let over = 0;
    let escalations = 0;
    for (const e of rows) {
      const fires = e.margin === null || e.margin < t;
      if (fires) escalations += 1;
      const reach = fires ? [...e.got, ...e.candidates] : e.got;
      expected += e.expect.length;
      missed += e.expect.filter((x) => !reach.includes(x)).length;
      surfaced += reach.length;
      over += reach.filter((g) => !e.expect.includes(g)).length;
    }
    return { expected, missed, surfaced, over, escalations, outcomes: rows.length };
  };

  const thresholds = [
    { label: 'silence only (today)', t: -Infinity },
    ...[0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12].map((t) => ({ label: `margin < ${t.toFixed(2)}`, t })),
    { label: 'always escalate', t: Infinity },
  ];

  const totalLabels56 = evaluated.reduce((a, e) => a + e.expect.length, 0);
  console.log(`\n  Pooled sweep (${evaluated.length} outcomes, ${totalLabels56} labels). Miss is an ORACLE-NAMER FLOOR,`);
  console.log('  over is a CREDULOUS-NAMER CEILING; a real namer lands between them.\n');
  console.log('  trigger                 miss (floor)                            over (ceiling)                          namer calls/outcome');
  for (const { label, t } of thresholds) {
    const s = scoreAt(evaluated, t);
    console.log(
      `  ${label.padEnd(22)}  ${formatRate(s.missed, s.expected).padEnd(38)}  ${formatRate(s.over, s.surfaced).padEnd(38)}  ${(s.escalations / s.outcomes).toFixed(3)} (${s.escalations}/${s.outcomes})`,
    );
  }

  console.log('\n  Per corpus, missed labels (oracle floor) and namer calls at each trigger:\n');
  console.log(`  trigger                 ${corpora.map((c) => c.name.replace('-outcomes.json', '').padEnd(22)).join('')}`);
  for (const { label, t } of thresholds) {
    const cells = corpora.map((c) => {
      const s = scoreAt(evaluated.filter((e) => e.corpus === c.name), t);
      return `miss ${s.missed}/${s.expected}, calls ${s.escalations}/${s.outcomes}`.padEnd(22);
    });
    console.log(`  ${label.padEnd(22)}  ${cells.join('')}`);
  }

  console.log('\n  Reading the sweep: the miss column is what §5.5 promised — the shortlist');
  console.log('  contains the misses, so a trigger that fires hands them to the namer.');
  console.log('  The over ceiling is why the trigger must stay narrow, and the calls');
  console.log('  column is the bill. No row here is a default: shipping one is a decision');
  console.log('  Gerald makes against the expanded corpus, not against this one.');
}

// ---------------------------------------------------------------------------
// §6 does not touch the implication corpora at all: the confidence ramp it
// asks about belongs to a different classifier (kernel/intake/classify.ts,
// document-type triage) than the one the pooled corpus labels (kernel/
// implication/map.ts, domain routing). The two never emit a shared value, so
// nothing above can stand in as ground truth for this section.
if (heading(6, 'Calibration of the intake confidence ramp')) {
  const golden = JSON.parse(
    readFileSync(join(ROOT, 'tests/kernel/intake/fixtures/classify-golden.json'), 'utf8'),
  );

  console.log('\n  RETIRED 2026-08-11: the classifier this section calibrates was deleted as');
  console.log('  an unwired v2 port (the densifier is the live intake). The fixtures stay as');
  console.log('  the historical record this section reads; nothing below describes shipping code.');
  console.log('\n  The ramp lived in kernel/intake/classify.ts:');
  console.log('    calibratedBaseConfidence: 1 hit -> 0.55, 2 -> 0.72, 3 -> 0.82, 4+ -> 0.92,');
  console.log('    0 hits (filename boost only) -> 0.45, capped at 0.50 when margin < 0.3.');
  console.log('    TITLE_LOCK_CONFIDENCE = 0.9 is a fifth, separate constant (filename + H1 agree).');

  console.log('\n  What "ground truth" would have to mean here: for a real (sourcePath,');
  console.log('  extractedText) intake document, an independently adjudicated TRUE intakeType —');
  console.log('  not classifyIntake()\'s own output, and not a label for a different classifier.');

  console.log('\n  Candidate sources checked, and why each fails to supply it:\n');
  console.log('    tests/kernel/intake/fixtures/classify-golden.json — captured verbatim from a');
  console.log('    construct-legacy run (scripts/capture-legacy-classify-golden.mjs). It records');
  console.log('    what the predecessor DID, not what a human independently decided the document');
  console.log('    WAS. Scoring classifyIntake() against its own captured output is circular by');
  console.log('    construction: the golden test already asserts exact equality, so "accuracy"');
  console.log('    against it is 100% by definition, always, and says nothing about calibration.');
  console.log('\n    tests/kernel/implication/fixtures/{labeled,held-out,fresh,unspent}-outcomes.json');
  console.log('    — label a DIFFERENT classifier (kernel/routing/dispatcher.ts + implication/');
  console.log('    map.ts, which domains an outcome implicates) that emits no confidence value at');
  console.log('    all, let alone this ramp\'s. There is no shared prediction to calibrate.');

  console.log('\n  What DOES exist: the golden fixture\'s own hit-count distribution (captured');
  console.log('  behavior, not correctness) — for scale, and to show the buckets a real study');
  console.log('  would need to fill:\n');
  const buckets = new Map();
  for (const c of golden) {
    const hits = c.triage.candidates?.[0]?.hits ?? null;
    const conf = c.triage.confidence;
    const key = `${hits === null ? 'n/a (silent/unknown)' : hits} hit(s) -> conf ${conf}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  for (const [k, v] of [...buckets].sort()) console.log(`    ${k.padEnd(36)} ${v} captured case(s)`);
  console.log(`    TOTAL: ${golden.length} cases, all behavior-lock, zero independently labeled`);

  console.log('\n  What it would take to fill them: a corpus of real intake documents (not');
  console.log('  outcome sentences — full sourcePath + extractedText, the shape classifyIntake()');
  console.log('  actually consumes), each independently adjudicated for true document type by a');
  console.log('  coder who does not see classifyIntake()\'s prediction, collected across enough');
  console.log('  documents per hit-count bucket to bound a reliability estimate. Rough per-bucket');
  console.log('  sample sizes for a few interval widths (Wilson 95%, centered near the ramp\'s own');
  console.log('  values), via the same requiredTrials machinery §1 uses:\n');
  console.log('    ramp value   target CI half-width   documents needed in that bucket');
  for (const [p, halfWidth] of [[0.55, 0.15], [0.72, 0.15], [0.82, 0.1], [0.92, 0.08]]) {
    // requiredTrials is built for a two-point discrimination test, not a CI
    // half-width solve, so this reuses the Wilson formula directly rather than
    // repurposing that function for a shape of question it was not written for.
    const z = 1.959964;
    // Solve n from the Wilson half-width at p, iterating rather than inverting
    // the closed form algebraically -- the same numeric-honesty bar as the rest
    // of this script: printed from a loop, not from a memorized formula.
    let n = 1;
    while (true) {
      const denom = 1 + (z * z) / n;
      const center = p + (z * z) / (2 * n);
      const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
      void center;
      if (half <= halfWidth || n > 5000) break;
      n += 1;
    }
    console.log(`    ${p.toFixed(2).padStart(8)}   +/- ${halfWidth.toFixed(2).padStart(4)}                 ${n}`);
  }
  console.log('    (four buckets, independently filled, plus a fifth for TITLE_LOCK_CONFIDENCE —');
  console.log('    this is the same shape of collection the corpus expansion already ran once, applied');
  console.log('    to intake documents instead of outcome sentences.)');

  console.log('\n  RESULT: no reliability diagram, ECE, or Brier decomposition is computed by this');
  console.log('  section, and none is fitted with Platt scaling, because no ground-truth-labeled');
  console.log('  (predicted confidence, was it correct) pair exists anywhere in this repository.');
  console.log('  Computing any of those numbers here would require inventing a proxy for');
  console.log('  correctness -- e.g. treating the golden fixture\'s own predictions as truth, or');
  console.log('  reusing the implication corpora\'s domain labels as if they scored this ramp --');
  console.log('  and every such proxy either produces a tautological 100% (scoring a classifier');
  console.log('  against its own captured output) or scores the wrong classifier entirely.');
  console.log('  Neither is reported. The ramp is UNVALIDATED, not validated-and-passing.');
}

// ---------------------------------------------------------------------------
if (heading(9, 'Phase gates as sequential hypothesis tests')) {
  console.log('\nWhat each gate proves, if every subject succeeds:\n');
  console.log('  successes   two-sided 95% CI        one-sided 95% lower bound');
  for (const n of [3, 4, 5, 8, 10, 15, 20, 30]) {
    const ci = clopperPearson(n, n);
    console.log(
      `  ${String(n).padStart(4)}/${String(n).padEnd(4)}   [${ci.low.toFixed(3)}, ${ci.high.toFixed(3)}]` +
        `${' '.repeat(11)}${clopperPearsonLowerBound(n, n).toFixed(3)}`,
    );
  }
  console.log(
    '\n  No phase gate spends external subjects: the program evaluates its own runs, so no' +
      '\n  cross-user success rate is claimed anywhere. The table stands as what a consecutive-' +
      '\n  success gate would license, for the day such evidence is payable.',
  );
  console.log(`  A hypothetical 5/5 would license only: true success rate > ${clopperPearson(5, 5).low.toFixed(3)} (two-sided)`);
  console.log(`                          or > ${clopperPearsonLowerBound(5, 5).toFixed(3)} (one-sided).`);
  console.log(`  To license "> 0.90" at 95% confidence needs ${(() => {
    for (let n = 1; n <= 500; n += 1) if (clopperPearsonLowerBound(n, n) > 0.9) return n;
    return '>500';
  })()} consecutive successes.`);

  // The proposed replacement. Every number below is printed,
  // not asserted, because a stopping rule quoted without its error rates is the
  // same defect as a rate quoted without its width.
  const PROPOSED = { bar: 0.7, passAt: 0.95, futileAt: 0.1, maxSubjects: 20 };
  const boundary = sequentialPassBoundary(PROPOSED);
  console.log(
    `\n  Proposed sequential gate: bar ${PROPOSED.bar}, pass at ${PROPOSED.passAt} posterior` +
      `, stop for futility at ${PROPOSED.futileAt}, budget ${PROPOSED.maxSubjects}.`,
  );
  console.log('\n  Pass boundary (fewest successes that stop the gate with a pass):\n');
  console.log('    subjects  needed');
  boundary.forEach((needed, i) => {
    if (needed === null) return;
    console.log(`    ${String(i + 1).padStart(8)}  ${needed}`);
  });

  console.log('\n  What it does, by exact enumeration of every path:\n');
  console.log('    true rate   P(pass)   P(futile)   P(neither)   E[subjects]');
  for (const rate of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1]) {
    const oc = sequentialOperatingCharacteristics(PROPOSED, rate);
    console.log(
      `    ${rate.toFixed(2).padStart(9)}   ${oc.pass.toFixed(3)}     ${oc.futile.toFixed(3)}` +
        `       ${oc.inconclusive.toFixed(3)}        ${oc.expectedSubjects.toFixed(1)}`,
    );
  }
  const typeI = sequentialOperatingCharacteristics(PROPOSED, PROPOSED.bar).pass;
  console.log(`\n    type-I (a system exactly at the bar passes anyway): ${typeI.toFixed(3)}`);

  // The fixed-n alternative that licenses the same claim, for comparison. A run
  // of consecutive successes is over at the first failure, which is the cost the
  // sequential design is buying out of.
  const fixedN = (() => {
    for (let n = 1; n <= 500; n += 1) if (clopperPearsonLowerBound(n, n) > PROPOSED.bar) return n;
    return Infinity;
  })();
  console.log(`\n  Fixed-n equivalent: ${fixedN} consecutive successes license "> ${PROPOSED.bar}".`);
  console.log('\n    true rate   P(pass)   E[subjects]   vs sequential P(pass)');
  for (const rate of [0.8, 0.9, 0.95]) {
    const pass = rate ** fixedN;
    // Stops at the first failure, so E[n] is the truncated geometric mean.
    let expected = 0;
    for (let i = 1; i <= fixedN; i += 1) expected += i * (i === fixedN ? rate ** (i - 1) : rate ** (i - 1) * (1 - rate));
    const seq = sequentialOperatingCharacteristics(PROPOSED, rate);
    console.log(
      `    ${rate.toFixed(2).padStart(9)}   ${pass.toFixed(3)}     ${expected.toFixed(1)}` +
        `           ${seq.pass.toFixed(3)} in ${seq.expectedSubjects.toFixed(1)}`,
    );
  }
  console.log('    A single unlucky failure ends the fixed run; the sequential design absorbs it.');

  console.log('\n  Phase 2 composition quota, checked against the corpora we have:\n');
  for (const c of corpora) {
    const nonEng = c.outcomes.filter((o) => o.category !== 'engineering').length;
    const legal = c.outcomes.filter((o) => o.category === 'legal').length;
    console.log(
      `    ${c.name.padEnd(28)} non-engineering ${nonEng}/${c.outcomes.length}` +
        ` (quota 40%), legal ${legal}/${c.outcomes.length} (quota 20%)`,
    );
  }
}

// ---------------------------------------------------------------------------
if (heading(8, 'Run coordination inputs')) {
  const counts = pooled.map((o) => o.expect.length);
  const tally = new Map();
  for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
  console.log('\n  Domains implicated per outcome (the arrival burst the coordinator sees):\n');
  for (const k of [...tally.keys()].sort((a, b) => a - b)) {
    console.log(`    ${k} domain(s): ${'#'.repeat(tally.get(k))} (${tally.get(k)})`);
  }
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  console.log(`\n    mean ${mean.toFixed(2)}, max ${Math.max(...counts)}, concurrency is 2`);
  console.log('    Service-time distribution: NOT MEASURED (no work-log corpus yet).');
  console.log('    Queueing conclusions therefore cannot be drawn until they exist.');
}

// ---------------------------------------------------------------------------
// §10 requires a live local generative model and is skipped without --namer:
// like §5.5, the rest of this script must stay runnable offline. This is the
// measured half of the inversion experiment — model-primary naming vs keywords-first —
// run against the SHIPPED seam (src/hosts/namer.ts's prompt and parser), so it
// measures the code an inversion would actually run, not a stand-in.
if (process.argv.includes('--namer') && heading(10, 'Model-primary naming vs keywords-first (live, local)')) {
  const { namerPrompt, parseNamings, createHostNamer } = await import('../src/hosts/namer.ts');
  const { domainsByName } = await import('../src/kernel/implication/domains.ts');
  const hostFlag = process.argv.indexOf('--namer-host');
  const NAMER_HOST = hostFlag !== -1 ? process.argv[hostFlag + 1] : 'ollama';
  const modelFlag = process.argv.indexOf('--namer-model');
  const MODEL =
    modelFlag !== -1 ? process.argv[modelFlag + 1] : NAMER_HOST === 'ollama' ? 'qwen3.5:4b' : undefined;
  // A wrapper binary (e.g. one that spawns claude through `op run` so a
  // password manager injects credentials into the child) — Node's spawn does
  // not see shell aliases, so an aliased auth path must be passed explicitly.
  const binaryFlag = process.argv.indexOf('--namer-binary');
  const BINARY = binaryFlag !== -1 ? process.argv[binaryFlag + 1] : undefined;
  // The script writes nothing unless asked to. --namer-record persists this
  // run's per-outcome answers so a later arm can be compared against it
  // paired; --namer-compare reads such a record and reports that comparison.
  const recordFlag = process.argv.indexOf('--namer-record');
  const RECORD_TO = recordFlag !== -1 ? process.argv[recordFlag + 1] : null;
  const compareFlag = process.argv.indexOf('--namer-compare');
  const COMPARE_TO = compareFlag !== -1 ? process.argv[compareFlag + 1] : null;
  const armFlag = process.argv.indexOf('--namer-arm');
  const ARM_LABEL = armFlag !== -1 ? process.argv[armFlag + 1] : 'unlabelled';

  // Refused before the run rather than after it. These figures are stated per
  // tier, and on this host an unnamed model means the session default answers
  // — whatever that resolves to today, and it may change mid-run. A run that
  // would be refused at the end is a run whose entire cost was spent to be
  // told so, and on this host that cost is real money.
  if (RECORD_TO && NAMER_HOST === 'claude' && MODEL === undefined) {
    console.log('\n  NOT RUN: --namer-record on the claude host needs --namer-model.');
    console.log('  Without one the session default answers, so the figures would name no tier —');
    console.log(`  and ${RECORD_TO} would be refused after the consultations were already paid for.`);
    process.exit(1);
  }
  const byName = domainsByName(DOMAINS);

  /**
   * What this run actually asked the model, reduced to a short digest. A record
   * that cannot say which prompt produced it invites the comparison nobody
   * meant to make: two runs of the same prompt, read as evidence about a change.
   */
  const promptFingerprint = () =>
    createHash('sha256').update(namerPrompt('fingerprint probe', DOMAINS)).digest('hex').slice(0, 12);

  let calls = 0;
  let failures = 0;
  // A repair is a second model call that succeeded, not a failure — but it is
  // a cost, and a prompt that provokes more of them is paying it.
  let repairs = 0;
  let totalMs = 0;
  let costUsd = 0;
  const modelsRan = new Set();
  /**
   * Which model served THIS consultation, carried per async context rather than
   * in a shared variable: consultations run four at a time on the Claude host,
   * so a "last model seen" would attribute one outcome's answer to another
   * outcome's model. The run-level set says a tier drifted; only this says
   * which answers came from where, which is what separating a mixed run needs.
   */
  const servedBy = new AsyncLocalStorage();
  const attribute = (model) => {
    if (typeof model !== 'string' || !model) return;
    modelsRan.add(model);
    servedBy.getStore()?.add(model);
  };

  /** One namer consultation returning raw namings. Throws on failure, like the real namer. */
  let rawNamer;
  if (NAMER_HOST === 'claude') {
    // The SHIPPED path, verbatim: the Claude host adapter behind
    // createHostNamer — the same objects `construct outcome --escalate
    // --host=claude` runs. Cost is real on this host (pin.ts) and is summed
    // from each envelope; modelRan is collected so the figures name what
    // actually served them, not what was requested.
    const { createClaudeAdapter } = await import('../src/hosts/claude/adapter.ts');
    const adapter = createClaudeAdapter({
      ...(MODEL ? { model: MODEL } : {}),
      ...(BINARY ? { binary: BINARY } : {}),
    });
    await adapter.init();
    const metered = {
      ...adapter,
      invoke: async (request, context) => {
        const result = await adapter.invoke(request, context);
        const out = result?.output;
        if (out && typeof out.cost === 'number') costUsd += out.cost;
        // modelRan is string[] on the Claude adapter (adapter.ts) — a string
        // check here silently reported 'unreported' for a run that named its
        // model in every envelope. Accept both shapes.
        const ran = out?.modelRan;
        if (typeof ran === 'string') attribute(ran);
        else if (Array.isArray(ran)) for (const m of ran) attribute(m);
        return result;
      },
    };
    rawNamer = createHostNamer(metered);
  } else {
    // ollama's own clients read OLLAMA_HOST; following that convention is what
    // lets this be pointed somewhere other than the daemon on this machine.
    const OLLAMA = (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    rawNamer = async (outcome, catalog) => {
      const res = await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          prompt: namerPrompt(outcome, catalog),
          stream: false,
          options: { temperature: 0 },
        }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status} — is ollama running with ${MODEL} pulled?`);
      const body = await res.json();
      // What answered, not what was asked for — the same question the Claude
      // path's modelRan answers. Requesting a model and being served it is the
      // usual case here and not the guaranteed one, and a record that reports
      // the request cannot tell the difference.
      attribute(typeof body.model === 'string' && body.model ? body.model : MODEL);
      return parseNamings(body.response ?? '');
    };
  }

  // Same admission bar as escalate.ts's admissible(): catalog membership, a
  // non-empty stated why, de-duplicated. Inlined because admissible() is
  // deliberately unexported; semantics must match it, not extend it.
  const admit = (namings) => {
    const seen = new Set();
    const kept = [];
    for (const n of namings) {
      const d = byName.get(n.domain);
      if (!d || seen.has(d.domain)) continue;
      if (typeof n.why !== 'string' || !n.why.trim()) continue;
      seen.add(d.domain);
      kept.push(d.domain);
    }
    return kept;
  };

  // A namer that had to repair its first reply answers with `{ namings,
  // retried }` rather than with a bare array (naming.ts's NamerReply), and
  // escalate.ts unwraps that before it admits anything. This script iterated
  // the reply directly, so every outcome that needed a repair threw "namings
  // is not iterable", was counted as a namer FAILURE, and fell back to
  // keywords — while the run still reported its figures as the namer's. The
  // unwrap belongs here for the same reason admit() does: the semantics must
  // match the shipped path, not approximate it.
  const unwrap = (reply) => (reply && !Array.isArray(reply) && 'namings' in reply ? reply.namings : reply);

  const consult = async (outcome) => {
    calls += 1;
    const started = Date.now();
    const reply = await rawNamer(outcome, DOMAINS);
    totalMs += Date.now() - started;
    const namings = unwrap(reply);
    if (Array.isArray(reply) === false && namings !== reply) repairs += 1;
    return admit(Array.isArray(namings) ? namings : []);
  };

  /** Which model(s) served each outcome's one consultation, by outcome text. */
  const servedByOutcome = new Map();

  // Outcomes repeat across configurations; one consultation serves all of them.
  const namerCache = new Map();
  let lastFailure = null;
  const named = async (outcome) => {
    if (!namerCache.has(outcome)) {
      // The attribution is bound around the consultation and kept whether it
      // answered or threw: a failure served by a tier is still evidence about
      // which tier was answering when.
      const served = new Set();
      try {
        namerCache.set(outcome, await servedBy.run(served, () => consult(outcome)));
      } catch (err) {
        failures += 1;
        lastFailure = err instanceof Error ? err.message : String(err);
        namerCache.set(outcome, null); // null = the namer failed, not "named nothing"
      } finally {
        servedByOutcome.set(outcome, [...served]);
      }
    }
    return namerCache.get(outcome);
  };

  // Prefetch every unique outcome with bounded concurrency so the per-corpus
  // reporting below reads the cache. The Claude adapter declares 'concurrent';
  // ollama serves one generation at a time, so it stays sequential.
  const uniqueOutcomes = [...new Set(pooled.map((o) => o.outcome))];
  const POOL = NAMER_HOST === 'claude' ? 4 : 1;
  let nextOutcome = 0;
  await Promise.all(
    Array.from({ length: Math.min(POOL, uniqueOutcomes.length) }, async () => {
      while (nextOutcome < uniqueOutcomes.length) {
        const outcome = uniqueOutcomes[nextOutcome];
        nextOutcome += 1;
        await named(outcome);
      }
    }),
  );

  const tally = (outcomes, got) => {
    let expected = 0;
    let missed = 0;
    let surfaced = 0;
    let over = 0;
    outcomes.forEach((o, i) => {
      expected += o.expect.length;
      missed += o.expect.filter((e) => !got[i].includes(e)).length;
      surfaced += got[i].length;
      over += got[i].filter((g) => !o.expect.includes(g)).length;
    });
    return { expected, missed, surfaced, over };
  };

  console.log(`\n  namer host: ${NAMER_HOST}${MODEL ? `, model ${MODEL}` : ' (session default model)'}`);
  console.log('  Figures are per-model, never per-architecture — a different tier answering');
  console.log('  differently is the point of measuring per tier.\n');
  console.log('  Configurations: A0 keywords only; A1 keywords + namer on silence (shipped');
  console.log('  --escalate behavior); B namer on every outcome, keyword map as the');
  console.log('  fallback when the namer fails (the shipped inversion).\n');

  // Per-outcome answers, kept rather than tallied away. Two arms score the
  // same outcomes against the same gold, so the comparison between them is
  // paired; reading two aggregate rates off two runs and eyeballing their
  // intervals throws that pairing away and needs far more corpus to conclude
  // anything. The unit is the (outcome, expected label) pair, which is exactly
  // the unit `miss = missed/expected` already counts.
  const perOutcome = {};

  for (const c of corpora) {
    const kw = c.outcomes.map((o) => implicatedDomains({ outcome: o.outcome }));
    const a1 = [];
    const b = [];
    for (let i = 0; i < c.outcomes.length; i += 1) {
      const o = c.outcomes[i];
      const answer = await named(o.outcome);
      a1.push(kw[i].length > 0 ? kw[i] : (answer ?? []));
      b.push(answer ?? kw[i]);
    }
    console.log(`  ${c.name}`);
    for (const [label, got] of [['A0 keywords', kw], ['A1 +silence', a1], ['B  namer-1st', b]]) {
      const t = tally(c.outcomes, got);
      console.log(
        `    ${label.padEnd(13)} miss ${formatRate(t.missed, t.expected).padEnd(38)} over ${formatRate(t.over, t.surfaced)}`,
      );
    }
    perOutcome[c.name] = c.outcomes.map((o, i) => ({
      outcome: o.outcome,
      expect: o.expect,
      A0: kw[i],
      A1: a1[i],
      B: b[i],
      // Which model produced this row's namer answer. A0 is the keyword map and
      // no model served it; the field describes the consultation, so it is
      // empty when there was none.
      servedBy: servedByOutcome.get(o.outcome) ?? [],
    }));
  }
  console.log(`\n  namer consultations: ${calls} (${failures} failed, ${repairs} answered on a corrective retry), mean latency ${calls ? Math.round(totalMs / calls) : 0}ms`);
  if (failures > 0) {
    console.log(`  LAST FAILURE: ${lastFailure}`);
    console.log('  A failed consultation falls back per configuration (A1 -> silence, B -> keywords),');
    console.log('  so a run with failures is measuring the FALLBACK, not the namer. Figures from');
    console.log('  such a run must not be quoted as namer figures.');
  }
  if (NAMER_HOST === 'claude') {
    console.log(`  cost: $${costUsd.toFixed(4)} summed from envelopes; model(s) that ran: ${[...modelsRan].join(', ') || 'unreported'}`);
    if (costUsd === 0 && calls > 0) {
      console.log('  A summed zero with consultations made is unmeasured, not free (subscription');
      console.log('  auth reports no spend). Do not quote this run as costless.');
    }
  }
  console.log('  The sealed corpus is deliberately absent, as everywhere in this script.');
  console.log('  Adoption was decided by Gerald on these figures, recorded in the tracker — a weak');
  console.log('  namer understating the inversion must not kill it, and a strong one');
  console.log('  flattering it must not ship it without the figures being read per tier.');

  // A record of a run that fell back is a trap: it looks like an arm, compares
  // like an arm, and is partly the keyword map. The run already says so on
  // screen, but a file outlives the terminal it was printed in, so the refusal
  // is here rather than left to whoever reads the figures later.
  if (RECORD_TO && failures > 0) {
    console.log(`\n  NOT RECORDED: ${failures} of ${calls} consultations failed, so this run is`);
    console.log(`  partly the fallback arm. ${RECORD_TO} is left untouched. Fix the cause and re-run.`);
  } else if (RECORD_TO && modelsRan.size > 1) {
    // These figures are stated per tier, and a run answered by two tiers is
    // not one tier's figures. The arm file is refused rather than annotated,
    // because an annotation on a file is a note the next comparison will not
    // read. Pin the tier with --namer-model and run it again.
    //
    // The answers are not thrown away with it. Each one now names the model
    // that served it, so the run is separable after the fact — which is the
    // whole difference between a refusal and a loss. It goes to a sibling
    // file that cannot be mistaken for an arm: nothing compares against a
    // path ending .mixed.json.
    const forensic = `${RECORD_TO}.mixed.json`;
    writeFileSync(
      forensic,
      `${JSON.stringify(
        {
          arm: ARM_LABEL,
          notAnArm:
            'more than one model served this run, so these figures are not a per-tier measurement. ' +
            'Kept only so the consultations can be separated by the model that served each one.',
          recordedAt: new Date().toISOString(),
          host: NAMER_HOST,
          model: MODEL ?? null,
          modelsRan: [...modelsRan],
          promptFingerprint: promptFingerprint(),
          consultations: calls,
          failures,
          repairs,
          perOutcome,
        },
        null,
        2,
      )}\n`,
    );
    const perTier = new Map();
    for (const [, list] of servedByOutcome) {
      for (const m of list) perTier.set(m, (perTier.get(m) ?? 0) + 1);
    }
    console.log(`\n  NOT RECORDED: ${modelsRan.size} tiers served this run (${[...modelsRan].join(', ')}),`);
    for (const [m, n] of [...perTier].sort()) {
      console.log(`    ${m}: ${n} of ${servedByOutcome.size} consultations`);
    }
    console.log('  so it is not a per-tier measurement. Pin the tier with --namer-model and re-run.');
    console.log(`  ${RECORD_TO} is left untouched; the per-consultation attribution is in ${forensic},`);
    console.log('  which is evidence about what happened, never an arm to compare against.');
  } else if (RECORD_TO) {
    const record = {
      arm: ARM_LABEL,
      recordedAt: new Date().toISOString(),
      host: NAMER_HOST,
      model: MODEL ?? null,
      modelsRan: [...modelsRan],
      promptFingerprint: promptFingerprint(),
      consultations: calls,
      failures,
      repairs,
      perOutcome,
    };
    writeFileSync(RECORD_TO, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`\n  recorded arm "${ARM_LABEL}" to ${RECORD_TO}`);
    console.log(`  prompt fingerprint ${record.promptFingerprint} — a comparison against a`);
    console.log('  record carrying a different fingerprint is comparing two prompts, which is');
    console.log('  the point; against the SAME fingerprint it is measuring host nondeterminism.');
  }

  if (COMPARE_TO) {
    const base = JSON.parse(readFileSync(COMPARE_TO, 'utf8'));
    console.log(`\n  PAIRED against arm "${base.arm}" (${COMPARE_TO}, recorded ${base.recordedAt})`);
    console.log(`  fingerprints: base ${base.promptFingerprint} -> now ${promptFingerprint()}`);
    if (base.promptFingerprint === promptFingerprint()) {
      console.log('  IDENTICAL PROMPTS: any difference below is host nondeterminism, not the change.');
    }
    console.log('\n  On the miss axis, per (outcome, expected label) pair. "base only" = the pair');
    console.log('  the baseline found and this arm misses (a regression); "now only" = recovered.\n');
    console.log('  corpus                       base miss    now miss   base only   now only   McNemar p');

    let totalBaseOnly = 0;
    let totalNowOnly = 0;
    let totalPairs = 0;
    let baseMissed = 0;
    let nowMissed = 0;
    // The §10 adoption gate is stated on pooled out-of-family miss — fresh +
    // unspent, the corpora written after the catalog — so that pooling gets
    // its own row rather than being recovered by hand from the per-corpus
    // ones. The all-four POOLED row below is not the gate's axis.
    const OUT_OF_FAMILY = new Set(['fresh-outcomes.json', 'unspent-outcomes.json']);
    let oofBaseOnly = 0;
    let oofNowOnly = 0;
    let oofPairs = 0;
    let oofBaseMissed = 0;
    let oofNowMissed = 0;

    for (const c of corpora) {
      const baseRows = base.perOutcome?.[c.name];
      const nowRows = perOutcome[c.name];
      if (!baseRows) {
        console.log(`  ${c.name.padEnd(28)} ABSENT from the baseline record — not compared`);
        continue;
      }
      // Match on the outcome text, never on position: a corpus that gained or
      // reordered an entry would otherwise pair each answer with a different
      // outcome's gold and report the misalignment as a finding.
      const baseByOutcome = new Map(baseRows.map((r) => [r.outcome, r]));
      let onlyBase = 0;
      let onlyNow = 0;
      let pairs = 0;
      let bMiss = 0;
      let nMiss = 0;
      let unmatched = 0;
      for (const row of nowRows) {
        const prior = baseByOutcome.get(row.outcome);
        if (!prior) {
          unmatched += 1;
          continue;
        }
        for (const label of row.expect) {
          pairs += 1;
          const foundBefore = prior.B.includes(label);
          const foundNow = row.B.includes(label);
          if (!foundBefore) bMiss += 1;
          if (!foundNow) nMiss += 1;
          if (foundBefore && !foundNow) onlyBase += 1;
          if (!foundBefore && foundNow) onlyNow += 1;
        }
      }
      const p = mcnemarExact(onlyBase, onlyNow);
      console.log(
        `  ${c.name.padEnd(28)} ${(bMiss / pairs).toFixed(3).padStart(9)} ${(nMiss / pairs)
          .toFixed(3)
          .padStart(11)} ${String(onlyBase).padStart(11)} ${String(onlyNow).padStart(10)} ${p
          .toFixed(4)
          .padStart(11)}${unmatched ? `  (${unmatched} unmatched)` : ''}`,
      );
      totalBaseOnly += onlyBase;
      totalNowOnly += onlyNow;
      totalPairs += pairs;
      baseMissed += bMiss;
      nowMissed += nMiss;
      if (OUT_OF_FAMILY.has(c.name)) {
        oofBaseOnly += onlyBase;
        oofNowOnly += onlyNow;
        oofPairs += pairs;
        oofBaseMissed += bMiss;
        oofNowMissed += nMiss;
      }
    }

    const oofP = mcnemarExact(oofBaseOnly, oofNowOnly);
    console.log(
      `  ${'OUT-OF-FAMILY (gate axis)'.padEnd(28)} ${(oofBaseMissed / oofPairs)
        .toFixed(3)
        .padStart(9)} ${(oofNowMissed / oofPairs).toFixed(3).padStart(11)} ${String(
        oofBaseOnly,
      ).padStart(11)} ${String(oofNowOnly).padStart(10)} ${oofP.toFixed(4).padStart(11)}`,
    );

    const pooledP = mcnemarExact(totalBaseOnly, totalNowOnly);
    console.log(
      `  ${'POOLED'.padEnd(28)} ${(baseMissed / totalPairs).toFixed(3).padStart(9)} ${(
        nowMissed / totalPairs
      )
        .toFixed(3)
        .padStart(11)} ${String(totalBaseOnly).padStart(11)} ${String(totalNowOnly).padStart(
        10,
      )} ${pooledP.toFixed(4).padStart(11)}`,
    );
    console.log(`\n  ${totalBaseOnly + totalNowOnly} discordant pairs of ${totalPairs}.`);
    console.log('  A large p with few discordant pairs is "this corpus cannot tell", not');
    console.log('  "the arms are the same". Concordant pairs carry no information about a');
    console.log('  difference, which is why the raw rates above are the wrong thing to read.');
  }
}

console.log('');
