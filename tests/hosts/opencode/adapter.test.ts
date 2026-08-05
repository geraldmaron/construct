/**
 * tests/hosts/opencode/adapter.test.ts — the adapter, with the process boundary
 * faked and everything else real.
 *
 * The fake supplies stdout from the captured fixtures, so these exercise the
 * adapter's actual reduction and error mapping rather than a mock of it. What is
 * NOT covered here is whether OpenCode still behaves the way those fixtures say
 * — that is scripts/probe-opencode-conformance.mjs, which needs a live binary
 * and cannot run in a hermetic suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenCodeAdapter, HOST_NAME, OPENCODE_CAPABILITIES } from '../../../src/hosts/opencode/adapter.ts';
import type { OpenCodeDeliverable, OpenCodeSpawnFn, SpawnedProcess } from '../../../src/hosts/opencode/adapter.ts';
import { PINNED_VERSION } from '../../../src/hosts/opencode/pin.ts';
import { validate } from '../../../src/kernel/hosts/interface.ts';
import { HostNotReadyError, InvocationError, InvocationTimeoutError } from '../../../src/kernel/hosts/errors.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`fixtures/${name}.ndjson`, import.meta.url), 'utf8');
}

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

interface Fake {
  readonly spawn: OpenCodeSpawnFn;
  readonly calls: Call[];
  readonly killed: string[][];
}

/** A fake process boundary: `--version` answers, `run` replays a transcript. */
function fakeSpawn(options: {
  version?: string;
  stdout?: string;
  code?: number;
  stderr?: string;
  hang?: boolean;
  throwOnSpawn?: boolean;
} = {}): Fake {
  const calls: Call[] = [];
  const killed: string[][] = [];

  const spawn: OpenCodeSpawnFn = (command, args, opts) => {
    if (options.throwOnSpawn) throw new Error('ENOENT');
    calls.push({ command, args: [...args], cwd: opts.cwd });

    if (args[0] === '--version') {
      return {
        done: Promise.resolve({ code: 0, stdout: `${options.version ?? PINNED_VERSION}\n`, stderr: '' }),
        kill: () => {},
      };
    }
    // init()'s database warm-up. Answered here so it does not read as a run and
    // hang every test that fakes a run which never settles.
    if (args[0] === 'stats') {
      return {
        done: Promise.resolve({ code: 0, stdout: '', stderr: '' }),
        kill: () => {},
      };
    }

    let settle: (value: { code: number | null; stdout: string; stderr: string }) => void = () => {};
    const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      settle = resolve;
    });
    const process: SpawnedProcess = {
      done,
      kill: () => {
        killed.push([...args]);
        settle({ code: null, stdout: options.stdout ?? '', stderr: '' });
      },
    };
    if (!options.hang) {
      settle({ code: options.code ?? 0, stdout: options.stdout ?? '', stderr: options.stderr ?? '' });
    }
    return process;
  };

  return { spawn, calls, killed };
}

const REQUEST = { role: 'privacy', task: 'Issue-spot this DPA.' };

/**
 * A process boundary the test settles by hand, so overlap is observable. The
 * plain `fakeSpawn` settles before it returns, which makes every invocation
 * look serial no matter what the adapter does — useless for proving a gate.
 *
 * `warmFails` makes init()'s warm-up not confirm, which is the only condition
 * under which the first-run gate arms. `throwOnRunNumber` fails one specific
 * `run` spawn: the gate has to open on the path where the host never started,
 * and that is the one place a leak deadlocks every later invocation instead of
 * failing one.
 */
function gatedSpawn(options: { code?: number; throwOnRunNumber?: number; warmFails?: boolean } = {}) {
  const release: Array<() => void> = [];
  let spawned = 0;
  let live = 0;
  let peak = 0;

  const spawn: OpenCodeSpawnFn = (_command, args) => {
    if (args[0] === '--version') {
      return {
        done: Promise.resolve({ code: 0, stdout: `${PINNED_VERSION}\n`, stderr: '' }),
        kill: () => {},
      };
    }
    if (args[0] === 'stats') {
      return {
        done: Promise.resolve({ code: options.warmFails ? 1 : 0, stdout: '', stderr: '' }),
        kill: () => {},
      };
    }
    spawned += 1;
    if (spawned === options.throwOnRunNumber) throw new Error('ENOENT');
    live += 1;
    peak = Math.max(peak, live);

    let settle: (value: { code: number | null; stdout: string; stderr: string }) => void = () => {};
    const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      settle = resolve;
    });
    release.push(() => {
      live -= 1;
      settle({ code: options.code ?? 0, stdout: '', stderr: '' });
    });
    return { done, kill: () => {} };
  };

  return {
    spawn,
    spawned: () => spawned,
    peak: () => peak,
    releaseAll: () => {
      for (const settle of release.splice(0)) settle();
    },
  };
}

