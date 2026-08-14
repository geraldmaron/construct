/**
 * tests/kernel/run/coordinator.test.ts — the four properties the coordinator
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
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { recordPlan } from '../../../src/kernel/store/plans.ts';
import { buildPlan } from '../../../src/kernel/plan/planner.ts';
import { recordLesson } from '../../../src/kernel/store/lessons.ts';
import { decideAdmission } from '../../../src/kernel/lessons/admission.ts';
import { playbookFor } from '../../../src/kernel/plan/playbooks.ts';
import { openDecisions } from '../../../src/kernel/store/decisions.ts';
import { assignmentFor, frameConflicts, spendOf, workRun } from '../../../src/kernel/run/coordinator.ts';
import { deliverableConcerns, licensedReviewFor } from '../../../src/kernel/run/accountability.ts';
import { ROLE_OWNERSHIP_BOUND } from '../../../src/kernel/run/grounding.ts';
import { DOMAINS } from '../../../src/kernel/implication/domains.ts';
import type { HostAdapter, HostContext, HostResult } from '../../../src/kernel/hosts/interface.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

/** The checkout this test runs from, so the prompt script is invoked where it lives. */
const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

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
  readonly answer?: (role: string) => string;
  readonly onInvoke?: (role: string) => void | Promise<void>;
}

interface FakeHost extends HostAdapter {
  readonly seen: string[];
  /** The assignment text each dispatch actually carried, in dispatch order. */
  readonly assignments: string[];
  readonly maxInFlight: number;
}

