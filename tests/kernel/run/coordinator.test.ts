/**
 * tests/kernel/run/coordinator.test.ts — the four properties construct-r67.5
 * exists for: the concurrency bound holds, a crashed run's work comes back, a
 * resumed run does not duplicate what finished, and the spend ceiling halts
 * dispatch.
 *
 * The host is a fake, and deliberately so. What is under test here is the
 * coordinator's bookkeeping under interleaving and failure, which a real host
 * makes slower and less deterministic without making it more true. The real
 * host is exercised by tests/hosts/opencode and by scripts/probe-opencode-conformance.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import {
  claimTask,
  completeTask,
  enqueueTask,
  failTask,
  getTask,
  listTasks,
  totalSpend,
} from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { assignmentFor, spendOf, workRun } from '../../../src/kernel/run/coordinator.ts';
import { deliverableConcerns, licensedReviewFor } from '../../../src/kernel/run/accountability.ts';
import { DOMAINS } from '../../../src/kernel/implication/domains.ts';
import type { HostAdapter, HostContext, HostResult } from '../../../src/kernel/hosts/interface.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const AT = '2026-08-03T00:00:00.000Z';
const LATER = '2026-08-03T01:00:00.000Z';

function withStore<T>(fn: (store: Store) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

/**
 * The async twin, and not a nicety: passing an async function to the sync one
 * closes the database while the coordinator is still writing to it. That is a
 * real failure ("database is not open") and it is the same trap the CLI's own
 * withStoreAsync exists to avoid.
 */
async function withStoreAsync<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return await fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

function brief(role: string): Brief {
  return {
    id: `t-${role}`,
    outcome: 'launch a paid beta to EU users next month',
    role,
    inputs: [],
    capabilities: [],
    postconditions: [],
  };
}

function seed(store: Store, roles: readonly string[]): void {
  for (const role of roles) {
    enqueueTask(store, { id: `t-${role}`, run: 'run-1', role, brief: brief(role), at: AT });
  }
}

interface FakeOptions {
  readonly cost?: number | null;
  readonly delayMs?: number;
  readonly fail?: (role: string) => boolean;
  readonly emptyText?: (role: string) => boolean;
  readonly onInvoke?: (role: string) => void | Promise<void>;
}

interface FakeHost extends HostAdapter {
  readonly seen: string[];
  readonly maxInFlight: number;
}

/** A host that records what it was asked to do and how much of it overlapped. */
function fakeHost(options: FakeOptions = {}): FakeHost {
  const seen: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const host = {
    name: 'fake',
    kind: 'general',
    capabilities: ['concurrent'] as const,
    seen,
    get maxInFlight(): number {
      return maxInFlight;
    },
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    async invoke(request: unknown, context?: HostContext): Promise<HostResult> {
      const req = request as { role: string; task: string };
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      seen.push(req.role);
      try {
        await options.onInvoke?.(req.role);
        if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        const id = context?.invocationId ?? req.role;
        if (options.fail?.(req.role)) {
          return { id, status: 'error', output: null, error: { messages: ['host said no'] } };
        }
        const usage = options.cost === null ? {} : { usage: { cost: options.cost ?? 0, steps: 1 } };
        const text = options.emptyText?.(req.role) ? '' : `${req.role} reporting`;
        return { id, status: 'ok', output: { text, ...usage }, error: null };
      } finally {
        inFlight -= 1;
      }
    },
  };
  return host as unknown as FakeHost;
}

/** A clock that never moves. Lease arithmetic is relative to it, so it holds. */
const frozen = (at: string) => (): string => at;

test('the concurrency bound holds — six tasks, three at a time', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'security', 'compliance', 'contracts', 'employment', 'accessibility']);
    const host = fakeHost({ delayMs: 5 });

    const report = await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
      concurrency: 3,
    });

    assert.equal(report.dispatched, 6);
    assert.equal(report.completed, 6);
    assert.equal(host.maxInFlight, 3, 'more than the bound ran at once');
    assert.equal(host.seen.length, 6, 'each task dispatched exactly once');
  });
});

