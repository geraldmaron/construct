#!/usr/bin/env node
/**
 * scripts/labeling-kit/compute-alpha.mjs — Krippendorff's alpha and the
 * implied Bayes error floor, over REAL returned coder sheets
 *.
 *
 * Reads every *.json file in scripts/labeling-kit/returned/ (one per coder,
 * the CODER-INSTRUCTIONS.md-filled copy of what generate-sheets.mjs
 * produced), computes Krippendorff's alpha over the labels the coders
 * actually wrote, derives the implied Bayes error floor from the observed
 * disagreement, and states whether the project's 0.15 miss target sits above
 * or below that floor.
 *
 * THIS SCRIPT DOES NOT FABRICATE INPUT. If scripts/labeling-kit/returned/ is
 * empty or has fewer than 2 coder files, it prints what is missing and exits
 * — it will not synthesize a demo alpha from placeholder or model-written
 * labels. See CODER-INSTRUCTIONS.md and CLAUDE.md: no agent may produce
 * labels for this study.
 *
 * Usage (once real coder sheets exist):
 *   node scripts/labeling-kit/compute-alpha.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { krippendorffAlpha, masiDistance, nominalSetDistance } from '../../src/kernel/metrics/krippendorff.ts';
import { DOMAINS } from '../../src/kernel/implication/domains.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RETURNED_DIR = join(ROOT, 'scripts/labeling-kit/returned');
const TARGET = 0.15;
const VALID_DOMAINS = new Set(DOMAINS.map((d) => d.domain));

function loadReturnedSheets() {
  if (!existsSync(RETURNED_DIR)) return [];
  return readdirSync(RETURNED_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json' && !f.startsWith('.'))
    .map((f) => ({ coder: f.replace(/\.json$/, ''), path: join(RETURNED_DIR, f) }));
}

function validateLabels(coder, id, labels) {
  if (!Array.isArray(labels)) {
    throw new Error(`${coder}: outcome ${id} has non-array labels (${JSON.stringify(labels)}) — every outcome must be [] or an array of domain names, never null`);
  }
  for (const label of labels) {
    if (!VALID_DOMAINS.has(label)) {
      throw new Error(`${coder}: outcome ${id} has unknown domain "${label}" — must be one of: ${[...VALID_DOMAINS].join(', ')}`);
    }
  }
}

function loadObservations(files) {
  const observations = [];
  for (const { coder, path } of files) {
    const sheet = JSON.parse(readFileSync(path, 'utf8'));
    for (const o of sheet.outcomes) {
      validateLabels(coder, o.id, o.labels);
      observations.push({ unit: o.id, coder, value: new Set(o.labels) });
    }
  }
  return observations;
}

/**
 * Derive the implied Bayes error floor from observed disagreement Do, under
 * an explicit, stated model: each coder is treated as an independent noisy
 * channel that disagrees with the (unknown) ground truth with probability e.
 * Under that model, the probability two independent coders disagree with
 * EACH OTHER is D = 2e(1-e) (they can differ either because exactly one of
 * them erred, in either direction). Solving for e:
 *
 *   e = (1 - sqrt(1 - 2D)) / 2,   valid only for D <= 0.5
 *
 * This is a standard two-rater noisy-channel bound, not a Krippendorff
 * primitive — Krippendorff's alpha itself does not define a Bayes error
 * floor, and treating this derivation as anything more than a labeled
 * modeling assumption would be exactly the "confident wrong answer"
 * commitment 15 forbids. It is reported with the assumption stated inline,
 * not as a bare number.
 *
 * If D > 0.5, the model is inapplicable (disagreement exceeds what two
 * independent binary-error channels can produce) and no floor is derived —
 * this is reported explicitly as an ambiguity, not silently clamped.
 */
function bayesFloorFromDisagreement(Do) {
  if (Do > 0.5) return null;
  return (1 - Math.sqrt(1 - 2 * Do)) / 2;
}

