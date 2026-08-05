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
 * Excluded by name: the two scripts whose subject IS the tracker
 * (reconcile-tracker, repo-gate) — they handle bead ids as data — and the
 * labeling kit, whose ids are study identifiers and, in one case, a
 * deterministic shuffle seed whose bytes decide which outcomes were drawn:
 * rewording it would silently re-randomize a finished study.
 * `construct-mcp`, `construct-cli-…` and similar functional names do not
 * match: a bead id is exactly three alphanumerics, optionally dotted, with
 * nothing attached.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BEAD = /construct-(?!mcp)[a-z0-9]{3}(?:\.\d+)?(?![a-z0-9_-])/;

const files = execSync(
  "git ls-files 'src/**/*.ts' 'tests/**/*.ts' 'scripts/**/*.mjs' 'scripts/**/*.sh'",
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .filter(
    (f) =>
      !f.includes('reconcile-tracker') && !f.includes('repo-gate') && !f.includes('labeling-kit'),
  );

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
