/**
 * tests/hosts/mcp/projection.test.ts — the spine's presence inside an MCP
 * host, and the boundary it must not cross.
 *
 * The load-bearing assertions are the negative ones: the projection exposes
 * no dispatch and nothing that advances completion — no submit_draft, no
 * append_work_log, no promote. Completion is kernel-owned and the role
 * server's token-scoped writes are the only role door; a projection that grew
 * either would let a host model spend money or certify work as a side effect
 * of being present.
 *
 * The positive assertions: the caller-as-namer path drives the SAME admission
 * gate the CLI's subprocess namer drives (catalog membership, a stated
 * reason, dedup), the log records whose model named what, and the reply says
 * what was not admitted rather than letting the model assume acceptance.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { listTasks } from '../../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { readFeedback } from '../../../src/kernel/store/feedback.ts';
import { raiseDecision, openDecisions } from '../../../src/kernel/store/decisions.ts';
import { getNote, notesFor } from '../../../src/kernel/store/notes.ts';
import {
  PROJECTION_TOOLS,
  createProjectionHandler,
} from '../../../src/hosts/mcp/projection.ts';
import { addRecord, updateRecordField } from '../../../src/kernel/store/records.ts';
import type { ProjectionCore } from '../../../src/hosts/mcp/projection.ts';
import type { JsonRpcResponse } from '../../../src/hosts/mcp/jsonrpc.ts';

const AT = '2026-08-05T00:00:00.000Z';

interface Fixture {
  readonly store: Store;
  readonly handle: (message: unknown) => Promise<JsonRpcResponse | null>;
  cleanup(): void;
}

function fixture(): Fixture {
  const sterileFixture = sterile();
  const store = openStore(join(sterileFixture.paths.dataDir, 'construct.db'));
  const core: ProjectionCore = { store, clock: () => AT, serverVersion: 'test' };
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
  // merely absent from the list.
  const f = fixture();
  try {
    for (const forbidden of ['submit_draft', 'append_work_log', 'promote', 'work']) {
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
    assert.equal(started.inferredBy, 'namer');
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

test('omitting namings is the deterministic keyword path — no model is claimed', async () => {
  const f = fixture();
  try {
    const reply = await f.handle(
      call('record_outcome', { outcome: 'Handle GDPR data subject requests for EU customers' }),
    );
    const { body } = payload(reply);
    const started = body as { inferredBy: string };
    assert.ok(
      started.inferredBy === 'keywords' || started.inferredBy === 'none',
      `keyword path only, got ${started.inferredBy}`,
    );
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

    // A second resolution of the same decision is refused as a result the
    // model can read, not a transport error.
    const again = payload(await f.handle(call('decide', { id: 'dec-1', resolution: 'Ship.' })));
    assert.equal(again.isError, true);
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
    const catalog = body as { construct: string; domains: { domain: string }[] };

    assert.equal(typeof catalog.construct, 'string');
    assert.ok(catalog.construct.length > 0, 'the version answering is not blank');
    assert.ok(catalog.domains.length > 0);
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
test('review, compose and erasure are absent from this surface by decision', () => {
  const names: string[] = PROJECTION_TOOLS.map((tool) => tool.name);
  for (const absent of ['review', 'compose', 'record_erase', 'erase', 'work']) {
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