/** A host that records what it was asked to do and how much of it overlapped. */
function fakeHost(options: FakeOptions = {}): FakeHost {
  const seen: string[] = [];
  const assignments: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const host = {
    name: 'fake',
    kind: 'general',
    capabilities: ['concurrent'] as const,
    seen,
    assignments,
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
      assignments.push(req.task);
      try {
        await options.onInvoke?.(req.role);
        if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        const id = context?.invocationId ?? req.role;
        if (options.fail?.(req.role)) {
          return { id, status: 'error', output: null, error: { messages: ['host said no'] } };
        }
        const usage = options.cost === null ? {} : { usage: { cost: options.cost ?? 0, steps: 1 } };
        const text = options.emptyText?.(req.role)
          ? ''
          : (options.answer?.(req.role) ?? `${req.role} reporting`);
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

test('the assignment states Construct identity, the framing role, and its concern', () => {
  const text = assignmentFor(brief('privacy'));
  assert.match(text, /You are Construct/);
  assert.match(text, /framed through privacy/);
  assert.doesNotMatch(text, /acting as/);
  assert.match(text, /personal data, consent/, "the domain's own concern is what makes it specific");
  assert.match(text, /launch a paid beta/);

  // A role outside the catalog gets no invented concern.
  const unknown = assignmentFor(brief('astrology'));
  assert.match(unknown, /framed through astrology/);
  assert.ok(!unknown.includes('Your concern:'));
});

test('an equipped role is shown its lens: posture, questions, escalation, labels', () => {
  const text = assignmentFor(brief('compliance'));
  assert.match(text, /Posture: Controls and evidence over intent/);
  assert.match(text, /which identity acts/, 'the question set travels with the dispatch');
  assert.match(text, /Escalate rather than push past your remit/);
  assert.match(text, /dogfood-only/);

  // A legal-lens domain declares the jurisdiction boundary out loud.
  const contracts = assignmentFor(brief('contracts'));
  assert.match(contracts, /template-for-review/);
  assert.match(contracts, /No jurisdiction is covered/);

  // The security lens carries a stated ceiling, and the ceiling reaches the
  // dispatch — a defensive-only limit the role never sees is not a limit.
  const security = assignmentFor(brief('security'));
  assert.match(security, /Posture: Assume the interesting failure is deliberate/);
  assert.match(security, /Defensive review only/);

  // A domain no lens equips gets no invented posture. Every catalog domain
  // carries a lens now, so the case is exercised by a domain outside it.
  assert.ok(!assignmentFor(brief('no-such-domain')).includes('Posture:'));
});

test('issue-spotting templates number issues; a PRD is a document, not a list of issues', () => {
  const privacy = assignmentFor(brief('privacy'));
  assert.match(privacy, /Number every issue/);
  assert.match(privacy, /Deliver a privacy review/);

  const prd = assignmentFor(brief('product-scoping'));
  assert.match(prd, /Deliver a product requirements document/);
  assert.doesNotMatch(prd, /Number every issue/);
  assert.match(prd, /Prose is the default/);
  assert.match(prd, /markdown table/);
  assert.match(prd, /mermaid diagram/);
});

test('an equipped role is told to drop findings another role owns, verbatim', () => {
  // Stated as an instruction rather than a suggestion, because a mild version
  // was measured and did not bind: roles reported other roles' findings freely,
  // which buries what only this role would have reached.
  const text = assignmentFor(brief('compliance'));
  assert.ok(
    text.includes(ROLE_OWNERSHIP_BOUND),
    'the bound must reach the dispatch verbatim, not as a paraphrase that can drift',
  );
});

test('the fixture-organization prompt states the same ownership bound as the product', () => {
  // The instrument must not credit itself with a discipline the shipped
  // dispatch never carries; that drift is what makes a measured number one no
  // user feels.
  const rendered = execFileSync(
    process.execPath,
    [join(REPO_ROOT, 'scripts', 'org-harness-producer-prompt.mjs'), '--lens', 'security'],
    { encoding: 'utf8', cwd: REPO_ROOT },
  );
  assert.ok(rendered.includes(ROLE_OWNERSHIP_BOUND));
});

test('a role holding the two writes is told it has them, and what they are for', () => {
  // The surface was built, registered and reachable, and the
  // assignment never mentioned it. A live four-role run finished with every role
  // reporting and not one draft submitted.
  const text = assignmentFor(brief('privacy'), DOMAINS, { writeSurface: true });

  assert.match(text, /submit_draft/);
  assert.match(text, /append_work_log/);
  assert.match(text, /exactly once/, 'a role that submits five drafts is not following this');
  assert.match(text, /does not\s+promote/, 'submitting must not read as finishing');
  assert.match(text, /in your own name/, "the work log's whole point is attribution");

  // Host-agnostic, per the acceptance criterion: a role has no business knowing
  // which host it landed on, and naming one host's mechanism would be wrong on
  // the other.
  for (const leak of ['--mcp-config', 'opencode.json', 'mcp__', '--strict-mcp-config', 'OPENCODE_CONFIG']) {
    assert.ok(!text.includes(leak), `the assignment must not name "${leak}"`);
  }
  assert.match(text, /may show these names with a prefix/, 'hosts namespace differently; say so');

  // The stance block still has to survive alongside it.
  assert.match(text, /STANCE: proceed \| hold \| unclear/);
});

test('a role holding no write surface is told that too, and not left guessing', () => {
  const text = assignmentFor(brief('privacy'), DOMAINS, { writeSurface: false });

  assert.match(text, /no write surface/);
  assert.match(text, /normal and not an error/, 'a legitimate dispatch must not read as a failure');
  assert.ok(!text.includes('submit_draft'), 'do not describe a tool that is not there');
  assert.match(text, /STANCE: proceed \| hold \| unclear/);

  // Defaulting to no surface is the safe direction: describing tools a role does
  // not hold sends it hunting for something that will never answer.
  assert.equal(assignmentFor(brief('privacy')), text, 'omitting the option means no surface');
});

test('what the assignment claims matches what the dispatch actually minted', () => {
  // The drift that would make this feature a lie: telling a role it has tools on
  // a run where no token was issued, or staying silent on one where it was.
  const seen: string[] = [];
  const recording = {
    ...fakeHost(),
    invoke: async (request: unknown): Promise<HostResult> => {
      seen.push((request as { task: string }).task);
      return { id: 'x', status: 'ok', output: { text: 'ok', usage: { cost: 0 } }, error: null };
    },
  } as unknown as HostAdapter;

  return withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    await workRun(store, recording, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
      capabilitySecret: 'a-secret',
    });
    assert.match(seen[0], /submit_draft/, 'a secret was supplied, so a surface exists');

    seen.length = 0;
    seed(store, ['security']);
    await workRun(store, recording, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });
    assert.ok(!seen[0].includes('submit_draft'), 'no secret, no token, no claim of tools');
    assert.match(seen[0], /no write surface/);
  });
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

test('disagreeing roles become one inbox item, and agreement becomes none', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'program-sequencing', 'product-scoping']);
    const answers: Record<string, string> = {
      privacy: 'Analysis.\nSTANCE: hold\nBECAUSE: no processing agreement\nCITE: GDPR Art. 28',
      'program-sequencing': '**STANCE:** proceed\n**BECAUSE:** the date has slack\n**CITE:** the plan',
      'product-scoping': 'STANCE: unclear\nBECAUSE: scope is not stated',
    };
    const host = fakeHost({ answer: (role) => answers[role] });

    const report = await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
    });

    assert.equal(report.conflicts, 1, 'one run, one framed decision');
    // Slot-gap asks share the inbox now; the conflict framing is the ':stance'
    // decision, and these assertions are about that framing alone.
    const inbox = openDecisions(store, 'run-1').filter((d) => d.id.endsWith(':stance'));
    assert.equal(inbox.length, 1);
    // The two sides by name, then the reversible default, which is not a side.
    assert.deepEqual(
      inbox[0].positions.map((p) => p.role),
      ['privacy', 'program-sequencing', 'construct'],
    );
    assert.equal(inbox[0].positions[0].citation, 'GDPR Art. 28');
    assert.match(inbox[0].positions[2].stance, /reversible default if you do nothing/);
    assert.equal(inbox[0].resolution, null, 'nothing auto-arbitrates');

    const raised = readWorkLog(store, 'run-1').find((e) => e.action === 'decision-raised');
    assert.ok(raised, 'raising a decision is itself accountable');
    assert.equal((raised.detail as { undeclared: number }).undeclared, 0);
  });
});

