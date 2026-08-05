/**
 * tests/cli/roleserve.test.ts — the role write surface, exercised end to end
 * across a real process boundary.
 *
 * The heart of these tests is the shape of the trust boundary: the model-side
 * caller sends tool calls that carry NO credential, run, or task; the serving
 * process attaches all three from the dispatcher-set environment; and the
 * bearer string never appears in anything the server emits or records. The
 * happy path and every denial are asserted against the real store the server
 * wrote, not against the server's own say-so.
 *
 * The protocol core is also tested in-process (handleMessage), because framing
 * bugs and authorization bugs fail differently and should be locatable apart.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sterile } from '../harness/sterile.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import type { Store } from '../../src/kernel/store/open.ts';
import { claimTask, enqueueTask, listTasks } from '../../src/kernel/store/tasks.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { loadOrCreateSecret } from '../../src/kernel/capabilities/secretfile.ts';
import { issueRoleToken } from '../../src/kernel/capabilities/tokens.ts';
import { buildRoleEnv } from '../../src/kernel/run/roleenv.ts';
import { handleMessage, TOOLS } from '../../src/cli/roleserve.ts';
import type { RoleServeCore } from '../../src/cli/roleserve.ts';

const BIN = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));
const AT = '2026-08-03T00:00:00.000Z';
// The spawned server judges expiry against the REAL clock, so a live token's
// deadline must be genuinely ahead of it — a fixed date would start failing
// the moment it passed, and this suite should not carry a time bomb.
const LEASE_END = new Date(Date.now() + 15 * 60 * 1000).toISOString();

interface Seeded {
  readonly root: string;
  readonly xdg: string;
  readonly storeFile: string;
  readonly secret: string;
  readonly token: string;
  readonly cleanup: () => void;
}

/** A sterile home with a claimed task and an honestly-minted token for it. */
function seedFixture(expiresAt: string = LEASE_END): Seeded {
  const fixture = sterile();
  const xdg = join(fixture.root, 'xdg');
  const dataDir = join(xdg, 'construct');
  const storeFile = join(dataDir, 'construct.db');
  const secret = loadOrCreateSecret(join(dataDir, 'capability-secret'));

  const store = openStore(storeFile);
  enqueueTask(store, {
    id: 'task-1',
    run: 'run-x',
    role: 'privacy',
    brief: { id: 'task-1', outcome: 'test', role: 'privacy', inputs: [], capabilities: [], postconditions: [] },
    at: AT,
  });
  const leased = claimTask(store, { owner: 'coord', leaseUntil: LEASE_END, now: AT });
  assert.ok(leased, 'fixture task must claim');
  store.close();

  const token = issueRoleToken(
    { run: 'run-x', task: 'task-1', role: 'privacy', expiresAt, nonce: '1' },
    secret,
  );
  return { root: fixture.root, xdg, storeFile, secret, token, cleanup: fixture.cleanup };
}

/** Spawn role-serve against the fixture, with the given env claim. */
function serve(seeded: Seeded, claim: { run: string; task: string }): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [BIN, 'role-serve'], {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(seeded.xdg, 'cfg'),
      XDG_STATE_HOME: join(seeded.xdg, 'state'),
      XDG_DATA_HOME: seeded.xdg,
      XDG_CACHE_HOME: join(seeded.xdg, 'cache'),
      ...buildRoleEnv({ token: seeded.token, run: claim.run, task: claim.task }),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Newline-framed JSON reader with a deadline, so a hang fails instead of stalling. */
function lineReader(child: ChildProcessWithoutNullStreams): (timeoutMs?: number) => Promise<unknown> {
  let buffer = '';
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const i = buffer.indexOf('\n');
      if (i < 0) break;
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    }
  });
  return (timeoutMs = 10_000) =>
    new Promise((resolve, reject) => {
      const queued = lines.shift();
      if (queued !== undefined) {
        resolve(JSON.parse(queued));
        return;
      }
      const timer = setTimeout(() => reject(new Error('no response before deadline')), timeoutMs);
      waiters.push((line) => {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      });
    });
}

