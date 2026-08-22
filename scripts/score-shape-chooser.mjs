#!/usr/bin/env node
/**
 * score-shape-chooser.mjs — re-derive the shape-chooser miss rate from the
 * recorded run.
 *
 * `docs/internal/2026-08-21-shape-chooser-miss-rate.md` quotes a headline the project
 * repeats beside its routing miss rate: on wording nobody tuned the matcher
 * against, the keyword shape chooser misses 0.625 (25/40). The per-ask answers
 * behind that figure are committed in `fixtures/shape-chooser/keywords.json`,
 * but nothing read the file back and compared it to what the doc claims — the
 * same gap `score-namer-arms.mjs` closed for the routing figures, here for the
 * shape figures.
 *
 * This scores the recorded run and, with `--expect`, fails when a published
 * figure no longer comes out of its own fixture. A fixture is never rewritten
 * to fit a later rule; a rule that disagrees with a recorded run is the rule
 * that changes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const FIXTURE = fileURLToPath(new URL('../fixtures/shape-chooser/keywords.json', import.meta.url));

/**
 * The cuts the doc publishes, each as a predicate over a row plus the published
 * rate. `matched` is `!fellThrough`: a phrase fired rather than the default
 * standing in for silence.
 */
const PUBLISHED = [
  { label: 'all forty', filter: () => true, denom: 'rows', miss: '0.625' },
  {
    label: 'names its genre word (18)',
    filter: (r) => r.avoidsGenreWord === false,
    denom: 'rows',
    miss: '0.500',
  },
  {
    label: 'avoids its genre word (22)',
    filter: (r) => r.avoidsGenreWord === true,
    denom: 'rows',
    miss: '0.727',
  },
  {
    label: 'a phrase matched',
    filter: () => true,
    denom: 'matchRate',
    miss: null,
    rate: '0.200',
  },
  {
    label: 'wrong given that a phrase matched',
    filter: (r) => !r.fellThrough,
    denom: 'rows',
    miss: '0.125',
  },
];

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
const rows = fixture.rows;

process.stdout.write(
  `shape chooser — arm "${fixture.arm}", corpus ${fixture.corpus}, measured ${fixture.measured}\n` +
    `rows: ${String(rows.length)}, recorded missed: ${String(fixture.missed)}/${String(fixture.scored)}\n\n`,
);

const failures = [];

function checkRate(label, hits, total, published) {
  const r = rate(hits, total);
  const [lo, hi] = wilson(hits, total);
  process.stdout.write(
    `${label}\n    ${r} (${String(hits)}/${String(total)}) Wilson 95% [${lo.toFixed(3)}, ${hi.toFixed(3)}]\n`,
  );
  if (published !== null && r !== published) {
    failures.push(`${label}: published ${published}, fixture gives ${r}`);
  }
}

// all forty / genre-word cuts: miss rate within the filtered subset
for (const cut of PUBLISHED.filter((p) => p.denom === 'rows')) {
  const subset = rows.filter(cut.filter);
  const missed = subset.filter((r) => r.missed === true).length;
  checkRate(cut.label, missed, subset.length, cut.miss);
}

// how the answer was reached: match rate and default rate
const matched = rows.filter((r) => r.fellThrough === false).length;
checkRate('a phrase matched', matched, rows.length, '0.200');
checkRate('nothing matched, default answered', rows.length - matched, rows.length, '0.800');

// overall recorded totals, independent of the per-row recompute above
const totalMissed = rows.filter((r) => r.missed === true).length;
if (totalMissed !== fixture.missed) {
  failures.push(
    `fixture header says missed ${String(fixture.missed)}, recomputing rows gives ${String(totalMissed)}`,
  );
}

if (!process.argv.includes('--expect')) process.exit(0);

if (failures.length > 0) {
  process.stderr.write(`\nscore-shape-chooser: a published figure no longer comes out of its fixture.\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.stderr.write(
    '\nEither the fixture changed, or the figure quoted in ' +
      'docs/internal/2026-08-21-shape-chooser-miss-rate.md is wrong. Both are decisions, not typos.\n',
  );
  process.exit(1);
}

process.stdout.write('\nscore-shape-chooser: every published figure re-derives from its fixture\n');
