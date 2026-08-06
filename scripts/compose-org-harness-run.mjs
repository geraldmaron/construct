#!/usr/bin/env node
/**
 * compose-org-harness-run.mjs — merge per-lens dispatch outputs and a
 * notes-drop pass into one scored-run JSON.
 *
 * The production spine dispatches one role per host invocation and aggregates
 * the deliverables; a composed run is the harness measuring that same shape.
 * Each input file is one dispatch's output, produced clean-context by
 * scripts/org-harness-producer-prompt.mjs --lens <name> (claims only) or
 * --notes (notesDrop only). This script concatenates the claims in the order
 * given, carries the notesDrop through, and records what it was composed of —
 * composition is bookkeeping, never editing: no claim is dropped, merged, or
 * rewritten, so the scored run is exactly what the dispatches produced.
 *
 * Usage:
 *   node scripts/compose-org-harness-run.mjs --out <run.json> <lens-output.json> [...] --notes-file <notes.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const args = process.argv.slice(2);
const take = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const [, value] = args.splice(i, 2);
  return value;
};
const out = take('--out');
const notesFile = take('--notes-file');
const parts = args.filter((a) => !a.startsWith('--'));

if (!out || parts.length === 0) {
  console.error(
    'usage: compose-org-harness-run.mjs --out <run.json> <lens-output.json> [...] --notes-file <notes.json>',
  );
  process.exit(2);
}

const claims = [];
const composedOf = [];
for (const file of parts) {
  const piece = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(piece.claims)) {
    console.error(`${file} carries no claims array — not a lens dispatch output`);
    process.exit(2);
  }
  claims.push(...piece.claims);
  composedOf.push({ file, claims: piece.claims.length });
}

let notesDrop = { proposals: [], deltas: [] };
if (notesFile) {
  const notes = JSON.parse(readFileSync(notesFile, 'utf8'));
  if (!notes.notesDrop) {
    console.error(`${notesFile} carries no notesDrop — not a notes-pass output`);
    process.exit(2);
  }
  notesDrop = notes.notesDrop;
  composedOf.push({
    file: notesFile,
    proposals: notesDrop.proposals?.length ?? 0,
    deltas: notesDrop.deltas?.length ?? 0,
  });
}

writeFileSync(out, JSON.stringify({ claims, notesDrop, composedOf }, null, 1));
console.log(`composed ${out}: ${claims.length} claims from ${parts.length} dispatch(es)` +
  (notesFile ? `, notesDrop from ${notesFile}` : ''));
