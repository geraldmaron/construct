/**
 * lint-no-tracker-refs.mjs — committed code never references a tracker id.
 *
 * Lineage lives in commit messages and the work ledger, never in code or
 * code comments. An id in a comment rots the
 * moment its item closes, sends the reader to a record the code must not
 * depend on, and says nothing the comment could not say in plain language.
 * The changelog may retain dated lineage. This lint covers code and shipped
 * skills: src, tests, scripts, skills.
 *
 * Two id shapes are refused: the native ledger's (`work-` and eight hex
 * digits) and the retired tracker's (`construct-` and three or four
 * alphanumerics, optionally dotted), which now point at nothing at all.
 * `construct-mcp`, `construct-role`, `construct-repo` and `construct-sync` are
 * functional names, not ids.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const TRACKER_ID = /\bwork-[0-9a-f]{8}\b|construct-(?!mcp|role|repo|sync)[a-z0-9]{3,4}(?:\.\d+)?(?![a-z0-9_-])/;

// Trailing-slash pathspecs with extension filtering in JS, not double-star
// globs: this git's pathspec matching does not treat `dir/**/*.ext` as
// matching dir's own direct children, so a glob here silently skips most of
// scripts/ — the files this gate most needs to read.
const EXTENSIONS = ['.ts', '.mjs', '.sh', '.md'];
const files = execSync("git ls-files 'src/' 'tests/' 'scripts/' 'skills/'", { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => EXTENSIONS.some((ext) => f.endsWith(ext)))
  // git ls-files still lists a path after a working-tree delete until the
  // deletion is staged; skip those so a mid-edit tree does not crash the lint.
  .filter((f) => existsSync(f))
  // This file names the shapes it refuses.
  .filter((f) => f !== 'scripts/lint-no-tracker-refs.mjs');

let violations = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (TRACKER_ID.test(line)) {
      violations += 1;
      console.error(`tracker id in code: ${file}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations > 0) {
  console.error(`\n${violations} tracker id(s) in committed code. Lineage belongs in the commit message and the ledger.`);
  process.exit(1);
}
console.log('lint-no-tracker-refs: clean');
