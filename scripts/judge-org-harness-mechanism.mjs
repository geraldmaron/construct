#!/usr/bin/env node
/**
 * judge-org-harness-mechanism.mjs — decide whether a claim that satisfied a
 * plant's terms actually states that plant's mechanism.
 *
 * The structural scorer credits a plant when one claim cites both planted
 * documents and matches an AND-set of terms. That is cheap, reproducible, and
 * blind to the one thing the credit is supposed to mean. Where a document pair
 * supports two mechanisms, both are written in the same vocabulary because they
 * are about the same feature, so a claim about the neighbour satisfies the
 * terms and takes the credit. The failure runs both ways: a correct claim in
 * unanticipated words scores a miss, and a wrong-mechanism claim in the
 * anticipated words scores a hit.
 *
 * Terms cannot fix this, and that is measured rather than assumed. Across the
 * corpus no plant has every term met by a high-frequency alternative, so a
 * distinctiveness threshold cannot separate the cases; and narrowing terms
 * after seeing a run is editing a key to fit results, which is the mirror of
 * the widening this harness already refuses.
 *
 * What separates them is whether the claim states the planted causal chain,
 * which is a judgment. So it is judged, and the judgment is recorded as a
 * judgment: named model, verdict per plant, kept beside the structural score
 * rather than folded into it. Recorded scores are never regenerated — this adds
 * a column, the same way the distractor gate was added.
 *
 * The judge is given each plant's `gist`, which was committed before any run
 * and has never been read by the scorer. Judging against it is therefore not
 * editing a key to fit results: the standard was fixed in advance and is only
 * now being applied.
 *
 * Correlated error travels with these numbers. When the judging model shares a
 * family with the model that produced the run, agreement is an upper bound on
 * what independent judges would reach, and any figure quoted from a judged file
 * carries that qualification.
 *
 * Usage:
 *   node scripts/judge-org-harness-mechanism.mjs --emit <run.score.json>
 *   node scripts/judge-org-harness-mechanism.mjs --apply <run.score.json> \
 *     --verdicts <verdicts.json> --judge <model-name>
 *
 * The verdicts file is `{ "<plant-id>": { "statesMechanism": bool, "why": "..." } }`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const emitPath = arg('--emit');
const applyPath = arg('--apply');
const verdictsPath = arg('--verdicts');
const judge = arg('--judge');
const harnessDir = arg('--harness', join('fixtures', 'org-harness'));

if (!emitPath && !applyPath) {
  console.error(
    'usage: judge-org-harness-mechanism.mjs --emit <score.json>\n' +
      '   or: judge-org-harness-mechanism.mjs --apply <score.json> --verdicts <file> --judge <model>',
  );
  process.exit(2);
}

const key = JSON.parse(readFileSync(join(harnessDir, 'answer-key.json'), 'utf8'));

/** Every plant the key defines, by id, with the gist committed before any run. */
function gists() {
  const byId = new Map();
  for (const section of ['crossReferences', 'conflicts', 'risks']) {
    for (const item of key[section] ?? []) byId.set(item.id, item.gist);
  }
  for (const item of key.roleFindings?.findings ?? []) {
    // A retired plant keeps its entry so old scores stay readable, but it is
    // not a standard anything is judged against today.
    if (!item.retired) byId.set(item.id, item.gist);
  }
  return byId;
}

/** Plants this score file credited, paired with the claim that earned each. */
function creditedPlants(score) {
  const out = [];
  const visit = (entries) => {
    for (const p of entries ?? []) {
      if (p.found && p.by?.claim) out.push({ id: p.id, claim: p.by.claim, citations: p.by.citations ?? [] });
    }
  };
  visit(score.rung1?.plants);
  visit(score.rung2?.plants);
  visit(score.rung3?.conflicts);
  for (const entries of Object.values(score.roleCoverage ?? {})) visit(entries);
  // One claim can be credited for two plants; each is judged on its own terms.
  const seen = new Set();
  return out.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

const score = JSON.parse(readFileSync(emitPath ?? applyPath, 'utf8'));
const credited = creditedPlants(score);
const gistById = gists();

if (emitPath) {
  const items = credited.map((p) => ({
    plant: p.id,
    plantedMechanism: gistById.get(p.id) ?? '(no gist recorded)',
    claimUnderJudgment: p.claim,
  }));
  process.stdout.write(
    `You are judging whether each claim states a specific planted mechanism.

For each item below you are given two things: the mechanism that was planted
(written down before any of these claims existed) and one claim that matched the
planted documents and vocabulary. Decide ONE question per item:

  Does the claim state the planted mechanism's causal chain?

Say true only when the claim asserts substantially the same mechanism: the same
cause producing the same effect by the same route. Say false when the claim is
about a different mechanism that happens to involve the same documents, the same
feature, or the same words. A claim can be entirely correct about the
organization and still be false here, because the question is not whether the
claim is right but whether it is THIS finding. Sharing a topic is not sharing a
mechanism. When you are genuinely unsure, answer false.

Return only a JSON object, no prose, in this shape:

{ "<plant id>": { "statesMechanism": true|false, "why": "<one sentence>" } }

Items:

${JSON.stringify(items, null, 1)}
`,
  );
  process.exit(0);
}

if (!verdictsPath || !judge) {
  console.error('--apply needs --verdicts <file> and --judge <model-name>');
  process.exit(2);
}

const verdicts = JSON.parse(readFileSync(verdictsPath, 'utf8'));
const results = credited.map((p) => {
  const v = verdicts[p.id];
  return {
    plant: p.id,
    structuralFound: true,
    // A plant nobody judged is unjudged, never assumed correct. Silence is not
    // compliance here either.
    statesMechanism: v ? v.statesMechanism === true : null,
    why: v?.why ?? null,
  };
});

const falseCredits = results.filter((r) => r.statesMechanism === false);
const out = {
  judgedBy: judge,
  judgedFrom: emitPath ?? applyPath,
  standard:
    "each plant's gist as committed before any run; the scorer has never read these gists, " +
    'so the standard was fixed in advance rather than fitted to results',
  correlatedError:
    'if the judging model shares a family with the model that produced the run, observed ' +
    'agreement is an upper bound on what independent judges would reach',
  results,
  falseCredits: falseCredits.map((r) => r.plant),
};

const base = (applyPath ?? '').replace(/\.score\.json$/, '');
const dest = `${base}.judged.json`;
writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`);
console.log(
  `judged: ${dest} — ${results.length} credited plant(s), ` +
    `${falseCredits.length} false credit(s)${falseCredits.length > 0 ? `: ${falseCredits.map((r) => r.plant).join(', ')}` : ''}`,
);
