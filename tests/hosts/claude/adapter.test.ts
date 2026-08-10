/**
 * tests/hosts/claude/adapter.test.ts — the second host adapter, driven
 * against envelopes captured from the real binary.
 *
 * The fixtures are real: success.json is a live haiku run, and
 * silent-fallback.json is the run where `--model no-such-model-xyz` was
 * silently served by claude-opus-4-8 at thirteen times the price — the
 * capture that produced pin.ts's headline expectation. Tests that assert
 * against invented envelopes assert nothing about the host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClaudeAdapter, HOST_NAME } from '../../../src/hosts/claude/adapter.ts';
import { MCP_SERVER_NAME, ROLE_TOOL_NAMES, writeMcpConfig } from '../../../src/hosts/claude/mcpconfig.ts';
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

test('a run with no role env registers no MCP server', async () => {
  const fake = fakeSpawn();
  const adapter = createClaudeAdapter({ spawn: fake.spawn });
  await adapter.init();
  await adapter.invoke({ role: 'r', task: 't' }, { invocationId: 'inv-nomcp' });
  const runCall = fake.calls.find((call) => call.args[0] === '-p');
  assert.ok(runCall);
  assert.equal(runCall.args.includes('--mcp-config'), false);
  assert.equal(runCall.args.includes('--strict-mcp-config'), false);
  assert.equal(runCall.args.includes('--allowedTools'), false);
});

test('a role env becomes an MCP config passed by path, never inline on argv', async () => {
  const fake = fakeSpawn();
  const adapter = createClaudeAdapter({ spawn: fake.spawn });
  await adapter.init();
  const roleEnv = {
    CONSTRUCT_ROLE_TOKEN: 'cx1.secret.sig',
    CONSTRUCT_ROLE_RUN: 'run-x',
    CONSTRUCT_ROLE_TASK: 'task-1',
  };
  await adapter.invoke({ role: 'r', task: 't' }, { invocationId: 'inv-mcp', roleEnv });
  const runCall = fake.calls.find((call) => call.args[0] === '-p');
  assert.ok(runCall);
  const mcpConfigIdx = runCall.args.indexOf('--mcp-config');
  assert.ok(mcpConfigIdx >= 0, 'run argv must include --mcp-config');
  const configPath = runCall.args[mcpConfigIdx + 1];
  assert.ok(typeof configPath === 'string' && configPath.startsWith('/'), 'config path must be an absolute path string');
  assert.ok(runCall.args.includes('--strict-mcp-config'), 'run argv must include --strict-mcp-config');
  const allowedToolsIdx = runCall.args.indexOf('--allowedTools');
  assert.ok(allowedToolsIdx >= 0, 'run argv must include --allowedTools');
  assert.equal(runCall.args[allowedToolsIdx + 1], ROLE_TOOL_NAMES.join(','));
  // --mcp-config is variadic on the pinned CLI (pin.ts): the path must be
  // followed by a flag, or the next argument is eaten as another config file.
  assert.match(runCall.args[mcpConfigIdx + 2] ?? '', /^--/);
  // The whole point of the change: the bearer is in the file, never in argv.
  for (const call of fake.calls) {
    for (const arg of call.args) {
      assert.equal(
        arg.includes('cx1.secret.sig'),
        false,
        `bearer token must not appear in argv: ${arg}`,
      );
    }
  }
});

test('the written config is 0600 inside a 0700 dir, names the role tools server, and disposes', () => {
  const roleEnv = {
    CONSTRUCT_ROLE_TOKEN: 'cx1.secret.sig',
    CONSTRUCT_ROLE_RUN: 'run-x',
  };
  const launch = {
    command: '/bin/echo',
    args: ['x'],
    env: { XDG_DATA_HOME: '/tmp/d', CONSTRUCT_ROLE_TOKEN: 'wrong' },
  };

  // Test that roleEnv wins over launch.env collisions
  const config = writeMcpConfig(roleEnv, launch);
  assert.ok(existsSync(config.path), 'config file must exist');

  const dirStat = statSync(dirname(config.path));
  assert.equal((dirStat.mode & 0o777), 0o700, 'directory mode must be 0700');

  const fileStat = statSync(config.path);
  assert.equal((fileStat.mode & 0o777), 0o600, 'file mode must be 0600');

  const content = JSON.parse(readFileSync(config.path, 'utf8'));
  assert.ok(content.mcpServers);
  assert.ok(content.mcpServers[MCP_SERVER_NAME]);
  const server = content.mcpServers[MCP_SERVER_NAME];
  assert.equal(server.type, 'stdio');
  assert.equal(server.command, '/bin/echo');
  assert.deepEqual(server.args, ['x']);
  assert.equal(server.env.CONSTRUCT_ROLE_TOKEN, 'cx1.secret.sig', 'roleEnv must win over launch.env collision');
  assert.equal(server.env.XDG_DATA_HOME, '/tmp/d', 'launch.env must be merged');
  assert.equal(server.env.CONSTRUCT_ROLE_RUN, 'run-x');

  // dispose() must remove the directory
  config.dispose();
  assert.equal(existsSync(config.path), false, 'config file must be gone after dispose');

  // dispose() must be idempotent
  assert.doesNotThrow(() => {
    config.dispose();
  });
});

test('the config file is removed even when the run times out', async () => {
  let capturedConfigPath: string | null = null;
  const wrappedSpawn = (command: string, args: readonly string[]): SpawnedProcess => {
    // Handle --version call
    if (args[0] === '--version') {
      return {
        done: Promise.resolve({ code: 0, stdout: `${PINNED_VERSION}\n`, stderr: '' }),
        kill: () => {},
      };
    }
    // For -p calls, capture the config path
    if (args[0] === '-p') {
      const mcpIdx = args.indexOf('--mcp-config');
      if (mcpIdx >= 0) {
        capturedConfigPath = args[mcpIdx + 1] as string;
      }
    }
    // Hang: never resolve, only kill
    let killResolve: (() => void) | undefined;
    const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      killResolve = () => resolve({ code: null, stdout: '', stderr: '' });
    });
    return {
      done,
      kill: () => {
        killResolve?.();
      },
    };
  };

  const adapter = createClaudeAdapter({
    spawn: wrappedSpawn,
    timeoutMs: 20,
    roleServe: { command: '/bin/echo', args: [] },
  });
  await adapter.init();

  await assert.rejects(
    adapter.invoke(
      { role: 'r', task: 't' },
      {
        invocationId: 'inv-timeout',
        roleEnv: { CONSTRUCT_ROLE_TOKEN: 'cx1.secret.sig' },
      },
    ),
    (error: Error) => error.name === 'InvocationTimeoutError',
  );

  assert.ok(capturedConfigPath, 'config path must have been captured during run');
  assert.equal(
    existsSync(capturedConfigPath),
    false,
    'config file must be removed after timeout',
  );
});

test('a role env whose values are not strings is refused', async () => {
  const adapter = createClaudeAdapter({ spawn: fakeSpawn().spawn });
  await adapter.init();
  await assert.rejects(
    adapter.invoke(
      { role: 'r', task: 't' },
      { invocationId: 'inv-bad', roleEnv: { CONSTRUCT_ROLE_TOKEN: 123 as unknown as string } },
    ),
    /strings/,
  );
});

test('naming no model does not make the family unknown: this binary runs one vendor', () => {
  const adapter = createClaudeAdapter({ binary: '/nonexistent/claude' });
  // No --model anywhere: the specific model is genuinely unknown, the family
  // is not. Reporting best-effort here said something false about a tuned
  // family in order to sound careful.
  assert.equal(adapter.model, null);
  // Tuning reporting is optional on the interface, so the absence of the hook
  // is itself a failure of this expectation, not a reason to skip the checks.
  const tuning = adapter.modelTuning?.() ?? null;
  assert.ok(tuning, 'the claude adapter must report a tuning family');
  assert.equal(tuning.family, 'claude');
  assert.equal(tuning.tuned, true);

  // The tier stays honestly unknown — which model inside the family answered
  // is not knowable before the envelope reports it — so that degradation,
  // which is real, still fires.
  assert.equal(adapter.modelTier?.() ?? null, null);

  // An explicitly named foreign model is still untuned; the fallback applies
  // only when nothing was named.
  const foreign = adapter.modelTuning?.('llama-3-70b') ?? null;
  assert.ok(foreign, 'a named foreign model still gets a tuning verdict');
  assert.equal(foreign.tuned, false);
  assert.equal(foreign.family, null);
});
