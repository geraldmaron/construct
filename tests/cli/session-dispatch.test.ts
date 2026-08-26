/**
 * tests/cli/session-dispatch.test.ts — in-session work uses the host that is
 * already there, and doctor never claims a spawn that work will not do.
 *
 * The failure this guards: `construct doctor` said Cursor in-session execution
 * was available, then `construct work --host=cursor` spawned cursor-agent and
 * died. Spawning the CLI you are already inside of is a second runtime.
 * In-session dispatch is host-pull through construct serve.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor, outcome, work } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { createCursorAdapter } from '../../src/hosts/cursor/adapter.ts';
import { usesSessionDispatch } from '../../src/hosts/session.ts';
import { presenceLines, surveyHosts } from '../../src/hosts/presence.ts';
import type { ProbeExec } from '../../src/hosts/presence.ts';
import { HOST_PULL_TOOLS } from '../../src/hosts/mcp/hostpull.ts';
import { PROJECTION_TOOLS, createProjectionHandler } from '../../src/hosts/mcp/projection.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { enqueueTask } from '../../src/kernel/store/tasks.ts';
import { sterile, sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

sterileHome();
sterileAmbientEnv();

const CURSOR_ENV = { CURSOR_AGENT: '1' };
const CLAUDE_ENV = { CLAUDECODE: '1' };
const BOB_ENV = { BOB_SHELL_CLI_IDE_SERVER_PORT: '42991' };

async function capture<T>(fn: () => T | Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: await fn(), out, err };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

async function isolated<T>(fn: () => Promise<T> | T): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'construct-session-'));
  const previous = { data: process.env.XDG_DATA_HOME, state: process.env.XDG_STATE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  try {
    return await fn();
  } finally {
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous.state;
    rmSync(root, { recursive: true, force: true });
  }
}

test('usesSessionDispatch is true inside Cursor and false when a different host is named', () => {
  assert.equal(usesSessionDispatch(CURSOR_ENV, { hostExplicit: false })?.host, 'cursor');
  assert.equal(usesSessionDispatch(CURSOR_ENV, { host: 'cursor', hostExplicit: true })?.host, 'cursor');
  assert.equal(usesSessionDispatch(CURSOR_ENV, { host: 'opencode', hostExplicit: true }), null);
  assert.equal(usesSessionDispatch(CURSOR_ENV, { hostExplicit: false, binary: '/opt/cursor-agent' }), null);
  assert.equal(usesSessionDispatch({}, { hostExplicit: false }), null);
});

test('doctor names in-session dispatch through serve, never a spawnable Cursor that work cannot start', async () => {
  await isolated(async () => {
    const { out } = await capture(() => doctor(process.cwd(), CURSOR_ENV));
    assert.match(
      out,
      /ok {3}ambient {2}running inside cursor \(detected via CURSOR_AGENT\); in-session dispatch: this session via construct serve \(will not spawn cursor\)/,
    );
    assert.doesNotMatch(out, /in-session execution: available/);
  });
});

test('doctor names Bob the same way: this session via serve, not a missing adapter as a dead end', async () => {
  await isolated(async () => {
    const { out } = await capture(() => doctor(process.cwd(), BOB_ENV));
    assert.match(out, /running inside bob/);
    assert.match(out, /in-session dispatch: this session via construct serve/);
    assert.doesNotMatch(out, /projection-only/);
  });
});

test('a missing cursor-agent binary is reported as not spawnable', () => {
  const none: ProbeExec = () => null;
  const lines = presenceLines(surveyHosts(none));
  const cursor = lines.find((line) => line.startsWith('cursor:'));
  assert.ok(cursor);
  assert.match(cursor, /spawnable: no/);
  const bob = lines.find((line) => line.startsWith('bob:'));
  assert.ok(bob);
  assert.match(bob, /spawnable: no/);
});

test('work --host=cursor inside Cursor does not spawn and hands the session the tasks', async () => {
  await isolated(async () => {
    const recorded = await capture(() => outcome(['--domains=evidence-provenance', 'investigate the launch'], undefined, CURSOR_ENV));
    assert.equal(recorded.result, 0);
    const { result, out, err } = await capture(() => work(['--host=cursor'], undefined, undefined, CURSOR_ENV));
    assert.equal(result, 0);
    assert.match(out, /In-session dispatch through cursor/);
    assert.match(out, /will not spawn a second cursor CLI/);
    assert.match(out, /claim_task/);
    assert.match(out, /submit_work/);
    assert.doesNotMatch(err, /Could not start/);
    assert.doesNotMatch(out, /Record an outcome first/);
  });
});

function standInHost(): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => ({
      id: (request as { role?: string }).role ?? 'x',
      status: 'ok',
      output: { text: 'a deliverable' },
      error: null,
    }),
  };
}

test('work finds the run it just recorded when no --run is typed', async () => {
  await isolated(async () => {
    await capture(() => outcome(['--domains=evidence-provenance', 'investigate the launch'], undefined, {}));
    const { result, out } = await capture(() => work([], standInHost(), undefined, {}));
    assert.equal(result, 0);
    assert.match(out, /worked \d+ task/);
    assert.doesNotMatch(out, /Record an outcome first/);
  });
});

test('an in-session outcome does not staff from the keyword map', async () => {
  await isolated(async () => {
    const { result, out } = await capture(() =>
      outcome(['research the market and ship an experiment'], undefined, CURSOR_ENV),
    );
    assert.equal(result, 0);
    assert.match(out, /This session is the namer/);
    assert.match(out, /keyword map is not first-run/);
    assert.doesNotMatch(out, /implicated domains/);
  });
});

test('a recorded run with no tasks is not reported as "record an outcome first"', async () => {
  await isolated(async () => {
    const { out: recorded } = await capture(() =>
      outcome(['research the market and ship an experiment'], undefined, CURSOR_ENV),
    );
    const id = /run (run-\S+)/.exec(recorded)?.[1];
    assert.ok(id);
    const { out } = await capture(() => work([`--run=${id}`], undefined, undefined, CURSOR_ENV));
    assert.match(out, /on record but queued no tasks/);
    assert.doesNotMatch(out, /Record an outcome first/);
  });
});

test('the Cursor adapter does not spawn cursor-agent when CURSOR_AGENT is set', async () => {
  let spawned = 0;
  const adapter = createCursorAdapter({
    env: CURSOR_ENV,
    spawn: () => {
      spawned += 1;
      throw new Error('must not spawn');
    },
  });
  await adapter.init();
  assert.equal(spawned, 0);
  await assert.rejects(
        () => adapter.invoke({ role: 'evidence-provenance', task: 'look' }),
    /second runtime|construct serve/,
  );
  assert.equal(spawned, 0);
});

test('construct serve with a secret lists host-pull dispatch tools', async () => {
  const s = sterile();
  const store = openStore(join(s.paths.dataDir, 'construct.db'));
  try {
    enqueueTask(store, {
      id: 'task-1',
      run: 'run-x',
      role: 'evidence-provenance',
      brief: { id: 'task-1', outcome: 'look', role: 'evidence-provenance', inputs: [], capabilities: [], postconditions: [] },
      at: '2026-08-26T00:00:00.000Z',
    });
    const handle = createProjectionHandler({
      store,
      clock: () => '2026-08-26T00:00:00.000Z',
      serverVersion: 'test',
      secret: 'test-secret-not-a-real-key',
    });
    const listed = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (listed?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    for (const name of PROJECTION_TOOLS.map((t) => t.name)) {
      assert.ok(tools.includes(name), `${name} stays on serve`);
    }
    for (const name of HOST_PULL_TOOLS.map((t) => t.name)) {
      assert.ok(tools.includes(name), `${name} is how serve dispatches`);
    }
    assert.ok(!tools.includes('promote'));
    assert.ok(!tools.includes('work'));
  } finally {
    store.close();
    s.cleanup();
  }
});

test('Claude in-session is the same dispatch shape as Cursor', async () => {
  await isolated(async () => {
    await capture(() => outcome(['--domains=evidence-provenance', 'investigate the launch'], undefined, CLAUDE_ENV));
    const { result, out } = await capture(() => work([], undefined, undefined, CLAUDE_ENV));
    assert.equal(result, 0);
    assert.match(out, /In-session dispatch through claude/);
    assert.match(out, /will not spawn a second claude CLI/);
  });
});
