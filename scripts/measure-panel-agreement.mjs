#!/usr/bin/env node
/**
 * scripts/measure-panel-agreement.mjs — cross-family annotator agreement over
 * the expanded labeled corpus.
 *
 * WHY THIS EXISTS. Every agreement figure this project has quoted came from
 * coders of one model family, and the caveat attached to all of them — observed
 * agreement is an UPPER bound on independent agreement — was doing heavy
 * lifting nobody had measured. This script measures it: the same 72 outcomes,
 * labeled by coders from families that share no pretraining, with same-family
 * and cross-family pairs reported separately so the difference between them is
 * visible rather than assumed.
 *
 * It reuses `compute-alpha.mjs`'s bootstrap and `kernel/metrics/krippendorff.ts`
 * rather than reimplementing either — a second alpha in this repo would be the
 * drift commitment 16 exists to catch. What is new here is only the panel: who
 * coded, which family each belongs to, and which pairs cross a family line.
 *
 * TWO CAVEATS THAT MUST TRAVEL WITH EVERY NUMBER THIS PRINTS.
 *
 * 1. A LOW cross-family alpha is AMBIGUOUS. It cannot distinguish "the labeling
 *    task is genuinely ambiguous" — the thing being measured — from "this coder
 *    is worse at the task", which is a fact about the coder. A HIGH one is the
 *    informative direction. `code-sheet-with-model.mjs` states this asymmetry
 *    too; it is repeated because this is where the number gets quoted from.
 * 2. Every coder here is still an LLM, and web-scale pretraining overlaps across
 *    all of them. Cross-family is a WEAKER upper bound, not an unbiased
 *    estimate. The human annotation floor stays unmeasured until the stakeholder-verdict study runs.
 *
 *   node scripts/measure-panel-agreement.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { krippendorffAlpha, masiDistance, nominalSetDistance } from '../src/kernel/metrics/krippendorff.ts';
import { bootstrap } from './labeling-kit/compute-alpha.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PANEL_DIR = join(ROOT, 'scripts/labeling-kit/returned-panel');
const CORPUS = join(ROOT, 'tests/kernel/implication/fixtures/unspent-outcomes.json');
const TARGET = 0.15;

/**
 * The family a model belongs to, which is the only axis that matters here.
 * Tier is not family: two sizes from one vendor share pretraining and share
 * blind spots, so a panel of them measures one family agreeing with itself.
 */
function familyOf(model) {
  const id = String(model).toLowerCase();
  if (id.includes('/')) return id.split('/')[0]; // hosted: vendor is the prefix
  return id.split(/[:\-.]/)[0]; // local ollama tag
}

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));

// The two coders recorded in the corpus itself, at authoring time. They are the
// same family as each other and as the adjudicator — which is the fact this
// whole script exists to put a number on.
const coders = [
  {
    name: 'anthropic-1',
    family: 'anthropic',
    model: 'claude (corpus provenance)',
    labels: new Map(corpus.outcomes.map((o) => [o.id, o.provenance.coder1])),
  },
  {
    name: 'anthropic-2',
    family: 'anthropic',
    model: 'claude (corpus provenance)',
    labels: new Map(corpus.outcomes.map((o) => [o.id, o.provenance.coder2])),
  },
];

