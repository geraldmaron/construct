#!/usr/bin/env node
/**
 * lint-reader-rubric-parity.mjs — the acceptance rubric and the code that
 * enforces it, held to each other.
 *
 * docs/persona-acceptance-rubrics.md is the source: what a reader in each role
 * requires before they would call a deliverable adequate, committed before any
 * judging so it could not be tuned to pass what it grades. src/kernel/challenge/
 * personas.ts is the enforcement. Two drifts are possible between them and both
 * are silent.
 *
 * A line added to the rubric and not to the table is a requirement the project
 * agreed to and nothing carries — the exact state the whole document was in
 * before it was wired up, arriving one line at a time instead of all at once.
 *
 * A line in the table that the rubric does not contain is worse: the run would
 * be holding deliverables to a standard the reader never stated, with the
 * rubric cited as its authority.
 *
 * Only the concern-keyed sections are governed — the ones written as
 * `## Persona (concern)`. The earlier reader-only blocks name no concern, so
 * there is nothing to bind them to, and this lint says how many it skipped
 * rather than passing in silence over them.
 */

import { readFileSync } from 'node:fs';

const RUBRIC = 'docs/persona-acceptance-rubrics.md';
const TABLE = 'src/kernel/challenge/readers.ts';

/** Sections written as `## Something (concern)`, and the lines under them. */
function parseRubric(text) {
  const lines = [];
  const skipped = [];
  let concern = null;
  // A heading only becomes a reported section once a rubric line appears under
  // it. The document also carries dated decision notes, and listing one as a
  // section that "binds to nothing" reads as a rubric nobody wired up rather
  // than as prose — which is what it is.
  let unkeyed = null;
  for (const raw of text.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      const keyed = /\(([a-z][a-z-]*)\)\s*$/.exec(heading[1]);
      concern = keyed ? keyed[1] : null;
      unkeyed = keyed ? null : heading[1];
      continue;
    }
    const line = /^-\s+(must|should)\s+([A-Z]\d+)\.\s+(.+)$/.exec(raw.trim());
    if (!line) continue;
    if (concern !== null) {
      lines.push({ concern, weight: line[1], id: line[2] });
      continue;
    }
    if (unkeyed !== null) {
      skipped.push(unkeyed);
      unkeyed = null;
    }
  }
  return { lines, skipped };
}

/** The RUBRIC_LINES entries, read as data rather than imported. */
function parseTable(text) {
  const entries = [];
  const re =
    /concern:\s*'([^']+)',\s*\n\s*id:\s*'([^']+)',\s*\n\s*weight:\s*'([^']+)'/g;
  for (const match of text.matchAll(re)) {
    entries.push({ concern: match[1], id: match[2], weight: match[3] });
  }
  return entries;
}

const rubricText = readFileSync(RUBRIC, 'utf8');
const tableText = readFileSync(TABLE, 'utf8');
const { lines: rubric, skipped } = parseRubric(rubricText);
const table = parseTable(tableText);

const key = (line) => `${line.concern}/${line.id}`;
const inTable = new Map(table.map((line) => [key(line), line]));
const inRubric = new Map(rubric.map((line) => [key(line), line]));
const problems = [];

// A concern-keyed must-line the table has never heard of. Should-lines are not
// required in the table: the rubric grades them as corrections rather than
// rejections, and nothing gates on them.
for (const line of rubric) {
  if (line.weight !== 'must') continue;
  if (!inTable.has(key(line))) {
    problems.push(
      `${key(line)} is a must-line in ${RUBRIC} and is absent from ${TABLE} — ` +
        'a requirement the project agreed to and nothing carries',
    );
  }
}

for (const line of table) {
  const source = inRubric.get(key(line));
  if (source === undefined) {
    problems.push(
      `${key(line)} is enforced in ${TABLE} and does not appear in ${RUBRIC} — ` +
        'the run would hold deliverables to a standard the reader never stated',
    );
    continue;
  }
  if (source.weight !== line.weight) {
    problems.push(
      `${key(line)} is "${source.weight}" in ${RUBRIC} and "${line.weight}" in ${TABLE}`,
    );
  }
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`reader-rubric-parity: ${problem}\n`);
  process.exit(1);
}

const gated = table.filter((line) => line.weight === 'must').length;
process.stdout.write(
  `reader-rubric-parity: clean — ${String(gated)} concern-keyed must-line(s) carried, ` +
    `${String(skipped.length)} reader-only section(s) name no concern and bind to nothing ` +
    `(${skipped.join(', ')})\n`,
);
