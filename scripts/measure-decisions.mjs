/**
 * scripts/measure-decisions.mjs — regenerate every number quoted in
 * RESEARCH-DECISIONS.md (construct-2jb).
 *
 * The document is prose, and prose is where unchecked numbers go to become
 * folklore. This script is the document's gate: a figure that appears there and
 * cannot be printed here is a figure nobody measured. Same discipline as
 * probe-*-conformance.mjs, applied to statistics instead of to a host.
 *
 * Reads the real corpora and the real catalog. Writes nothing.
 *
 *   node scripts/measure-decisions.mjs
 *   node scripts/measure-decisions.mjs --section 3
 */

import { readFileSync } from 'node:fs';
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
 * measured half of construct-2jb.4's corpus; its sealed half is deliberately
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

  // construct-2jb.4's corpus is the first one labeled twice at authoring time,
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
    `\n  construct-2jb.4 corpus, measured half (${observations.length / 2} outcomes, 2 coders):`,
  );
  console.log(`    exact set agreement: ${exact}/${observations.length / 2}`);
  console.log(`    Krippendorff alpha (MASI):    ${masi.alpha.toFixed(4)}  (Do ${masi.Do.toFixed(4)}, De ${masi.De.toFixed(4)})`);
  console.log(`    Krippendorff alpha (nominal): ${nominal.alpha.toFixed(4)}`);
  console.log('    CAVEAT: both coders, both adjudicator and all eight authors are models of');
  console.log('    one family. Observed agreement is an UPPER BOUND on independent agreement');
  console.log('    (correlated error — construct-2jb.3\'s caveat, unchanged).');
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
  console.log('    construct-4jq is what actually gates admission, and MIN_SIGNAL sits one');
  console.log('    step below a cliff rather than at a tuned optimum.');
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
if (process.argv.includes('--embeddings') && heading(5.6, 'Margin-triggered escalation: what a similarity margin WOULD have done (construct-zg4)')) {
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
  console.log('  tuned against during construct-4jq. Nothing here is derived or validated;');
  console.log('  it is what each threshold WOULD have done, on data that cannot vouch for');
  console.log('  it. Believing any row requires the corpus construct-2jb.4 will build.');

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
  console.log('  Gerald makes against construct-2jb.4\'s corpus, not against this one.');
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
  console.log('\n  Phase 5 gate is "three to five external users".');
  console.log(`  At 5/5 that licenses only: true success rate > ${clopperPearson(5, 5).low.toFixed(3)} (two-sided)`);
  console.log(`                          or > ${clopperPearsonLowerBound(5, 5).toFixed(3)} (one-sided).`);
  console.log(`  To license "> 0.90" at 95% confidence needs ${(() => {
    for (let n = 1; n <= 500; n += 1) if (clopperPearsonLowerBound(n, n) > 0.9) return n;
    return '>500';
  })()} consecutive successes.`);

  // The proposed replacement (construct-2jb.9). Every number below is printed,
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
  console.log('    Queueing conclusions therefore cannot be drawn — see construct-2jb.11.');
}

console.log('');
