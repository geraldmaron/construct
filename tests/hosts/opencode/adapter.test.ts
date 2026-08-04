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
import { readFileSync } from 'node:fs';
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
