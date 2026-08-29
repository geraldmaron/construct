/**
 * tests/hosts/mcp/projection.test.ts — the spine's presence inside an MCP
 * host, and the boundary it must not cross.
 *
 * The load-bearing assertions are the negative ones: the projection never
 * starts a Construct-side host spawn, and nothing on it advances completion
 * — no submit_draft, no append_work_log, no promote. Host-pull tools
 * (claim_task / submit_work) are offered only when a secret is supplied;
 * they let the host that is already running execute work on its own
 * capacity and submit a draft. Completion is kernel-owned and the role
 * server's token-scoped writes are the only role door. The strongest
 * negative is structural rather than by-name: no module this surface can
 * reach, transitively, is able to spawn a host, so no tool on it can start
 * a second runtime.
 *
 * The positive assertions: the caller-as-namer path drives the SAME admission
 * gate the CLI's subprocess namer drives (catalog membership, a stated
 * reason, dedup), the log records whose model named what, and the reply says
 * what was not admitted rather than letting the model assume acceptance.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { listTasks } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { readFeedback } from '../../../src/kernel/store/feedback.ts';
import { raiseDecision, openDecisions, getDecision } from '../../../src/kernel/store/decisions.ts';
import { answeredAsksFor, frameAsk } from '../../../src/kernel/run/asks.ts';
import { startRunSelected } from '../../../src/kernel/run/outcome.ts';
import { readRunDispatch } from '../../../src/kernel/store/dispatch.ts';
import { getNote, notesFor } from '../../../src/kernel/store/notes.ts';
import {
  PROJECTION_TOOLS,
  createProjectionHandler,
} from '../../../src/hosts/mcp/projection.ts';
import { addRecord, updateRecordField } from '../../../src/kernel/store/records.ts';
import { recordCatalogSighting } from '../../../src/kernel/store/catalog.ts';
import { DOMAINS } from '../../../src/kernel/implication/domains.ts';
import type { DomainNamer } from '../../../src/kernel/implication/naming.ts';
import type { ProjectionCore } from '../../../src/hosts/mcp/projection.ts';
import type { JsonRpcRequest, JsonRpcResponse } from '../../../src/hosts/mcp/jsonrpc.ts';
import { createHostNamer } from '../../../src/hosts/namer.ts';
import type { HostAdapter, HostResult } from '../../../src/kernel/hosts/interface.ts';

const AT = '2026-08-05T00:00:00.000Z';

interface Fixture {
  readonly store: Store;
  readonly handle: (message: unknown) => Promise<JsonRpcResponse | null>;
  cleanup(): void;
}

function fixture(namer?: DomainNamer): Fixture {
  const sterileFixture = sterile();
  const store = openStore(join(sterileFixture.paths.dataDir, 'construct.db'));
  const core: ProjectionCore = { store, clock: () => AT, serverVersion: 'test', namer };
  const handle = createProjectionHandler(core) as Fixture['handle'];
  return {
    store,
    handle,
    cleanup: () => {
      store.close();
      sterileFixture.cleanup();
    },
  };
}

const WARSAW =
  'We need to bring on a freelancer in Warsaw who will get our customer list and a production login.';

/**
 * A recorded host-namer consultation: the real createHostNamer path
 * against a stub that saw the catalog and the Warsaw words. Not a
 * product phrase table and not a jurisdiction hardcode.
 */
function warsawHostNamer(): DomainNamer {
  const host: HostAdapter = {
    name: 'fixture',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      const task = typeof (request as { task?: unknown }).task === 'string'
        ? (request as { task: string }).task
        : '';
      if (!task.includes('Warsaw') || !task.includes('customer list')) {
        return { id: 'x', status: 'ok', output: { text: '{"domains":[]}' }, error: null };
      }
      if (!task.includes('contracts:') || !task.includes('privacy:')) {
        return {
          id: 'x',
          status: 'error',
          output: null,
          error: 'namer prompt must carry the catalog',
        };
      }
      return {
        id: 'x',
        status: 'ok',
        output: {
          text: JSON.stringify({
            domains: [
              {
                domain: 'contracts',
                why: 'bringing on a freelancer is an agreement with an outside party',
              },
              {
                domain: 'privacy',
                why: 'the freelancer will get the customer list',
              },
              {
                domain: 'security',
                why: 'a production login is who can reach production',
              },
              {
                domain: 'employment',
                why: 'bringing on a freelancer is engaging a person',
              },
            ],
          }),
        },
        error: null,
      };
    },
  };
  return createHostNamer(host);
}

let nextId = 0;
function call(name: string, args?: Record<string, unknown>): unknown {
  nextId += 1;
  return {
    jsonrpc: '2.0',
    id: nextId,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

function payload(reply: JsonRpcResponse | null): { body: unknown; isError: boolean } {
  assert.ok(reply, 'expected a reply');
  const result = reply.result as { content: Array<{ text: string }>; isError?: boolean };
  return { body: JSON.parse(result.content[0].text) as unknown, isError: result.isError === true };
}

test('the tool surface is exactly the read/append set — nothing dispatches, nothing advances completion', async () => {
  const names = PROJECTION_TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'answer',
    'asks',
    'catalog',
    'decide',
    'drop_note',
    'inbox',
    'record',
    'record_outcome',
    'records',
    'run_status',
    'validate_brief',
    'verdict',
    'work_log',
  ]);

  // The role server's writes and any completion verb are refused by name, not
  // merely absent from the list. `ask` is refused with them: a question put to
  // the staff dispatches a role and is paid for, which is the opposite of the
  // ask protocol `asks` and `answer` relay.
  const f = fixture();
  try {
    for (const forbidden of ['submit_draft', 'append_work_log', 'promote', 'work', 'ask']) {
      const reply = await f.handle(call(forbidden, {}));
      assert.ok(reply?.error, `${forbidden} must be refused`);
      assert.match(reply.error.message, /unknown tool/);
    }
  } finally {
    f.cleanup();
  }
});

