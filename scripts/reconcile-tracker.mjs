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
 * Two witnesses, not one. The commit-side reconcile compares the tracker's
 * current export against what landed on main. It cannot see a close the tracker
 * database itself lost — the bead reads open, no commit contradicts it, and the
 * whole regression prints as agreement. So the export's own version history is
 * swept too, and a record it once held that the export no longer holds is
 * reported. Both are read from one branch's view, so the report opens by saying
 * where that branch stands and which beads already have commits it cannot see.
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

import {
  reconcileSession,
  describeConflict,
  describeDivergence,
  lostRecords,
} from '../src/kernel/tracker/session-drift.ts';
import {
  gatherRepoEvidence,
  gatherDivergence,
  isFailure,
  recordedHistory,
} from '../src/hosts/repo/evidence.ts';

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

// The second witness. The reconcile above can only ever compare the tracker's
// current export against the repo's commits, so a close the tracker database
// lost reads there as agreement: the bead says open, no one closed it, nothing
// disagrees. The export's own version history remembers otherwise.
const lost = lostRecords(issues, recordedHistory(ROOT) ?? undefined);

// Every finding above is made from one branch's view. Sessions working main and
// a direction branch in parallel implemented the same beads twice because the
// branch session could not see the commits that already carried them, so where
// the checkout stands is said before anything else is judged from it.
const divergence = describeDivergence(
  gatherDivergence({ root: ROOT, mainBranch: MAIN_BRANCH }) ?? undefined,
);

const allClean = report.clean && lost.clean && !divergence.diverged;

if (json) {
  process.stdout.write(
    `${JSON.stringify({ ...report, lost, divergence, clean: allClean }, null, 2)}\n`,
  );
} else if (!(quiet && allClean)) {
  const titles = new Map(issues.map((i) => [i.id, i.title ?? '']));
  process.stdout.write(
    `\nreconcile-tracker: ${report.counts.total} beads against ${MAIN_BRANCH}` +
      ` — ${report.counts.inSync} in sync, ${report.counts.drifted} drifted,` +
      ` ${report.counts.adjudicated} adjudicated,` +
      ` ${report.contradictions.length} contradiction(s)\n`,
  );
  if (divergence.diverged) {
    process.stdout.write('\n  this checkout is not where the work is:\n');
    for (const line of divergence.lines) process.stdout.write(`    ${line}\n`);
  }
  for (const result of report.drifted) {
    process.stdout.write(`\n  ${result.external_id}  ${titles.get(result.external_id) ?? ''}\n`);
    for (const c of result.conflicts) {
      process.stdout.write(`    ${describeConflict(c.field, c.domain, c.tracker)}\n`);
    }
  }
  for (const c of report.contradictions) {
    process.stdout.write(`\n  ${c.external_id}  [${c.rule}]\n    ${c.detail}\n`);
  }
  // Named, not listed. These are disagreements a dated note on the bead already
  // accounts for, and reprinting them in full is what buried the ones that
  // still needed a person.
  if (report.adjudicated.length > 0) {
    process.stdout.write(
      `\n  ${report.adjudicated.length} adjudicated (a dated note on the bead says why): ` +
        `${report.adjudicated.map((r) => r.external_id).join(', ')}\n`,
    );
  }
  if (!lost.clean) {
    process.stdout.write(
      `\n  the export's own history disagrees with the tracker` +
        ` (${lost.commitsScanned} revision(s) read${lost.truncated ? ', capped — older revisions went unread' : ''}):\n`,
    );
    for (const id of lost.lostCloses) {
      process.stdout.write(
        `    ${id}  ${titles.get(id) ?? ''}\n` +
          '      recorded closed in an earlier revision of the export, open now — a close the\n' +
          '      tracker database lost. Reclose it, or write a dated note settling it — REOPENED if\n' +
          "      it was deliberate, or DRIFT ADJUDICATED (lost-close) if it wasn't lost at all.\n",
      );
    }
    for (const id of lost.missingRecords) {
      process.stdout.write(
        `    ${id}  (no record)\n` +
          '      filed in an earlier revision of the export and absent from it now — a bead the\n' +
          '      tracker database lost. Refile it from that revision, or, if this checkout is just\n' +
          '      behind another ref, write a dated DRIFT ADJUDICATED (missing-filing) note naming\n' +
          '      this id — on any current bead, since this one has none of its own.\n',
      );
    }
    // The same known-benign warning the commit-side findings carry, for the same
    // reason: this sweep reads every local ref, so a checkout whose export is
    // simply older than another branch's shows that branch's later work as lost.
    process.stdout.write(
      '\n    Read before fixing. This sweep reads every local ref, so a checkout sitting\n' +
        '    behind another branch reports that branch\'s later filings and closes as lost.\n' +
        '    Check where this checkout stands before refiling anything.\n',
    );
  }
  if (lost.reopened.length > 0) {
    process.stdout.write(
      `\n  ${lost.reopened.length} reopened (a dated note on the bead says so): ${lost.reopened.join(', ')}\n`,
    );
  }
  if (lost.adjudicated.length > 0) {
    process.stdout.write(
      `\n  ${lost.adjudicated.length} adjudicated (a dated note says why): ${lost.adjudicated.join(', ')}\n`,
    );
  }

  if (allClean) process.stdout.write('  the tracker and the repo agree.\n');
  if (!report.clean) {
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

process.exit(strict && !allClean ? 1 : 0);
