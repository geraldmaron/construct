/**
 * tests/hosts/cursor/adapter.test.ts — the Cursor adapter against envelopes
 * captured from the real binary on the pinned version, and the invariant the
 * multi-vendor catalog makes load-bearing: an unoptimized model family is
 * labeled, never refused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCursorAdapter } from '../../../src/hosts/cursor/adapter.ts';
import type { CursorDeliverable, CursorSpawnFn, SpawnedProcess } from '../../../src/hosts/cursor/adapter.ts';
import { PINNED_VERSION } from '../../../src/hosts/cursor/pin.ts';
import { reduceEnvelope } from '../../../src/hosts/cursor/result.ts';

// Captured 2026-08-11 from cursor-agent 2026.08.11-e8db854, `-p --output-format json`.
const SUCCESS_ENVELOPE =
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":2992,' +
  '"duration_api_ms":2992,"result":"pong","session_id":"cdf04658-3a22-4017-b0d4-02c04a0b348a",' +
  '"request_id":"2b8446ad-9950-4040-9991-5cf0e1a827d5",' +
  '"usage":{"inputTokens":14744,"outputTokens":14,"cacheReadTokens":5248,"cacheWriteTokens":0}}';

interface Spawned {
  readonly command: string;
  readonly args: readonly string[];
}

function fakeSpawn(options: {
  readonly version?: string;
  readonly stdout?: string;
  readonly code?: number;
  readonly calls?: Spawned[];
}): CursorSpawnFn {
  return (command, args): SpawnedProcess => {
    options.calls?.push({ command, args });
    const isVersion = args[0] === '--version';
    return {
      done: Promise.resolve({
        code: isVersion ? 0 : (options.code ?? 0),
        stdout: isVersion ? `${options.version ?? PINNED_VERSION}\n` : (options.stdout ?? SUCCESS_ENVELOPE),
        stderr: '',
      }),
      kill: () => undefined,
    };
  };
}

test('the captured envelope reduces to text, session, and token usage', () => {
  const envelope = reduceEnvelope(SUCCESS_ENVELOPE);
  assert.ok(envelope);
  assert.equal(envelope.text, 'pong');
  assert.equal(envelope.sessionId, 'cdf04658-3a22-4017-b0d4-02c04a0b348a');
  assert.equal(envelope.isError, false);
  // Tokens counted, dollars absent: zero cost with zero steps reads
  // downstream as unmeasured, never as free.
  assert.equal(envelope.usage.inputTokens, 14744);
  assert.equal(envelope.usage.outputTokens, 14);
  assert.equal(envelope.usage.cost, 0);
});

test('dispatch runs read-only in plan mode with per-invocation trust', async () => {
  const calls: Spawned[] = [];
  const adapter = createCursorAdapter({ spawn: fakeSpawn({ calls }) });
  await adapter.init();
  const result = await adapter.invoke({ role: 'security', task: 'review the change' });
  assert.equal(result.status, 'ok');

  const dispatch = calls.find((c) => c.args[0] === '-p');
  assert.ok(dispatch);
  const joined = dispatch.args.join(' ');
  // -p alone would grant write and shell; plan mode is the probed read-only posture.
  assert.ok(joined.includes('--mode plan'));
  assert.ok(dispatch.args.includes('--trust'));
  assert.ok(String(dispatch.args.at(-1)).startsWith('You are acting as: security.'));
});

test('a family this project never optimized for is labeled untuned and still runs', async () => {
  // gemini has no TUNED_FAMILIES entry and no tuning evidence anywhere here.
  const adapter = createCursorAdapter({ spawn: fakeSpawn({}), model: 'gemini-3.1-pro' });
  await adapter.init();
  const tuning = adapter.modelTuning?.();
  assert.ok(tuning);
  assert.equal(tuning.tuned, false);
  // Untuned is a label on the record, not a gate on the dispatch:
  const result = await adapter.invoke({ role: 'operations', task: 'review' });
  assert.equal(result.status, 'ok');
  const deliverable = result.output as CursorDeliverable;
  assert.deepEqual(deliverable.modelRan, ['gemini-3.1-pro']);
});

test('a tuned family reached through this host still counts as its family', async () => {
  // Family evidence attaches to the model family, not to the transport: the
  // shared table answers for a claude model no matter which host serves it.
  const adapter = createCursorAdapter({ spawn: fakeSpawn({}), model: 'claude-opus-5-high' });
  await adapter.init();
  const tuning = adapter.modelTuning?.();
  assert.ok(tuning);
  assert.equal(tuning.family, 'claude');
  assert.equal(tuning.tuned, true);
});

test('an unnamed model on a multi-vendor host belongs to no family, honestly', async () => {
  const adapter = createCursorAdapter({ spawn: fakeSpawn({}) });
  await adapter.init();
  // Guessing a family here would attach one vendor's tuning evidence to
  // another vendor's output; no family is the only true answer.
  const tuning = adapter.modelTuning?.();
  assert.ok(tuning);
  assert.equal(tuning.family, null);
  assert.equal(tuning.tuned, false);
  const result = await adapter.invoke({ role: 'security', task: 'review' });
  assert.equal(result.status, 'ok');
});

test('a non-envelope reply is version-drift territory, not a failed run', async () => {
  const adapter = createCursorAdapter({ spawn: fakeSpawn({ stdout: 'Workspace Trust Required', code: 1 }) });
  await adapter.init();
  const result = await adapter.invoke({ role: 'security', task: 'review' });
  assert.equal(result.status, 'error');
  const error = result.error as { messages: string[] };
  assert.ok(error.messages.some((m) => /exited 1/.test(m)));
});

test('a supplied role env is answered with a notice, not silently dropped', async () => {
  const adapter = createCursorAdapter({ spawn: fakeSpawn({}) });
  await adapter.init();
  const result = await adapter.invoke(
    { role: 'security', task: 'review' },
    { roleEnv: { CONSTRUCT_ROLE_TOKEN: 'x' } },
  );
  const deliverable = result.output as CursorDeliverable;
  assert.ok(deliverable.notices.some((n) => /no role write surface/.test(n)));
});

test('version drift is observed and reported by health, never fatal', async () => {
  const adapter = createCursorAdapter({ spawn: fakeSpawn({ version: '2027.01.01-deadbeef' }) });
  await adapter.init();
  assert.equal(adapter.versionDrifted, true);
  const health = await adapter.health();
  assert.equal(health.live, true);
  assert.match(health.detail ?? '', /version drift/);
});
