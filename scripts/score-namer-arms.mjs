#!/usr/bin/env node
/**
 * score-namer-arms.mjs — re-derive the routing figures from the recorded runs.
 *
 * The miss and false-implicate rates are this project's most-quoted numbers and
 * the least flattering thing it publishes, which is exactly why they must stay
 * checkable. Every per-outcome answer behind them is committed under
 * `fixtures/namer-arms/`, but nothing could read those files back, so the
 * figures could only be trusted, never verified, and a change to the catalog
 * could move them with nobody noticing.
 *
 * This scores the recorded arms and, with `--expect`, fails when a headline
 * figure no longer comes out of its own fixture.
 *
 * Definitions, kept the way `RESEARCH-DECISIONS.md` §10 and §18 state them:
 *
 *   miss  = expected labels the arm did not name, over all expected labels,
 *           pooled over the out-of-family corpora (fresh + unspent). Naming a
 *           domain the labeler did not mark is not a miss.
 *   over  = named domains the labeler did not mark, over all named domains, on
 *           the same pool. §18's ablation table reports a different `over`
 *           scoped to the unspent arm alone; the two are not comparable and
 *           this script computes §10's.
 *
 * The columns are the arms as recorded: `A0` is the zero-model keyword map,
 * `B` the shipped model namer. A fixture is never rewritten to fit a later
 * rule; a rule that disagrees with a recorded run is the rule that changes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const FIXTURE = fileURLToPath(new URL('../fixtures/namer-arms/shipped.json', import.meta.url));

/** The out-of-family pool: wording whose authors had never seen the catalog. */
const OUT_OF_FAMILY = ['fresh-outcomes.json', 'unspent-outcomes.json'];

/**
 * The figures the README and RESEARCH-DECISIONS §10 state, and the arm each
 * belongs to. A change that moves one of these has changed what the project
 * claims in public, which is a decision rather than a side effect.
 */
const PUBLISHED = [
  { column: 'B', label: 'shipped model namer', miss: '0.280', over: '0.374' },
  { column: 'A0', label: 'zero-model keyword map', miss: '0.634', over: null },
];

function score(rows, column) {
  let expected = 0;
  let missed = 0;
  let named = 0;
  let over = 0;
  for (const row of rows) {
    const want = new Set(row.expect);
    const got = new Set(row[column] ?? []);
    expected += want.size;
    named += got.size;
    for (const label of want) if (!got.has(label)) missed++;
    for (const label of got) if (!want.has(label)) over++;
  }
  return { expected, missed, named, over };
}

/** Wilson 95%, the interval every published rate here carries. */
function wilson(hits, total) {
  if (total === 0) return [0, 0];
  const z = 1.959_963_984_540_054;
  const p = hits / total;
  const d = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, (centre - spread) / d), Math.min(1, (centre + spread) / d)];
}

function rate(hits, total) {
  return total === 0 ? '—' : (hits / total).toFixed(3);
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const pool = OUT_OF_FAMILY.flatMap((corpus) => fixture.perOutcome[corpus] ?? []);

process.stdout.write(
  `namer arms — arm "${fixture.arm}", host ${fixture.host}, recorded ${fixture.recordedAt}\n` +
    `pool: ${OUT_OF_FAMILY.join(' + ')} (${String(pool.length)} outcomes)\n\n`,
);

const failures = [];
for (const { column, label, miss, over } of PUBLISHED) {
  const s = score(pool, column);
  const missRate = rate(s.missed, s.expected);
  const overRate = rate(s.over, s.named);
  const [ml, mh] = wilson(s.missed, s.expected);
  process.stdout.write(
    `${column}  ${label}\n` +
      `    miss ${missRate} (${String(s.missed)}/${String(s.expected)}) ` +
      `Wilson 95% [${ml.toFixed(3)}, ${mh.toFixed(3)}]\n` +
      `    over ${overRate} (${String(s.over)}/${String(s.named)})\n`,
  );
  if (missRate !== miss) failures.push(`${column} miss: published ${miss}, fixture gives ${missRate}`);
  if (over !== null && overRate !== over) {
    failures.push(`${column} over: published ${over}, fixture gives ${overRate}`);
  }
}

if (!process.argv.includes('--expect')) process.exit(0);

if (failures.length > 0) {
  process.stderr.write(`\nscore-namer-arms: a published figure no longer comes out of its fixture.\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.stderr.write(
    '\nEither the fixture changed, or the figure quoted in README.md and ' +
      'RESEARCH-DECISIONS.md §10 is wrong. Both are decisions, not typos.\n',
  );
  process.exit(1);
}

process.stdout.write('\nscore-namer-arms: every published figure re-derives from its fixture\n');