/**
 * Resample the study to get widths on alpha and the floor.
 *
 * THE UNIT IS THE OUTCOME, not the coder-outcome pair. What varies between
 * hypothetical repeats of this study is which outcomes were drawn, not which
 * coders looked at them — resampling pairs independently would break the
 * pairing alpha is computed over and understate the width.
 *
 * Why this exists at all: at n=34 the point floor and the target sit close
 * enough that a bare above/below is a coin-flip dressed as a finding. The first
 * real run put the point floor at 0.1235 against a 0.15 target and the interval
 * straddled it — the verdict and the interval disagreed. Reporting the point
 * alone would be the defect construct-2jb.2 withdrew claims for across this
 * project, committed by the instrument that decides whether the project's
 * headline target is reachable at all.
 *
 * Deterministic by construction: a fixed seed, so re-running the script on the
 * same sheets reproduces the same interval. A measurement that moves when
 * nobody changed anything cannot be audited.
 */
export function bootstrap(observations, target, resamples = 4000) {
  const units = [...new Set(observations.map((o) => o.unit))];
  const byUnit = new Map(units.map((u) => [u, observations.filter((o) => o.unit === u)]));

  let seed = 20260805;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const alphas = [];
  const floors = [];
  let belowTarget = 0;
  for (let i = 0; i < resamples; i += 1) {
    const drawn = [];
    for (let k = 0; k < units.length; k += 1) {
      const unit = units[Math.floor(next() * units.length)];
      // Re-key so the same outcome drawn twice counts as two units rather than
      // collapsing into one.
      for (const o of byUnit.get(unit)) drawn.push({ ...o, unit: `${o.unit}#${String(k)}` });
    }
    const r = krippendorffAlpha(drawn, masiDistance);

    // Alpha and the floor fail independently, and conflating them biases the
    // interval. A resample where every coder agreed has De = 0, so alpha is
    // undefined (Krippendorff's own guidance — a corpus with zero variance says
    // nothing about reliability) — but its floor is not undefined, it is
    // exactly 0, and dropping those resamples would silently push the floor's
    // lower bound up and make the study look more pessimistic than it is.
    if (Number.isFinite(r.alpha)) alphas.push(r.alpha);

    const f = bayesFloorFromDisagreement(r.Do);
    if (f === null) continue;
    floors.push(f);
    if (f < target) belowTarget += 1;
  }

  const quantile = (arr, p) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(p * (sorted.length - 1))];
  };
  return {
    resamples: floors.length,
    alphaResamples: alphas.length,
    alphaLo: quantile(alphas, 0.025),
    alphaHi: quantile(alphas, 0.975),
    floorLo: quantile(floors, 0.025),
    floorHi: quantile(floors, 0.975),
    pBelowTarget: floors.length > 0 ? belowTarget / floors.length : null,
  };
}