test('caller-as-namer: proposals pass the admission gate, and the reply names what was not admitted', async () => {
  const f = fixture();
  try {
    await f.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } });
    const reply = await f.handle(
      call('record_outcome', {
        outcome: 'Launch a paid beta to EU users next month',
        namings: [
          { domain: 'privacy', why: 'EU users means GDPR obligations before launch.' },
          { domain: 'privacy', why: 'duplicate, must be dropped' },
          { domain: 'astrology', why: 'not a catalog domain' },
          { domain: 'commerce-tax', why: '   ' },
        ],
      }),
    );
    const { body, isError } = payload(reply);
    assert.equal(isError, false);
    const started = body as {
      run: string;
      implicated: Array<{ domain: string; reason: string }>;
      inferredBy: string;
      notAdmitted: string[];
      tasksQueued: number;
    };

    // Only the catalog domain with a stated reason survives, once.
    assert.deepEqual(started.implicated.map((i) => i.domain), ['privacy']);
    assert.equal(started.implicated[0].reason, 'EU users means GDPR obligations before launch.');
    assert.equal(started.inferredBy, 'session');
    // The invented domain and the reasonless one are named back to the caller.
    assert.deepEqual(started.notAdmitted.sort(), ['astrology', 'commerce-tax']);
    assert.equal(started.tasksQueued, 1);

    // The log says whose model named it — the client from initialize.
    const named = readWorkLog(f.store, started.run).find((e) => e.action === 'implication-named');
    assert.ok(named, 'a consulted model is logged');
    assert.equal((named.detail as { host: string }).host, 'mcp:claude-code');
  } finally {
    f.cleanup();
  }
});

test('an empty namings array is an answer, not a failure', async () => {
  const f = fixture();
  try {
    const reply = await f.handle(
      call('record_outcome', { outcome: 'Water the office plants', namings: [] }),
    );
    const { body } = payload(reply);
    const started = body as { inferredBy: string; implicated: unknown[]; namerFailure?: string };
    assert.equal(started.inferredBy, 'none');
    assert.equal(started.implicated.length, 0);
    assert.equal(started.namerFailure, undefined, 'naming nothing is not a failure');
  } finally {
    f.cleanup();
  }
});

test('on a host-pull serve, omitting namings records a run — not an error, not the keyword map', async () => {
  const sterileFixture = sterile();
  const store = openStore(join(sterileFixture.paths.dataDir, 'construct.db'));
  const handle = createProjectionHandler({
    store,
    clock: () => AT,
    serverVersion: 'test',
    secret: 'test-secret-not-a-real-key',
  });
  try {
    const reply = await handle(call('record_outcome', { outcome: 'is this ready' }) as JsonRpcRequest);
    const { body, isError } = payload(reply);
    assert.equal(isError, false);
    const started = body as { inferredBy: string; run: string };
    assert.notEqual(started.inferredBy, 'keywords');
    assert.match(started.run, /^run-/);
  } finally {
    store.close();
    sterileFixture.cleanup();
  }
});

test('omitting namings is not the keyword path — a run is recorded either way', async () => {
  const f = fixture();
  try {
    const reply = await f.handle(
      call('record_outcome', { outcome: 'Handle GDPR data subject requests for EU customers' }),
    );
    const { body } = payload(reply);
    const started = body as { inferredBy: string; run: string };
    assert.notEqual(started.inferredBy, 'keywords');
    assert.match(started.run, /^run-/);
  } finally {
    f.cleanup();
  }
});

test('omitted namings seat from Construct\'s namer reading the Warsaw words', async () => {
  const f = fixture(warsawHostNamer());
  try {
    const reply = await f.handle(call('record_outcome', { outcome: WARSAW }));
    const { body, isError } = payload(reply);
    assert.equal(isError, false);
    const started = body as {
      run: string;
      implicated: Array<{ domain: string }>;
      inferredBy: string;
    };
    const domains = started.implicated.map((row) => row.domain);
    assert.ok(domains.length > 0, 'the namer must seat from the words');
    assert.ok(domains.includes('contracts'), `contracts missing from ${domains.join(',')}`);
    assert.ok(domains.includes('privacy'), `privacy missing from ${domains.join(',')}`);
    assert.equal(started.inferredBy, 'namer');
    assert.notEqual(started.inferredBy, 'none');
    assert.notEqual(started.inferredBy, 'session');
    assert.notEqual(started.inferredBy, 'keywords');

    const log = readWorkLog(f.store, started.run);
    const actions = log.map((entry) => entry.action);
    assert.ok(actions.includes('outcome-received'));
    assert.ok(actions.includes('implication-named'), 'no-domains-implicated must not be the only follow-up');
    assert.ok(actions.includes('domain-implicated'));
    assert.ok(!actions.includes('no-domains-implicated'));
    assert.ok(
      log.some((entry) => (entry.detail as { inferredBy?: string } | null)?.inferredBy === 'namer'),
    );
  } finally {
    f.cleanup();
  }
});

