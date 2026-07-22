/**
 * lib/oracle/invariants/analysis-success-requires-execution-evidence.mjs — Layer 1
 * deterministic invariant: a scheduler job whose result carries a `ranAnalysis` flag
 * must persist that flag alongside any snapshot state it writes, or a downstream reader
 * cannot distinguish "the analysis ran and found nothing" from "the analysis never ran."
 *
 * Per the oracle-miss-report's rows 5-6 (execution-gap/roadmap false success): "No
 * producer distinguishes 'provider method missing' from 'provider method threw' from
 * 'zero results'... Deterministic (job-level honesty) + Oracle vocabulary to consume
 * it." The job-level honesty half is already built: `lib/embed/daemon.mjs`'s
 * `#runExecutionGapAnalysis()` (~line 1375) returns `{ gaps, ticketsCreated,
 * highRiskCount, ranAnalysis }`, and its own comment states the intent directly:
 * "`ranAnalysis: false` must never be reported as 'no gaps'" (daemon.mjs, above the
 * `execution-gap` job registration). The consuming half is not yet built: that same job
 * (`this.#scheduler.register('execution-gap', ...)`) writes `this.#lastSnapshot.
 * executionGaps = result.gaps` unconditionally, before it branches on
 * `!result.ranAnalysis` — the persisted snapshot state carries only the (possibly
 * empty-because-never-run) gaps array, never the `ranAnalysis` flag itself. A caller
 * that reads `lastSnapshot.executionGaps.length === 0` later — Oracle's read model, or
 * any future consumer — cannot recover whether that zero means "no gaps" or "analysis
 * did not run"; the ephemeral console/notification warning the job emits is not
 * queryable state.
 *
 * The check is a static source scan of `lib/embed/daemon.mjs`, not a live daemon
 * invocation — the job's real work (a Jira provider round-trip) is out of reach for a
 * hermetic Layer 1 check, and `lib/embed/**` is this repo's owned-by-another-lane
 * boundary this wave, so the check reads the file as data without importing or
 * exercising it. Scoped to scheduler-registered job blocks that reference
 * `.ranAnalysis` at all, so a future job with the same shape is covered automatically
 * rather than requiring a second hardcoded target.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const id = 'analysis-success-requires-execution-evidence';
export const layer = 1;
export const description =
  "A scheduler job whose result carries a `ranAnalysis` flag must persist that flag alongside any snapshot state it writes, so 'zero results' cannot be misread as 'analysis never ran.'";

const REGISTER_RE = /this\.#scheduler\.register\(\s*'([^']+)'/g;
const SNAPSHOT_ASSIGN_RE = /#lastSnapshot\.(\w+)\s*=\s*(\w+)\.(\w+)/g;

/**
 * Splits daemon.mjs's source into one text block per `this.#scheduler.register(<jobId>,
 * ...)` call, each spanning to the start of the next register call (or end of file).
 *
 * @returns {{jobId: string, block: string}[]}
 */
export function splitIntoJobBlocks(source) {
  const matches = [...source.matchAll(REGISTER_RE)];
  const blocks = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length;
    blocks.push({ jobId: matches[i][1], block: source.slice(start, end) });
  }
  return blocks;
}

/**
 * @param {string} block one job's source text
 * @returns {{checksRanAnalysis: boolean, snapshotAssignments: {field: string, source: string}[], persistsRanAnalysis: boolean}}
 */
export function analyzeJobBlock(block) {
  const checksRanAnalysis = /\.ranAnalysis\b/.test(block);
  const snapshotAssignments = [];
  SNAPSHOT_ASSIGN_RE.lastIndex = 0;
  let m;
  while ((m = SNAPSHOT_ASSIGN_RE.exec(block))) {
    snapshotAssignments.push({ field: m[1], source: `${m[2]}.${m[3]}` });
  }
  const persistsRanAnalysis =
    snapshotAssignments.some((a) => /ranAnalysis/i.test(a.field) || /ranAnalysis/i.test(a.source)) ||
    /#lastSnapshot\.\w*[Rr]an[Aa]nalysis/.test(block);
  return { checksRanAnalysis, snapshotAssignments, persistsRanAnalysis };
}

/**
 * @param {{cwd?: string, daemonPath?: string}} [opts]
 */
export async function check({
  cwd = process.cwd(),
  daemonPath = path.join(cwd, 'lib', 'embed', 'daemon.mjs'),
} = {}) {
  let source;
  try {
    source = readFileSync(daemonPath, 'utf8');
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to read ${daemonPath}: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      unresolved: [],
      results: [],
    };
  }

  const jobBlocks = splitIntoJobBlocks(source);
  const results = [];

  for (const { jobId, block } of jobBlocks) {
    const { checksRanAnalysis, snapshotAssignments, persistsRanAnalysis } = analyzeJobBlock(block);
    if (!checksRanAnalysis || snapshotAssignments.length === 0) continue;

    if (persistsRanAnalysis) {
      results.push({
        job: jobId,
        status: 'passed',
        detail: `'${jobId}' persists its ranAnalysis flag alongside its snapshot assignment(s)`,
      });
    } else {
      results.push({
        job: jobId,
        status: 'failed',
        violation: true,
        snapshotAssignments,
        detail: `'${jobId}' checks '.ranAnalysis' but persists ${snapshotAssignments.map((a) => `#lastSnapshot.${a.field} = ${a.source}`).join(', ')} without also persisting ranAnalysis — a reader of that snapshot field cannot tell "zero results" from "analysis did not run"`,
      });
    }
  }

  const violations = results.filter((r) => r.status === 'failed');
  return {
    status: violations.length > 0 ? 'failed' : 'passed',
    evaluated: results.length,
    violations,
    unresolved: [],
    results,
  };
}
