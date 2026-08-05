/**
 * kernel/watch/construct-ground.ts — the first watched ground is Construct.
 *
 * Commitment 16 says Construct is the first organization Construct monitors,
 * and until now that was a ritual a session performed by hand at its
 * boundaries. Sessions end abnormally, and the ones that do are exactly the
 * ones that leave the tracker asserting things the repo stopped agreeing with.
 * This module turns that ritual's output into watch findings, so the drift
 * arrives in the decision inbox instead of waiting for someone to remember to
 * look.
 *
 * The judgement it converts is not re-derived here. tracker/session-drift.ts
 * already decides what has drifted and describes each conflict in actionable
 * terms; this reads that report and frames it as a decision. A second opinion
 * about the same evidence would be a second matcher for the same job.
 *
 * The framing is the work. A reconcile report says "closed, but no commit on
 * main names it" and leaves a person to work out whether that matters; a
 * finding has to say what is at stake either way and which branch is safe to
 * take by default. Both directions of `landed` drift have a known benign cause
 * (a close that predates the commit-trailer convention, or work that landed on
 * a branch never merged), and the honest default is to record the cause rather
 * than to reopen work or to delete a close.
 */

import { describeConflict } from '../tracker/session-drift.ts';
import type { SessionDriftReport } from '../tracker/session-drift.ts';
import type { Finding } from './watch.ts';

/** Ground worth naming, so the watch's outcome text reads like an outcome. */
export const CONSTRUCT_GROUND =
  'Construct itself: the strategy, the tracker, and the repo staying in agreement';

interface Framing {
  readonly question: string;
  readonly stakeIfAccepted: string;
  readonly stakeIfFixed: string;
  readonly reversible: string;
  readonly wouldHaveCaught: string;
}

/**
 * What each kind of drift actually costs, in both directions. The reconcile
 * vocabulary names the disagreement; this names the consequence, which is what
 * a person needs to decide with.
 */
function frame(field: string, trackerClaim: unknown): Framing {
  if (field === 'landed' && trackerClaim === true) {
    return {
      question:
        'Is this closed bead work that actually landed, or a close nobody earned?',
      stakeIfAccepted:
        'Accepting the close as correct: the program counts capability it may not have, and a later phase gate rests on it.',
      stakeIfFixed:
        'Reopening it: a session re-does work that landed before the commit-trailer convention existed, which is the common benign cause.',
      reversible:
        'Record why the close has no trailer commit (predates the convention, or landed on an unmerged branch) and leave it closed. Reversible: reopening later costs nothing, while re-doing landed work costs a session.',
      wouldHaveCaught: 'program-sequencing',
    };
  }
  if (field === 'landed') {
    return {
      question: 'A commit on main names this bead, but it is still open. Did the work finish?',
      stakeIfAccepted:
        'Leaving it open: the ready queue shows work that may be done, and the next session picks it up and finds nothing to do.',
      stakeIfFixed:
        'Closing it: a commit can legitimately touch a bead it did not finish, and closing on that evidence hides remaining work.',
      reversible:
        'Read the commit before deciding. Leaving it open is the reversible default: an open bead costs a session one read, a wrongly closed one costs the work.',
      wouldHaveCaught: 'program-sequencing',
    };
  }
  if (field === 'in_flight' && trackerClaim === true) {
    return {
      question: 'This bead is claimed but nothing is in flight. Is a session still working it?',
      stakeIfAccepted:
        'Leaving the claim: the bead is invisible to every other session, including yours tomorrow, and stays that way indefinitely.',
      stakeIfFixed:
        'Releasing it: if a session really is working it in a checkout this sweep cannot see, two sessions may now collide on the same bead.',
      reversible:
        'Release the claim and set the status back to open. Reversible: re-claiming takes one command, while an abandoned claim silently removes work from the queue.',
      wouldHaveCaught: 'program-sequencing',
    };
  }
  if (field === 'in_flight') {
    return {
      question: 'Work is in flight on this bead, but nobody claimed it. Whose is it?',
      stakeIfAccepted:
        'Leaving it unclaimed: a second session can pick up the same bead and duplicate the work already underway.',
      stakeIfFixed:
        'Claiming it: harmless if you are the one working it, misleading if the branch is stale.',
      reversible:
        'Claim it. Reversible: releasing a claim is one command, while duplicated work is discovered at merge time.',
      wouldHaveCaught: 'program-sequencing',
    };
  }
  return {
    question: `The tracker and the repo disagree about ${field}. Which is right?`,
    stakeIfAccepted: 'Leaving it: the tracker keeps asserting something the repo does not support.',
    stakeIfFixed: 'Changing it: the disagreement may be evidence this sweep cannot see.',
    reversible: 'Read the evidence before changing either side.',
    wouldHaveCaught: 'program-sequencing',
  };
}

/**
 * Turn a reconcile report into watch findings.
 *
 * One finding per drifted bead rather than per conflict: a bead that drifted on
 * both fields is one situation a person resolves once, and splitting it would
 * put the same read in the inbox twice.
 *
 * Contradictions inside the tracker's own claims become findings too, and they
 * are the more urgent kind: no repo evidence can settle them, so they will
 * never resolve themselves.
 */
export function constructFindings(report: SessionDriftReport): Finding[] {
  const findings: Finding[] = [];

  for (const drifted of report.drifted) {
    const conflicts = drifted.conflicts ?? [];
    if (conflicts.length === 0) continue;
    const primary = conflicts[0];
    const framing = frame(primary.field, primary.tracker);
    const evidence = conflicts
      .map((c) => describeConflict(c.field, c.domain, c.tracker))
      .join('; ');

    findings.push({
      // Keyed by bead and the fields that disagreed, so the same drift is the
      // same finding tomorrow, and a NEW field disagreeing is a new one.
      key: `drift:${drifted.external_id}:${conflicts.map((c) => c.field).sort().join('+')}`,
      trigger: `tracker and repo disagree about ${drifted.external_id}`,
      question: framing.question,
      branches: [
        { role: 'as-recorded', stance: framing.stakeIfAccepted, citation: evidence },
        { role: 'as-corrected', stance: framing.stakeIfFixed, citation: evidence },
        { role: 'reversible-default', stance: framing.reversible, citation: null },
      ],
      wouldHaveCaught: framing.wouldHaveCaught,
    });
  }

  for (const contradiction of report.contradictions) {
    findings.push({
      key: `contradiction:${contradiction.external_id}:${contradiction.rule}`,
      trigger: `the tracker contradicts itself about ${contradiction.external_id}`,
      question: 'Which of the two claims this bead makes about itself is true?',
      branches: [
        {
          role: 'as-recorded',
          stance:
            'Leaving it: no repo evidence can settle this one, so it will not resolve on its own and every later sweep reports it again.',
          citation: contradiction.detail,
        },
        {
          role: 'reversible-default',
          stance: `Fix the bead as the rule describes: ${contradiction.detail}. Reversible: every part of it is one tracker command.`,
          citation: contradiction.rule,
        },
      ],
      wouldHaveCaught: 'program-sequencing',
    });
  }

  return findings;
}