test('an empty namings array does not consult the namer', async () => {
  const f = fixture(warsawHostNamer());
  try {
    const reply = await f.handle(call('record_outcome', { outcome: WARSAW, namings: [] }));
    const started = payload(reply).body as { inferredBy: string; implicated: unknown[] };
    assert.equal(started.inferredBy, 'none');
    assert.equal(started.implicated.length, 0);
  } finally {
    f.cleanup();
  }
});

test('a thrown namer on omitted namings stays empty and is not the keyword map', async () => {
  const f = fixture(async () => {
    throw new Error('host not logged in');
  });
  try {
    const reply = await f.handle(call('record_outcome', { outcome: WARSAW }));
    const started = payload(reply).body as { inferredBy: string; implicated: unknown[]; run: string };
    assert.equal(started.inferredBy, 'none');
    assert.equal(started.implicated.length, 0);
    const unnamed = readWorkLog(f.store, started.run).find((entry) => entry.action === 'no-domains-implicated');
    assert.equal((unnamed?.detail as { inferredBy?: string }).inferredBy, 'none');
    assert.ok(
      !readWorkLog(f.store, started.run).some(
        (entry) => (entry.detail as { inferredBy?: string } | null)?.inferredBy === 'keywords',
      ),
    );
  } finally {
    f.cleanup();
  }
});

/**
 * A cache hit is not a rejection: the admission gate never ran against the
 * second call's proposals at all, an earlier consultation's cached answer
 * stood in unevaluated. That is a different fact from a naming genuinely
 * refused for being outside the catalog or reasonless, and the reply must not
 * make a caller infer the difference by cross-referencing inferredBy itself.
 */
test('a cache hit is named in notAdmittedBecause, not left to be inferred from inferredBy alone', async () => {
  const f = fixture();
  try {
    const outcome = 'Migrate the customer database to a new hosting region';
    const firstReply = await f.handle(
      call('record_outcome', {
        outcome,
        namings: [{ domain: 'privacy', why: 'customer data crosses a new jurisdiction on migration.' }],
      }),
    );
    const first = payload(firstReply).body as { inferredBy: string; notAdmitted?: string[] };
    assert.equal(first.inferredBy, 'session');
    assert.equal(first.notAdmitted?.length ?? 0, 0, 'nothing was rejected on the first consultation');

    // The exact same outcome text, a second time, with a fresh proposal that
    // would be perfectly admissible on its own merits — real catalog domain,
    // real reason. The point is that it is never actually checked.
    const secondReply = await f.handle(
      call('record_outcome', {
        outcome,
        namings: [{ domain: 'security', why: 'a well-formed reason the gate never sees' }],
      }),
    );
    const second = payload(secondReply).body as {
      inferredBy: string;
      implicated: Array<{ domain: string }>;
      notAdmitted: string[];
      notAdmittedBecause?: string;
    };
    assert.equal(second.inferredBy, 'cache');
    // The first call's cached answer stands — not the second call's proposal.
    assert.deepEqual(second.implicated.map((i) => i.domain), ['privacy']);
    assert.deepEqual(second.notAdmitted, ['security']);
    assert.ok(second.notAdmittedBecause, 'the reply says outright that this is a cache hit');
    assert.match(second.notAdmittedBecause as string, /cache/);
  } finally {
    f.cleanup();
  }
});

test('a genuine catalog rejection carries no notAdmittedBecause — that field is cache-hits only', async () => {
  const f = fixture();
  try {
    const reply = await f.handle(
      call('record_outcome', {
        outcome: 'An outcome nothing has ever consulted before',
        namings: [{ domain: 'astrology', why: 'not a catalog domain' }],
      }),
    );
    const body = payload(reply).body as {
      inferredBy: string;
      notAdmitted: string[];
      notAdmittedBecause?: string;
    };
    assert.notEqual(body.inferredBy, 'cache');
    assert.deepEqual(body.notAdmitted, ['astrology']);
    assert.equal(body.notAdmittedBecause, undefined, 'a real rejection must not be mislabeled as a cache hit');
  } finally {
    f.cleanup();
  }
});

test('exercising every read leaves task state and completion untouched', async () => {
  const f = fixture();
  try {
    // Seed a run through the projection itself, then drive the whole surface.
    const recorded = await f.handle(
      call('record_outcome', {
        outcome: 'Ship it',
        namings: [{ domain: 'privacy', why: 'personal data is handled.' }],
      }),
    );
    const { body } = payload(recorded);
    const run = (body as { run: string }).run;
    const before = listTasks(f.store).map((t) => ({ id: t.id, state: t.state }));
    const logBefore = readWorkLog(f.store).length;

    await f.handle(call('catalog'));
    await f.handle(call('work_log', { run }));
    await f.handle(call('run_status', { run }));
    await f.handle(call('inbox'));
    await f.handle(call('validate_brief', { brief: { id: 'b', outcome: 'x', role: 'privacy' } }));

    const after = listTasks(f.store).map((t) => ({ id: t.id, state: t.state }));
    assert.deepEqual(after, before, 'no read moved a task');
    assert.equal(readWorkLog(f.store).length, logBefore, 'no read appended to the log');
    assert.ok(before.every((t) => t.state === 'pending'), 'nothing was dispatched');
  } finally {
    f.cleanup();
  }
});