function main() {
  const files = loadReturnedSheets();
  if (files.length < 2) {
    console.log('--- construct-2jb.3: multi-coder agreement ---');
    console.log(`Found ${files.length} file(s) in scripts/labeling-kit/returned/.`);
    console.log('Need >= 2 independent coders\' filled-in sheets before alpha means anything.');
    console.log('');
    console.log('This script will not proceed with fewer than 2 real coder files, and will');
    console.log('never fabricate labels to fill the gap. Ask Gerald to drop the completed');
    console.log('sheets (see CODER-INSTRUCTIONS.md) into scripts/labeling-kit/returned/,');
    console.log('named <coder-name>.json, then re-run this script.');
    process.exitCode = 1;
    return;
  }

  let observations;
  try {
    observations = loadObservations(files);
  } catch (err) {
    console.error(`Invalid returned sheet: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const unitCount = new Set(observations.map((o) => o.unit)).size;

  console.log('--- construct-2jb.3: multi-coder agreement ---');
  console.log(`Coders: ${files.map((f) => f.coder).join(', ')}`);
  console.log(`Distinct outcomes seen: ${unitCount}`);
  if (unitCount < 30) {
    console.log(`WARNING: acceptance criteria call for >= 30 outcomes; only ${unitCount} distinct outcome ids were found across returned sheets.`);
  }
  console.log('');

  const masi = krippendorffAlpha(observations, masiDistance);
  const nominal = krippendorffAlpha(observations, nominalSetDistance);

  console.log('Krippendorff\'s alpha (MASI distance — the multi-label metric; primary result):');
  console.log(`  alpha = ${masi.alpha.toFixed(4)}  (n=${masi.n} pairable values, ${masi.unitsUsed} units, Do=${masi.Do.toFixed(4)}, De=${masi.De.toFixed(4)})`);
  console.log('');
  console.log('Krippendorff\'s alpha (exact-match nominal distance — set-must-match-exactly, for reference):');
  console.log(`  alpha = ${nominal.alpha.toFixed(4)}  (n=${nominal.n} pairable values, ${nominal.unitsUsed} units, Do=${nominal.Do.toFixed(4)}, De=${nominal.De.toFixed(4)})`);
  console.log('');

  const floor = bayesFloorFromDisagreement(masi.Do);
  if (floor === null) {
    console.log(`Observed disagreement Do=${masi.Do.toFixed(4)} exceeds 0.5 — the two-independent-noisy-coder`);
    console.log('model this floor derivation assumes does not apply. No floor is derived; this');
    console.log('is reported as a genuine ambiguity, not resolved by guessing.');
    process.exitCode = 2;
    return;
  }

  console.log('Implied Bayes error floor (derived from observed disagreement Do under the');
  console.log('MASI metric, assuming each coder is an independent noisy channel around one');
  console.log('ground truth — see the comment in this file for the exact model and its limits):');
  console.log(`  floor = ${floor.toFixed(4)}`);
  console.log('');

  const boot = bootstrap(observations, TARGET);
  console.log(`Bootstrap over units (${boot.resamples} resamples, fixed seed — the outcome is the`);
  console.log('resampling unit, because the outcome is what varies between repeats of this study):');
  console.log(`  alpha 95% CI = [${boot.alphaLo.toFixed(4)}, ${boot.alphaHi.toFixed(4)}]`);
  console.log(`  floor 95% CI = [${boot.floorLo.toFixed(4)}, ${boot.floorHi.toFixed(4)}]`);
  console.log('');

  // The verdict is stated as the resamples license it. A bare above/below on a
  // point estimate is the defect construct-eib was filed for: at these sample
  // sizes the interval routinely straddles the target, and resolving that by
  // point estimate manufactures a finding.
  const straddles = boot.floorLo <= TARGET && TARGET <= boot.floorHi;
  const pct = boot.pBelowTarget === null ? null : (boot.pBelowTarget * 100).toFixed(1);

  if (straddles) {
    console.log(`VERDICT: UNSETTLED. The floor's 95% interval CONTAINS the ${TARGET} target.`);
    console.log(`The floor sits below ${TARGET} in ${pct}% of resamples — probable, not demonstrated.`);
    console.log(`Defensible: "the floor is probably but not demonstrably below ${TARGET}".`);
    console.log(`NOT defensible: "the ${TARGET} target is above the floor" — that is this point`);
    console.log('estimate reported in a register its sample size cannot support.');
    console.log('Narrowing it takes more units, not more resamples.');
  } else if (TARGET < boot.floorLo) {
    console.log(`VERDICT: the ${TARGET} target is BELOW the implied floor, and the interval agrees`);
    console.log(`(floor 95% CI [${boot.floorLo.toFixed(4)}, ${boot.floorHi.toFixed(4)}] excludes it).`);
    console.log('No classifier can be scored below the rate at which the ground truth itself');
    console.log('disagrees with itself. The target is unreachable by construction under this model.');
  } else {
    console.log(`VERDICT: the ${TARGET} target is ABOVE the implied floor, and the interval agrees`);
    console.log(`(floor 95% CI [${boot.floorLo.toFixed(4)}, ${boot.floorHi.toFixed(4)}] excludes it).`);
    console.log(`The floor sits below ${TARGET} in ${pct}% of resamples.`);
    console.log('The target is not ruled out by annotator disagreement under this model.');
  }
  console.log('');
  console.log('CAVEAT, carried with every number above: these coders are what they are. If any');
  console.log('of them is a model, observed alpha is an UPPER bound on true independent');
  console.log('agreement and the floor a LOWER bound — correlated training, correlated errors.');
}

export function verdictFor(boot, target) {
  if (boot.floorLo <= target && target <= boot.floorHi) return 'unsettled';
  return target < boot.floorLo ? 'target-below-floor' : 'target-above-floor';
}

// Only when run as a script. Importing this file (a test does) must not execute
// the study or exit the process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