test('a run where the roles agree leaves the inbox empty', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'security']);
    const host = fakeHost({ answer: () => 'STANCE: proceed\nBECAUSE: nothing blocks it' });

    const report = await workRun(store, host, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });

    assert.equal(report.conflicts, 0);
    assert.equal(
      openDecisions(store).filter((d) => d.id.endsWith(':stance')).length,
      0,
      'agreement must not be framed as a decision',
    );
  });
});

test('every task records the model that ran it, and an unmet floor is loud', async () => {
  await withStoreAsync(async (store) => {
    // A brief that needs judgment, dispatched to a 4b local model — the exact
    // pairing the undecidable inbox silence came from, and the
    // reason a tier is declared at all.
    enqueueTask(store, {
      id: 't-privacy',
      run: 'run-1',
      role: 'privacy',
      brief: { ...brief('privacy'), modelFloor: 'frontier' },
      at: AT,
    });

    const weak = {
      ...fakeHost(),
      model: 'ollama/qwen3.5:4b',
      modelTier: () => 'any' as const,
    } as unknown as HostAdapter;

    const report = await workRun(store, weak, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });

    assert.equal(report.completed, 1, 'degrading must not stop the work');
    assert.equal(report.degraded, 1);

    const entries = readWorkLog(store, 'run-1');
    const dispatched = entries.find((e) => e.action === 'role-dispatched');
    assert.equal((dispatched?.detail as { model: string }).model, 'ollama/qwen3.5:4b');
    assert.equal((dispatched?.detail as { modelTier: string }).modelTier, 'any');

    const flag = entries.find((e) => e.action === 'model-floor-degraded');
    assert.ok(flag, 'an unmet floor must reach the record, not just the return value');
    assert.equal((flag.detail as { floor: string }).floor, 'frontier');
    assert.match((flag.detail as { why: string }).why, /tier "any"/);
  });
});

test('a host that will not name its tier degrades rather than passing quietly', async () => {
  await withStoreAsync(async (store) => {
    enqueueTask(store, {
      id: 't-privacy',
      run: 'run-1',
      role: 'privacy',
      brief: { ...brief('privacy'), modelFloor: 'capable' },
      at: AT,
    });

    // fakeHost declares no model and no modelTier — the ordinary adapter that
    // has not been taught tiers yet. Silence must not read as compliance.
    const report = await workRun(store, fakeHost(), {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
    });

    assert.equal(report.degraded, 1);
    const flag = readWorkLog(store, 'run-1').find((e) => e.action === 'model-floor-degraded');
    assert.match((flag?.detail as { why: string }).why, /silence is not compliance/);
    assert.equal((flag?.detail as { modelTier: unknown }).modelTier, null);
  });
});

