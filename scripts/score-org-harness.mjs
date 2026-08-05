#!/usr/bin/env node
/**
 * score-org-harness.mjs — score a grounded-synthesis run against the fixture
 * organization's recorded answer key.
 *
 * The corpus under fixtures/org-harness/corpus is handed to the system under
 * test; the answer key was recorded before any run and is never edited to fit
 * one. This scorer is deliberately structural: keyword sets and document pairs,
 * not judgment. Gerald reviews the scored output in place of an external
 * tester; the scorer's job is to make that review cheap and honest, not to
 * replace it.
 *
 * Usage:
 *   node scripts/score-org-harness.mjs <run-output.json> [--harness <dir>] [--json]
 *
 * Run-output shape (produced by the host running the harness scenario):
 *   {
 *     "claims": [ { "kind": "cross-reference"|"conflict"|"risk",
 *                   "claim": "...", "citations": ["tickets/T-26443.md", ...] } ],
 *     "notesDrop": {
 *       "proposals": [ { "target": "tickets/T-26271.md", "change": "...", "citedLine": "..." } ],
 *       "deltas":    [ { "body": "...", "citedLine": "..." } ]
 *     }
 *   }
 * Citations are corpus-relative paths; an optional #L<n> suffix is ignored.
 * Each rung gate is PASS/FAIL; the process exits non-zero if any rung fails.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const harnessIdx = args.indexOf('--harness');
const harnessDir =
  harnessIdx >= 0 ? args[harnessIdx + 1] : join('fixtures', 'org-harness');
const runPath = args.find(
  (a, i) => !a.startsWith('--') && (harnessIdx < 0 || i !== harnessIdx + 1),
);

if (!runPath) {
  console.error('usage: score-org-harness.mjs <run-output.json> [--harness <dir>] [--json]');
  process.exit(2);
}

const key = JSON.parse(readFileSync(join(harnessDir, 'answer-key.json'), 'utf8'));
const run = JSON.parse(readFileSync(runPath, 'utf8'));
const corpusRoot = join(harnessDir, key.corpusRoot);

/** Every document the corpus actually contains, corpus-relative. */
function listDocuments(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listDocuments(full));
    else out.push(relative(corpusRoot, full));
  }
  return out;
}
if (!existsSync(corpusRoot)) {
  console.error(`corpus not found at ${corpusRoot}`);
  process.exit(2);
}
const documents = new Set(listDocuments(corpusRoot));