/** Let every pending microtask and promise callback run. */
function settleQueue(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test('init() opens the host database itself, before any task can meet it cold', async () => {
  const fake = fakeSpawn();
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  // The migration race: whatever opens OpenCode's database first migrates it, and
  // that open can fail. init() spends a disposable command on it so a real task
  // never does.
  const warmup = fake.calls.find((call) => call.args[0] === 'stats');
  assert.ok(warmup, 'init() must warm the database');
  assert.ok(
    !fake.calls.some((call) => call.args[0] === 'run'),
    'and it must do it without a model call — that would be unmetered spend on every init',
  );
});

test('a host whose warm-up fails still starts, and gates instead', async () => {
  const fake = gatedSpawn({ warmFails: true });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });

  // Best-effort by design: refusing to start because a warm-up command moved
  // would turn a performance guard into an outage.
  await adapter.init();

  const both = [
    adapter.invoke({ role: 'privacy', task: 'one' }),
    adapter.invoke({ role: 'commerce-tax', task: 'two' }),
  ];
  assert.equal(fake.spawned(), 1, 'an unconfirmed database means one run meets it, not two');
  fake.releaseAll();
  await settleQueue();
  fake.releaseAll();
  await Promise.all(both);
});

test('a warmed host does not serialize anything — the gate is fallback, not policy', async () => {
  const fake = gatedSpawn();
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  const all = [
    adapter.invoke({ role: 'privacy', task: 'one' }),
    adapter.invoke({ role: 'commerce-tax', task: 'two' }),
    adapter.invoke({ role: 'product-scoping', task: 'three' }),
  ];
  await settleQueue();

  assert.equal(fake.spawned(), 3, 'the migration already happened; making tasks queue would be pure loss');
  assert.equal(fake.peak(), 3);
  fake.releaseAll();
  await Promise.all(all);
});

test('the first run against an unconfirmed database goes alone; the rest go together', async () => {
  const fake = gatedSpawn({ warmFails: true });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  const all = [
    adapter.invoke({ role: 'privacy', task: 'one' }),
    adapter.invoke({ role: 'commerce-tax', task: 'two' }),
    adapter.invoke({ role: 'product-scoping', task: 'three' }),
  ];

  // This is the migration race: without the gate all three start at once and race
  // OpenCode's one-time sqlite migration, and the losers exit 1. Checked before
  // any flush, because the gate owner must reach spawn in the same tick it
  // always did — an await slipped in ahead of it moves cancel()'s window.
  assert.equal(fake.spawned(), 1, 'only the first run may start against a cold data dir');
  await settleQueue();
  assert.equal(fake.spawned(), 1, 'and it is still alone after the queue drains');

  fake.releaseAll();
  await settleQueue();

  assert.equal(fake.spawned(), 3, 'once the migration is done the rest are free to go');
  assert.equal(fake.peak(), 2, 'and they go concurrently — the gate is first-run only, not a queue');

  fake.releaseAll();
  const results = await Promise.all(all);
  assert.deepEqual(results.map((r) => r.status), ['ok', 'ok', 'ok']);
});

test('a first run that fails still opens the gate', async () => {
  const fake = gatedSpawn({ code: 1, warmFails: true });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  const first = adapter.invoke({ role: 'privacy', task: 'one' });
  const second = adapter.invoke({ role: 'commerce-tax', task: 'two' });

  // Release once per generation: the second run does not exist to be settled
  // until the first has finished and opened the gate.
  fake.releaseAll();
  await settleQueue();
  fake.releaseAll();

  // The migration runs at host startup whatever the run does afterwards, so a
  // failing first task must not wedge every task behind it.
  assert.equal((await first).status, 'error');
  assert.equal((await second).status, 'error');
  assert.equal(fake.spawned(), 2);
});