test('work_log refuses an unscoped call and names what to pass, unlike its optionally-scoped siblings', async () => {
  const f = fixture();
  try {
    // Two runs — the second seeded directly against the store with its own
    // explicit id, since the fixture's clock is fixed and a second call
    // through record_outcome would derive the same run id as the first — so
    // a run-scoped read has something real to exclude, not just an empty log.
    const first = await f.handle(
      call('record_outcome', { outcome: 'First outcome', namings: [{ domain: 'privacy', why: 'x' }] }),
    );
    const runA = (payload(first).body as { run: string }).run;
    const runB = 'run-work-log-other';
    startRunSelected(f.store, { runId: runB, outcome: 'Second outcome', at: AT, domains: ['security'] });
    assert.notEqual(runA, runB);

    const unscoped = await f.handle(call('work_log'));
    const { body, isError } = payload(unscoped);
    assert.equal(isError, true, 'an unscoped call is refused rather than dumping the whole table');
    assert.match((body as { error: string }).error, /run/);

    // run_status and asks stay optionally scoped: their unscoped answer is
    // naturally small because it reflects only current state, not history.
    const statusReply = await f.handle(call('run_status'));
    assert.equal(payload(statusReply).isError, false, 'run_status stays optional');

    // A scoped call is exactly as it was: bounded to its own run's entries.
    const scoped = await f.handle(call('work_log', { run: runA }));
    const { body: scopedBody, isError: scopedIsError } = payload(scoped);
    assert.equal(scopedIsError, false);
    const entries = (scopedBody as { entries: Array<{ run: string }> }).entries;
    assert.ok(entries.length > 0, 'the scoped run has entries');
    assert.ok(
      entries.every((e) => e.run === runA),
      'a run-scoped read carries only that run — runB never leaks in',
    );
  } finally {
    f.cleanup();
  }
});

test('decide relays the user call and closes the decision', async () => {
  const f = fixture();
  try {
    raiseDecision(f.store, {
      id: 'dec-1',
      run: 'run-1',
      question: 'Ship now or wait for legal?',
      positions: [
        { role: 'legal', stance: 'wait', citation: null },
        { role: 'program-sequencing', stance: 'ship', citation: null },
      ],
      raisedAt: AT,
    });

    const inbox = payload(await f.handle(call('inbox')));
    assert.equal((inbox.body as { decisions: unknown[] }).decisions.length, 1);

    const decided = payload(await f.handle(call('decide', { id: 'dec-1', resolution: 'Wait for legal.' })));
    assert.equal(decided.isError, false);
    assert.equal(openDecisions(f.store).length, 0);
    // The resolution carries the model's provenance, distinct from a person's
    // `cli:user`, so nothing downstream reads a model's call as a human's. This
    // fixture never sends initialize, so the client is the default placeholder.
    assert.equal(getDecision(f.store, 'dec-1')?.resolvedBy, 'mcp:unknown-client');

    // A second resolution of the same decision is refused as a result the
    // model can read, not a transport error.
    const again = payload(await f.handle(call('decide', { id: 'dec-1', resolution: 'Ship.' })));
    assert.equal(again.isError, true);
  } finally {
    f.cleanup();
  }
});

/**
 * The ask protocol, end to end on this surface: a role's question reaches the
 * user where they already are, and the answer they give lands on the run so
 * the next dispatch reads it as settled. Both directions are relay — the
 * question was written by work already done and paid for, and the answer is
 * the user's own words.
 */
test('a role\'s question reaches the user and the answer lands on the run', async () => {
  const f = fixture();
  try {
    raiseDecision(
      f.store,
      frameAsk({
        run: 'run-1',
        task: 't-privacy',
        role: 'privacy',
        ask: { question: 'Which regions launch first?', assuming: 'EU only', stakes: null },
        at: AT,
      }),
    );

    const unscoped = payload(await f.handle(call('asks')));
    assert.equal(unscoped.isError, false);
    const queue = unscoped.body as {
      open: Array<{ id: string; run: string; role: string; question: string; standingDefault: string }>;
      answered?: unknown;
    };
    assert.equal(queue.open.length, 1);
    assert.equal(queue.open[0].id, 't-privacy:ask');
    assert.equal(queue.open[0].role, 'privacy');
    assert.match(queue.open[0].question, /Which regions launch first\?/);
    // The default travels with the question, so the user is never shown a
    // question mark where the work is in fact already done.
    assert.match(queue.open[0].standingDefault, /EU only/);
    // Answers are a per-run fact, and an unscoped read says so by omission
    // rather than by an empty list that would read as "never answered".
    assert.equal(queue.answered, undefined);

    const scoped = payload(await f.handle(call('asks', { run: 'run-1' })));
    assert.deepEqual((scoped.body as { answered: unknown[] }).answered, []);

    const answered = payload(
      await f.handle(call('answer', { id: 't-privacy:ask', answer: 'EU and UK; US waits for tax review.' })),
    );
    assert.equal(answered.isError, false);
    assert.equal((answered.body as { run: string }).run, 'run-1');

    // On record where the next dispatch of the run reads it back.
    const onRecord = answeredAsksFor(f.store, 'run-1');
    assert.equal(onRecord.length, 1);
    assert.equal(onRecord[0]?.role, 'privacy');
    assert.equal(onRecord[0]?.answer, 'EU and UK; US waits for tax review.');
    assert.equal(openDecisions(f.store).length, 0, 'the question is no longer waiting');

    const after = payload(await f.handle(call('asks', { run: 'run-1' })));
    const settled = after.body as { open: unknown[]; answered: Array<{ answer: string }> };
    assert.deepEqual(settled.open, []);
    assert.equal(settled.answered[0]?.answer, 'EU and UK; US waits for tax review.');
  } finally {
    f.cleanup();
  }
});