const normalizeCitation = (c) => String(c).replace(/#L\d+.*$/, '').trim();
const lower = (s) => String(s ?? '').toLowerCase();

/**
 * Collapse case, camelCase, and separators before matching, so that a claim
 * written "destinationServiceAccounts" satisfies the term "service account".
 * The collapse also joins adjacent words, which can in principle match a term
 * across a word boundary; that looseness is accepted — the plants' terms are
 * multi-word enough that the false-positive class is smaller than the
 * vocabulary-artifact class this removes.
 */
const collapse = (s) => lower(s).replace(/[^a-z0-9]+/g, '');

/** AND of terms; a term is OR of |-separated case/separator-insensitive substrings. */
function matchesKeywords(text, keywords) {
  const t = collapse(text);
  return keywords.every((term) => term.split('|').some((alt) => t.includes(collapse(alt))));
}

const claims = Array.isArray(run.claims) ? run.claims : [];
const proposals = run.notesDrop?.proposals ?? [];
const deltas = run.notesDrop?.deltas ?? [];

/** A planted item is found if some claim cites both documents and matches keywords. */
function findPlant(plant) {
  return claims.find((c) => {
    const cited = new Set((c.citations ?? []).map(normalizeCitation));
    return (
      plant.documents.every((d) => cited.has(d)) &&
      matchesKeywords(c.claim, plant.keywords)
    );
  });
}

// ---- rung 0: provenance validity --------------------------------------------
const fabricated = [];
const uncited = [];
for (const c of claims) {
  const cited = (c.citations ?? []).map(normalizeCitation);
  if (cited.length === 0) uncited.push(c.claim);
  for (const d of cited) if (!documents.has(d)) fabricated.push(d);
}
for (const p of proposals) {
  if (p.target && !documents.has(normalizeCitation(p.target))) fabricated.push(p.target);
}
const rung0 = { pass: fabricated.length === 0 && uncited.length === 0, fabricated, uncited };

// ---- rung 1: grounded synthesis (planted cross-references) ------------------
const xrefs = key.crossReferences.map((p) => ({ id: p.id, found: Boolean(findPlant(p)) }));
const rung1 = { pass: xrefs.every((x) => x.found), plants: xrefs };

// ---- rung 2: risks evidence-tied + uses sources rather than listing them ----
const risks = key.risks.map((p) => ({ id: p.id, found: Boolean(findPlant(p)) }));
const substantive = claims.filter((c) => {
  const stripped = lower(c.claim).replace(/[a-z0-9/_.-]+\.md/g, '').trim();
  return stripped.length >= 40 && (c.citations ?? []).length <= 4;
});
const substantiveRatio = claims.length === 0 ? 0 : substantive.length / claims.length;
const rung2 = {
  pass: risks.every((r) => r.found) && substantiveRatio >= 0.8,
  plants: risks,
  substantiveRatio: Number(substantiveRatio.toFixed(2)),
};

// ---- rung 3: drift conflict + notes-drop propagation and memory deltas ------
const conflicts = key.conflicts.map((p) => ({ id: p.id, found: Boolean(findPlant(p)) }));
const propHits = key.notesDrop.expectedProposals.map((exp) => {
  const hit = proposals.find(
    (p) =>
      normalizeCitation(p.target) === exp.target &&
      matchesKeywords(p.change, exp.keywords) &&
      matchesKeywords(p.citedLine, exp.noteLineKeywords),
  );
  return { id: exp.id, found: Boolean(hit) };
});
const deltaHits = key.notesDrop.expectedDeltas.map((exp) => {
  const hit = deltas.find(
    (d) => matchesKeywords(d.body, exp.keywords) && matchesKeywords(d.citedLine, exp.noteLineKeywords),
  );
  return { id: exp.id, found: Boolean(hit) };
});
const rung3 = {
  pass:
    conflicts.every((c) => c.found) &&
    propHits.every((p) => p.found) &&
    deltaHits.every((d) => d.found),
  conflicts,
  proposals: propHits,
  deltas: deltaHits,
};

// ---- role coverage (advisory): which role lenses saw, which are blind ------
// Coverage reports; it never gates. Labels are recommended, then accepted or
// rejected by a human — the scorer only measures against what was recorded.
const roleKey = key.roleFindings ?? { roles: {}, findings: [] };
const plantById = new Map(
  [...key.crossReferences, ...key.conflicts, ...key.risks, ...roleKey.findings].map((p) => [p.id, p]),
);
const roleCoverage = Object.fromEntries(
  Object.entries(roleKey.roles).map(([role, ids]) => [
    role,
    ids.map((id) => ({ id, found: Boolean(findPlant(plantById.get(id))) })),
  ]),
);

const report = {
  rung0,
  rung1,
  rung2,
  rung3,
  roleCoverage,
  pass: rung0.pass && rung1.pass && rung2.pass && rung3.pass,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const mark = (b) => (b ? 'PASS' : 'FAIL');
  console.log(`rung 0 provenance        ${mark(rung0.pass)}  fabricated=${fabricated.length} uncited=${uncited.length}`);
  console.log(`rung 1 cross-references  ${mark(rung1.pass)}  ${xrefs.map((x) => `${x.id}:${x.found ? 'hit' : 'miss'}`).join(' ')}`);
  console.log(`rung 2 risks + usage     ${mark(rung2.pass)}  ${risks.map((r) => `${r.id}:${r.found ? 'hit' : 'miss'}`).join(' ')} substantive=${rung2.substantiveRatio}`);
  console.log(`rung 3 context loop      ${mark(rung3.pass)}  ${[...conflicts, ...propHits, ...deltaHits].map((x) => `${x.id}:${x.found ? 'hit' : 'miss'}`).join(' ')}`);
  for (const [role, hits] of Object.entries(roleCoverage)) {
    console.log(`role ${role.padEnd(12)} (advisory)  ${hits.map((h) => `${h.id}:${h.found ? 'hit' : 'miss'}`).join(' ')}`);
  }
  console.log(report.pass ? 'HARNESS PASS' : 'HARNESS FAIL');
}
process.exit(report.pass ? 0 : 1);
