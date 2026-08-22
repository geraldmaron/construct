#!/usr/bin/env node
/**
 * score-namer-ablation.mjs — re-derive the catalog-conditions ablation from the
 * recorded arms.
 *
 * `RESEARCH-DECISIONS.md` §18 ran five namer-arm recordings — the shipped
 * catalog and four variants carrying `implicatedWhen`/`notImplicatedWhen`
 * clauses — and used the comparison to reject handing the router the
 * catalog's precision comments (§21 restates the same numbers as the reason
 * the proposal stays closed). Every per-outcome answer behind that table is
 * committed under `fixtures/namer-arms/`, the same directory
 * `score-namer-arms.mjs` already reads, but nothing checked this second table
 * against its own fixtures.
 *
 * This recomputes, per arm: the pooled out-of-family miss rate (§18's `miss`
 * column, the same quantity `score-namer-arms.mjs` computes for the shipped
 * arm alone), the unspent-only over rate (§18's `over` column — explicitly
 * NOT §10's pooled false-implicate rate; the two must not be quoted against
 * each other, and this script keeps them apart the way the doc does), and the
 * McNemar-paired lost/recovered counts against the shipped arm on the same
 * (outcome, expected label) pairs.
 *
 * `node scripts/score-namer-ablation.mjs [--expect]`
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const DIR = fileURLToPath(new URL('../fixtures/namer-arms/', import.meta.url));

/** The out-of-family pool the miss column is stated over, same as score-namer-arms.mjs. */
const OUT_OF_FAMILY = ['fresh-outcomes.json', 'unspent-outcomes.json'];

/**
 * The five arms as §18 tables them, each with its published miss (pooled
 * out-of-family) and over (unspent-only) rate, and the McNemar lost/recovered
 * counts against the shipped baseline where §18 states one.
 */
const ARMS = [
  { file: 'shipped.json', label: 'shipped — one-line concerns', miss: '0.280', over: '0.376', baseline: true },
  {
    file: 'armD-measured-exclusions.json',
    label: 'D — 4 measured exclusions',
    miss: '0.312',
    over: '0.353',
    lost: 9,
    recovered: 6,
    p: 0.61,
  },
  {
    file: 'armE-all-exclusions.json',
    label: 'E — 23 exclusions, no inclusions',
    miss: '0.333',
    over: '0.321',
    lost: 11,
    recovered: 6,
    p: 0.33,
  },
  {
    file: 'armA-no-exclusions.json',
    label: 'A — 58 inclusions, no exclusions',
    miss: '0.505',
    over: '0.377',
    lost: 22,
    recovered: 1,
    p: 0.0001,
    pDirection: 'below',
  },
  {
    file: 'held-verbatim.json',
    label: 'held — 58 inclusions + 23 exclusions',
    miss: '0.548',
    over: '0.190',
    lost: 26,
    recovered: 1,
    p: 0.0001,
    pDirection: 'below',
  },
];

function load(file) {
  return JSON.parse(readFileSync(DIR + file, 'utf8'));
}

function pooledRows(fixture) {
  return OUT_OF_FAMILY.flatMap((c) => fixture.perOutcome[c] ?? []);
}

/** Miss/over over the `B` column (namer-first), matching score-namer-arms.mjs's score(). */
function score(rows) {
  let expected = 0;
  let missed = 0;
  let named = 0;
  let over = 0;
  for (const row of rows) {
    const want = new Set(row.expect);
    const got = new Set(row.B ?? []);
    expected += want.size;
    named += got.size;
    for (const label of want) if (!got.has(label)) missed++;
    for (const label of got) if (!want.has(label)) over++;
  }
  return { expected, missed, named, over };
}

function rate(hits, total) {
  return total === 0 ? '—' : (hits / total).toFixed(3);
}

/** Exact nCk via BigInt, so the binomial CDF below carries no floating-point error. */
function binomCoeff(n, k) {
  if (k < 0 || k > n) return 0n;
  let result = 1n;
  for (let i = 0; i < k; i++) result = (result * BigInt(n - i)) / BigInt(i + 1);
  return result;
}