function send(child: ChildProcessWithoutNullStreams, message: unknown): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function exited(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

function withReopened<T>(storeFile: string, fn: (store: Store) => T): T {
  const store = openStore(storeFile);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

test('a role submits a draft and appends to the log through MCP, never holding the bearer', async () => {
  const seeded = seedFixture();
  const child = serve(seeded, { run: 'run-x', task: 'task-1' });
  try {
    const read = lineReader(child);

    send(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    const init = (await read()) as { result: { serverInfo: { name: string }; protocolVersion: string } };
    assert.equal(init.result.serverInfo.name, 'construct-role');
    assert.equal(init.result.protocolVersion, '2025-06-18');

    send(child, { jsonrpc: '2.0', method: 'notifications/initialized' });

    send(child, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = (await read()) as { result: { tools: Array<{ name: string }> } };
    assert.deepEqual(
      list.result.tools.map((t) => t.name).sort(),
      ['append_work_log', 'submit_draft'],
    );

    // The call carries no token, no run, no task — that is the entire point.
    send(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'submit_draft', arguments: { deliverable: { text: 'issue-spotting notes' } } },
    });
    const draft = (await read()) as { result: { isError: boolean; content: [{ text: string }] } };
    assert.equal(draft.result.isError, false, draft.result.content[0].text);
    const outcome = JSON.parse(draft.result.content[0].text) as { ok: boolean; role: string };
    assert.equal(outcome.ok, true);
    assert.equal(outcome.role, 'privacy', 'attribution comes from the token, not the caller');

    send(child, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'append_work_log', arguments: { action: 'corpus-reviewed', detail: { files: 3 } } },
    });
    const note = (await read()) as { result: { isError: boolean } };
    assert.equal(note.result.isError, false);

    child.stdin.end();
    assert.equal(await exited(child), 0);

    withReopened(seeded.storeFile, (store) => {
      const log = readWorkLog(store, 'run-x');
      const actions = log.map((entry) => entry.action);
      assert.ok(actions.includes('draft-submitted'), `expected draft-submitted in ${actions.join(', ')}`);
      assert.ok(actions.includes('role:corpus-reviewed'), 'role-chosen action is namespaced');
      const submitted = log.find((entry) => entry.action === 'draft-submitted');
      assert.equal(submitted?.role, 'privacy');
      assert.equal(submitted?.task, 'task-1');

      const everything = JSON.stringify(log) + JSON.stringify(listTasks(store, 'run-x'));
      assert.ok(!everything.includes(seeded.token), 'bearer must appear in no record');
    });
  } finally {
    child.kill();
    seeded.cleanup();
  }
});

test('an env claim for another task is denied and the denial is on the record', async () => {
  const seeded = seedFixture();
  const child = serve(seeded, { run: 'run-x', task: 'task-2' });
  try {
    const read = lineReader(child);
    send(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await read();
    send(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'submit_draft', arguments: { deliverable: 'x' } },
    });
    const refused = (await read()) as { result: { isError: boolean; content: [{ text: string }] } };
    assert.equal(refused.result.isError, true);
    const outcome = JSON.parse(refused.result.content[0].text) as { ok: boolean; denial: string };
    assert.equal(outcome.ok, false);
    assert.equal(outcome.denial, 'wrong-task');

    child.stdin.end();
    await exited(child);

    withReopened(seeded.storeFile, (store) => {
      const denials = readWorkLog(store).filter((entry) => entry.action === 'capability-denied');
      assert.equal(denials.length, 1, 'a refused write is recorded, never dropped');
      assert.ok(!JSON.stringify(denials).includes(seeded.token));
    });
  } finally {
    child.kill();
    seeded.cleanup();
  }
});

test('an expired token is refused at the surface', async () => {
  const seeded = seedFixture('2020-01-01T00:00:00.000Z');
  const child = serve(seeded, { run: 'run-x', task: 'task-1' });
  try {
    const read = lineReader(child);
    send(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await read();
    send(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'append_work_log', arguments: { action: 'late' } },
    });
    const refused = (await read()) as { result: { isError: boolean; content: [{ text: string }] } };
    assert.equal(refused.result.isError, true);
    assert.equal((JSON.parse(refused.result.content[0].text) as { denial: string }).denial, 'expired');
    child.stdin.end();
    await exited(child);
  } finally {
    child.kill();
    seeded.cleanup();
  }
});

