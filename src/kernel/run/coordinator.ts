/**
 * kernel/run/coordinator.ts — the bounded run coordinator: it takes leased
 * tasks off the store, dispatches them to a host, and writes down what happened.
 *
 * Bounded, and deliberately not a pool. There is no worker abstraction, no
 * queue service, no supervision tree — STRATEGY calls an agent pool enterprise
 * cosplay at this scale and it is right: the whole thing is a loop that keeps at
 * most N invocations in flight. Everything that would normally justify a pool
 * (durability, recovery, deduplication) lives in the task rows instead, where it
 * survives the process dying. See store/tasks.ts for the lease and its fence.
 *
 * What this module owns:
 *   - the concurrency bound, so a ten-domain outcome does not open ten hosts;
 *   - the global spend ceiling, checked before each dispatch (STRATEGY risk 6:
 *     cost outrunning a solo maintainer);
 *   - a work log entry for every dispatch and every settle, so a run is
 *     accountable in each role's name (commitment 4) whether it succeeded or not.
 *
 * What it does not own: retries, model choice, tool brokering, session state.
 * Those are the host's, and rebuilding any of them here is the homebrew-runtime
 * creep commitment 1 forbids.
 *
 * The clock is injected as a function rather than a value because a coordinator
 * runs across time — leases expire while it works. `clock()` is the only way
 * this module learns what time it is; there is no `new Date()` below.
 */

import { appendWorkLog } from '../store/worklog.ts';
import {
  StaleLeaseError,
  claimTask,
  completeTask,
  failTask,
  totalSpend,
} from '../store/tasks.ts';
import type { LeasedTask } from '../store/tasks.ts';
import type { Store } from '../store/open.ts';
import type { HostAdapter, HostResult } from '../hosts/interface.ts';
import type { Brief } from '../brief/schema.ts';
import { DOMAINS, domainsByName } from '../implication/domains.ts';
import type { Domain } from '../implication/domains.ts';

export const DEFAULT_CONCURRENCY = 2;

/**
 * A lease must outlive the host's own timeout. If it does not, a slow-but-alive
 * invocation looks crashed, the coordinator re-claims its task and dispatches a
 * second copy — self-inflicted duplicate work. The fencing token still keeps the
 * result correct (the loser's settle is dropped), so the damage is wasted spend
 * rather than corruption, but the default is set above the OpenCode adapter's
 * ten-minute timeout so it does not happen at all.
 */
export const DEFAULT_LEASE_MS = 15 * 60 * 1000;

/** now + ms, as ISO. Parsing a supplied string reads no clock. */
function deadline(now: string, ms: number): string {
  return new Date(Date.parse(now) + ms).toISOString();
}

/** Why dispatch stopped before the queue was empty. Null means it emptied. */
export type HaltReason = 'spend-ceiling';

export interface CoordinatorOptions {
  /** Identifies this process's leases. Two coordinators must not share one. */
  readonly owner: string;
  /** Injected; the kernel never reads the clock. */
  readonly clock: () => string;
  /**
   * Total spend allowed across every run in this store, in the host's own cost
   * units. Reaching it halts dispatch; it does not kill work already in flight.
   */
  readonly spendCeiling: number;
  readonly concurrency?: number;
  readonly leaseMs?: number;
  /** Work only this run. Omit to work whatever is claimable. */
  readonly run?: string;
  /** Domain catalog the assignment text is built from. */
  readonly catalog?: readonly Domain[];
}

export interface RunReport {
  readonly dispatched: number;
  readonly completed: number;
  readonly failed: number;
  /**
   * Ids this invocation settled, in settle order. Reported rather than left to
   * the caller to infer from the store, because "what this run did" and "what
   * the store contains" are different sets the moment a second run exists.
   */
  readonly settled: readonly string[];
  /** Settles dropped because the lease had been taken over. */
  readonly staleSettles: number;
  /** Tasks claimed whose previous lease had expired — recovered crashed work. */
  readonly recovered: number;
  readonly spendBefore: number;
  readonly spendAfter: number;
  readonly spendCeiling: number;
  /**
   * Completions where the host reported no cost at all. The ceiling cannot bind
   * on these, and saying so is the difference between a measured bound and an
   * assumed one.
   */
  readonly costSilent: number;
  readonly halted: HaltReason | null;
}

