/**
 * kernel/run/outcome.ts — the deterministic spine: an outcome in, a run
 * recorded, implications inferred, a work log entry per inferred domain, and one
 * task enqueued per implicated role.
 *
 * This is the half of "outcome -> deliverable" that does not need a host. It
 * infers the invisible roles (commitment 1) and files what it did in each one's
 * name (commitment 4) before any model is invoked. Executing those tasks —
 * dispatching them to a host adapter and collecting deliverables — is the
 * coordinator's job (run/coordinator.ts) and rides on top of this.
 *
 * Clock and identity are injected. The kernel neither reads the clock nor
 * invents an id, so the same outcome recorded with the same run id and timestamp
 * produces byte-identical state — which is what makes a replayed run comparable
 * to the original. Task ids are derived from the run id and the domain for the
 * same reason: recording the same run twice must enqueue the work once.
 */

import { mapImplications } from '../implication/map.ts';
import type { Domain } from '../implication/domains.ts';
import type { Implication } from '../implication/map.ts';
import { appendWorkLog } from '../store/worklog.ts';
import { enqueueTask } from '../store/tasks.ts';
import { transact } from '../store/open.ts';
import type { Store } from '../store/open.ts';
import type { Brief } from '../brief/schema.ts';

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
  /** Ids of the tasks enqueued for the coordinator, one per implicated role. */
  readonly tasks: readonly string[];
}

/** Deterministic, so re-recording a run enqueues its work once. */
export function taskId(runId: string, domain: string): string {
  return `${runId}:${domain}`;
}

/**
 * The brief for one implicated role. It declares what the task needs and
 * nothing about how to do it — no tool, no host, no order of operations
 * (commitment 10). `capabilities` is empty because an issue-spotting pass over
 * the outcome text needs nothing beyond the host's base; `postconditions` is
 * empty because the role's registered defaults apply, which is not the same as
 * unverified.
 */
function briefFor(input: StartRunInput, implication: Implication): Brief {
  return {
    id: taskId(input.runId, implication.domain),
    outcome: input.outcome,
    role: implication.domain,
    inputs: [
      { name: 'outcome', description: "the outcome, in the user's words", required: true },
    ],
    capabilities: [],
    postconditions: [],
  };
}

/**
 * Record a new outcome: infer its implicated domains, write the inference — and
 * its evidence — to the work log, and enqueue one task per implicated role.
 *
 * The whole thing is one transaction. A half-recorded run whose log lists three
 * of five inferred domains is indistinguishable from a run that only inferred
 * three, and the work log is the record the user is asked to trust. Enqueuing
 * joins that transaction for the same reason: a run whose log claims five roles
 * but whose queue holds three would have the accountability record and the work
 * disagreeing.
 *
 * An outcome that implicates nothing is still recorded, with that fact stated.
 * Silence would be indistinguishable from the run never happening.
 */
export function startRun(store: Store, input: StartRunInput): StartedRun {
  const map = mapImplications({ outcome: input.outcome, catalog: input.catalog });

  return transact(store, () => {
    const logged: number[] = [];
    const tasks: string[] = [];

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
      const brief = briefFor(input, implication);
      logged.push(
        appendWorkLog(store, {
          run: input.runId,
          task: brief.id,
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
      // False on a replay: the task is already queued, and enqueuing it again
      // would turn a resumed run into a duplicated one.
      if (
        enqueueTask(store, {
          id: brief.id,
          run: input.runId,
          role: implication.domain,
          brief,
          at: input.at,
        })
      ) {
        tasks.push(brief.id);
      }
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

    return {
      runId: input.runId,
      outcome: input.outcome,
      implicated: map.implicated,
      logged,
      tasks,
    };
  });
}
