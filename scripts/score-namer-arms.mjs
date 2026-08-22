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
 * Definitions, kept the way `RESEARCH-DECISIONS.md` §10, §18 and §24 state them:
 *
 *   miss  = expected labels the arm did not name, over all expected labels,
 *           pooled over the out-of-family corpora (fresh + unspent). Naming a
 *           domain the labeler did not mark is not a miss.
 *   over  = named domains the labeler did not mark, over all named domains, on
 *           the same pool. §18's ablation table reports a different `over`
 *           scoped to the unspent arm alone; the two are not comparable and
 *           this script computes §10's.
 *
 * **Two frames, because most of the catalog carries no gold here.** Ten of the
 * catalog's domains are marked on at least one outcome in this pool and the
 * rest are marked on none. A domain the labelers never marked anywhere can only
 * ever contribute a false implicate, so the OVERALL over-rate charges the
 * router for naming concerns this corpus holds no opinion about — silence there
 * is the corpus's, not the router's. IN-FRAME restricts the named set to the
 * domains that carry gold. Miss is identical in both frames by construction,
 * since every expected label is in-frame, and is printed twice anyway so the
 * pair is never quoted as though only one of them had moved. The frame is read
 * from the corpora themselves rather than hard-coded, so a corpus that grows a
 * label moves the frame instead of silently disagreeing with it.
 *
 * The columns are the arms as recorded: `A0` is the zero-model keyword map,
 * `B` the shipped model namer. A fixture is never rewritten to fit a later
 * rule; a rule that disagrees with a recorded run is the rule that changes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const DIR = fileURLToPath(new URL('../fixtures/namer-arms/', import.meta.url));
const CORPORA = fileURLToPath(new URL('../tests/kernel/implication/fixtures/', import.meta.url));

/** The out-of-family pool: wording whose authors had never seen the catalog. */
const OUT_OF_FAMILY = ['fresh-outcomes.json', 'unspent-outcomes.json'];

/** The domains this pool actually marks. Everything else can only over-fire. */
const IN_FRAME = new Set(
  OUT_OF_FAMILY.flatMap((corpus) =>
    JSON.parse(readFileSync(CORPORA + corpus, 'utf8')).outcomes.flatMap((o) => o.expect),
  ),
);

/**
 * The figures the README and `RESEARCH-DECISIONS.md` §10 and §24 state, and the
 * arm each belongs to. A change that moves one of these has changed what the
 * project claims in public, which is a decision rather than a side effect.
 *
 * The three arms are not interchangeable and the reason is the point of §24:
 * `shipped.json` was recorded against a 15-domain catalog on the Claude build
 * of 2026-08-11, and the two 2026-08-21 arms against the 17-domain catalog on
 * that day's build. Only same-day arms are a paired comparison; the older arm
 * is kept because §10 and §18 are stated on it.
 */
const ARMS = [
  {
    file: 'shipped.json',
    note: '15-domain catalog, the arm §10 and §18 are stated on',
    columns: [
      { column: 'B', label: 'shipped model namer', miss: '0.280', over: '0.374', inFrame: '0.163' },
      { column: 'A0', label: 'zero-model keyword map', miss: '0.634', over: null, inFrame: null },
    ],
  },
  {
    file: 'shipped-17-domain.json',
    note: '17-domain catalog, the paired baseline §24 measures against',
    columns: [
      { column: 'B', label: 'current concern lines', miss: '0.194', over: '0.537', inFrame: '0.370' },
      { column: 'A0', label: 'zero-model keyword map', miss: '0.634', over: '0.507', inFrame: '0.414' },
    ],
  },
  {
    file: 'five-concern-lines.json',
    note: '17-domain catalog, five concern lines redrafted against their lenses',
    columns: [
      { column: 'B', label: 'five redrafted concern lines', miss: '0.183', over: '0.483', inFrame: '0.339' },
    ],
  },
];

function score(rows, column, frame) {
  let expected = 0;
  let missed = 0;
  let named = 0;
  let over = 0;
  for (const row of rows) {
    const want = new Set(row.expect);
    const all = row[column] ?? [];
    const got = new Set(frame === 'in-frame' ? all.filter((d) => IN_FRAME.has(d)) : all);
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

process.stdout.write(
  `namer arms — in-frame is ${String(IN_FRAME.size)} gold-carrying domains; ` +
    `overall is the whole catalog\npool: ${OUT_OF_FAMILY.join(' + ')}\n`,
);

const failures = [];
for (const arm of ARMS) {
  const fixture = JSON.parse(readFileSync(DIR + arm.file, 'utf8'));
  const pool = OUT_OF_FAMILY.flatMap((corpus) => fixture.perOutcome[corpus] ?? []);
  process.stdout.write(
    `\narm "${fixture.arm}" (${arm.file}) — ${arm.note}\n` +
      `  host ${fixture.host}, model ${String(fixture.model)}, ran ${fixture.modelsRan.join(', ')}, ` +
      `prompt ${fixture.promptFingerprint}, recorded ${fixture.recordedAt}\n` +
      `  ${String(pool.length)} outcomes, ${String(fixture.consultations)} consultations, ` +
      `${String(fixture.failures)} failed, ${String(fixture.repairs)} repaired\n`,
  );
  for (const { column, label, miss, over, inFrame } of arm.columns) {
    const overall = score(pool, column, 'overall');
    const framed = score(pool, column, 'in-frame');
    const missRate = rate(overall.missed, overall.expected);
    const overRate = rate(overall.over, overall.named);
    const inFrameRate = rate(framed.over, framed.named);
    const [ml, mh] = wilson(overall.missed, overall.expected);
    const [ol, oh] = wilson(overall.over, overall.named);
    const [fl, fh] = wilson(framed.over, framed.named);
    process.stdout.write(
      `  ${column.padEnd(2)} ${label}\n` +
        `      miss          ${missRate} (${String(overall.missed)}/${String(overall.expected)}) ` +
        `Wilson 95% [${ml.toFixed(3)}, ${mh.toFixed(3)}]  (same in both frames)\n` +
        `      over overall  ${overRate} (${String(overall.over)}/${String(overall.named)}) ` +
        `Wilson 95% [${ol.toFixed(3)}, ${oh.toFixed(3)}]\n` +
        `      over in-frame ${inFrameRate} (${String(framed.over)}/${String(framed.named)}) ` +
        `Wilson 95% [${fl.toFixed(3)}, ${fh.toFixed(3)}]\n`,
    );
    const where = `${fixture.arm} ${column}`;
    if (missRate !== miss) failures.push(`${where} miss: published ${miss}, fixture gives ${missRate}`);
    if (over !== null && overRate !== over) {
      failures.push(`${where} over overall: published ${over}, fixture gives ${overRate}`);
    }
    if (inFrame !== null && inFrameRate !== inFrame) {
      failures.push(`${where} over in-frame: published ${inFrame}, fixture gives ${inFrameRate}`);
    }
  }
}

if (!process.argv.includes('--expect')) process.exit(0);

if (failures.length > 0) {
  process.stderr.write(`\nscore-namer-arms: a published figure no longer comes out of its fixture.\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.stderr.write(
    '\nEither the fixture changed, or the figure quoted in README.md and ' +
      'RESEARCH-DECISIONS.md §10 and §24 is wrong. Both are decisions, not typos.\n',
  );
  process.exit(1);
}

process.stdout.write('\nscore-namer-arms: every published figure re-derives from its fixture\n');