/**
 * A judgment between cited positions and a fact only the user holds are not
 * interchangeable, and a surface that let one be recorded as the other would
 * put a choice on record as evidence.
 */
test('answer takes ask ids only, once, and names decide for the rest', async () => {
  const f = fixture();
  try {
    raiseDecision(f.store, {
      id: 'dec-1',
      run: 'run-1',
      question: 'Ship now or wait for legal?',
      positions: [
        { role: 'legal', stance: 'wait', citation: null },
        { role: 'program-sequencing', stance: 'ship', citation: null },
      ],
      raisedAt: AT,
    });
    const wrongKind = payload(await f.handle(call('answer', { id: 'dec-1', answer: 'Wait.' })));
    assert.equal(wrongKind.isError, true);
    assert.match((wrongKind.body as { error: string }).error, /decide/);
    assert.equal(openDecisions(f.store).length, 1, 'the decision is untouched');

    const missing = payload(await f.handle(call('answer', { id: 'nobody:ask', answer: 'x' })));
    assert.equal(missing.isError, true);

    raiseDecision(
      f.store,
      frameAsk({
        run: 'run-1',
        task: 't-privacy',
        role: 'privacy',
        ask: { question: 'Which regions launch first?', assuming: 'EU only', stakes: null },
        at: AT,
      }),
    );
    assert.equal(
      payload(await f.handle(call('answer', { id: 't-privacy:ask', answer: 'EU and UK' }))).isError,
      false,
    );
    // A second answer to a question already answered is refused as a readable
    // result, exactly as a second resolution of a decision is.
    const again = payload(await f.handle(call('answer', { id: 't-privacy:ask', answer: 'US too' })));
    assert.equal(again.isError, true);

    for (const bad of [
      call('answer', { id: 't-privacy:ask' }),
      call('answer', { answer: 'EU and UK' }),
      call('answer', { id: '  ', answer: 'EU and UK' }),
      call('answer', { id: 't-privacy:ask', answer: '   ' }),
    ]) {
      assert.equal(payload(await f.handle(bad)).isError, true);
    }
  } finally {
    f.cleanup();
  }
});

/**
 * The spend boundary, at the level of behavior: relaying a question and an
 * answer moves no task and dispatches nothing. `construct work` is what
 * spends, and it is not on this surface.
 */
test('relaying a question and its answer dispatches nothing and moves no task', async () => {
  const f = fixture();
  try {
    const recorded = payload(
      await f.handle(
        call('record_outcome', {
          outcome: 'Launch a paid beta to EU users next month',
          namings: [{ domain: 'privacy', why: 'EU users means GDPR obligations before launch.' }],
        }),
      ),
    );
    const run = (recorded.body as { run: string }).run;
    raiseDecision(
      f.store,
      frameAsk({
        run,
        task: 't-privacy',
        role: 'privacy',
        ask: { question: 'Which regions launch first?', assuming: 'EU only', stakes: null },
        at: AT,
      }),
    );
    const before = listTasks(f.store).map((t) => ({ id: t.id, state: t.state }));
    const logBefore = readWorkLog(f.store).length;

    await f.handle(call('asks'));
    await f.handle(call('asks', { run }));
    await f.handle(call('answer', { id: 't-privacy:ask', answer: 'EU and UK' }));

    assert.deepEqual(listTasks(f.store).map((t) => ({ id: t.id, state: t.state })), before);
    assert.ok(before.every((t) => t.state === 'pending'), 'nothing was dispatched');
    assert.equal(readWorkLog(f.store).length, logBefore, 'the relay appended no work');
    assert.equal(readRunDispatch(f.store, run), null, 'no dispatch was recorded against the run');
  } finally {
    f.cleanup();
  }
});