/**
 * What the role is being asked to do, in words.
 *
 * Built here rather than stored on the brief because a brief declares what a
 * task NEEDS — inputs, capabilities, postconditions — and the moment it also
 * carried the prompt it would be orchestrating itself, which is what commitment
 * 10 separates. The domain's own stated concern is what makes the assignment
 * specific, and it comes from the catalog, so a role outside the catalog gets an
 * assignment that says only what is actually known about it.
 */
export function assignmentFor(brief: Brief, catalog: readonly Domain[] = DOMAINS): string {
  const domain = domainsByName(catalog).get(brief.role);
  const concern = domain ? `\nYour concern: ${domain.concern}.` : '';
  return (
    `You are acting as the ${brief.role} role.${concern}\n\n` +
    `The outcome the user asked for: ${brief.outcome}\n\n` +
    'Report what this outcome implicates in your domain: what needs to be true, ' +
    'what is likely to be missed, and what you cannot determine from the outcome ' +
    'alone. Do not assert anything you cannot support. Be brief.'
  );
}

/**
 * Host-reported cost of one invocation, and whether it was reported at all.
 *
 * The shape is the host's, so this reads defensively: an adapter that reports
 * nothing yields 0 with `reported: false`, and the caller can tell a genuinely
 * free local run from an unmeasured one. Treating both as zero is how a spend
 * ceiling turns into an assurance nobody checked.
 *
 * `steps` is the second half of that check, and it was added after a live run
 * rather than in anticipation: OpenCode against a local model returned a
 * complete deliverable with zero step_finish events, so the adapter's summed
 * usage was a well-formed envelope of zeroes. Cost 0 out of 0 measurements is
 * not "this run was free", and reporting it as free is precisely the false
 * assurance this function exists to prevent. A usage envelope that says how many
 * measurements it summed and answers none is unmeasured.
 */
export function spendOf(result: HostResult): { spend: number; reported: boolean } {
  const output = result.output as { usage?: { cost?: unknown; steps?: unknown } } | null;
  const cost = output?.usage?.cost;
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return { spend: 0, reported: false };
  const steps = output?.usage?.steps;
  if (typeof steps === 'number' && steps <= 0) return { spend: 0, reported: false };
  return { spend: cost, reported: true };
}

function summarize(result: HostResult): Record<string, unknown> {
  const output = result.output as
    | { text?: unknown; toolCalls?: unknown[]; failedToolCalls?: unknown[]; usage?: unknown }
    | null;
  const text = typeof output?.text === 'string' ? output.text : '';
  return {
    chars: text.length,
    toolCalls: Array.isArray(output?.toolCalls) ? output.toolCalls.length : 0,
    failedToolCalls: Array.isArray(output?.failedToolCalls) ? output.failedToolCalls.length : 0,
    usage: output?.usage ?? null,
  };
}

/**
 * Work the claimable tasks until the queue empties or the spend ceiling stops
 * dispatch.
 *
 * The ceiling is checked before each claim, never mid-invocation: money already
 * committed to a running host is spent whether or not the result is collected,
 * so killing in-flight work to enforce a budget wastes exactly what it is
 * protecting. Halting means claiming nothing further; unclaimed tasks stay
 * pending and a later run with a raised ceiling picks them up.
 */