test('cancelling a run still waiting at the gate stops it before it ever spawns', async () => {
  const fake = gatedSpawn({ warmFails: true });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  const first = adapter.invoke({ role: 'privacy', task: 'one' });
  const waiting = adapter.invoke({ role: 'commerce-tax', task: 'two' }, { invocationId: 'inv-wait' });

  // The window this covers did not exist before the gate: an invocation that
  // has been accepted but has not spawned. Reporting "no in-flight invocation"
  // for it would tell the caller nothing was cancelled while it went on to run.
  assert.deepEqual(await adapter.cancel('inv-wait'), { cancelled: true });

  fake.releaseAll();
  assert.equal((await waiting).status, 'cancelled');
  assert.equal((await first).status, 'ok');
  assert.equal(fake.spawned(), 1, 'the cancelled run must never have started');
});

test('a first run whose host never starts opens the gate rather than deadlocking', async () => {
  const fake = gatedSpawn({ throwOnRunNumber: 1, warmFails: true });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  await assert.rejects(() => adapter.invoke({ role: 'privacy', task: 'one' }), InvocationError);

  const second = adapter.invoke({ role: 'commerce-tax', task: 'two' });
  await settleQueue();
  fake.releaseAll();

  // Guarded, because the failure this test exists for is a hang: an unopened
  // gate leaves `second` pending forever and would stall the suite, not fail it.
  let guard: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    second.then((result) => result.status),
    new Promise((resolve) => {
      guard = setTimeout(() => resolve('never-settled'), 1000);
    }),
  ]).finally(() => {
    if (guard) clearTimeout(guard);
  });
  assert.equal(outcome, 'ok', 'a spawn failure must release the gate it claimed');
});

test('the adapter satisfies the host seam it claims to implement', () => {
  assert.deepEqual(validate(createOpenCodeAdapter({ spawn: fakeSpawn().spawn })), {
    valid: true,
    errors: [],
  });
});

test('it declares only capabilities it actually has', () => {
  const adapter = createOpenCodeAdapter({ spawn: fakeSpawn().spawn });
  assert.deepEqual([...adapter.capabilities], [...OPENCODE_CAPABILITIES]);
  assert.ok(adapter.capabilities.includes('interrupt'), 'cancel() really kills the child');
  assert.ok(
    !adapter.capabilities.includes('stream'),
    'the transcript is reduced after exit; declaring stream would hide our own limitation',
  );
  assert.ok(!adapter.capabilities.includes('sandbox'), 'the child runs with our privileges');
});

test('invoking before init() is refused, not attempted', async () => {
  const adapter = createOpenCodeAdapter({ spawn: fakeSpawn().spawn });
  await assert.rejects(() => adapter.invoke(REQUEST), HostNotReadyError);
});

test('init() records the installed version and flags drift against the pin', async () => {
  const pinned = createOpenCodeAdapter({ spawn: fakeSpawn().spawn });
  await pinned.init();
  assert.equal(pinned.observedVersion, PINNED_VERSION);
  assert.equal(pinned.versionDrifted, false);

  const drifted = createOpenCodeAdapter({ spawn: fakeSpawn({ version: '9.9.9' }).spawn });
  await drifted.init();
  assert.equal(drifted.observedVersion, '9.9.9');
  assert.equal(drifted.versionDrifted, true, 'an upgrade is visible, not silent');
});

test('health() names the drift instead of quietly staying green', async () => {
  const adapter = createOpenCodeAdapter({ spawn: fakeSpawn({ version: '9.9.9' }).spawn });
  await adapter.init();
  const health = await adapter.health();
  assert.equal(health.live, true, 'a drifted host still runs');
  assert.match(health.detail ?? '', /version drift: installed 9\.9\.9, pinned/);
  assert.match(health.detail ?? '', /probe-opencode-conformance/, 'and says what to do about it');
});

test('health() before init() is not live', async () => {
  const health = await createOpenCodeAdapter({ spawn: fakeSpawn().spawn }).health();
  assert.deepEqual(health, { live: false, detail: 'init() has not run' });
});