test('a verdict is recorded against what the run actually surfaced, in the host client\'s name', async () => {
  const f = fixture();
  try {
    await f.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } });
    const recorded = payload(
      await f.handle(
        call('record_outcome', {
          outcome: 'Launch a paid beta to EU users next month',
          namings: [{ domain: 'privacy', why: 'EU users means GDPR obligations before launch.' }],
        }),
      ),
    );
    const run = (recorded.body as { run: string }).run;

    const ok = payload(
      await f.handle(call('verdict', { run, confirm: ['privacy'], missed: ['commerce-tax'] })),
    );
    assert.equal(ok.isError, false);
    assert.deepEqual(ok.body, { run, seq: 1, confirmed: 1, dismissed: 0, missed: 1 });

    const stored = readFeedback(f.store);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].source, 'mcp:claude-code');
    assert.deepEqual(stored[0].verdicts, { privacy: 'confirmed', 'commerce-tax': 'missed' });

    // Confirming something that never surfaced would manufacture agreement in
    // the corpus; the projection enforces the CLI's rule, not a looser one.
    const bad = payload(await f.handle(call('verdict', { run, confirm: ['security'] })));
    assert.equal(bad.isError, true);
    assert.match((bad.body as { error: string }).error, /did not surface/);

    // A verdict is a label, not a state change.
    assert.ok(listTasks(f.store).every((t) => t.state === 'pending'));
  } finally {
    f.cleanup();
  }
});

test('bad arguments come back as readable tool errors, not transport failures', async () => {
  const f = fixture();
  try {
    for (const bad of [
      call('record_outcome', {}),
      call('record_outcome', { outcome: '  ' }),
      call('record_outcome', { outcome: 'x', namings: 'privacy' }),
      call('decide', { id: 'dec-1' }),
      call('verdict', {}),
      call('verdict', { run: 'run-nope', confirm: ['privacy'] }),
      call('verdict', { run: 'run-1', confirm: 'privacy' }),
      call('validate_brief', {}),
      call('work_log', {}),
    ]) {
      const reply = await f.handle(bad);
      const { body, isError } = payload(reply);
      assert.equal(isError, true);
      assert.ok((body as { error: string }).error.length > 0);
    }
  } finally {
    f.cleanup();
  }
});

test('initialize declares the server and tools/list matches the exported surface', async () => {
  const f = fixture();
  try {
    const init = await f.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const info = (init?.result as { serverInfo: { name: string } }).serverInfo;
    assert.equal(info.name, 'construct');

    const listed = await f.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = (listed?.result as { tools: Array<{ name: string }> }).tools;
    assert.deepEqual(tools.map((t) => t.name), PROJECTION_TOOLS.map((t) => t.name));
  } finally {
    f.cleanup();
  }
});

test('drop_note: both doors land the verbatim body, and the reply bounds what a citation may name', async () => {
  const f = fixture();
  try {
    const typed = payload(
      await f.handle(
        call('drop_note', {
          workspace: 'acme',
          body: 'they want the pilot in Q4\npricing stays flat',
          door: 'host-session',
        }),
      ),
    );
    assert.equal(typed.isError, false);
    const body = typed.body as { note: string; door: string; lines: number };
    assert.equal(body.door, 'host-session');
    assert.equal(body.lines, 2);
    assert.equal(getNote(f.store, body.note)?.body, 'they want the pilot in Q4\npricing stays flat');

    const dropped = payload(
      await f.handle(
        call('drop_note', { workspace: 'acme', body: 'from the dropped file', door: 'file-drop' }),
      ),
    );
    assert.equal((dropped.body as { door: string }).door, 'file-drop');
  } finally {
    f.cleanup();
  }
});

test('drop_note refuses a missing workspace, an unknown door, and an empty body', async () => {
  const f = fixture();
  try {
    for (const args of [
      { body: 'x', door: 'host-session' },
      { workspace: 'acme', body: 'x', door: 'email' },
      { workspace: 'acme', body: '  ', door: 'file-drop' },
    ]) {
      const { body, isError } = payload(await f.handle(call('drop_note', args)));
      assert.equal(isError, true, JSON.stringify(args));
      assert.ok((body as { error: string }).error);
    }
    assert.equal(notesFor(f.store, 'acme').length, 0);
  } finally {
    f.cleanup();
  }
});

/**
 * A host reaches whatever Construct is installed, never whatever a repository
 * holds. A trial found a machine answering with fifteen domains while the tree
 * carried seventeen, and nothing on either side said so — so an operator
 * reading a catalog through a chat surface was making claims about coverage
 * from a released build they could not name. The handshake carries the version
 * too; a model that read the catalog and never saw the handshake is who this
 * is for.
 */
test('the catalog names the Construct that answered it', async () => {
  const f = fixture();
  try {
    const answered = await f.handle(call('catalog'));
    const { body } = payload(answered);
    const catalog = body as { construct: string; stale?: string; domains: { domain: string }[] };

    assert.equal(typeof catalog.construct, 'string');
    assert.ok(catalog.construct.length > 0, 'the version answering is not blank');
    assert.ok(catalog.domains.length > 0);
    // A store nothing richer has opened: the reply is exactly what it was.
    assert.equal(catalog.stale, undefined);
  } finally {
    f.cleanup();
  }
});

/**
 * The host reaches whatever Construct is installed, not whatever the tree
 * carries — and the machine's newer build leaves its catalog mark on the
 * shared store every time it opens it. An answer served through an older
 * build must say it is behind rather than leaving the reader to count
 * domains against a list it cannot see.
 */
