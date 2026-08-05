#!/usr/bin/env node
/**
 * scripts/reconcile-tracker.mjs — run the reconciliation ritual against this
 * repo's own beads (construct-fnn).
 *
 * CLAUDE.md describes the ritual as something a session performs at its
 * boundaries. Sessions end abnormally, and the ones that do are precisely the
 * ones that leave the tracker asserting things the repo stopped agreeing with.
 * So the ritual runs here instead of being remembered.
 *
 * Every judgement lives in src/kernel/tracker/session-drift.ts, which is pure
 * and tested against fixtures rather than against whatever this repo happens to
 * look like today, and the evidence gathering lives in
 * src/hosts/repo/evidence.ts, shared with the standing watch. All this file
 * does is print.
 *
 *   node scripts/reconcile-tracker.mjs            # human-readable
 *   node scripts/reconcile-tracker.mjs --json     # the report as data
 *   node scripts/reconcile-tracker.mjs --quiet    # print only if something drifted
 *
 * Exit code is 0 unless --strict is passed. The repo gate calls it warn-only,
 * for the reason repo-gate.mjs states at length: a gate people turn off is worth
 * less than a gate that only talks.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { reconcileSession, describeConflict } from '../src/kernel/tracker/session-drift.ts';
import { gatherRepoEvidence, isFailure } from '../src/hosts/repo/evidence.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_BRANCH = 'main';

const json = process.argv.includes('--json');
const quiet = process.argv.includes('--quiet');
const strict = process.argv.includes('--strict');

// The gather lives in src/hosts/repo/evidence.ts because the standing watch
// (construct watch) asks this repository the same question, and two callers
// answering it differently is the drift this script exists to catch.
const gathered = gatherRepoEvidence({ root: ROOT, mainBranch: MAIN_BRANCH });
if (isFailure(gathered)) {
  process.stderr.write(`reconcile-tracker: ${gathered.problem} — skipped\n`);
  process.exit(0);
}
const { issues, evidence } = gathered;

const reconciledAt = new Date().toISOString();
const report = reconcileSession(issues, evidence, reconciledAt);

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (!(quiet && report.clean)) {
  const titles = new Map(issues.map((i) => [i.id, i.title ?? '']));
  process.stdout.write(
    `\nreconcile-tracker: ${report.counts.total} beads against ${MAIN_BRANCH}` +
      ` — ${report.counts.inSync} in sync, ${report.counts.drifted} drifted,` +
      ` ${report.contradictions.length} contradiction(s)\n`,
  );
  for (const result of report.drifted) {
    process.stdout.write(`\n  ${result.external_id}  ${titles.get(result.external_id) ?? ''}\n`);
    for (const c of result.conflicts) {
      process.stdout.write(`    ${describeConflict(c.field, c.domain, c.tracker)}\n`);
    }
  }
  for (const c of report.contradictions) {
    process.stdout.write(`\n  ${c.external_id}  [${c.rule}]\n    ${c.detail}\n`);
  }
  if (report.clean) process.stdout.write('  the tracker and the repo agree.\n');
  else {
    // Both directions are read before they are fixed, and both have a known
    // benign cause. Saying so here is what keeps this output trusted: a checker
    // that presented these as errors would be wrong often enough to be ignored.
    process.stdout.write(
      '\n  Read before fixing. A close with no trailer commit is usually work that predates\n' +
        '  the `(construct-<id>)` convention or landed on a branch never merged\n' +
        '  (`git merge-base --is-ancestor <sha> main` settles which). An open bead named in a\n' +
        '  trailer is usually a commit that touched it without finishing it.\n',
    );
  }
  process.stdout.write('\n');
}

process.exit(strict && !report.clean ? 1 : 0);
