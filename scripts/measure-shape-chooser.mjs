/**
 * scripts/measure-shape-chooser.mjs — what the zero-model shape chooser gets
 * right on wording it was never tuned against.
 *
 * `shapeForOutcome` is the free path: with no host named, or when the host
 * call that would choose the shape fails, it is what picks the document a run
 * produces. It matches phrases. This script measures how often that pick is
 * the one the person asking meant, on a corpus authored by a mind that had
 * never read the matcher — the same discipline the implication corpora carry,
 * for the same reason: a phrase matcher scored on wording its own authors
 * imagined is scoring its memory, not its reach.
 *
 *   node scripts/measure-shape-chooser.mjs
 *   node scripts/measure-shape-chooser.mjs --record fixtures/shape-chooser/keywords.json
 *
 * Writes nothing unless --record names a file.
 *
 * One difference from the implication figures, and it is not cosmetic. Domain
 * inference is multi-label, so it carries a miss rate and an over rate that
 * move independently. A shape pick is single-label — exactly one shape comes
 * back, always — so there is one error rate and quoting a second would be
 * inventing a number. Every rate below is Wilson 95%, per the project's
 * reporting rule.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { formatRate } from '../src/kernel/metrics/intervals.ts';
import { DEFAULT_SHAPE, shapeForOutcome, shapeNames } from '../src/kernel/run/shapes.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = join(ROOT, 'tests/kernel/run/fixtures/shape-asks.json');

const args = process.argv.slice(2);
const recordAt = (() => {
  const flag = args.indexOf('--record');
  return flag === -1 ? null : args[flag + 1];
})();

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
const asks = corpus.asks;

const known = new Set(shapeNames());
for (const ask of asks) {
  if (!known.has(ask.shape)) {
    throw new Error(`corpus ask ${ask.id} is labeled "${ask.shape}", which is not a shape`);
  }
}

/** One row per ask: what was meant, what the matcher picked, whether it agreed. */
const scored = asks.map((ask) => {
  const chosen = shapeForOutcome(ask.ask).name;
  return {
    id: ask.id,
    ask: ask.ask,
    setting: ask.setting,
    avoidsGenreWord: ask.avoidsGenreWord === true,
    intended: ask.shape,
    chosen,
    missed: chosen !== ask.shape,
    // The default shape carries no phrase list of its own, so it is the one
    // answer the matcher can reach without matching anything. Returning it is
    // therefore silence — and the caller cannot tell that from a match.
    fellThrough: chosen === DEFAULT_SHAPE.name,
  };
});

const missed = scored.filter((row) => row.missed).length;

/** Rates over an arbitrary slice, so every cut below is computed one way. */
const rate = (rows) => formatRate(rows.filter((r) => r.missed).length, rows.length);

console.log(`corpus: ${asks.length} asks, ${corpus.authoring?.author ?? 'unknown author'}`);
console.log(`\noverall miss  ${rate(scored)}\n`);

console.log('by whether the ask names its genre outright');
const avoiding = scored.filter((r) => r.avoidsGenreWord);
const naming = scored.filter((r) => !r.avoidsGenreWord);
console.log(`  names the genre word    ${rate(naming)}`);
console.log(`  avoids the genre word   ${rate(avoiding)}`);

// The distinction the miss rate alone hides. `${DEFAULT_SHAPE.name}` has no
// signal list, so every ask that matched nothing is reported under that name
// rather than as the silence it is — and an ask that genuinely wanted that
// shape produces a byte-identical answer.
const fired = scored.filter((r) => !r.fellThrough);
const silent = scored.filter((r) => r.fellThrough);
console.log('\nhow often the phrase lists fire at all');
console.log(`  matched a phrase        ${formatRate(fired.length, scored.length)}`);
console.log(`  matched nothing         ${formatRate(silent.length, scored.length)}`);
console.log(`  wrong when it fired     ${rate(fired)}`);
console.log(
  `  of the ${String(silent.length)} that matched nothing, ${String(silent.filter((r) => !r.missed).length)} genuinely wanted ${DEFAULT_SHAPE.name} and are indistinguishable from the rest`,
);

console.log('\nby intended shape');
for (const name of shapeNames()) {
  const rows = scored.filter((r) => r.intended === name);
  if (rows.length === 0) continue;
  console.log(`  ${name.padEnd(9)} ${rate(rows)}`);
}

console.log('\nwhat it picked instead (intended -> picked, misses only)');
const confusion = new Map();
for (const row of scored) {
  if (!row.missed) continue;
  const key = `${row.intended} -> ${row.chosen}`;
  confusion.set(key, (confusion.get(key) ?? 0) + 1);
}
for (const [pair, count] of [...confusion.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pair.padEnd(24)} ${String(count)}`);
}

console.log('\nmisses, in full');
for (const row of scored.filter((r) => r.missed)) {
  console.log(`  [${String(row.id).padStart(2)}] meant ${row.intended}, picked ${row.chosen}`);
  console.log(`       ${row.ask}`);
}

if (recordAt) {
  const path = join(ROOT, recordAt);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        measured: new Date().toISOString().slice(0, 10),
        corpus: 'tests/kernel/run/fixtures/shape-asks.json',
        arm: 'keywords',
        missed,
        scored: scored.length,
        rows: scored,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nrecorded to ${recordAt}`);
}
