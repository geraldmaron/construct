/**
 * kernel/tracker/session-drift.ts — reconcile the repo's own bead set against
 * the repo itself.
 *
 * CLAUDE.md carries the reconciliation ritual as a manual practice, run at the
 * session boundaries. A manual practice is exactly the thing a session that ends
 * abnormally never runs — a crash, a lost context, or an agent that simply
 * stopped, and the tracker keeps asserting something the repo stopped agreeing
 * with. This module is the practice as a behavior, so it happens without being
 * remembered.
 *
 * The framing is the one kernel/tracker/reconcile.ts already established, and
 * the point of reusing it rather than writing a bespoke checker is that the
 * authority rule already answers the question a bespoke checker would have to
 * re-litigate: who is allowed to be right. A bead's status is the tracker's to
 * assert. Whether a commit landed on main, and whether work is in flight, are
 * facts about the repo — DOMAIN-owned, so a disagreement is a CONFLICT that gets
 * reported and never silently resolved in the tracker's favour.
 *
 * Two propositions are projected per bead, each phrased so both sides can answer
 * it with the same kind of value:
 *
 *   - `landed`   — the tracker asserts it by closing the bead; the repo answers
 *                  with whether a commit on main names it.
 *   - `in_flight`— the tracker asserts it with status in_progress; the repo
 *                  answers with uncommitted or branched work naming it.
 *
 * Both directions of each disagreement are real drift and both are reported. A
 * closed bead with no commit is undone work or work stranded on an unmerged
 * branch; a commit with the bead still open is a close nobody ran. An
 * in_progress bead with nothing in flight is an abandoned claim; work in flight
 * with no claim is a bead someone forgot to claim.
 *
 * Deliberately not modelled here: whether the specific move named in a
 * `human`-labelled bead's blocker line has since been made. That is a claim
 * about English prose and no amount of git can decide it. What *is* decidable is
 * the ritual contradiction it produces — a bead cannot be both in_progress and
 * waiting on Gerald — and that is reported separately, in its own vocabulary,
 * rather than dressed up as a reconciliation result it is not.
 *
 * Pure, like the rest of kernel/tracker: the evidence is gathered by a caller
 * that may run git, and arrives here as data.
 */

import { AUTHORITY } from './authority.ts';
import { projectionId } from './projection.ts';
import type { Projection } from './projection.ts';
import { reconcileAll } from './reconcile.ts';
import type { DriftReport } from './reconcile.ts';

/** The propositions this projection reconciles. Both are repo-owned. */
export const SESSION_FIELDS = ['landed', 'in_flight'] as const;

const SESSION_FIELD_AUTHORITY = Object.freeze({
  landed: AUTHORITY.DOMAIN,
  in_flight: AUTHORITY.DOMAIN,
});

/** The minimum of a bead this module reads. Everything else is carried verbatim. */
export interface BeadIssue {
  readonly id: string;
  readonly status?: string;
  readonly labels?: readonly string[];
  readonly [field: string]: unknown;
}

/** What the repo says about one bead. Gathered by a caller; no IO happens here. */
export interface RepoEvidence {
  /** Commits reachable from main whose message names this bead. */
  readonly landingCommits?: readonly string[];
  /** Uncommitted changes, a branch, or a worktree naming this bead. */
  readonly inFlight?: boolean;
}

export type EvidenceBySlug = Readonly<Record<string, RepoEvidence>>;

/** A tracker-internal contradiction: no repo evidence can settle it either way. */
export interface RitualContradiction {
  readonly external_id: string;
  readonly rule: string;
  readonly detail: string;
}

