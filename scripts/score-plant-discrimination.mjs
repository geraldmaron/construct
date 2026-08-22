#!/usr/bin/env node
/**
 * score-plant-discrimination.mjs — re-derive the headline of the retired depth
 * claim from the recorded discrimination matrices.
 *
 * This project's most consequential finding is a retraction: role packs do not
 * reach measurable "depth", because a planted finding one lens owns is reached
 * by other lenses just as often, on two independently built fixture
 * organizations. README, STRATEGY.md (Phase 4) and RESEARCH-DECISIONS.md §14
 * all state the same headline — zero of ten plants isolate on the broad
 * corpus, one of ten on the original — and the numbers behind it are already
 * computed and committed as
 * `fixtures/org-harness-broad/runs/2026-08-10-broad-sweep.judged-discrimination.json`
 * and `fixtures/org-harness/runs/2026-08-10-narrow-sweep.judged-discrimination.json`,
 * the output of `check-plant-discrimination.mjs --judged`. Nothing compared
 * those committed files back to the sentence three documents quote from them.
 *
 * This reads the two files, tallies verdicts, and with `--expect` fails when
 * a published figure no longer comes out of them.
 *
 * `node scripts/score-plant-discrimination.mjs [--expect]`
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const OWNER_LENS = new Map([
  ['pm', 'product'],
  ['tpm', 'program'],
]);
const lensOf = (owner) => OWNER_LENS.get(owner) ?? owner;

/**
 * The two sweeps README/STRATEGY/§14 quote, each with the published tallies:
 * how many plants the owning lens found (regardless of collisions), how many
 * were established as discriminating (owner found it, nobody else did), and
 * how many no lens found at all.
 */
const SWEEPS = [
  {
    file: fileURLToPath(
      new URL(
        '../fixtures/org-harness-broad/runs/2026-08-10-broad-sweep.judged-discrimination.json',
        import.meta.url,
      ),
    ),
    label: 'broad corpus (org-harness-broad)',
    ownerFound: 1,
    discriminating: 0,
    missedByAll: 6,
  },
  {
    file: fileURLToPath(
      new URL('../fixtures/org-harness/runs/2026-08-10-narrow-sweep.judged-discrimination.json', import.meta.url),
    ),
    label: 'original corpus (org-harness)',
    ownerFound: 5,
    discriminating: 1,
    missedByAll: 4,
  },
];

const failures = [];

for (const sweep of SWEEPS) {
  const doc = JSON.parse(readFileSync(sweep.file, 'utf8'));
  if (doc.lensesMissing.length > 0) {
    failures.push(`${sweep.label}: sweep incomplete (missing ${doc.lensesMissing.join(', ')}), cannot score`);
    continue;
  }

  let ownerFound = 0;
  let discriminating = 0;
  let missedByAll = 0;
  const discriminatingPlants = [];
  for (const r of doc.results) {
    const owner = lensOf(r.owner);
    if (r.earnedBy.includes(owner)) ownerFound++;
    if (r.verdict === 'discriminating') {
      discriminating++;
      discriminatingPlants.push(`${r.plant} (${owner})`);
    }
    if (r.verdict === 'missed') missedByAll++;
  }

  process.stdout.write(
    `${sweep.label} — suite "${doc.suite}", ${String(doc.lensesTested.length)} lenses swept, ${String(doc.results.length)} plants\n` +
      `    owner lens found its own plant: ${String(ownerFound)}/${String(doc.results.length)}\n` +
      `    established as discriminating: ${String(discriminating)}/${String(doc.results.length)}` +
      (discriminatingPlants.length > 0 ? ` (${discriminatingPlants.join(', ')})` : '') +
      `\n` +
      `    found by no lens at all: ${String(missedByAll)}/${String(doc.results.length)}\n\n`,
  );

  if (ownerFound !== sweep.ownerFound) {
    failures.push(`${sweep.label} owner-found: published ${String(sweep.ownerFound)}, fixture gives ${String(ownerFound)}`);
  }
  if (discriminating !== sweep.discriminating) {
    failures.push(
      `${sweep.label} discriminating: published ${String(sweep.discriminating)}, fixture gives ${String(discriminating)}`,
    );
  }
  if (missedByAll !== sweep.missedByAll) {
    failures.push(
      `${sweep.label} missed-by-all: published ${String(sweep.missedByAll)}, fixture gives ${String(missedByAll)}`,
    );
  }
}

if (!process.argv.includes('--expect')) process.exit(0);

if (failures.length > 0) {
  process.stderr.write(`\nscore-plant-discrimination: a published figure no longer comes out of its fixture.\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.stderr.write(
    '\nEither a discrimination matrix changed, or the retraction headline in README.md, ' +
      "STRATEGY.md Phase 4, and RESEARCH-DECISIONS.md §14 is wrong. Both are decisions, not typos.\n",
  );
  process.exit(1);
}

process.stdout.write('score-plant-discrimination: every published figure re-derives from its fixtures\n');
