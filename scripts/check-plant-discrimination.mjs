#!/usr/bin/env node
/**
 * check-plant-discrimination.mjs — decide which role plants actually measure
 * the lens that owns them.
 *
 * The per-run scorer credits a role plant whenever some claim in the run
 * matches its document pair and keyword sets. That is the right rule for one
 * run and the wrong rule for a depth claim: a plant every lens stumbles into
 * measures how much of the corpus a run swept, not whether the owning lens saw
 * something the others could not. A run that produces twenty claims collects
 * other roles' plants on the way past.
 *
 * Discrimination is therefore a property of a SWEEP, not of a run: hold the
 * corpus and the family fixed, dispatch every lens once, and ask of each plant
 * which lenses earned it. A plant is discriminating when its owner earns it and
 * no one else does. Anything else is a plant that cannot support the sentence
 * "this lens reaches depth", whichever way its own run scored.
 *
 * A failing plant is retired, not re-keyed. Keywords are a proxy for stating a
 * mechanism, so tightening them to exclude the lenses that collided moves the
 * coincidence rather than removing it — and tightening after seeing the runs is
 * editing a key to fit results, which this harness does not do.
 *
 * The matrix is built from the recorded .score.json artifacts rather than by
 * re-matching claims here. The scorer stays the single implementation of what
 * "earned" means; a second copy in this file could drift from it silently and
 * would then disagree with the artifacts a reader holds.
 *
 * Usage:
 *   node scripts/check-plant-discrimination.mjs --suite <label> [--runs <dir>] [--json]
 *
 * A suite is one sweep: the score files named `<prefix>-<lens>-<label>.score.json`
 * under the runs directory, one per lens. Missing lenses are reported rather
 * than assumed clean — a plant no sweep tested is unmeasured, not passing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { LENSES } from '../src/kernel/plan/lenses.ts';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const suite = arg('--suite');
const runsDir = arg('--runs', join('fixtures', 'org-harness', 'runs'));
const jsonMode = args.includes('--json');

if (!suite) {
  console.error('usage: check-plant-discrimination.mjs --suite <label> [--runs <dir>] [--json]');
  process.exit(2);
}

const lensNames = LENSES.map((l) => l.lens);

/**
 * The answer key names two roles by the job title they were written under,
 * while the lenses are named for the concern. The alias is recorded here rather
 * than resolved by renaming the key, because renaming a key entry after runs
 * have been scored against it edits the record. A plant whose owner resolves to
 * no lens is reported untested, never assumed clean.
 */
const OWNER_LENS = new Map([
  ['pm', 'product'],
  ['tpm', 'program'],
]);
const lensOf = (owner) => OWNER_LENS.get(owner) ?? owner;

/** The score file for one lens in this suite, or null when the sweep skipped it. */
function scoreFor(lens) {
  const suffix = `-${lens}-${suite}.score.json`;
  const match = readdirSync(runsDir).find((f) => f.endsWith(suffix));
  return match ? JSON.parse(readFileSync(join(runsDir, match), 'utf8')) : null;
}

const scores = new Map();
const missing = [];
for (const lens of lensNames) {
  const score = scoreFor(lens);
  if (score) scores.set(lens, score);
  else missing.push(lens);
}

if (scores.size === 0) {
  console.error(`no score files found for suite "${suite}" under ${runsDir}`);
  process.exit(2);
}

/**
 * Owner is read from the runs rather than from the key: every score file
 * carries the same roleCoverage shape, so the first one tells us which role
 * owns which plant without this script reading the answer key at all.
 */
const owners = new Map();
for (const score of scores.values()) {
  for (const [role, plants] of Object.entries(score.roleCoverage ?? {})) {
    for (const plant of plants) if (!owners.has(plant.id)) owners.set(plant.id, role);
  }
}

const results = [];
for (const [plantId, owner] of owners) {
  const earnedBy = [];
  for (const [lens, score] of scores) {
    const plants = Object.values(score.roleCoverage ?? {}).flat();
    if (plants.some((p) => p.id === plantId && p.found)) earnedBy.push(lens);
  }
  const ownerLens = lensOf(owner);
  const ownerTested = scores.has(ownerLens);
  const ownerEarned = earnedBy.includes(ownerLens);
  const foreign = earnedBy.filter((l) => l !== ownerLens);
  // A partial sweep can prove a collision but never the absence of one: the
  // lens that would have earned the plant may simply not have run. So a clean
  // result on an incomplete sweep is inconclusive, not a pass — otherwise
  // sweeping two lenses would be the cheapest way to declare depth.
  const sweepComplete = missing.length === 0;
  const verdict = !ownerTested
    ? 'untested'
    : foreign.length > 0
      ? 'not-discriminating'
      : !ownerEarned
        ? 'missed'
        : sweepComplete
          ? 'discriminating'
          : 'inconclusive-partial-sweep';
  results.push({ plant: plantId, owner, verdict, earnedBy, foreignEarners: foreign });
}

results.sort((a, b) => a.plant.localeCompare(b.plant));
const failing = results.filter((r) => r.verdict === 'not-discriminating');

if (jsonMode) {
  console.log(JSON.stringify({ suite, lensesTested: [...scores.keys()], lensesMissing: missing, results }, null, 1));
} else {
  console.log(`suite: ${suite} — ${scores.size}/${lensNames.length} lenses swept`);
  if (missing.length > 0) console.log(`lenses not swept (their plants are untested, not passing): ${missing.join(', ')}`);
  console.log('');
  for (const r of results) {
    const detail = r.foreignEarners.length > 0 ? ` — also earned by: ${r.foreignEarners.join(', ')}` : '';
    console.log(`${r.plant.padEnd(5)} owner=${r.owner.padEnd(12)} ${r.verdict}${detail}`);
  }
  console.log('');
  const discriminating = results.filter((r) => r.verdict === 'discriminating');
  console.log(
    failing.length === 0
      ? 'no collisions observed in this sweep'
      : `${failing.length} plant(s) are not lens-discriminating and cannot support a depth claim: ${failing.map((r) => r.plant).join(', ')}`,
  );
  console.log(
    missing.length === 0
      ? `${discriminating.length}/${results.length} plant(s) are established as lens-discriminating: ${discriminating.map((r) => r.plant).join(', ') || 'none'}`
      : 'this sweep is incomplete, so no plant is established as discriminating by it',
  );
}

process.exit(failing.length === 0 ? 0 : 1);
