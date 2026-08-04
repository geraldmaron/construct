#!/usr/bin/env node
/**
 * scripts/labeling-kit/compute-alpha.mjs — Krippendorff's alpha and the
 * implied Bayes error floor, over REAL returned coder sheets
 * (construct-2jb.3).
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
import { fileURLToPath } from 'node:url';
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

  if (TARGET < floor) {
    console.log(`VERDICT: the 0.15 target is BELOW the implied floor (${floor.toFixed(4)}).`);
    console.log('No classifier can be scored below the rate at which the ground truth itself');
    console.log('disagrees with itself. The target is unreachable by construction under this model.');
  } else {
    console.log(`VERDICT: the 0.15 target is ABOVE the implied floor (${floor.toFixed(4)}).`);
    console.log('The target is not ruled out by annotator disagreement under this model.');
  }
}

main();
