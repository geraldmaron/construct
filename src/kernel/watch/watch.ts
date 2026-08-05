/**
 * kernel/watch/watch.ts — a watch is an outcome that never closes.
 *
 * The direction this serves: the same staff that works a pointed outcome also
 * keeps a standing watch over ground the user designates, surfacing what an
 * extra set of eyes would catch — strategies quietly diverging, initiatives
 * contending for the same resources, decisions that contradict each other.
 * Nothing on the market does this. The market builds agents that execute and
 * observability that watches the agents; nothing watches the organization.
 *
 * It is deliberately NOT a second subsystem, and that constraint shapes every
 * line below. A watch is a run whose outcome happens to be "keep watching X".
 * Its observations land in the same append-only work log, and its findings
 * surface in the same decision inbox as a conflict between two roles. There is
 * no watch table, no scheduler, and no daemon: something outside calls `sweep`,
 * exactly as something outside calls `construct work`. A watch that grew its
 * own storage and its own runtime would be the homebrew-runtime creep the
 * strategy vetoes, wearing a different hat.
 *
 * Two design decisions carry the weight:
 *
 *   1. A finding is raised ONCE. The decision id is derived from the watch and
 *      the finding's key, so the second sweep that sees the same divergence
 *      writes nothing. A watch that re-raised every standing finding on every
 *      sweep would train the user to ignore the inbox, which costs more than
 *      the watch is worth. The finding going away is not the same as it being
 *      resolved, so a disappearing finding closes nothing either — only the
 *      user resolves a decision.
 *   2. A finding is a risk assessment, not an alert. Amended commitment 11
 *      fixes the shape: what pattern triggered it, evidence that was actually
 *      checked, what is at stake down each branch, which branch is the
 *      reversible default, and the role that would normally have caught this.
 *      An alert that says "these disagree" and stops has handed the user the
 *      same work they were trying to delegate.
 */

import { appendWorkLog } from '../store/worklog.ts';
import { getDecision, raiseDecision } from '../store/decisions.ts';
import type { Position } from '../store/decisions.ts';
import { transact } from '../store/open.ts';
import type { Store } from '../store/open.ts';

export interface Watch {
  /** Stable id. Findings derive their decision ids from it, so it must not drift. */
  readonly id: string;
  /** What is being watched, in the user's words. */
  readonly ground: string;
}

/**
 * One thing a sweep noticed, in the shape amended commitment 11 requires of
 * every decision this phase raises.
 */
export interface Finding {
  /**
   * Stable within a watch: the same divergence must produce the same key on
   * every sweep, or the watch raises it again every time it looks.
   */
  readonly key: string;
  /** The pattern that fired, named — not "something changed". */
  readonly trigger: string;
  /** The call the user has to make, in one question. */
  readonly question: string;
  /** The branches, each with what is at stake and the evidence checked. */
  readonly branches: readonly Position[];
  /** The role whose standing job this would normally be. */
  readonly wouldHaveCaught: string;
}

/** The run id a watch's entries and decisions belong to. */
export function watchRun(watch: Watch): string {
  return `watch-${watch.id}`;
}

function decisionId(watch: Watch, key: string): string {
  return `${watchRun(watch)}:${key}`;
}

/**
 * Begin watching, once. The standing outcome is recorded in the work log like
 * any other, so a watch's first entry reads the same as a pointed run's and
 * needs no special reader.
 *
 * Idempotent by the caller's discipline rather than by a lookup: re-recording
 * a watch appends a second `watch-started` entry, which is a true statement
 * about what happened and not a corruption.
 */
export function startWatch(store: Store, watch: Watch, at: string): string {
  const run = watchRun(watch);
  appendWorkLog(store, {
    run,
    role: 'construct',
    action: 'watch-started',
    detail: { watch: watch.id, ground: watch.ground },
    at,
  });
  return run;
}

export interface SweepResult {
  readonly run: string;
  /** Findings raised as new decisions by this sweep. */
  readonly raised: readonly string[];
  /** Findings the watch had already raised, so nothing was written for them. */
  readonly standing: readonly string[];
}

/**
 * Record one sweep: raise what is new, stay quiet about what is standing.
 *
 * Every sweep writes a `watch-swept` entry whether or not it found anything,
 * because a watch that only writes when it is unhappy is indistinguishable
 * from a watch that stopped running. That distinction is the whole value of a
 * standing watch, and it is the one a silent implementation destroys.
 */
export function sweepWatch(
  store: Store,
  input: { readonly watch: Watch; readonly findings: readonly Finding[]; readonly at: string },
): SweepResult {
  const { watch, findings, at } = input;
  const run = watchRun(watch);

  return transact(store, () => {
    const raised: string[] = [];
    const standing: string[] = [];

    for (const finding of findings) {
      const id = decisionId(watch, finding.key);
      if (getDecision(store, id)) {
        standing.push(finding.key);
        continue;
      }

      raiseDecision(store, {
        id,
        run,
        // The trigger travels in the question because the user reads the
        // question and nothing else before deciding whether to care.
        question: `${finding.trigger}: ${finding.question}`,
        positions: [
          ...finding.branches,
          // Named as a position rather than as prose so it is as visible as the
          // branches are. The user's own follow-up question is always "who
          // should have caught this", and answering it unasked is the point.
          {
            role: finding.wouldHaveCaught,
            stance: 'this is the concern that would normally have caught this, watching continuously rather than at a session boundary',
            citation: null,
          },
        ],
        raisedAt: at,
      });

      appendWorkLog(store, {
        run,
        role: 'construct',
        action: 'watch-found',
        detail: { watch: watch.id, key: finding.key, trigger: finding.trigger, decision: id },
        at,
      });
      raised.push(finding.key);
    }

    appendWorkLog(store, {
      run,
      role: 'construct',
      action: 'watch-swept',
      detail: {
        watch: watch.id,
        ground: watch.ground,
        found: findings.length,
        raised: raised.length,
        standing: standing.length,
      },
      at,
    });

    return { run, raised, standing };
  });
}