export async function workRun(
  store: Store,
  host: HostAdapter,
  options: CoordinatorOptions,
): Promise<RunReport> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const leaseMs = Math.max(1, options.leaseMs ?? DEFAULT_LEASE_MS);
  const catalog = options.catalog ?? DOMAINS;
  const spendBefore = totalSpend(store);

  let dispatched = 0;
  let completed = 0;
  let failed = 0;
  let staleSettles = 0;
  let recovered = 0;
  let costSilent = 0;
  let halted: HaltReason | null = null;
  const settled: string[] = [];

  const inFlight = new Set<Promise<void>>();
  // A dispatch that throws something other than a stale lease means the store
  // itself is unusable. It is captured rather than left to reject on its own,
  // because an unattended rejection would surface as an unhandled promise while
  // the loop was awaiting a different one — the error must arrive after the
  // in-flight work settles, not instead of it.
  let fatal: unknown = null;

  async function dispatch(task: LeasedTask): Promise<void> {
    const brief = task.brief as Brief;
    appendWorkLog(store, {
      run: task.run,
      task: task.id,
      role: task.role,
      action: 'role-dispatched',
      detail: { host: host.name, attempt: task.token },
      at: options.clock(),
    });

    let result: HostResult;
    try {
      result = await host.invoke(
        { role: task.role, task: assignmentFor(brief, catalog) },
        { invocationId: task.id },
      );
    } catch (error) {
      result = {
        id: task.id,
        status: 'error',
        output: null,
        error: { message: (error as Error).message, name: (error as Error).name },
      };
    }

    const settledAt = options.clock();
    try {
      if (result.status === 'ok') {
        const cost = spendOf(result);
        if (!cost.reported) costSilent += 1;
        completeTask(store, {
          id: task.id,
          owner: task.leaseOwner,
          token: task.token,
          result: result.output,
          spend: cost.spend,
          spendReported: cost.reported,
          at: settledAt,
        });
        completed += 1;
        settled.push(task.id);
        appendWorkLog(store, {
          run: task.run,
          task: task.id,
          role: task.role,
          action: 'role-reported',
          detail: { ...summarize(result), spend: cost.spend, spendReported: cost.reported },
          at: settledAt,
        });
        return;
      }

      failTask(store, {
        id: task.id,
        owner: task.leaseOwner,
        token: task.token,
        error: result.error ?? { status: result.status },
        at: settledAt,
      });
      failed += 1;
      settled.push(task.id);
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'role-failed',
        detail: { status: result.status, error: result.error },
        at: settledAt,
      });
    } catch (error) {
      if (!(error instanceof StaleLeaseError)) throw error;
      // Another worker finished this task while this one was still running. Its
      // result is dropped, not merged: the task is done exactly once, and the
      // takeover is recorded so the wasted invocation is visible rather than
      // silently absorbed.
      staleSettles += 1;
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'settle-dropped-stale-lease',
        detail: { attempt: task.token, reason: error.message },
        at: settledAt,
      });
    }
  }

  for (;;) {
    if (fatal !== null) break;

    if (totalSpend(store) >= options.spendCeiling) {
      halted = 'spend-ceiling';
      break;
    }

    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
      continue;
    }

    const now = options.clock();
    const task = claimTask(store, {
      owner: options.owner,
      leaseUntil: deadline(now, leaseMs),
      now,
      run: options.run,
    });

    if (!task) {
      if (inFlight.size === 0) break;
      await Promise.race(inFlight);
      continue;
    }

    dispatched += 1;
    // attempts > 1 means this task had been claimed before and its lease ran
    // out — a crashed run, returning to circulation.
    if (task.token > 1) {
      recovered += 1;
      appendWorkLog(store, {
        run: task.run,
        task: task.id,
        role: task.role,
        action: 'lease-recovered',
        detail: { attempt: task.token },
        at: now,
      });
    }

    const running = dispatch(task)
      .catch((error: unknown) => {
        fatal ??= error;
      })
      .finally(() => inFlight.delete(running));
    inFlight.add(running);
  }

  await Promise.all(inFlight);
  if (fatal !== null) throw fatal;

  const spendAfter = totalSpend(store);
  if (halted !== null) {
    appendWorkLog(store, {
      run: options.run ?? 'all',
      role: 'construct',
      action: 'dispatch-halted',
      detail: { reason: halted, spend: spendAfter, ceiling: options.spendCeiling },
      at: options.clock(),
    });
  }

  return {
    dispatched,
    completed,
    failed,
    settled,
    staleSettles,
    recovered,
    spendBefore,
    spendAfter,
    spendCeiling: options.spendCeiling,
    costSilent,
    halted,
  };
}