test('an untuned or tuning-silent family is recorded best-effort on every dispatch', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    // fakeHost declares no modelTuning — silence must read as best-effort.
    await workRun(store, fakeHost(), { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });

    const flag = readWorkLog(store, 'run-1').find((e) => e.action === 'model-untuned-best-effort');
    assert.ok(flag, 'an unmeasured family must reach the record');
    assert.match((flag.detail as { note: string }).note, /best-effort/);
    assert.match((flag.detail as { note: string }).note, /not validated/);
  });
});

test('a tuned family is not labeled best-effort', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    const tuned = {
      ...fakeHost(),
      model: 'claude-sonnet-5',
      modelTuning: () => ({ family: 'claude', tuned: true }),
    } as unknown as HostAdapter;
    await workRun(store, tuned, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });

    assert.equal(
      readWorkLog(store, 'run-1').some((e) => e.action === 'model-untuned-best-effort'),
      false,
      'tuning evidence on record means no degradation label',
    );
  });
});

test('the dispatch itself records the family, not only the best-effort note', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    const tuned = {
      ...fakeHost(),
      model: 'claude-sonnet-5',
      modelTuning: () => ({ family: 'claude', tuned: true }),
    } as unknown as HostAdapter;
    await workRun(store, tuned, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });

    // A record that names the family only when tuning is missing cannot answer
    // "what ran this?" for the runs that succeeded, which are the runs a later
    // claim quotes.
    const dispatched = readWorkLog(store, 'run-1').find((e) => e.action === 'role-dispatched');
    const detail = dispatched?.detail as { modelFamily: unknown; modelTuned: unknown };
    assert.equal(detail.modelFamily, 'claude');
    assert.equal(detail.modelTuned, true);
  });
});

test('a host that will not say which family it is records that silence', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    await workRun(store, fakeHost(), { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });

    const dispatched = readWorkLog(store, 'run-1').find((e) => e.action === 'role-dispatched');
    const detail = dispatched?.detail as { modelFamily: unknown; modelTuned: unknown };
    assert.equal(detail.modelFamily, null, 'an unknown family is written down as unknown');
    assert.equal(detail.modelTuned, null);
  });
});

test('a brief declaring no floor is never reported as degraded', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    const report = await workRun(store, fakeHost(), {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
    });

    assert.equal(report.degraded, 0, 'a floor nobody declared cannot be missed');
    assert.equal(
      readWorkLog(store, 'run-1').some((e) => e.action === 'model-floor-degraded'),
      false,
    );
    // The model identity is still recorded — that is unconditional.
    const dispatched = readWorkLog(store, 'run-1').find((e) => e.action === 'role-dispatched');
    assert.ok(dispatched, 'every dispatch is recorded whatever the brief declared');
    assert.equal((dispatched.detail as { model: unknown }).model, null);
  });
});

test('a run that settled and then died still raises its decision', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'program-sequencing']);
    const answers: Record<string, string> = {
      privacy: 'STANCE: hold\nBECAUSE: no processing agreement',
      'program-sequencing': 'STANCE: proceed\nBECAUSE: the date has slack',
    };

    // The lost invocation, reconstructed: the tasks settle durably through the
    // ordinary claim/complete path, and then the process is gone. Nothing calls
    // frameConflicts, and no in-invocation state survives to be handed to it —
    // which is exactly the state a live run observed on
    // run-20260804173017057, where two roles disagreed and the inbox was empty.
    for (let i = 0; i < 2; i += 1) {
      const leased = claimTask(store, { owner: 'died', leaseUntil: LATER, now: AT });
      assert.ok(leased);
      completeTask(store, {
        id: leased.id,
        owner: 'died',
        token: leased.token,
        result: { text: answers[leased.role], usage: { cost: 0.01, steps: 1 } },
        spend: 0.01,
        spendReported: true,
        at: AT,
      });
    }

    assert.equal(openDecisions(store, 'run-1').length, 0, 'the decision is lost at this point');

    // A later invocation reaches the framing with no memory of the first: an
    // empty settled list is all the fix is allowed to be given.
    const raised = frameConflicts(store, [], { clock: frozen(LATER) });

    assert.equal(raised, 1, 'the framing is re-derived from the store');
    const inbox = openDecisions(store, 'run-1');
    assert.equal(inbox.length, 1);
    assert.deepEqual(
      inbox[0].positions.map((p) => p.role),
      ['privacy', 'program-sequencing', 'construct'],
    );

    // The once-per-run rule has to survive being re-enterable, or the fix trades
    // a lost decision for one that rewrites itself under the reader.
    assert.equal(frameConflicts(store, [], { clock: frozen(LATER) }), 0, 'framed once, not once per call');
    assert.equal(openDecisions(store, 'run-1').length, 1);
  });
});