test('a killed run leaves recoverable work, and resuming does not redo what finished', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'security', 'compliance']);

    // The state a crash leaves behind: one task finished, one still leased by a
    // process that will never come back, one never started.
    const finished = claimTask(store, { owner: 'dead', leaseUntil: LATER, now: AT });
    assert.ok(finished);
    completeTask(store, {
      id: finished.id,
      owner: 'dead',
      token: finished.token,
      result: { text: 'finished before the crash', usage: { cost: 0.25 } },
      spend: 0.25,
      spendReported: true,
      at: AT,
    });
    const orphaned = claimTask(store, { owner: 'dead', leaseUntil: LATER, now: AT });
    assert.ok(orphaned);

    // Resume after the lease has expired.
    const afterExpiry = '2026-08-03T02:00:00.000Z';
    const host = fakeHost({ cost: 0.1 });
    const report = await workRun(store, host, {
      owner: 'w2',
      clock: frozen(afterExpiry),
      spendCeiling: 100,
    });

    assert.equal(report.dispatched, 2, 'the finished task must not be dispatched again');
    assert.equal(report.recovered, 1, 'the orphaned lease is what recovery means');
    assert.ok(!host.seen.includes(finished.role), 'completed work was redone');

    const done = getTask(store, finished.id);
    assert.equal(done?.state, 'done');
    assert.deepEqual(
      (done?.result as { text: string }).text,
      'finished before the crash',
      'a resumed run must not overwrite a result it did not produce',
    );
    assert.equal(totalSpend(store), 0.25 + 0.2, 'spend accumulates across the crash boundary');
  });
});

test('a takeover makes the slow worker drop its result rather than overwrite', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);

    // While this coordinator is invoking, another process decides the lease has
    // expired, takes the task over, and finishes it first.
    const host = fakeHost({
      onInvoke: () => {
        const stolen = claimTask(store, {
          owner: 'other',
          leaseUntil: '2026-08-04T00:00:00.000Z',
          now: '2026-08-03T23:00:00.000Z',
        });
        assert.ok(stolen);
        completeTask(store, {
          id: stolen.id,
          owner: 'other',
          token: stolen.token,
          result: { text: 'theirs' },
          spend: 0,
          spendReported: true,
          at: LATER,
        });
      },
    });

    const report = await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
    });

    assert.equal(report.staleSettles, 1);
    assert.equal(report.completed, 0, 'the losing worker must not count its own result');
    assert.equal((getTask(store, 't-privacy')?.result as { text: string }).text, 'theirs');

    const dropped = readWorkLog(store, 'run-1').filter(
      (e) => e.action === 'settle-dropped-stale-lease',
    );
    assert.equal(dropped.length, 1, 'a wasted invocation is recorded, not silently absorbed');
  });
});

test('the spend ceiling halts dispatch and leaves the rest pending', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'security', 'compliance', 'contracts']);
    const host = fakeHost({ cost: 0.5 });

    const report = await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 1,
      concurrency: 1,
    });

    assert.equal(report.halted, 'spend-ceiling');
    assert.equal(report.completed, 2, 'dispatch stops at the ceiling, not after it');
    assert.equal(report.spendAfter, 1);
    assert.equal(
      listTasks(store, 'run-1').filter((t) => t.state === 'pending').length,
      2,
      'unspent work stays pending rather than being failed or dropped',
    );

    const halt = readWorkLog(store).filter((e) => e.action === 'dispatch-halted');
    assert.equal(halt.length, 1);
    assert.deepEqual((halt[0].detail as { reason: string }).reason, 'spend-ceiling');
  });
});

test('a ceiling already reached dispatches nothing, and says so', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    const host = fakeHost({ cost: 5 });

    const report = await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 0,
    });

    assert.equal(report.dispatched, 0);
    assert.equal(report.halted, 'spend-ceiling');
    assert.equal(host.seen.length, 0);
  });
});

test('a host that reports no cost is counted, not assumed free', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'security']);
    const host = fakeHost({ cost: null });

    const report = await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 1,
    });

    assert.equal(report.completed, 2);
    assert.equal(report.costSilent, 2, 'unmeasured spend must be visible as unmeasured');
    assert.equal(report.spendAfter, 0);
    assert.ok(listTasks(store, 'run-1').every((t) => !t.spendReported));
  });
});

