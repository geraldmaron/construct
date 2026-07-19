/**
 * tests/mcp/host-role-clientinfo.test.mjs — orchestration_run host provenance
 * from the MCP initialize handshake (construct-6y6w.7).
 *
 * Before this bead's fix, lib/mcp/server.mjs's orchestration_run dispatch called
 * orchestrationRun(args) with no handshake context, so every MCP host (VS Code,
 * OpenCode, Cursor, ...) recorded hostRole 'cli-direct' — the same value a bare
 * CLI invocation records. The fix defaults host from server.getClientVersion()
 * ?.name (the SDK accessor for the initialize clientInfo) with an explicit
 * args.host still taking precedence, and leaves the CLI path (which never runs
 * an MCP handshake) recording 'cli-direct' as before.
 *
 * Drives the real server (lib/mcp/server.mjs) over stdio with the real MCP SDK
 * Client, whose constructor clientInfo becomes the inbound handshake identity,
 * then reads the run back from the persisted store (getRun) since the shaped
 * tool response does not itself carry hostRole.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { getRun, runOrchestration } from '../../lib/orchestration/runtime.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO_ROOT, 'lib', 'mcp', 'server.mjs');
const MODEL = 'anthropic/claude-sonnet-4-6';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'host-role-clientinfo-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(join(HOME, '.cx'), { recursive: true });
  mkdirSync(join(project, '.cx'), { recursive: true });
  return { root, HOME, project, cleanup() { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

async function connect(env, clientInfo) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: env.project,
    env: sterileSpawnEnv({
      HOME: env.HOME,
      USERPROFILE: env.HOME,
      CONSTRUCT_HOME_OVERRIDE: env.HOME,
      XDG_CONFIG_HOME: join(env.HOME, '.config'),
      XDG_DATA_HOME: join(env.HOME, '.local', 'share'),
      XDG_RUNTIME_DIR: join(env.HOME, 'run'),
      CONSTRUCT_DEV_PATH: REPO_ROOT,
      CONSTRUCT_ORCHESTRATION_URL: '',
      OPENROUTER_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      CONSTRUCT_MODEL_REASONING: MODEL,
      CONSTRUCT_MODEL_STANDARD: MODEL,
      CONSTRUCT_MODEL_FAST: MODEL,
    }),
  });
  const client = new Client(clientInfo, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function payload(result) {
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  if (text == null) return result;
  try { return JSON.parse(text); } catch { return text; }
}

// Any in-process call that resolves the machine-scoped state root (ADR-0066)
// needs CONSTRUCT_HOME_OVERRIDE pinned around it — process.env is the only thing
// homeDir()/constructDir() consult, not the { env } option threaded through a
// function's own signature. The spawned server sees the sandboxed HOME via
// sterileSpawnEnv's env; this process must pin the same override around any
// direct call (getRun, or runOrchestration invoked without a handshake), or it
// reads/writes the real developer machine's state root instead.

async function withHomeOverride(env, fn) {
  const prev = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = env.HOME;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prev;
  }
}

async function getRunInSandbox(env, runId) {
  return withHomeOverride(env, () => getRun(env.project, runId, { env: {} }));
}

async function runViaClient(env, clientInfo, args) {
  const client = await connect(env, clientInfo);
  try {
    const run = payload(await client.callTool({
      name: 'orchestration_run',
      arguments: { request: 'compare oidc vs saml', wait: true, worker_backend: 'inline', ...args },
    }));
    const persisted = await getRunInSandbox(env, run.runId);
    return { run, persisted };
  } finally {
    await client.close();
  }
}

test('a run invoked via an MCP client that sent clientInfo.name records that name\'s hostRole, not cli-direct', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());

  const { persisted } = await runViaClient(env, { name: 'OpenCode', version: '1.0.0' }, {});
  assert.ok(persisted, 'run record is persisted and readable');
  assert.equal(persisted.hostRole, 'primary-plus-subagents', 'hostRole resolves from the handshake clientInfo.name, not the cli-direct default');
  assert.notEqual(persisted.hostRole, 'cli-direct', 'an MCP client handshake must never record as cli-direct');
});

test('an explicit host tool arg overrides the handshake clientInfo default', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());

  const { persisted } = await runViaClient(env, { name: 'OpenCode', version: '1.0.0' }, { host: 'VS Code' });
  assert.equal(persisted.hostRole, 'copilot-mcp', 'explicit args.host ("VS Code") wins over the handshake clientInfo.name ("OpenCode")');
});

test('the CLI path (no MCP handshake, no host arg) still records cli-direct', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());

  const run = await withHomeOverride(env, () =>
    runOrchestration({ request: 'compare oidc vs saml', workerBackend: 'inline' }, { cwd: env.project, env: {} }),
  );
  assert.equal(run.hostRole, 'cli-direct', 'a direct runOrchestration call with no handshake and no host arg keeps recording cli-direct');
});