if (existsSync(PANEL_DIR)) {
  for (const file of readdirSync(PANEL_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const sheet = JSON.parse(readFileSync(join(PANEL_DIR, file), 'utf8'));
    const model = sheet.codedBy?.model ?? 'unknown';
    coders.push({
      name: file.replace(/^panel-|\.json$/g, ''),
      family: familyOf(model),
      model,
      via: sheet.codedBy?.via,
      labels: new Map(sheet.outcomes.map((o) => [o.id, o.labels])),
    });
  }
}

const families = new Set(coders.map((c) => c.family));
if (coders.length < 3 || families.size < 2) {
  console.log('Not enough of a panel to measure anything a single family did not already say.');
  console.log(`Coders: ${coders.length}, families: ${[...families].join(', ') || 'none'}`);
  console.log('Add at least one coder from a family that did not author the catalog:');
  console.log('  node scripts/labeling-kit/code-sheet-with-model.mjs panel-<name> <model> \\');
  console.log('    [--provider openrouter] --corpus tests/kernel/implication/fixtures/unspent-outcomes.json');
  process.exitCode = 1;
}

const observationsFor = (subset) =>
  subset.flatMap((c) => [...c.labels].map(([unit, value]) => ({ unit, coder: c.name, value: new Set(value) })));

const exactAgreement = (a, b) => {
  let same = 0;
  for (const [unit, value] of a.labels) {
    const other = b.labels.get(unit) ?? [];
    if ([...value].sort().join() === [...other].sort().join()) same += 1;
  }
  return same;
};

console.log('--- cross-family annotator agreement ---\n');
console.log(`Corpus: ${corpus.outcomes.length} outcomes (the measured half of the expanded labeled corpus)\n`);
console.log('  coder          family        model');
for (const c of coders) {
  console.log(`  ${c.name.padEnd(14)} ${c.family.padEnd(13)} ${c.model}${c.via ? ` (via ${c.via})` : ''}`);
}

console.log('\nPairwise agreement, same-family and cross-family separated:\n');
console.log('  pair                          alpha    exact      ');
for (let i = 0; i < coders.length; i += 1) {
  for (let j = i + 1; j < coders.length; j += 1) {
    const [a, b] = [coders[i], coders[j]];
    const alpha = krippendorffAlpha(observationsFor([a, b]), masiDistance).alpha;
    const kind = a.family === b.family ? `same family (${a.family})` : 'CROSS-FAMILY';
    console.log(
      `  ${`${a.name} x ${b.name}`.padEnd(29)} ${alpha.toFixed(4)}   ` +
        `${String(exactAgreement(a, b)).padStart(2)}/${corpus.outcomes.length}   ${kind}`,
    );
  }
}

const sameFamily = coders.filter((c) => c.family === 'anthropic');
// One coder per family: the slice with no same-family pair in it at all, which
// is the honest reading of what independent annotators would agree on.
const oneEach = [...new Map(coders.map((c) => [c.family, c])).values()];

const slices = [
  ['whole panel', coders],
  ['cross-family only (one coder per family)', oneEach],
  ['same family only', sameFamily],
].filter(([, subset]) => subset.length >= 2);

console.log('\nAgreement and the annotation floor it implies, by slice:\n');
console.log('  slice                                      alpha (MASI)   95% CI            floor 95% CI      P(floor < 0.15)');
for (const [label, subset] of slices) {
  const obs = observationsFor(subset);
  const point = krippendorffAlpha(obs, masiDistance);
  const boot = bootstrap(obs, TARGET, 4000);
  console.log(
    `  ${label.padEnd(42)} ${point.alpha.toFixed(4)}         ` +
      `[${boot.alphaLo.toFixed(3)}, ${boot.alphaHi.toFixed(3)}]    ` +
      `[${boot.floorLo.toFixed(3)}, ${boot.floorHi.toFixed(3)}]     ${boot.pBelowTarget.toFixed(3)}`,
  );
}

const nominalAll = krippendorffAlpha(observationsFor(coders), nominalSetDistance).alpha;
console.log(`\n  Whole panel, exact-match nominal alpha (no partial credit): ${nominalAll.toFixed(4)}`);

console.log(`
Reading this table. The floor is the rate at which the ground truth contradicts
itself; no classifier can be scored below it, so a target set beneath it is
unreachable by construction rather than merely hard. The project's target is
${TARGET}. Compare the same-family row against the cross-family row before quoting
either: if they disagree, the difference between them IS the correlated error
every earlier figure carried as an unmeasured caveat.

What this does NOT license, in either direction:
  - A low cross-family alpha does not prove the task is ambiguous. It is equally
    consistent with a coder that labels the task badly, and the two cannot be
    separated from agreement alone.
  - A floor above ${TARGET} does not excuse the map. Compare it against the miss rate
    in RESEARCH-DECISIONS.md section 1 before concluding anything: a miss rate far
    above the floor's upper bound is the map's problem whatever the floor is.
  - No slice here measures HUMAN agreement. Every coder is an LLM. The stakeholder-verdict study
    is the bead that lifts that, and it is not lifted.`);