test('a run still in flight is not framed early by the recovery sweep', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'program-sequencing', 'security']);

    // Two roles disagree and have settled; the third has not run at all. A
    // sweep that framed on this would hand the user a decision missing a side
    // and, by the once-per-run rule, never correct it.
    const answers: Record<string, string> = {
      privacy: 'STANCE: hold\nBECAUSE: no processing agreement',
      'program-sequencing': 'STANCE: proceed\nBECAUSE: the date has slack',
    };
    for (let i = 0; i < 2; i += 1) {
      const leased = claimTask(store, { owner: 'w1', leaseUntil: LATER, now: AT });
      assert.ok(leased);
      completeTask(store, {
        id: leased.id,
        owner: 'w1',
        token: leased.token,
        result: { text: answers[leased.role] ?? 'STANCE: unclear', usage: { cost: 0.01, steps: 1 } },
        spend: 0.01,
        spendReported: true,
        at: AT,
      });
    }

    assert.equal(frameConflicts(store, [], { clock: frozen(LATER) }), 0, 'a pending task means not settled');
    assert.equal(openDecisions(store, 'run-1').length, 0);
  });
});

test('a re-run does not rewrite a decision the user is already looking at', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'program-sequencing']);
    const answers: Record<string, string> = {
      privacy: 'STANCE: hold\nBECAUSE: no processing agreement',
      'program-sequencing': 'STANCE: proceed\nBECAUSE: the date has slack',
    };
    const host = fakeHost({ answer: (role) => answers[role] });
    await workRun(store, host, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });
    const first = openDecisions(store, 'run-1').find((d) => d.id.endsWith(':stance'))!;

    // A later role lands and also disagrees.
    enqueueTask(store, {
      id: 't-security',
      run: 'run-1',
      role: 'security',
      brief: brief('security'),
      at: AT,
    });
    const again = await workRun(store, fakeHost({ answer: () => 'STANCE: hold\nBECAUSE: no review' }), {
      owner: 'w1',
      clock: frozen(LATER),
      spendCeiling: 100,
    });

    assert.equal(again.conflicts, 0, 'framed once per run');
    const inbox = openDecisions(store, 'run-1').filter((d) => d.id.endsWith(':stance'));
    assert.equal(inbox.length, 1);
    assert.deepEqual(inbox[0].question, first.question, 'the question must not change underneath');
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

/**
 * Every dispatch mints a capability token scoped to exactly
 * that run and task, expiring with the lease, delivered as env for the role's
 * serving process — and the bearer string never touches the record.
 */
test('a dispatch mints a lease-bound capability token and keeps the bearer off the record', async () => {
  const { authorizeRoleToken } = await import('../../../src/kernel/capabilities/tokens.ts');
  const { ROLE_RUN_ENV, ROLE_TASK_ENV, ROLE_TOKEN_ENV } = await import(
    '../../../src/kernel/run/roleenv.ts'
  );

  await withStoreAsync(async (store) => {
    seed(store, ['privacy', 'security']);
    const captured: Array<Record<string, string> | undefined> = [];
    const host = fakeHost({
      onInvoke: () => {},
    });
    const invoke = host.invoke.bind(host);
    (host as { invoke: typeof host.invoke }).invoke = (request, context) => {
      captured.push(context?.roleEnv as Record<string, string> | undefined);
      return invoke(request, context);
    };

    const leaseMs = 60_000;
    await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
      leaseMs,
      capabilitySecret: 'test-secret',
    });

    assert.equal(captured.length, 2);
    const leaseDeadline = new Date(Date.parse(AT) + leaseMs).toISOString();
    for (const env of captured) {
      assert.ok(env, 'dispatch must deliver a role env when a secret is configured');
      const token = env[ROLE_TOKEN_ENV];
      const run = env[ROLE_RUN_ENV];
      const task = env[ROLE_TASK_ENV];
      assert.equal(run, 'run-1');

      // The token authorizes exactly its own scope...
      const granted = authorizeRoleToken(token, 'test-secret', {
        grant: 'submit-draft',
        run,
        task,
        now: AT,
      });
      assert.ok(granted.ok, `token must authorize its own scope: ${JSON.stringify(granted)}`);
      assert.equal(granted.scope.expiresAt, leaseDeadline, 'expiry must be the lease deadline');

      // ...and nothing else: another task, a wider grant, a time past the lease.
      assert.equal(
        authorizeRoleToken(token, 'test-secret', { grant: 'submit-draft', run, task: 'other', now: AT }).ok,
        false,
      );
      assert.equal(
        authorizeRoleToken(token, 'test-secret', { grant: 'record-verdict', run, task, now: AT }).ok,
        false,
      );
      assert.equal(
        authorizeRoleToken(token, 'test-secret', {
          grant: 'submit-draft',
          run,
          task,
          now: new Date(Date.parse(leaseDeadline) + 1).toISOString(),
        }).ok,
        false,
      );

      // The bearer appears in no work log entry and no task row.
      const everything = JSON.stringify(readWorkLog(store)) + JSON.stringify(listTasks(store, 'run-1'));
      assert.ok(token && !everything.includes(token), 'bearer string must never touch the record');
    }

    const issued = readWorkLog(store).filter((entry) => entry.action === 'capability-issued');
    assert.equal(issued.length, 2, 'each dispatch records that a token was issued');
  });
});