export interface SessionDriftReport extends Omit<DriftReport, 'counts' | 'drifted'> {
  readonly counts: DriftReport['counts'] & { readonly adjudicated: number };
  /** Disagreements no one has adjudicated. These are what a session acts on. */
  readonly drifted: DriftReport['drifted'];
  /** Disagreements a dated note already explains, kept out of the working list. */
  readonly adjudicated: DriftReport['drifted'];
  /** Contradictions inside the tracker's own claims. Not reconciliation results. */
  readonly contradictions: readonly RitualContradiction[];
  /** True only when the reconcile is clean AND no contradiction was found. */
  readonly clean: boolean;
}

/**
 * The four disagreements a bead can be in, named the way a person writes them
 * down. A note adjudicates one of these, not "the drift" in general, so a bead
 * whose disagreement later flips direction is reported again rather than
 * inheriting a verdict that was about something else.
 */
const ADJUDICABLE = Object.freeze({
  'closed-without-commit': 'landed:true',
  'open-but-named': 'landed:false',
  'claimed-but-idle': 'in_flight:true',
  'in-flight-unclaimed': 'in_flight:false',
});

const ADJUDICATION_MARKER = /DRIFT (?:ADJUDICATED|RESOLVED)\b[^\n]*/gi;

function conflictKey(field: string, tracker: unknown): string {
  return `${field}:${String(tracker)}`;
}

/**
 * The disagreements a bead's notes already account for.
 *
 * The ritual says every drift fix is a dated note on the bead, and the reason it
 * says so is that an unrecorded fix recreates the drift. What it could not do
 * until now is spend that record: the checker re-derived the same disagreement
 * on every run, so adjudicated beads stayed in the working list forever and a
 * genuine drift had to be found among them. A note that names its direction is
 * read here and the disagreement is reported as settled instead of as work.
 *
 * A bare marker with no direction is the older form, which was only ever written
 * for closes with no landing commit, so that is what it means.
 */
export function adjudicatedConflicts(issue: BeadIssue | undefined): ReadonlySet<string> {
  const notes = typeof issue?.notes === 'string' ? issue.notes : '';
  const keys = new Set<string>();
  for (const marker of notes.match(ADJUDICATION_MARKER) ?? []) {
    const named = Object.entries(ADJUDICABLE).filter(([direction]) => marker.includes(direction));
    if (named.length === 0) keys.add(ADJUDICABLE['closed-without-commit']);
    else for (const [, key] of named) keys.add(key);
  }
  return keys;
}

function isClosed(status: unknown): boolean {
  return status === 'closed';
}

function isInProgress(status: unknown): boolean {
  return status === 'in_progress';
}

/**
 * What the tracker asserts about a bead, expressed as the two propositions.
 * Carries `id` because that is how reconcileAll matches a projection to its
 * issue.
 */
export function trackerClaims(issue: BeadIssue): Record<string, unknown> {
  return {
    id: issue.id,
    landed: isClosed(issue.status),
    in_flight: isInProgress(issue.status),
  };
}

/** What the repo says, in the same two propositions. */
export function repoAnswers(evidence: RepoEvidence | undefined): Record<string, unknown> {
  return {
    landed: (evidence?.landingCommits?.length ?? 0) > 0,
    in_flight: evidence?.inFlight === true,
  };
}

/**
 * The projection for one bead. Only the two propositions carry authority; the
 * bead's own fields are preserved verbatim in `raw_record`, so nothing is lost
 * by projecting a narrow view of a wide record.
 *
 * `fields` holds the tracker's claims, which makes them the baseline a
 * reconcile falls back to when no repo evidence was gathered for this bead. That
 * fallback is deliberately the quiet one: absent evidence reads as agreement
 * rather than as drift, because a missing measurement is not a finding.
 */
export function projectBead(issue: BeadIssue): Projection {
  if (!issue || typeof issue.id !== 'string') {
    throw new Error('projectBead: issue must have a string id');
  }
  const claims = trackerClaims(issue);
  return {
    id: projectionId(issue.id),
    workspace: null,
    work: null,
    tracker: 'beads',
    external_id: issue.id,
    field_authority: SESSION_FIELD_AUTHORITY,
    state: 'projected',
    fields: { landed: claims.landed, in_flight: claims.in_flight },
    raw_record: structuredClone(issue),
    importedAt: null,
    reconciledAt: null,
  };
}