test('role-serve without the dispatcher environment refuses to start', async () => {
  const seeded = seedFixture();
  try {
    const child = spawn(process.execPath, [BIN, 'role-serve'], {
      env: { ...process.env, XDG_DATA_HOME: seeded.xdg, CONSTRUCT_ROLE_TOKEN: '', CONSTRUCT_ROLE_RUN: '', CONSTRUCT_ROLE_TASK: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    assert.equal(await exited(child), 2);
    assert.match(stderr, /dispatcher-set role environment/);
  } finally {
    seeded.cleanup();
  }
});

/* ---------------- protocol core, in-process ---------------- */

function coreFixture(): { core: RoleServeCore; done: () => void } {
  const seeded = seedFixture();
  const store = openStore(seeded.storeFile);
  return {
    core: {
      store,
      secret: seeded.secret,
      token: seeded.token,
      run: 'run-x',
      task: 'task-1',
      clock: () => AT,
      serverVersion: '0.0.0-test',
    },
    done: () => {
      store.close();
      seeded.cleanup();
    },
  };
}

test('protocol edges: unknown method, unknown tool, missing arguments, notifications', () => {
  const { core, done } = coreFixture();
  try {
    const unknown = handleMessage(core, { jsonrpc: '2.0', id: 9, method: 'resources/list' });
    assert.equal(unknown?.error?.code, -32601);

    const badTool = handleMessage(core, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'record_verdict', arguments: {} },
    });
    assert.equal(badTool?.error?.code, -32602, 'a verdict tool does not exist to call');

    const noDeliverable = handleMessage(core, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'submit_draft', arguments: {} },
    });
    assert.equal(noDeliverable?.error?.code, -32602);

    assert.equal(handleMessage(core, { jsonrpc: '2.0', method: 'notifications/cancelled' }), null);

    assert.equal(TOOLS.length, 2, 'two writes, and no third');
  } finally {
    done();
  }
});

/**
 * The acceptance chain in one piece: the COORDINATOR mints the token and
 * builds the env; a real role-serve process receives exactly that env; the
 * draft lands attributed to the role. No test-minted twin anywhere.
 */
test('a coordinator-minted token drives the full surface end to end', async () => {
  const { workRun } = await import('../../src/kernel/run/coordinator.ts');
  const fixture = sterile();
  const xdg = join(fixture.root, 'xdg');
  const dataDir = join(xdg, 'construct');
  const storeFile = join(dataDir, 'construct.db');
  const secret = loadOrCreateSecret(join(dataDir, 'capability-secret'));

  const store = openStore(storeFile);
  try {
    enqueueTask(store, {
      id: 'task-e2e',
      run: 'run-e2e',
      role: 'privacy',
      brief: { id: 'task-e2e', outcome: 'test', role: 'privacy', inputs: [], capabilities: [], postconditions: [] },
      at: new Date().toISOString(),
    });

    const host = {
      name: 'role-serve-probe',
      kind: 'general',
      capabilities: [] as const,
      init: async (): Promise<void> => {},
      health: async () => ({ live: true }),
      cancel: async () => ({ cancelled: false }),
      // The "host" here is the test acting as one: it launches the write
      // surface with the dispatcher-provided env, exactly as a real host's
      // MCP configuration would, and the model-side call carries nothing.
      async invoke(_request: unknown, context?: { roleEnv?: Record<string, string> }) {
        assert.ok(context?.roleEnv, 'coordinator must deliver the role env');
        const child = spawn(process.execPath, [BIN, 'role-serve'], {
          env: {
            ...process.env,
            XDG_CONFIG_HOME: join(xdg, 'cfg'),
            XDG_STATE_HOME: join(xdg, 'state'),
            XDG_DATA_HOME: xdg,
            XDG_CACHE_HOME: join(xdg, 'cache'),
            ...context.roleEnv,
          },
          stdio: ['pipe', 'pipe', 'pipe'] as const,
        }) as ChildProcessWithoutNullStreams;
        const read = lineReader(child);
        send(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
        await read();
        send(child, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'submit_draft', arguments: { deliverable: 'from inside the host' } },
        });
        const result = (await read()) as { result: { isError: boolean; content: [{ text: string }] } };
        assert.equal(result.result.isError, false, result.result.content[0].text);
        child.stdin.end();
        await exited(child);
        return { id: 'task-e2e', status: 'ok' as const, output: { text: 'done' }, error: null };
      },
    };

    await workRun(store, host, {
      owner: 'w1',
      clock: () => new Date().toISOString(),
      spendCeiling: 100,
      capabilitySecret: secret,
    });

    const log = readWorkLog(store, 'run-e2e');
    const actions = log.map((entry) => entry.action);
    assert.ok(actions.includes('capability-issued'));
    assert.ok(actions.includes('draft-submitted'), `expected draft-submitted in ${actions.join(', ')}`);
    const submitted = log.find((entry) => entry.action === 'draft-submitted');
    assert.equal(submitted?.role, 'privacy');
    assert.equal(submitted?.task, 'task-e2e');
    assert.ok(!JSON.stringify(log).includes('cx1.'), 'no bearer fragment on the record');
  } finally {
    store.close();
    fixture.cleanup();
  }
});