test('a catalog answered by a build behind the store mark says so', async () => {
  const f = fixture();
  try {
    recordCatalogSighting(f.store, {
      version: '99.0.0',
      domains: DOMAINS.length + 2,
      at: AT,
    });

    const answered = await f.handle(call('catalog'));
    const { body, isError } = payload(answered);
    assert.equal(isError, false);
    const catalog = body as { construct: string; stale?: string; domains: { domain: string }[] };

    assert.ok(catalog.stale, 'skew is stated, not silent');
    assert.match(catalog.stale, /99\.0\.0/);
    assert.match(catalog.stale, new RegExp(String(DOMAINS.length + 2)));
    assert.match(catalog.stale, /behind/);
    // The domains themselves are unchanged: the line warns, it does not trim.
    assert.equal(catalog.domains.length, DOMAINS.length);
  } finally {
    f.cleanup();
  }
});

test('a mark at or behind the answering build changes nothing', async () => {
  const f = fixture();
  try {
    // 'test' does not parse as a version, so richness falls to the domain
    // count — the same count the server answers with, which is not skew.
    recordCatalogSighting(f.store, { version: 'test', domains: DOMAINS.length, at: AT });
    const { body } = payload(await f.handle(call('catalog')));
    assert.equal((body as { stale?: string }).stale, undefined);
  } finally {
    f.cleanup();
  }
});

/**
 * An operator triaging a decision needs to see what is already known about the
 * thing they are deciding about. Before this that meant leaving the surface,
 * which is the whole complaint the projection exists to answer.
 */
test('a subject reads through the projection with its history and citations', async () => {
  const f = fixture();
  try {
    addRecord(f.store, {
      id: 'sub-1',
      workspace: 'blackstory',
      kind: 'customer',
      name: 'Acme',
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    updateRecordField(f.store, {
      record: 'sub-1',
      field: 'renewal',
      value: 'Q2',
      citation: 'note:n1#L4',
      recordedAt: '2026-08-01T00:00:00.000Z',
    });
    updateRecordField(f.store, {
      record: 'sub-1',
      field: 'renewal',
      value: 'Q3',
      citation: 'note:n2#L9',
      recordedAt: '2026-08-05T00:00:00.000Z',
    });

    const listed = payload(await f.handle(call('records', { workspace: 'blackstory' }))).body as {
      subjects: { id: string; name: string }[];
    };
    assert.deepEqual(listed.subjects.map((s) => s.name), ['Acme']);

    const shown = payload(await f.handle(call('record', { id: 'sub-1' }))).body as {
      fields: { field: string; value: string; citation: string; previously: { value: string }[] }[];
    };
    const renewal = shown.fields.find((field) => field.field === 'renewal');
    assert.equal(renewal?.value, 'Q3', 'the current value is the most recent');
    assert.equal(renewal?.citation, 'note:n2#L9', 'and it carries the words that taught it');
    // A current value with no way to see what it replaced is a fact with no way
    // to be wrong.
    assert.deepEqual(renewal?.previously.map((p) => p.value), ['Q2']);
  } finally {
    f.cleanup();
  }
});

/**
 * The two operations that must not reach a surface whose host can enable
 * externally reachable channels: the ones that spend the user's money, and the
 * one with no way back.
 */
test('review, compose, ask and erasure are absent from this surface by decision', () => {
  const names: string[] = PROJECTION_TOOLS.map((tool) => tool.name);
  for (const absent of ['review', 'compose', 'ask', 'record_erase', 'erase', 'work']) {
    assert.equal(names.includes(absent), false, `${absent} must not be projected`);
  }
});

/**
 * A note dropped here is stored and waits. The tool used to say the loop
 * happened "elsewhere", which a model relays to the user as though the work had
 * been done somewhere they need not think about.
 */
test('drop_note says plainly that nothing is learned until someone runs the loop', () => {
  const note = PROJECTION_TOOLS.find((tool) => tool.name === 'drop_note');
  assert.match(note?.description ?? '', /does not run the context loop/);
  assert.match(note?.description ?? '', /construct notes --run/);
});

/**
 * The description is the only thing a calling host or model reads before
 * calling the tool. It stated an exhaustive-sounding list of discard reasons
 * (outside the catalog, no reason given) that left out a third: an outcome
 * text already consulted once answers from a cache instead of evaluating a
 * fresh, well-formed proposal at all.
 */
test('record_outcome names the cache override in its own description', () => {
  const tool = PROJECTION_TOOLS.find((t) => t.name === 'record_outcome');
  assert.match(tool?.description ?? '', /already consulted/);
  assert.match(tool?.description ?? '', /cache/);
  assert.match(tool?.description ?? '', /notAdmittedBecause/);
});

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

/**
 * Every module this surface can reach by importing, transitively. Relative
 * specifiers carry their extension throughout the tree, so following them is
 * the whole graph; a specifier that resolves to nothing is skipped rather than
 * guessed at.
 */
function importClosure(entry: string): Map<string, string> {
  const reached = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reached.has(file)) continue;
    const text = readFileSync(file, 'utf8');
    reached.set(file, text);
    for (const match of text.matchAll(/from\s*'(\.[^']+\.ts)'/g)) {
      const next = resolve(dirname(file), match[1]);
      if (existsSync(next)) queue.push(next);
    }
  }
  return reached;
}

/**
 * The spend boundary as a property of the code rather than a promise in a
 * comment: nothing the projection can reach is able to start a host process.
 * Spending happens by running a model, running a model happens by spawning a
 * host, and no module in this closure can spawn anything — so no tool on this
 * surface can spend, whatever a future one is written to do. The ask relay is
 * inside that closure, which is what makes it a read rather than a dispatch
 * wearing the clothes of one.
 */