test('a missing binary is a typed host error, not a raw ENOENT', async () => {
  const adapter = createOpenCodeAdapter({ spawn: fakeSpawn({ throwOnSpawn: true }).spawn });
  await assert.rejects(() => adapter.init(), (error: unknown) => {
    assert.ok(error instanceof InvocationError);
    assert.equal(error.code, 'HOST_UNAVAILABLE');
    assert.equal(error.host, HOST_NAME);
    assert.match(error.message, /is OpenCode installed and on PATH/);
    return true;
  });
});

test('a real run returns the text as the deliverable, with usage attached', async () => {
  const fake = fakeSpawn({ stdout: fixture('simple-text') });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  const result = await adapter.invoke(REQUEST, { invocationId: 'inv-1' });
  assert.equal(result.status, 'ok');
  assert.equal(result.id, 'inv-1');
  assert.equal(result.error, null);

  const deliverable = result.output as OpenCodeDeliverable;
  assert.equal(deliverable.text, 'READY');
  assert.equal(deliverable.role, 'privacy');
  assert.ok(deliverable.usage.inputTokens > 0);
  assert.equal(deliverable.failedToolCalls.length, 0);
});

test('the role is stated to the host when no OpenCode agent is named', async () => {
  const fake = fakeSpawn({ stdout: fixture('simple-text') });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn, model: 'ollama/qwen3.5:4b', dir: '/w' });
  await adapter.init();
  await adapter.invoke(REQUEST);

  const run = fake.calls.find((call) => call.args[0] === 'run');
  assert.ok(run);
  assert.deepEqual(run.args.slice(0, 3), ['run', '--format', 'json']);
  assert.ok(run.args.includes('--model'), 'model is passed through');
  assert.equal(run.args.at(-1), 'You are acting as: privacy.\n\nIssue-spot this DPA.');
  assert.equal(run.cwd, '/w', 'the working directory is injected, never the ambient cwd');
});

test('a named OpenCode agent is used as-is, with no invented framing', async () => {
  const fake = fakeSpawn({ stdout: fixture('simple-text') });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();
  await adapter.invoke({ ...REQUEST, agent: 'issue-spotter' });

  const run = fake.calls.find((call) => call.args[0] === 'run');
  assert.ok(run?.args.includes('--agent'));
  assert.equal(run?.args.at(-1), 'Issue-spot this DPA.', 'the task reaches the agent unmodified');
});

test('a failed run is an error result carrying the host diagnosis', async () => {
  const fake = fakeSpawn({ stdout: fixture('model-not-found'), code: 1 });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  const result = await adapter.invoke(REQUEST);
  assert.equal(result.status, 'error');
  assert.equal(result.output, null, 'no empty deliverable is handed back as if it were work');
  const error = result.error as { messages: string[]; exitCode: number | null };
  assert.match(error.messages[0] ?? '', /Model not found/);
  assert.equal(error.exitCode, 1);
});

test('error events fail the run even if the exit code says otherwise', async () => {
  // At the pin both signals agree. This asserts the adapter fails closed if they
  // ever diverge — the direction that matters, since the opposite would report a
  // total failure as a success with an empty deliverable.
  const fake = fakeSpawn({ stdout: fixture('model-not-found'), code: 0 });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  const result = await adapter.invoke(REQUEST);
  assert.equal(result.status, 'error');
});

test('a non-zero exit fails the run even with no error events', async () => {
  const fake = fakeSpawn({ stdout: '', code: 137, stderr: 'killed' });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  const result = await adapter.invoke(REQUEST);
  assert.equal(result.status, 'error');
  const error = result.error as { messages: string[]; stderr: string | null };
  assert.match(error.messages[0] ?? '', /exited 137/);
  assert.equal(error.stderr, 'killed');
});

test('a run whose tools failed still returns a deliverable, with the failures named', async () => {
  const fake = fakeSpawn({ stdout: fixture('tool-use') });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  const result = await adapter.invoke(REQUEST);
  assert.equal(result.status, 'ok', 'a rejected tool call is not an outage');

  const deliverable = result.output as OpenCodeDeliverable;
  assert.equal(deliverable.failedToolCalls.length, 1);
  assert.equal(deliverable.failedToolCalls[0]?.tool, 'read');
  assert.ok(deliverable.toolCalls.length > 1, 'successful calls are reported too');
});

