/**
 * lint-no-bead-refs.mjs — committed code never references tracker bead ids.
 *
 * The rule (Gerald, 2026-08-05): lineage lives in commit messages and the
 * tracker, never in code or code comments. A bead id in a comment rots the
 * moment the bead closes, sends the reader to a tool the code must not depend
 * on, and says nothing the comment could not say in plain language. Root
 * documents (STRATEGY, CHANGELOG, RESEARCH-DECISIONS) are the drift record
 * and keep their dated lineage; this lint covers code: src, tests, scripts.
 *
 * Excluded by name: the scripts whose subject IS the tracker
 * (reconcile-tracker, repo-gate, lint-doc-bead-refs and its test), which
 * handle bead ids as data, and the labeling kit, whose ids are study
 * identifiers and, in one case, a deterministic shuffle seed whose bytes
 * decide which outcomes were drawn: rewording it would silently
 * re-randomize a finished study.
 * `construct-mcp` and `construct-role` are excluded by name (functional
 * identifiers, not lineage); `construct-cli-…` and similar never match: a
 * bead id is three or four alphanumerics, optionally dotted, with nothing
 * attached — four because the tracker mints four-character ids now,
 * and a gate that cannot match what it was built to catch is worse than none.
 * Shipped skills are covered too: a bead id in a portable file points at a
 * tracker the file's reader has never seen.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const BEAD = /construct-(?!mcp|role|repo|sync)[a-z0-9]{3,4}(?:\.\d+)?(?![a-z0-9_-])/;

// Trailing-slash pathspecs with extension filtering in JS, not double-star
// globs: this git's pathspec matching does not treat `dir/**/*.ext` as
// matching dir's own direct children, so a glob here silently skips most of
// scripts/ — the files this gate most needs to read.
const EXTENSIONS = ['.ts', '.mjs', '.sh', '.md'];
const files = execSync("git ls-files 'src/' 'tests/' 'scripts/' 'skills/'", { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => EXTENSIONS.some((ext) => f.endsWith(ext)))
  .filter(
    (f) =>
      !f.includes('reconcile-tracker') &&
      !f.includes('repo-gate') &&
      !f.includes('labeling-kit') &&
      !f.includes('lint-doc-bead-refs'),
  )
  // git ls-files still lists a path after a working-tree delete until the
  // deletion is staged; skip those so a mid-edit tree does not crash the lint.
  .filter((f) => existsSync(f));

let violations = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (BEAD.test(line)) {
      violations += 1;
      console.error(`bead reference in code: ${file}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations > 0) {
  console.error(`\n${violations} bead reference(s) in committed code. Lineage belongs in the commit message and the tracker.`);
  process.exit(1);
}
console.log('lint-no-bead-refs: clean');
