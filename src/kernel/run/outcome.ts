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
import { mapImplicationsNamed } from '../implication/naming.ts';
import type { DomainNamer, NamingCache, InferredBy } from '../implication/naming.ts';
import { domainsByName } from '../implication/domains.ts';
import type { Domain } from '../implication/domains.ts';
import type { Implication } from '../implication/map.ts';
import { appendWorkLog } from '../store/worklog.ts';
import { enqueueTask } from '../store/tasks.ts';
import { transact } from '../store/open.ts';
import type { Store } from '../store/open.ts';
import { SPINE_CHALLENGES } from '../challenge/catalog.ts';
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
  /**
   * How these implications were reached. Travels out of the kernel because the
   * CLI must be able to tell a user that an answer cost money and rests on a
   * model's stated reason rather than on a cited keyword.
   */
  readonly inferredBy: InferredBy;
  /**
   * Present when a supplied namer threw and the keyword map answered in its
   * place. Travels out for the same reason `inferredBy` does: a fallback the
   * user cannot see is a keyword answer impersonating a model's.
   */
  readonly namerFailure?: string;
}

export interface StartRunNamedInput extends StartRunInput {
  /** Absent means the zero-model fallback: behaves exactly like `startRun`. */
  readonly namer?: DomainNamer;
  readonly cache?: NamingCache;
  /** Named in the work log when a model is consulted, so the cost has a source. */
  readonly host?: string;
  /**
   * What the namer reads, when intake produced a densified form of a rough
   * framing. The recorded outcome stays `outcome` — the user's words — in
   * every case; this only redirects the inference's input.
   */
  readonly namerText?: string;
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
function briefFor(
  input: StartRunInput,
  implication: Implication,
  inferredBy: InferredBy,
): Brief {
  return {
    id: taskId(input.runId, implication.domain),
    outcome: input.outcome,
    role: implication.domain,
    inputs: [
      { name: 'outcome', description: "the outcome, in the user's words", required: true },
    ],
    capabilities: [],
    postconditions: [],
    // Declared here rather than left empty, because an empty list reads as
    // "nothing is pending" when it means "nobody required anything" — and a
    // deliverable that asserts statutes it did not source promoted straight
    // past draft on the strength of no one asking.
    challenges: SPINE_CHALLENGES,
    // The evidence that engaged this role travels with the work. Dropping it
    // here is what made a role start blind to which concern fired. An
    // implication with nothing cited carries no engagement rather than an
    // empty one, which would claim evidence that does not exist.
    ...(implication.signals.length > 0
      ? {
          engagement: {
            concern: implication.concern,
            evidence: implication.signals,
            inferredBy,
          },
        }
      : {}),
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
  return record(store, input, map.implicated, map.implicated.length > 0 ? 'keywords' : 'none');
}

/**
 * The same run, with the namer primary: when one is supplied it reads every
 * outcome, and the keyword map only answers if the namer fails
 * (adopted 2026-08-05 on the §10 figures).
 *
 * Async and separate from `startRun` on purpose. Recording an outcome is the
 * one spine operation that is pure and free, and a caller must not be able to
 * reach the paid path by accident — it takes a different function and an
 * explicitly supplied namer. Without a namer this is `startRun` with an extra
 * await: the deterministic path still does no I/O and costs nothing.
 *
 * The model call happens OUTSIDE the transaction, and must: a transaction held
 * open across a network round trip blocks every other writer of this store for
 * as long as a model takes to answer.
 */
export async function startRunNamed(
  store: Store,
  input: StartRunNamedInput,
): Promise<StartedRun> {
  const map = await mapImplicationsNamed({
    outcome: input.namerText ?? input.outcome,
    catalog: input.catalog,
    namer: input.namer,
    cache: input.cache,
  });
  return record(store, input, map.implicated, map.inferredBy, input.host, map.namerFailure);
}

export interface StartRunSelectedInput extends StartRunInput {
  /** The domains the user named, in their own words, in the order given. */
  readonly domains: readonly string[];
}

/** The evidence a user-named implication cites. It is not a keyword and not a
 * model's reason, and the record must not let it read as either. */
export const USER_NAMED_SIGNAL = 'named by the user';

/**
 * Record an outcome against domains the user named outright.
 *
 * Inference exists for the user who does not know what to ask for; a user who
 * does must be able to say so. This path skips the map and the namer entirely
 * — no keywords, no model, no cost — but not the catalog: a named domain is
 * validated exactly as a namer's proposal is, and a domain nobody defined is an
 * error listing what exists rather than a role invented on the spot.
 *
 * The provenance is its own value ('user'), because a user's own choice is not
 * an inference and the work log must not show it as one.
 */
export function startRunSelected(store: Store, input: StartRunSelectedInput): StartedRun {
  const catalog = domainsByName(input.catalog);
  const seen = new Set<string>();
  const implicated: Implication[] = [];

  for (const name of input.domains) {
    const domain = catalog.get(name);
    if (!domain) {
      throw new RangeError(
        `unknown domain "${name}" — the catalog is: ${[...catalog.keys()].join(', ')}`,
      );
    }
    if (seen.has(name)) continue;
    seen.add(name);
    implicated.push({
      domain: domain.domain,
      concern: domain.concern,
      // No keyword scored this and no model argued for it; a number here would
      // invite comparison with scores that mean something else.
      score: 0,
      signals: [USER_NAMED_SIGNAL],
    });
  }

  return record(store, input, implicated, 'user');
}

function record(
  store: Store,
  input: StartRunInput,
  implicated: readonly Implication[],
  inferredBy: InferredBy,
  host?: string,
  namerFailure?: string,
): StartedRun {
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

    // A consulted model is logged whether or not it named anything. A
    // consultation that cost money and produced silence is exactly the entry a
    // user needs to see, and the one a "log it if it worked" rule would drop.
    if (inferredBy === 'namer' || inferredBy === 'cache') {
      logged.push(
        appendWorkLog(store, {
          run: input.runId,
          role: 'construct',
          action: 'implication-named',
          detail: {
            outcome: input.outcome,
            inferredBy,
            host: host ?? null,
            named: implicated.length,
          },
          at: input.at,
        }),
      );
    }

    // The degradation note: when the namer threw and keywords
    // caught the run, the log says so, because a keyword answer standing in
    // for a model's must never read identically to the model answering.
    if (namerFailure !== undefined) {
      logged.push(
        appendWorkLog(store, {
          run: input.runId,
          role: 'construct',
          action: 'namer-failed',
          detail: {
            outcome: input.outcome,
            host: host ?? null,
            failure: namerFailure,
            fellBackTo: inferredBy,
          },
          at: input.at,
        }),
      );
    }

    for (const implication of implicated) {
      const brief = briefFor(input, implication, inferredBy);
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
            // An implication that cost a model call and cites a stated reason
            // must not read identically to one that cites a keyword.
            inferredBy,
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

    if (implicated.length === 0) {
      logged.push(
        appendWorkLog(store, {
          run: input.runId,
          role: 'construct',
          action: 'no-domains-implicated',
          detail: { outcome: input.outcome, inferredBy },
          at: input.at,
        }),
      );
    }

    return {
      runId: input.runId,
      outcome: input.outcome,
      implicated,
      logged,
      tasks,
      inferredBy,
      ...(namerFailure !== undefined ? { namerFailure } : {}),
    };
  });
}