test('a failed task is terminal, recorded, and does not block the rest', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'security']);
    const host = fakeHost({ fail: (role) => role === 'privacy' });

    const report = await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
    });

    assert.equal(report.failed, 1);
    assert.equal(report.completed, 1);
    assert.equal(getTask(store, 't-privacy')?.state, 'failed');

    // No retry here on purpose: the host owns retry policy (commitment 1).
    const again = await workRun(store, fakeHost(), {
      owner: 'w1',
      clock: frozen(LATER),
      spendCeiling: 100,
    });
    assert.equal(again.dispatched, 0, 'a failed task must not be silently retried');
  });
});

test('every dispatch and every settle reaches the work log', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'security']);
    await workRun(store, fakeHost({ fail: (role) => role === 'security' }), {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
    });

    const actions = readWorkLog(store, 'run-1').map((e) => `${e.role}:${e.action}`);
    assert.deepEqual(actions.filter((a) => a.endsWith('role-dispatched')).length, 2);
    assert.ok(actions.includes('privacy:role-reported'));
    assert.ok(actions.includes('security:role-failed'));
    for (const entry of readWorkLog(store, 'run-1')) {
      assert.ok(entry.task, 'a role action must name the task it belongs to');
    }
  });
});

test('a host that throws is a failed task, not a crashed coordinator', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    const host = fakeHost({
      onInvoke: () => {
        throw new Error('host fell over');
      },
    });

    const report = await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
    });

    assert.equal(report.failed, 1);
    assert.match(JSON.stringify(getTask(store, 't-privacy')?.error), /host fell over/);
  });
});

test('the assignment states the role and its concern, and nothing it cannot support', () => {
  const text = assignmentFor(brief('privacy'));
  assert.match(text, /privacy role/);
  assert.match(text, /personal data, consent/, "the domain's own concern is what makes it specific");
  assert.match(text, /launch a paid beta/);

  // A role outside the catalog gets no invented concern.
  const unknown = assignmentFor(brief('astrology'));
  assert.match(unknown, /astrology role/);
  assert.ok(!unknown.includes('Your concern:'));
});

test('spendOf separates a free run from an unmeasured one', () => {
  const free = spendOf({ id: 'a', status: 'ok', output: { usage: { cost: 0 } }, error: null });
  assert.deepEqual(free, { spend: 0, reported: true });

  const silent = spendOf({ id: 'a', status: 'ok', output: { text: 'hi' }, error: null });
  assert.deepEqual(silent, { spend: 0, reported: false });

  const nonsense = spendOf({ id: 'a', status: 'ok', output: { usage: { cost: 'lots' } }, error: null });
  assert.deepEqual(nonsense, { spend: 0, reported: false });

  // The shape a live OpenCode run against a local model actually returned: a
  // full deliverable, and a usage envelope summed from zero measurements.
  const unmeasured = spendOf({
    id: 'a',
    status: 'ok',
    output: { text: 'a real answer', usage: { cost: 0, steps: 0, totalTokens: 0 } },
    error: null,
  });
  assert.deepEqual(unmeasured, { spend: 0, reported: false }, 'zero of zero steps is not free');

  const measured = spendOf({
    id: 'a',
    status: 'ok',
    output: { usage: { cost: 0, steps: 2 } },
    error: null,
  });
  assert.deepEqual(measured, { spend: 0, reported: true }, 'a measured local run really is free');
});

test('settling a task nobody holds is refused', () => {
  withStore((store) => {
    seed(store, ['privacy']);
    assert.throws(
      () =>
        completeTask(store, {
          id: 't-privacy',
          owner: 'nobody',
          token: 1,
          result: {},
          spend: 0,
          spendReported: true,
          at: AT,
        }),
      /no longer held/,
    );
    assert.throws(
      () => failTask(store, { id: 't-privacy', owner: 'nobody', token: 1, error: {}, at: AT }),
      /no longer held/,
    );
    assert.equal(getTask(store, 't-privacy')?.state, 'pending');
  });
});