/** P(X <= k) for X ~ Binomial(n, 0.5), exact. */
function binomialCdfHalf(k, n) {
  let sum = 0n;
  for (let i = 0; i <= k; i++) sum += binomCoeff(n, i);
  return Number(sum) / Number(2n ** BigInt(n));
}

/** McNemar's exact test on discordant counts, matching src/kernel/metrics/intervals.ts's contract. */
function mcnemarExact(onlyBefore, onlyAfter) {
  const discordant = onlyBefore + onlyAfter;
  if (discordant === 0) return 1;
  const smaller = Math.min(onlyBefore, onlyAfter);
  return Math.min(1, 2 * binomialCdfHalf(smaller, discordant));
}

const shipped = load('shipped.json');
const shippedByOutcome = new Map(pooledRows(shipped).map((r) => [r.outcome, r]));

const failures = [];

for (const arm of ARMS) {
  const fixture = load(arm.file);
  const pooled = pooledRows(fixture);
  const s = score(pooled);
  const missRate = rate(s.missed, s.expected);

  const unspentRows = fixture.perOutcome['unspent-outcomes.json'] ?? [];
  const u = score(unspentRows);
  const overRate = rate(u.over, u.named);

  process.stdout.write(
    `${arm.label}\n` +
      `    miss ${missRate} (${String(s.missed)}/${String(s.expected)}, pooled fresh+unspent)\n` +
      `    over ${overRate} (${String(u.over)}/${String(u.named)}, unspent only — not §10's pooled rate)\n`,
  );

  if (missRate !== arm.miss) failures.push(`${arm.label} miss: published ${arm.miss}, fixture gives ${missRate}`);
  if (overRate !== arm.over) failures.push(`${arm.label} over: published ${arm.over}, fixture gives ${overRate}`);

  if (arm.baseline) continue;

  // Paired comparison against shipped, on the (outcome, expected label) pairs
  // both arms score. Matched on outcome text, per measure-decisions.mjs's own
  // convention for comparing two arms.
  let lost = 0;
  let recovered = 0;
  let matched = 0;
  for (const row of pooled) {
    const base = shippedByOutcome.get(row.outcome);
    if (!base) continue;
    matched++;
    const baseGot = new Set(base.B ?? []);
    const armGot = new Set(row.B ?? []);
    for (const label of row.expect) {
      const baseHit = baseGot.has(label);
      const armHit = armGot.has(label);
      if (baseHit && !armHit) lost++;
      else if (!baseHit && armHit) recovered++;
    }
  }
  const p = mcnemarExact(Math.min(lost, recovered), Math.max(lost, recovered));
  const pLabel = arm.pDirection === 'below' ? `p < ${arm.p.toFixed(4)}` : `p = ${p.toFixed(2)}`;
  process.stdout.write(
    `    paired vs shipped: ${String(matched)} outcomes matched, ${String(lost)} lost / ${String(recovered)} recovered, ${pLabel} (exact: ${p.toFixed(6)})\n`,
  );

  if (lost !== arm.lost) failures.push(`${arm.label} lost: published ${String(arm.lost)}, fixture gives ${String(lost)}`);
  if (recovered !== arm.recovered) {
    failures.push(`${arm.label} recovered: published ${String(arm.recovered)}, fixture gives ${String(recovered)}`);
  }
  const pOk = arm.pDirection === 'below' ? p < arm.p : Math.abs(p - arm.p) < 0.005;
  if (!pOk) failures.push(`${arm.label} p-value: published ${pLabel}, fixture gives ${p.toFixed(4)}`);
}

if (!process.argv.includes('--expect')) process.exit(0);

if (failures.length > 0) {
  process.stderr.write(`\nscore-namer-ablation: a published figure no longer comes out of its fixture.\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.stderr.write(
    '\nEither a fixture changed, or the ablation table in RESEARCH-DECISIONS.md ' +
      '§18/§21 is wrong. Both are decisions, not typos.\n',
  );
  process.exit(1);
}

process.stdout.write('\nscore-namer-ablation: every published figure re-derives from its fixture\n');