test('without a secret, no token is minted and no env is delivered', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    let sawEnv: unknown = 'unset';
    const host = fakeHost({});
    const invoke = host.invoke.bind(host);
    (host as { invoke: typeof host.invoke }).invoke = (request, context) => {
      sawEnv = context?.roleEnv;
      return invoke(request, context);
    };

    await workRun(store, host, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });

    assert.equal(sawEnv, undefined, 'no secret means no write surface, not a broken one');
    assert.equal(readWorkLog(store).filter((e) => e.action === 'capability-issued').length, 0);
  });
});

test('a voice override reaches the assignment and is recorded at the dispatch it shaped', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    const host = fakeHost();

    await workRun(store, host, {
      owner: 'w1',
      clock: frozen(AT),
      spendCeiling: 100,
      voice: { instruction: 'Write it as a limerick.', source: 'cli --voice' },
    });

    assert.match(host.assignments[0], /Write it as a limerick\./);

    // An deliverable that will not sound like Construct is traceable to the user
    // who asked for that, at the dispatch it shaped.
    const overridden = readWorkLog(store, 'run-1').filter((e) => e.action === 'voice-overridden');
    assert.equal(overridden.length, 1);
    assert.deepEqual(overridden[0].detail, {
      instruction: 'Write it as a limerick.',
      source: 'cli --voice',
    });
  });
});

test('the house voice needs no record — silence in the log means Construct sounded like itself', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    const host = fakeHost();
    await workRun(store, host, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });
    assert.equal(
      readWorkLog(store, 'run-1').some((e) => e.action === 'voice-overridden'),
      false,
    );
  });
});

test('a dispatch carries the workspace\'s admitted lessons, and records which', async () => {
  await withStoreAsync(async (store) => {
    // The run's plan names the workspace; the dispatch reads memory through it.
    recordPlan(
      store,
      buildPlan({
        id: 'plan-run-1',
        run: 'run-1',
        outcome: 'launch the beta',
        densified: null,
        implicated: [{ domain: 'privacy', concern: 'personal data', score: 10, signals: ['beta'] }],
        inferredBy: 'keywords',
        sources: [],
        workspace: 'client-a',
        mode: 'team',
        plannedAt: AT,
      }),
    );
    recordLesson(store, {
      id: 'l-1',
      workspace: 'client-a',
      kind: 'technique',
      body: 'the billing team owns refunds; route refund questions there first',
      citation: 'run:2026-08-05',
      external: false,
      createdAt: AT,
    });
    decideAdmission(store, {
      lessonId: 'l-1',
      domain: 'operations',
      basis: { kind: 'adversarial-pass', detail: 'challenged and upheld' },
      decidedAt: AT,
    });
    // A lesson merely recorded is not memory yet: an unadmitted one must not
    // reach a dispatch, or the admission gate is decoration.
    recordLesson(store, {
      id: 'l-unadmitted',
      workspace: 'client-a',
      kind: 'technique',
      body: 'this sentence must never appear in an assignment',
      citation: 'run:2026-08-05',
      external: false,
      createdAt: AT,
    });

    seed(store, ['privacy']);
    const host = fakeHost();
    await workRun(store, host, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });

    const assignment = host.assignments[0]!;
    assert.match(assignment, /What this workspace already remembers/);
    assert.match(assignment, /billing team owns refunds/);
    assert.match(assignment, /\[cite:lesson\]/);
    assert.ok(!assignment.includes('must never appear'), 'unadmitted lessons stay out');

    const briefed = readWorkLog(store, 'run-1').find((e) => e.action === 'lessons-briefed');
    assert.ok(briefed, 'which lessons were briefed is on the record');
    assert.deepEqual((briefed!.detail as { lessons: string[] }).lessons, ['l-1']);
    assert.equal((briefed!.detail as { workspace: string }).workspace, 'client-a');
  });
});

