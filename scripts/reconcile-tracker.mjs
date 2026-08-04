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
 * This is the IO half; every judgement lives in
 * src/kernel/tracker/session-drift.ts, which is pure and tested against fixtures
 * rather than against whatever this repo happens to look like today. All this
 * file does is gather evidence and print.
 *
 *   node scripts/reconcile-tracker.mjs            # human-readable
 *   node scripts/reconcile-tracker.mjs --json     # the report as data
 *   node scripts/reconcile-tracker.mjs --quiet    # print only if something drifted
 *
 * Exit code is 0 unless --strict is passed. The repo gate calls it warn-only,
 * for the reason repo-gate.mjs states at length: a gate people turn off is worth
 * less than a gate that only talks.
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { reconcileSession, describeConflict } from '../src/kernel/tracker/session-drift.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ISSUES = join(ROOT, '.beads/issues.jsonl');
const MAIN_BRANCH = 'main';

const json = process.argv.includes('--json');
const quiet = process.argv.includes('--quiet');
const strict = process.argv.includes('--strict');

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

function loadIssues() {
  if (!existsSync(ISSUES)) return null;
  return readFileSync(ISSUES, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
    .filter((record) => record._type === 'issue' && typeof record.id === 'string');
}

/**
 * Which beads each commit on main landed.
 *
 * Only the trailer counts: CLAUDE.md's convention is that a landing commit's
 * subject ends with `(construct-<id>)`, and one subject may carry several. A
 * bead named anywhere else in the message is explicitly NOT evidence that it
 * landed — the ritual already names this case ("a commit can legitimately
 * reference a bead it did not finish"), and scanning whole messages reproduces
 * it as noise: every epic gets credited by each of its children's commits, and
 * every bead a commit merely discusses reads as closed work.
 *
 * The trailer is matched against the known id set rather than by shape, so
 * `construct-2jb` never matches inside `construct-2jb.9`.
 */
function landingCommits(ids) {
  const log = git(['log', '--format=%H%x00%s%x01', MAIN_BRANCH]);
  if (log === null) return null;
  const known = new Set(ids);
  const found = new Map(ids.map((id) => [id, []]));
  for (const entry of log.split('\x01')) {
    const [sha, subject] = entry.split('\x00');
    if (!sha || !subject) continue;
    const trailer = subject.trim().match(/\(([^()]*)\)$/);
    if (!trailer) continue;
    for (const token of trailer[1].split(/[,\s]+/)) {
      const id = token.trim();
      if (known.has(id)) found.get(id).push(sha.trim().slice(0, 12));
    }
  }
  return found;
}

/**
 * Which beads have work in flight: named by a branch, a worktree, or the
 * uncommitted working tree. Deliberately generous — a false "in flight" makes a
 * stale claim look legitimate, which is quieter than the reverse, and this
 * checker earns its keep by being trusted rather than by being maximal.
 */
function inFlight(ids) {
  const haystacks = [
    git(['status', '--porcelain=v1', '-b']) ?? '',
    git(['branch', '--list', '--format=%(refname:short)']) ?? '',
    git(['worktree', 'list']) ?? '',
    git(['stash', 'list']) ?? '',
  ].join('\n');
  return new Set(ids.filter((id) => haystacks.includes(id)));
}

const issues = loadIssues();
if (issues === null) {
  process.stderr.write('reconcile-tracker: no .beads/issues.jsonl — nothing to reconcile\n');
  process.exit(0);
}

const ids = issues.map((i) => i.id);
const commits = landingCommits(ids);
if (commits === null) {
  process.stderr.write(`reconcile-tracker: cannot read git log for ${MAIN_BRANCH} — skipped\n`);
  process.exit(0);
}
const flight = inFlight(ids);

// Evidence is gathered for every bead, so absence of an entry never silently
// excuses one. The kernel's skip-what-was-not-looked-at rule is for callers that
// gather partially; this caller does not.
const evidence = Object.fromEntries(
  ids.map((id) => [id, { landingCommits: commits.get(id) ?? [], inFlight: flight.has(id) }]),
);

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