/**
 * The contradictions a bead's own fields can hold, independent of the repo.
 *
 * One rule so far, and it is the one the ritual states outright: the moment the
 * next move belongs to Gerald the claim is released, so `human` and
 * `in_progress` together mean a session claimed a bead it cannot advance.
 */
export function ritualContradictions(issue: BeadIssue): RitualContradiction[] {
  const found: RitualContradiction[] = [];
  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  if (isInProgress(issue.status) && labels.includes('human')) {
    found.push({
      external_id: issue.id,
      rule: 'human-labelled-bead-is-in-progress',
      detail:
        'the next move belongs to Gerald, so no session can be working it — release the claim and set status back to open',
    });
  }
  return found;
}

/**
 * Reconcile the whole bead set against the repo.
 *
 * Beads with no evidence entry are skipped rather than assumed drifted: this
 * runs on a partial gather (a commit-time hook does not walk every branch), and
 * a checker that reported everything it failed to look at would be noise that
 * gets turned off, which is the failure mode scripts/hooks/repo-gate.mjs exists
 * to avoid.
 */
export function reconcileSession(
  issues: readonly BeadIssue[],
  evidence: EvidenceBySlug,
  reconciledAt: string,
): SessionDriftReport {
  const examined = (issues ?? []).filter((issue) => issue && issue.id in evidence);
  const projections = examined.map(projectBead);
  const liveIssues = examined.map(trackerClaims);
  const domainRecords: Record<string, Record<string, unknown>> = {};
  for (const issue of examined) domainRecords[issue.id] = repoAnswers(evidence[issue.id]);

  const report = reconcileAll(projections, liveIssues, reconciledAt, { domainRecords });
  const contradictions = (issues ?? []).flatMap(ritualContradictions);

  // A bead's own notes can settle a disagreement, so the working list holds only
  // what nobody has accounted for yet. Settled entries are kept and counted
  // rather than dropped: the reconcile still says how much of the board it is
  // taking on trust.
  const byId = new Map((issues ?? []).map((issue) => [issue?.id, issue] as const));
  const drifted: DriftReport['drifted'][number][] = [];
  const adjudicated: DriftReport['drifted'][number][] = [];
  for (const result of report.drifted) {
    const settled = adjudicatedConflicts(byId.get(result.external_id));
    const live = result.conflicts.filter((c) => !settled.has(conflictKey(c.field, c.tracker)));
    if (live.length === 0) adjudicated.push(result);
    else if (live.length === result.conflicts.length) drifted.push(result);
    else drifted.push({ ...result, conflicts: live });
  }

  const ok = drifted.length === 0 && report.missing.length === 0;
  return {
    ...report,
    ok,
    counts: { ...report.counts, drifted: drifted.length, adjudicated: adjudicated.length },
    drifted,
    adjudicated,
    contradictions,
    clean: ok && contradictions.length === 0,
  };
}

/**
 * Name a conflict in the terms a person can act on. The reconcile vocabulary
 * says which field disagreed; this says what to do about it, and the direction
 * matters — the two ways `landed` can disagree call for opposite fixes.
 */
export function describeConflict(field: string, domain: unknown, tracker: unknown): string {
  if (field === 'landed') {
    return tracker === true
      ? 'closed, but no commit on main names it — undone work, or work stranded on an unmerged branch'
      : 'a commit on main names it, but it is still open — a close nobody ran';
  }
  if (field === 'in_flight') {
    return tracker === true
      ? 'in_progress, but nothing is in flight — an abandoned claim from a session that did not close out'
      : 'work in flight, but the bead is not claimed — claim it so a second session does not pick it up';
  }
  return `${field}: repo says ${JSON.stringify(domain)}, tracker says ${JSON.stringify(tracker)}`;
}