test('a run with no plan or no lessons dispatches without a memory block', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    const host = fakeHost();
    await workRun(store, host, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });
    assert.ok(!host.assignments[0]!.includes('What this workspace already remembers'));
    assert.ok(!readWorkLog(store, 'run-1').some((e) => e.action === 'lessons-briefed'));
  });
});

test('a seat-mode run tells every role it proposes to a human team; team mode adds nothing', async () => {
  await withStoreAsync(async (store) => {
    recordPlan(
      store,
      buildPlan({
        id: 'plan-run-1',
        run: 'run-1',
        outcome: 'launch the beta',
        densified: null,
        implicated: [{ domain: 'privacy', concern: 'personal data', score: 10, signals: ['beta'] }],
        inferredBy: 'keywords',
        sources: [],
        workspace: 'default',
        mode: 'seat',
        plannedAt: AT,
      }),
    );
    seed(store, ['privacy']);
    const host = fakeHost();
    await workRun(store, host, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });
    const assignment = host.assignments[0]!;
    assert.match(assignment, /Engagement mode: seat/);
    assert.match(assignment, /system of record/);
    assert.match(assignment, /never "done", "applied", or "decided"/);
  });
  await withStoreAsync(async (store) => {
    // Team mode — and the no-plan legacy case — must not carry seat framing.
    seed(store, ['privacy']);
    const host = fakeHost();
    await workRun(store, host, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });
    assert.ok(!host.assignments[0]!.includes('Engagement mode: seat'));
  });
});

test('a required slot the deliverable never filled becomes a batched inbox decision with its default', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['privacy']);
    // The privacy template requires finding/evidence/risks plus the lens and
    // domain slots; answer with only two of them headed.
    const host = fakeHost({
      answer: () => '## Finding\nok\n\n## Evidence\nnone cited\n',
    });
    const report = await workRun(store, host, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });
    assert.ok(report.slotGapsRaised > 0, 'gaps were raised');

    const raised = readWorkLog(store, 'run-1').find((e) => e.action === 'slot-gaps-raised');
    assert.ok(raised);
    const slots = (raised!.detail as { slots: string[] }).slots;
    assert.ok(slots.includes('risks'), 'the unheaded required slot is named');
    assert.ok(!slots.includes('finding') && !slots.includes('evidence'), 'headed slots are not gaps');

    // One decision per deliverable, whatever the gap count: a flood is how an
    // inbox stops being read.
    const open = openDecisions(store).filter((d) => d.id.endsWith(':sections'));
    assert.equal(open.length, 1);
    assert.match(open[0].question, /risks/);
    assert.doesNotMatch(open[0].question, /finding, /, 'headed slots are not asked about');
    // The ladder's rule: asking never blocks a draft — the question ships with
    // the default the deliverable stands on until the human answers.
    assert.ok(open[0].positions.some((p) => /stands as delivered/.test(p.stance)));
  });
});

test('a deliverable that heads every required section raises no slot-gap decisions', async () => {
  await withStoreAsync(async (store) => {
    seed(store, ['program-sequencing']);
    const template = playbookFor('program-sequencing').template;
    const complete = template.slots.map((s) => `## ${s.name}\ncontent for ${s.name}\n`).join('\n');
    const host = fakeHost({ answer: () => complete });
    const report = await workRun(store, host, { owner: 'w1', clock: frozen(AT), spendCeiling: 100 });
    assert.equal(report.slotGapsRaised, 0);
    assert.ok(!readWorkLog(store, 'run-1').some((e) => e.action === 'slot-gaps-raised'));
  });
});
