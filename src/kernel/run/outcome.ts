/**
 * kernel/run/outcome.ts — the deterministic spine: an outcome in, a run
 * recorded, implications inferred, and a work log entry per inferred domain.
 *
 * This is the half of "outcome -> deliverable" that does not need a host. It
 * infers the invisible roles (commitment 1) and files what it did in each one's
 * name (commitment 4) before any model is invoked. Execution — dispatching the
 * briefs to a host adapter and collecting deliverables — is the coordinator's
 * job and rides on top of this.
 *
 * Clock and identity are injected. The kernel neither reads the clock nor
 * invents an id, so the same outcome recorded with the same run id and timestamp
 * produces byte-identical state — which is what makes a replayed run comparable
 * to the original.
 */

import { mapImplications } from '../implication/map.ts';
import type { Domain } from '../implication/domains.ts';
import type { Implication } from '../implication/map.ts';
import { appendWorkLog } from '../store/worklog.ts';
import { transact } from '../store/open.ts';
import type { Store } from '../store/open.ts';

export interface StartRunInput {
  readonly runId: string;
  readonly outcome: string;
  /** Injected; the kernel never reads the clock. */
  readonly at: string;
  readonly catalog?: readonly Domain[];
}

export interface StartedRun {
  readonly runId: string;
  readonly outcome: string;
  readonly implicated: readonly Implication[];
  /** Sequence numbers of the work log entries this run wrote. */
  readonly logged: readonly number[];
}

/**
 * Record a new outcome: infer its implicated domains and write the inference —
 * and its evidence — to the work log.
 *
 * The whole thing is one transaction. A half-recorded run whose log lists three
 * of five inferred domains is indistinguishable from a run that only inferred
 * three, and the work log is the record the user is asked to trust.
 *
 * An outcome that implicates nothing is still recorded, with that fact stated.
 * Silence would be indistinguishable from the run never happening.
 */
export function startRun(store: Store, input: StartRunInput): StartedRun {
  const map = mapImplications({ outcome: input.outcome, catalog: input.catalog });

  return transact(store, () => {
    const logged: number[] = [];

    logged.push(
      appendWorkLog(store, {
        run: input.runId,
        role: 'construct',
        action: 'outcome-received',
        detail: { outcome: input.outcome },
        at: input.at,
      }),
    );

    for (const implication of map.implicated) {
      logged.push(
        appendWorkLog(store, {
          run: input.runId,
          task: implication.domain,
          role: implication.domain,
          action: 'domain-implicated',
          detail: {
            concern: implication.concern,
            score: implication.score,
            signals: implication.signals,
          },
          at: input.at,
        }),
      );
    }

    if (map.implicated.length === 0) {
      logged.push(
        appendWorkLog(store, {
          run: input.runId,
          role: 'construct',
          action: 'no-domains-implicated',
          detail: { outcome: input.outcome },
          at: input.at,
        }),
      );
    }

    return { runId: input.runId, outcome: input.outcome, implicated: map.implicated, logged };
  });
}