test('nothing the projection can reach is able to spawn a host', () => {
  const reached = importClosure(join(SRC, 'hosts', 'mcp', 'projection.ts'));
  assert.ok(reached.size > 10, `the walk found only ${reached.size} modules; it did not follow the graph`);
  assert.ok(
    [...reached.keys()].some((file) => file.endsWith(join('kernel', 'run', 'asks.ts'))),
    'the ask protocol is inside the closure this proves things about',
  );

  for (const [file, text] of reached) {
    const where = relative(SRC, file);
    assert.doesNotMatch(text, /from\s*'node:child_process'/, `${where} can spawn a process`);
    assert.doesNotMatch(text, /import\(\s*'node:child_process'\s*\)/, `${where} can spawn a process`);
    // Host adapters are the execution transports. The projection is presence,
    // so the only host code it reaches is the MCP surface itself.
    assert.ok(
      !where.startsWith(`hosts${sep}`) || where.startsWith(join('hosts', 'mcp') + sep),
      `${where} is an execution transport and the projection can reach it`,
    );
  }
});

/**
 * Inbox positions (the text describing pending decisions) reach the projection
 * without the escaping the terminal path applies, so attacker-authored content
 * with control characters could be misinterpreted by the in-session agent. The
 * projection must apply the same escape discipline the terminal render path uses.
 */
test('control characters in decision positions and questions are escaped', async () => {
  const f = fixture();
  try {
    // Create a decision with actual control characters (ESC, STX, etc.).
    const esc = '\x1b'; // ESC character
    const stx = '\x02'; // STX (Start of Text)

    raiseDecision(f.store, {
      id: 'dec-control',
      run: 'run-1',
      question: `Ship now or wait?${esc}Fake question`,
      positions: [
        { role: 'legal', stance: `wait${stx}actually ship`, citation: null },
        { role: 'program', stance: 'ship now', citation: `note#L5${esc}injected` },
      ],
      raisedAt: AT,
    });

    // The inbox returns escaped positions.
    const inbox = payload(await f.handle(call('inbox')));
    const decisions = (inbox.body as { decisions: Array<{ question: string; positions: Array<{ stance: string; citation: string | null }> }> }).decisions;
    assert.equal(decisions.length, 1);
    const escaped = decisions[0];

    // Control characters in question and stance must be escaped as \xNN sequences.
    assert.ok(escaped.question.includes('\\x1b'), 'ESC in question is escaped');
    assert.equal(escaped.question.includes(esc), false);
    assert.ok(escaped.positions[0].stance.includes('\\x02'), 'STX in stance is escaped');
    assert.equal(escaped.positions[0].stance.includes(stx), false);
    assert.ok(escaped.positions[1].citation?.includes('\\x1b'), 'ESC in citation is escaped');

    // Plain text without control characters survives readable.
    assert.match(escaped.positions[1].stance, /ship now/);
    assert.ok(escaped.question.includes('Ship now or wait'));
  } finally {
    f.cleanup();
  }
});

/**
 * The escape applies to asks as well: a role's question and the standing
 * default both carry untrusted content that could include control characters.
 */
test('control characters in asks are escaped', async () => {
  const f = fixture();
  try {
    const esc = '\x1b'; // ESC character
    raiseDecision(
      f.store,
      frameAsk({
        run: 'run-1',
        task: 't-test',
        role: 'privacy',
        ask: { question: `Which regions?${esc}Injected`, assuming: 'EU only', stakes: null },
        at: AT,
      }),
    );

    const asks = payload(await f.handle(call('asks')));
    const open = (asks.body as { open: Array<{ question: string; standingDefault: string | null }> }).open;
    assert.equal(open.length, 1);

    // Control characters are escaped.
    assert.ok(open[0].question.includes('\\x1b'), 'ESC in question is escaped');
    assert.equal(open[0].question.includes(esc), false);
    // Plain content survives.
    assert.ok(open[0].question.includes('Which regions'));
    assert.ok(open[0].standingDefault?.includes('EU only'));
  } finally {
    f.cleanup();
  }
});

/**
 * The escape applies to user input relayed through decide and answer as well.
 * A resolution or answer echoed back from the projection should not be able to
 * carry unescaped control characters.
 */
test('user resolutions and answers are escaped on echo', async () => {
  const f = fixture();
  try {
    const stx = '\x02'; // STX (Start of Text)
    raiseDecision(f.store, {
      id: 'dec-echo',
      run: 'run-1',
      question: 'Ship or wait?',
      positions: [
        { role: 'legal', stance: 'wait', citation: null },
        { role: 'program', stance: 'ship', citation: null },
      ],
      raisedAt: AT,
    });

    const decided = payload(
      await f.handle(call('decide', { id: 'dec-echo', resolution: `Ship now${stx}Injected` })),
    );
    assert.equal(decided.isError, false);
    // The resolution returned should have control characters escaped.
    const resolution = (decided.body as { resolution: string }).resolution;
    assert.ok(resolution.includes('\\x02'), 'STX is escaped');
    assert.equal(resolution.includes(stx), false);
    assert.ok(resolution.includes('Ship now'));
  } finally {
    f.cleanup();
  }
});
