/**
 * tests/hosts/claude/adapter.test.ts — the second host adapter, driven
 * against envelopes captured from the real binary (construct-r67.4).
 *
 * The fixtures are real: success.json is a live haiku run, and
 * silent-fallback.json is the run where `--model no-such-model-xyz` was
 * silently served by claude-opus-4-8 at thirteen times the price — the
 * capture that produced pin.ts's headline expectation. Tests that assert
 * against invented envelopes assert nothing about the host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClaudeAdapter, HOST_NAME } from '../../../src/hosts/claude/adapter.ts';
import type { ClaudeDeliverable, SpawnedProcess } from '../../../src/hosts/claude/adapter.ts';
import { modelDrifted, reduceEnvelope } from '../../../src/hosts/claude/result.ts';
import { PINNED_VERSION } from '../../../src/hosts/claude/pin.ts';
import { deliverableConcerns } from '../../../src/kernel/run/accountability.ts';
import { spendOf } from '../../../src/kernel/run/coordinator.ts';
import { validate } from '../../../src/kernel/hosts/interface.ts';

const SUCCESS = readFileSync(new URL('fixtures/success.json', import.meta.url), 'utf8');
const FALLBACK = readFileSync(new URL('fixtures/silent-fallback.json', import.meta.url), 'utf8');

interface FakeCall {
  readonly command: string;
  readonly args: readonly string[];
}

interface FakeOptions {
  readonly runStdout?: string;
  readonly runExit?: number;
  readonly hang?: boolean;
  readonly version?: string;
}

function fakeSpawn(options: FakeOptions = {}) {
  const calls: FakeCall[] = [];
  const killed: string[] = [];
  const spawn = (command: string, args: readonly string[]): SpawnedProcess => {
    calls.push({ command, args });
    if (args[0] === '--version') {
      return {
        done: Promise.resolve({ code: 0, stdout: `${options.version ?? PINNED_VERSION}\n`, stderr: '' }),
        kill: () => {},
      };
    }
    if (options.hang) {
      let killResolve: (() => void) | undefined;
      const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        killResolve = () => resolve({ code: null, stdout: '', stderr: '' });
      });
      return {
        done,
        kill: () => {
          killed.push(args.join(' '));
          killResolve?.();
        },
      };
    }
    return {
      done: Promise.resolve({
        code: options.runExit ?? 0,
        stdout: options.runStdout ?? SUCCESS,
        stderr: '',
      }),
      kill: () => killed.push(args.join(' ')),
    };
  };
  return { spawn, calls, killed };
}

test('the adapter satisfies the host interface', () => {
  const adapter = createClaudeAdapter({ spawn: fakeSpawn().spawn });
  const result = validate(adapter);
  assert.deepEqual(result.errors, []);
  assert.equal(adapter.name, HOST_NAME);
});

test('a captured success envelope becomes a deliverable with real cost', async () => {
  const fake = fakeSpawn();
  const adapter = createClaudeAdapter({ spawn: fake.spawn, model: 'haiku' });
  await adapter.init();
  assert.equal(adapter.versionDrifted, false);

  const result = await adapter.invoke({ role: 'privacy', task: 'say ok' }, { invocationId: 'inv-1' });
  assert.equal(result.status, 'ok');
  const deliverable = result.output as ClaudeDeliverable;
  assert.equal(deliverable.text, 'ok');
  assert.ok(deliverable.sessionId);
  assert.deepEqual(deliverable.modelRan, ['claude-haiku-4-5-20251001']);
  assert.equal(deliverable.notices.length, 0, 'haiku honored means no drift notice');

  // The whole reason this host matters to the ceiling: spend is MEASURED.
  const spend = spendOf(result);
  assert.equal(spend.reported, true, 'cost must count as reported');
  assert.ok(spend.spend > 0);

  // The prompt carries the role framing and rides -p.
  const runCall = fake.calls.find((call) => call.args[0] === '-p');
  assert.ok(runCall);
  assert.match(runCall.args[1], /^You are acting as: privacy\./);
  assert.ok(runCall.args.includes('--model'));
});

test('the silent model fallback is caught and flagged, not trusted', async () => {
  const fake = fakeSpawn({ runStdout: FALLBACK });
  const adapter = createClaudeAdapter({ spawn: fake.spawn, model: 'no-such-model-xyz' });
  await adapter.init();

  const result = await adapter.invoke({ role: 'privacy', task: 'say ok' });
  assert.equal(result.status, 'ok', 'the run DID succeed and its cost is real — failing it would lose the spend');
  const deliverable = result.output as ClaudeDeliverable;
  assert.deepEqual(deliverable.modelRan, ['claude-opus-4-8']);
  assert.equal(deliverable.notices.length, 1);
  assert.match(deliverable.notices[0], /no-such-model-xyz/);

  // And the kernel turns it into a flagged concern the work log surfaces.
  const kinds = deliverableConcerns(deliverable).map((concern) => concern.kind);
  assert.ok(kinds.includes('model-drift'), `expected model-drift in ${kinds.join(', ')}`);
});

test('an alias honored by its full model id is not drift', () => {
  assert.equal(modelDrifted('haiku', ['claude-haiku-4-5-20251001']), false);
  assert.equal(modelDrifted(undefined, ['claude-opus-4-8']), false, 'delegating the choice is never drift');
  assert.equal(modelDrifted('haiku', ['claude-opus-4-8']), true);
});

test('output that is not an envelope reads as version drift, not as a run result', async () => {
  const adapter = createClaudeAdapter({ spawn: fakeSpawn({ runStdout: 'plain text' }).spawn });
  await adapter.init();
  const result = await adapter.invoke({ role: 'r', task: 't' });
  assert.equal(result.status, 'error');
  assert.match(
    (result.error as { messages: string[] }).messages[0],
    /not a result envelope/,
  );
});

test('a non-zero exit with no envelope is an error carrying the exit code', async () => {
  const adapter = createClaudeAdapter({ spawn: fakeSpawn({ runStdout: '', runExit: 1 }).spawn });
  await adapter.init();
  const result = await adapter.invoke({ role: 'r', task: 't' });
  assert.equal(result.status, 'error');
  assert.equal((result.error as { exitCode: number }).exitCode, 1);
});

test('the timeout fires on an idle loop and kills the child', async () => {
  const fake = fakeSpawn({ hang: true });
  const adapter = createClaudeAdapter({ spawn: fake.spawn, timeoutMs: 50 });
  await adapter.init();
  await assert.rejects(
    adapter.invoke({ role: 'r', task: 't' }),
    (error: Error) => error.name === 'InvocationTimeoutError',
  );
  assert.equal(fake.killed.length, 1, 'the hung child must be killed, not abandoned');
});

test('cancel kills an in-flight run and the result reads cancelled', async () => {
  const fake = fakeSpawn({ hang: true });
  const adapter = createClaudeAdapter({ spawn: fake.spawn });
  await adapter.init();
  const pending = adapter.invoke({ role: 'r', task: 't' }, { invocationId: 'inv-c' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await adapter.cancel('inv-c'), { cancelled: true });
  const result = await pending;
  assert.equal(result.status, 'cancelled');
});

test('version drift is visible on health, and invoke before init refuses', async () => {
  const drifted = createClaudeAdapter({ spawn: fakeSpawn({ version: '9.9.9 (Claude Code)' }).spawn });
  await assert.rejects(drifted.invoke({ role: 'r', task: 't' }), /init/i);
  await drifted.init();
  assert.equal(drifted.versionDrifted, true);
  const health = await drifted.health();
  assert.match(health.detail ?? '', /version drift/);
});

test('reduceEnvelope refuses what is not a result envelope', () => {
  assert.equal(reduceEnvelope('not json'), null);
  assert.equal(reduceEnvelope('{"type":"banana"}'), null);
  const reduced = reduceEnvelope(SUCCESS);
  assert.ok(reduced);
  assert.equal(reduced.usage.steps, 1);
  assert.ok(reduced.usage.cost > 0);
});
