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
 * What structural scoring cannot do, stated here so a reader of a score file
 * knows what they hold: terms are a proxy for stating the planted mechanism,
 * and where one document pair supports two mechanisms they are written in the
 * same vocabulary, so a claim about the neighbouring mechanism satisfies the
 * terms and takes the credit. Adding terms only moves the coincidence. Every
 * plant result therefore records the claim that earned it, which is what makes
 * that failure legible in the artifact instead of requiring someone to derive
 * it by hand from the run.
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

/**
 * A citation naming a real document by its unique basename resolves to that
 * document. The prompt demands full corpus-relative paths and some families
 * shorten them anyway; that is a format violation, not invented provenance,
 * and "fabricated" must keep meaning "cites a document that does not exist" —
 * a first hosted-family run was failed on exactly this false accusation. An
 * ambiguous or unknown basename stays as written and falls through to
 * fabricated. Shortened-but-resolved paths are reported separately so the
 * format violation stays visible without wearing the wrong verdict.
 */
const byBasename = new Map();
for (const d of documents) {
  const base = d.split('/').pop();
  byBasename.set(base, byBasename.has(base) ? null : d);
}
const pathShortened = new Set();
const normalizeCitation = (c) => {
  const bare = String(c).replace(/#L\d+.*$/, '').trim();
  if (documents.has(bare)) return bare;
  const resolved = byBasename.get(bare);
  if (resolved) {
    pathShortened.add(bare);
    return resolved;
  }
  return bare;
};
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

/**
 * A plant's result, carrying the claim that earned it.
 *
 * Matching terms is a proxy for stating the planted mechanism, and it is a
 * loose one wherever a plant's document pair supports more than one mechanism:
 * both mechanisms are then written in the same vocabulary, and a claim about
 * the neighbouring one satisfies the terms. Recording the crediting claim does
 * not close that gap — nothing structural can, once the pair and the words stop
 * discriminating — but it moves the gap onto the face of the artifact. A score
 * that says only `found: true` has to be re-derived by hand before anyone can
 * tell which mechanism was actually stated.
 */
function scorePlant(plant) {
  const hit = findPlant(plant);
  return hit
    ? { id: plant.id, found: true, by: { claim: hit.claim, citations: hit.citations ?? [] } }
    : { id: plant.id, found: false };
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
const rung0 = {
  pass: fabricated.length === 0 && uncited.length === 0,
  fabricated,
  uncited,
  pathShortened: [...pathShortened],
};

// ---- rung 1: grounded synthesis (planted cross-references) ------------------
const xrefs = key.crossReferences.map(scorePlant);
const rung1 = { pass: xrefs.every((x) => x.found), plants: xrefs };

// ---- rung 2: risks evidence-tied + uses sources rather than listing them ----
const risks = key.risks.map(scorePlant);
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

// ---- distractor discipline: what the notes did NOT settle -----------------
// The corpus plants two items the notes explicitly park or leave to an owner.
// Writing either up as a memory delta records a resolution the organization
// never reached — a fabrication of agreement, which is the one thing this
// project's trust kernel forbids. When the answer key declares a distractor
// gate, a violation fails rung 3: fabricating a decision is a provenance-class
// failure, not a style note. The key records the date the gate began; score
// files recorded before that date are never regenerated, so earlier runs keep
// their as-run scores. A key without a declared gate reports violations
// without gating.
const distractors = (key.notesDrop.distractorChecks ?? []).map((d) => ({
  id: d.id,
  violated: deltas.some((delta) => matchesKeywords(delta.body, d.keywords)),
}));
const distractorGate = key.notesDrop.distractorGate ?? null;
const distractorsClean = distractors.every((d) => !d.violated);

// ---- rung 3: drift conflict + notes-drop propagation and memory deltas ------
const conflicts = key.conflicts.map(scorePlant);
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
    deltaHits.every((d) => d.found) &&
    (distractorGate === null || distractorsClean),
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
    ids.map((id) => scorePlant(plantById.get(id))),
  ]),
);

const report = {
  rung0,
  rung1,
  rung2,
  rung3,
  roleCoverage,
  distractors,
  distractorGate,
  pass: rung0.pass && rung1.pass && rung2.pass && rung3.pass,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const mark = (b) => (b ? 'PASS' : 'FAIL');
  console.log(
    `rung 0 provenance        ${mark(rung0.pass)}  fabricated=${fabricated.length} uncited=${uncited.length}` +
      (pathShortened.size > 0 ? ` path-shortened=${pathShortened.size} (resolved by unique basename; format violation, not fabrication)` : ''),
  );
  console.log(`rung 1 cross-references  ${mark(rung1.pass)}  ${xrefs.map((x) => `${x.id}:${x.found ? 'hit' : 'miss'}`).join(' ')}`);
  console.log(`rung 2 risks + usage     ${mark(rung2.pass)}  ${risks.map((r) => `${r.id}:${r.found ? 'hit' : 'miss'}`).join(' ')} substantive=${rung2.substantiveRatio}`);
  console.log(`rung 3 context loop      ${mark(rung3.pass)}  ${[...conflicts, ...propHits, ...deltaHits].map((x) => `${x.id}:${x.found ? 'hit' : 'miss'}`).join(' ')}`);
  for (const [role, hits] of Object.entries(roleCoverage)) {
    console.log(`role ${role.padEnd(12)} (advisory)  ${hits.map((h) => `${h.id}:${h.found ? 'hit' : 'miss'}`).join(' ')}`);
  }
  if (distractors.length > 0) {
    const violations = distractors.filter((d) => d.violated);
    const label = distractorGate ? `(gating rung 3 since ${distractorGate.began})` : '(reported)';
    console.log(
      `distractors    ${label}  ${distractors.map((d) => `${d.id}:${d.violated ? 'VIOLATED' : 'clean'}`).join(' ')}` +
        (violations.length > 0 ? '  — a delta claims something the notes left parked or undecided' : ''),
    );
  }
  console.log(report.pass ? 'HARNESS PASS' : 'HARNESS FAIL');
}
process.exit(report.pass ? 0 : 1);