test('enqueuing the same task twice queues it once', () => {
  withStore((store) => {
    assert.equal(
      enqueueTask(store, { id: 't-1', run: 'r', role: 'privacy', brief: brief('privacy'), at: AT }),
      true,
    );
    assert.equal(
      enqueueTask(store, { id: 't-1', run: 'r', role: 'privacy', brief: brief('privacy'), at: AT }),
      false,
    );
    assert.equal(listTasks(store, 'r').length, 1);
  });
});

test('a deliverable is flagged from what the host reported, never from its wording', () => {
  assert.deepEqual(deliverableConcerns({ text: 'a clean answer', failedToolCalls: [] }), []);

  const incomplete = deliverableConcerns({
    text: 'here is my answer',
    failedToolCalls: [{ tool: 'read', error: 'permission denied' }],
  });
  assert.deepEqual(incomplete.map((c) => c.kind), ['incomplete-inputs']);
  assert.match(incomplete[0].detail, /could not read everything/);

  assert.deepEqual(
    deliverableConcerns({ text: '   ', failedToolCalls: [] }).map((c) => c.kind),
    ['empty-deliverable'],
  );
  assert.deepEqual(
    deliverableConcerns({ text: 'cut off mid-', finishReasons: ['length'] }).map((c) => c.kind),
    ['truncated'],
  );

  // An unfamiliar finish reason is not evidence of anything.
  assert.deepEqual(deliverableConcerns({ text: 'fine', finishReasons: ['tool-calls'] }), []);

  // Alarming prose is not a flag. Only the host's own report is.
  assert.deepEqual(deliverableConcerns({ text: 'I am not at all sure about any of this' }), []);
});

test('licensed review is a property of the domain, and every domain has an answer', () => {
  assert.equal(licensedReviewFor('privacy'), 'attorney');
  assert.equal(licensedReviewFor('commerce-tax'), 'tax professional');
  assert.equal(licensedReviewFor('product-scoping'), null);
  assert.equal(licensedReviewFor('a-domain-that-does-not-exist'), null);

  // Pinned so a new domain is a decision someone makes, not one that defaults.
  const requiring = DOMAINS.filter((d) => d.licensedReview).map((d) => d.domain).sort();
  assert.deepEqual(requiring, [
    'commerce-tax',
    'compliance',
    'contracts',
    'employment',
    'privacy',
  ]);
});

test('the work log records what was flagged and what needs a licensed human', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'product-scoping']);
    const host = fakeHost({ emptyText: (role) => role === 'privacy' });

    const report = await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
    });

    assert.equal(report.flagged, 1, 'the empty deliverable is the only flagged one');
    assert.equal(report.escalated, 1, 'privacy needs an attorney; product-scoping does not');

    const entries = readWorkLog(store, 'run-1');
    const flag = entries.find((e) => e.action === 'deliverable-flagged');
    assert.equal(flag?.role, 'privacy');
    assert.equal((flag?.detail as { kind: string }).kind, 'empty-deliverable');

    const escalation = entries.find((e) => e.action === 'licensed-review-required');
    assert.equal(escalation?.role, 'privacy');
    assert.equal((escalation?.detail as { profession: string }).profession, 'attorney');
    assert.match((escalation?.detail as { why: string }).why, /issue-spotting, not advice/);

    assert.ok(
      !entries.some((e) => e.role === 'product-scoping' && e.action === 'licensed-review-required'),
      'a domain that does not need licensed review must not claim it does',
    );
  });
});

test('the coordinator reads neither the clock nor the environment', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../../../src/kernel/run/', import.meta.url);
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const file of readdirSync(dir)) {
    const code = stripComments(readFileSync(new URL(file, dir), 'utf8'));
    // `new Date(x)` on a supplied string is arithmetic, not a clock read; the
    // argless form and Date.now() are the ones that reach for ambient time.
    assert.ok(!/new Date\(\s*\)|Date\.now\(/.test(code), `${file} must not read the clock`);
    assert.ok(!/process\.env|homedir\(/.test(code), `${file} must not read the environment`);
  }
});