test('a malformed request is refused before a process is spawned', async () => {
  const fake = fakeSpawn({ stdout: fixture('simple-text') });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();
  const spawnsAfterInit = fake.calls.length;

  for (const bad of [null, {}, { role: 'privacy' }, { task: 'x' }, { role: '', task: 'x' }]) {
    await assert.rejects(() => adapter.invoke(bad), InvocationError);
  }
  assert.equal(fake.calls.length, spawnsAfterInit, 'nothing was launched');
});

test('cancel() kills the child and the run reports cancelled, not ok', async () => {
  const fake = fakeSpawn({ hang: true, stdout: fixture('simple-text') });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn });
  await adapter.init();

  const running = adapter.invoke(REQUEST, { invocationId: 'inv-cancel' });
  const cancellation = await adapter.cancel('inv-cancel');
  assert.deepEqual(cancellation, { cancelled: true });

  const result = await running;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.output, null, 'a killed run yields no partial deliverable');
  assert.equal(fake.killed.length, 1, 'the process was actually killed');
});

test('cancelling an unknown invocation says so rather than claiming success', async () => {
  const adapter = createOpenCodeAdapter({ spawn: fakeSpawn().spawn });
  await adapter.init();
  const result = await adapter.cancel('never-started');
  assert.equal(result.cancelled, false);
  assert.match(result.reason ?? '', /no in-flight invocation/);
});

test('a run that never finishes times out as a typed error', async () => {
  const fake = fakeSpawn({ hang: true });
  const adapter = createOpenCodeAdapter({ spawn: fake.spawn, timeoutMs: 10 });
  await adapter.init();

  await assert.rejects(() => adapter.invoke(REQUEST), (error: unknown) => {
    assert.ok(error instanceof InvocationTimeoutError);
    assert.equal(error.timeoutMs, 10);
    return true;
  });
  assert.equal(fake.killed.length, 1, 'and the child is not left running');
});

/**
 * The same claim, in the one condition where it was false.
 *
 * The test above passes whether or not the timeout can actually fire, because
 * the rest of the suite keeps the event loop busy long enough for a timer that
 * does not hold the loop open to fire anyway. It went red only in CI, on the
 * machine that drained the loop first, which is the shape of a flake and was
 * treated as one — the defect underneath was a timeout that silently did not
 * happen when nothing else was pending, leaving invoke() hung forever.
 *
 * So this runs the hung invocation in a process of its own with nothing else in
 * it. Timing is not what makes it deterministic — an empty loop is.
 */
test('the timeout still fires when nothing else keeps the process alive', () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'construct-timeout-'));
  try {
    const adapterUrl = new URL('../../../src/hosts/opencode/adapter.ts', import.meta.url).href;
    const probe = join(fixtureDir, 'probe.mjs');
    writeFileSync(
      probe,
      `import { createOpenCodeAdapter } from ${JSON.stringify(adapterUrl)};
const spawn = (command, args) => {
  if (args[0] === '--version') {
    return { done: Promise.resolve({ code: 0, stdout: ${JSON.stringify(PINNED_VERSION)} + '\\n', stderr: '' }), kill: () => {} };
  }
  if (args[0] === 'stats') {
    return { done: Promise.resolve({ code: 0, stdout: '', stderr: '' }), kill: () => {} };
  }
  let settle;
  const done = new Promise((resolve) => { settle = resolve; });
  return { done, kill: () => settle({ code: null, stdout: '', stderr: '' }) };
};
const adapter = createOpenCodeAdapter({ spawn, timeoutMs: 25 });
await adapter.init();
try {
  await adapter.invoke({ role: 'privacy', task: 'a run that never finishes' });
  process.stdout.write('SETTLED-OK\\n');
} catch (error) {
  process.stdout.write('REJECTED:' + error.name + '\\n');
}
`,
    );

    const run = spawnSync(process.execPath, [probe], { encoding: 'utf8' });
    assert.equal(
      run.stdout.trim(),
      'REJECTED:InvocationTimeoutError',
      `invoke() must settle on an idle loop — it printed ${JSON.stringify(run.stdout)}${run.stderr}`,
    );
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
