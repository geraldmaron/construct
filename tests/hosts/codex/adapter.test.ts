/**
 * tests/hosts/codex/adapter.test.ts — the Codex adapter against streams
 * captured from the real binary on the pinned version. The fixtures are
 * verbatim probe output, because the assumptions that were never captured
 * are the ones that turn out wrong.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodexAdapter } from '../../../src/hosts/codex/adapter.ts';
import type { CodexDeliverable, CodexSpawnFn, SpawnedProcess } from '../../../src/hosts/codex/adapter.ts';
import { PINNED_VERSION } from '../../../src/hosts/codex/pin.ts';
import { reduceStream } from '../../../src/hosts/codex/result.ts';

// Captured 2026-08-11 from codex-cli 0.145.0, `codex exec --json`.
const SUCCESS_STREAM = [
  '{"type":"thread.started","thread_id":"019ff326-19b9-7d80-9b9a-163c9e242537"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}',
  '{"type":"turn.completed","usage":{"input_tokens":13952,"cached_input_tokens":3840,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
  '',
].join('\n');

// Captured the same day: an unsupported model on a ChatGPT login.
const FAILED_STREAM = [
  '{"type":"thread.started","thread_id":"019ff326-8474-7911-9c1e-4ca21d826409"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `bogus` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}',
  '{"type":"turn.started"}',
  '{"type":"error","message":"The model is not supported"}',
  '{"type":"turn.failed","error":{"message":"The model is not supported"}}',
  '',
].join('\n');

interface Spawned {
  readonly command: string;
  readonly args: readonly string[];
}

function fakeSpawn(options: {
  readonly version?: string;
  readonly stdout?: string;
  readonly code?: number;
  readonly calls?: Spawned[];
}): CodexSpawnFn {
  return (command, args): SpawnedProcess => {
    options.calls?.push({ command, args });
    const isVersion = args[0] === '--version';
    return {
      done: Promise.resolve({
        code: isVersion ? 0 : (options.code ?? 0),
        stdout: isVersion ? `${options.version ?? PINNED_VERSION}\n` : (options.stdout ?? SUCCESS_STREAM),
        stderr: '',
      }),
      kill: () => undefined,
    };
  };
}

test('the captured success stream reduces to text, thread, and token usage', () => {
  const stream = reduceStream(SUCCESS_STREAM);
  assert.ok(stream);
  assert.equal(stream.text, 'pong');
  assert.equal(stream.threadId, '019ff326-19b9-7d80-9b9a-163c9e242537');
  assert.equal(stream.completed, true);
  assert.deepEqual(stream.errors, []);
  // Tokens are counted and dollars are not: zero cost with zero steps reads
  // downstream as unmeasured, never as free.
  assert.equal(stream.usage.inputTokens, 13952);
  assert.equal(stream.usage.outputTokens, 5);
  assert.equal(stream.usage.cost, 0);
  assert.equal(stream.usage.steps, 0);
});

test('a successful invocation delivers with the requested model as what ran', async () => {
  const calls: Spawned[] = [];
  const adapter = createCodexAdapter({ spawn: fakeSpawn({ calls }), model: 'gpt-5.2-codex' });
  await adapter.init();
  const result = await adapter.invoke({ role: 'security', task: 'review the change' });
  assert.equal(result.status, 'ok');
  const deliverable = result.output as CodexDeliverable;
  assert.equal(deliverable.text, 'pong');
  assert.equal(deliverable.role, 'security');
  // Unknown models are refused, never substituted, so a completed turn's
  // requested name is what served it.
  assert.deepEqual(deliverable.modelRan, ['gpt-5.2-codex']);
  assert.equal(deliverable.modelRequested, 'gpt-5.2-codex');

  const exec = calls.find((c) => c.args[0] === 'exec');
  assert.ok(exec);
  for (const flag of ['--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check']) {
    assert.ok(exec.args.includes(flag), `missing ${flag}`);
  }
  assert.ok(exec.args.join(' ').includes('-s read-only'));
  assert.ok(String(exec.args.at(-1)).startsWith('You are acting as: security.'));
});

test('an unnamed model delivers with modelRan honestly empty', async () => {
  const adapter = createCodexAdapter({ spawn: fakeSpawn({}) });
  await adapter.init();
  const result = await adapter.invoke({ role: 'operations', task: 'review' });
  const deliverable = result.output as CodexDeliverable;
  assert.equal(deliverable.modelRequested, null);
  assert.deepEqual(deliverable.modelRan, []);
});

test('the captured failed stream becomes an error result carrying the host message', async () => {
  const adapter = createCodexAdapter({ spawn: fakeSpawn({ stdout: FAILED_STREAM, code: 1 }) });
  await adapter.init();
  const result = await adapter.invoke({ role: 'security', task: 'review' });
  assert.equal(result.status, 'error');
  const error = result.error as { messages: string[] };
  assert.ok(error.messages.some((m) => /not supported/.test(m)));
});

test('unrecognisable stdout is version-drift territory, not a failed run', async () => {
  const adapter = createCodexAdapter({ spawn: fakeSpawn({ stdout: 'plain text, no events' }) });
  await adapter.init();
  const result = await adapter.invoke({ role: 'security', task: 'review' });
  assert.equal(result.status, 'error');
  const error = result.error as { messages: string[] };
  assert.ok(error.messages.some((m) => /probe:codex/.test(m)));
});

test('a supplied role env is answered with a notice, not silently dropped', async () => {
  const adapter = createCodexAdapter({ spawn: fakeSpawn({}) });
  await adapter.init();
  const result = await adapter.invoke(
    { role: 'security', task: 'review' },
    { roleEnv: { CONSTRUCT_ROLE_TOKEN: 'x' } },
  );
  const deliverable = result.output as CodexDeliverable;
  assert.ok(deliverable.notices.some((n) => /no role write surface/.test(n)));
});

test('the untuned family runs labeled best-effort rather than being refused', async () => {
  const adapter = createCodexAdapter({ spawn: fakeSpawn({}) });
  await adapter.init();
  // Family membership is a fact about the host even when no model is named.
  const tuning = adapter.modelTuning?.();
  assert.ok(tuning);
  assert.equal(tuning.tuned, false);
  // And an untuned answer does not block the dispatch:
  const result = await adapter.invoke({ role: 'security', task: 'review' });
  assert.equal(result.status, 'ok');
});

test('version drift is observed and reported by health, never fatal', async () => {
  const adapter = createCodexAdapter({ spawn: fakeSpawn({ version: 'codex-cli 0.999.0' }) });
  await adapter.init();
  assert.equal(adapter.versionDrifted, true);
  const health = await adapter.health();
  assert.equal(health.live, true);
  assert.match(health.detail ?? '', /version drift/);
});
