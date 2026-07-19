/**
 * tests/functional/regression-run-02158a157d53.functional.test.mjs
 *
 * Regression pin for incident run-02158a157d53 (and run-e66e7418e4cb): a
 * machine with provider keys present (op:// refs) but no CONSTRUCT_MODEL_ or
 * CONSTRUCT_MODEL_ tier vars saw `construct orchestrate preflight` pass while
 * `orchestration_run` silently persisted degraded:true, tasks:[],
 * executionMode:'construct-prompt-only', status:'completed' — a run that
 * looked done and did nothing.
 *
 * Drives the exact machine state end to end through the real spawned MCP
 * server (StdioClientTransport harness, per tests/functional/
 * host-mcp-emulation.functional.test.mjs) under a sterile mkdtemp HOME/
 * CONSTRUCT_HOME_OVERRIDE with fake-but-present ANTHROPIC_API_KEY/OPENROUTER_API_KEY
 * and zero model-tier vars (sterileSpawnEnv's allowlist omits CONSTRUCT_MODEL_ and
 * CONSTRUCT_MODEL_ tier vars by construction), then asserts on the durable run file
 * under the sandbox HOME — not just the tool envelope.
 *
 * Dependency scope (construct-neq9.2, construct-neq9.3): resolveEmbeddedModel's
 * credential-family-fallback (lib/embedded-contract/model-resolve.mjs:210-227)
 * resolves a runnable model straight from a present provider key when no tier
 * is pinned, and readiness.mjs consults resolveExecution so a PASS verdict is
 * a genuine prediction of run-executability, not a blind attachment check. On
 * the keys-present/tiers-absent env the run EXECUTES (degraded:false, tasks
 * non-empty) rather than needing readiness to fail/warn, so the assertions
 * below target the end-state invariants that actually hold — hard invariant,
 * honest binary, readiness/run parity — instead of a fixed "readiness must
 * warn" expectation that does not match a credential-fallback resolution.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { resolveStatePath } from '../../lib/state-root.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO_ROOT, 'lib', 'mcp', 'server.mjs');
const REQUEST = 'design and implement a new authentication architecture';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'cx-run-02158a157d53-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(join(HOME, '.cx'), { recursive: true });
  mkdirSync(join(project, '.cx'), { recursive: true });
  return { root, HOME, project, cleanup() { rmTmpDir(root); } };
}

// Incident machine state: keys present (fake-but-present), tiers absent.
// sterileSpawnEnv's allowlist already excludes CONSTRUCT_MODEL_*/CONSTRUCT_MODEL_*
// by construction, so not naming them here IS the fixture.
function keysNoTiersSpawnEnv(box) {
  return sterileSpawnEnv({
    HOME: box.HOME,
    USERPROFILE: box.HOME,
    CONSTRUCT_HOME_OVERRIDE: box.HOME,
    XDG_CONFIG_HOME: join(box.HOME, '.config'),
    XDG_DATA_HOME: join(box.HOME, '.local', 'share'),
    XDG_RUNTIME_DIR: join(box.HOME, 'run'),
    CONSTRUCT_DEV_PATH: REPO_ROOT,
    CONSTRUCT_ORCHESTRATION_URL: '',
    ANTHROPIC_API_KEY: 'sk-ant-fake-but-present',
    OPENROUTER_API_KEY: 'sk-or-fake-but-present',
  });
}

async function connect(box) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: box.project,
    env: keysNoTiersSpawnEnv(box),
  });
  const client = new Client({ name: 'regression-run-02158a157d53', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function payload(result) {
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

// The run store resolves the machine-scoped state root (ADR-0066) via
// CONSTRUCT_HOME_OVERRIDE on process.env directly — the sandboxed HOME the
// subprocess sees via sterileSpawnEnv is invisible to this process unless
// the same override is pinned here around the read.

function runFilePathInSandbox(box, runId) {
  const prev = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = box.HOME;
  try {
    return resolveStatePath(box.project, 'runtime', 'orchestration', 'runs', `${runId}.json`, { ensureDir: false });
  } finally {
    if (prev === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prev;
  }
}

test('incident run-02158a157d53: keys-present/tiers-absent never persists a silent degraded "completed" run', async (t) => {
  const box = sandbox();
  t.after(() => box.cleanup());

  const client = await connect(box);
  t.after(() => client.close());

  const readiness = payload(await client.callTool({
    name: 'orchestration_readiness',
    arguments: { observed_tools: ['orchestration_policy', 'orchestration_run'], observation_scope: 'host-session' },
  }));
  assert.ok(readiness && !readiness.error, `readiness call must not error: ${JSON.stringify(readiness)}`);

  const run = payload(await client.callTool({
    name: 'orchestration_run',
    arguments: { request: REQUEST, file_count: 20, module_count: 6, wait: true, worker_backend: 'inline' },
  }));
  assert.ok(run && !run.error, `orchestration_run must not error outright: ${JSON.stringify(run)}`);
  assert.ok(run.runId, 'a completed/degraded/refused run must still carry a runId for the durable artifact to be located');

  // Hard invariant target: the durable run file on disk, not the tool
  // envelope shapeRun() returns (shapeRun already re-derives a legacy
  // degraded+completed combo as 'degraded' — read past that guard to prove
  // the persisted artifact itself was never written dishonestly).
  const runFilePath = runFilePathInSandbox(box, run.runId);
  assert.ok(existsSync(runFilePath), `persisted run file must exist at ${runFilePath}`);
  const persisted = JSON.parse(readFileSync(runFilePath, 'utf8'));

  const degraded = persisted.execution?.degraded ?? persisted.degraded ?? false;
  const taskCount = Array.isArray(persisted.tasks) ? persisted.tasks.length : 0;
  const silentlyDegradedCompleted = degraded === true && taskCount === 0 && persisted.status === 'completed';
  assert.equal(
    silentlyDegradedCompleted,
    false,
    'keys-present/tiers-absent must never persist degraded:true + tasks:[] + status:"completed" (incident run-02158a157d53 shape)',
  );

  // Honest binary: either the run refused loudly (an explicit error/refused
  // status with an actionable reason) or it genuinely executed (not
  // degraded, with real tasks) — never a quiet "done, nothing happened".
  const refusedLoudly = ['error', 'refused'].includes(persisted.status) && Boolean(persisted.error || persisted.degradationReason);
  const executedForReal = degraded === false && taskCount > 0;
  assert.ok(
    refusedLoudly || executedForReal,
    `run must refuse loudly or execute for real, got status=${persisted.status} degraded=${degraded} tasks=${taskCount}`,
  );

  // Readiness/run parity: a PASS verdict is only honest if this exact env's
  // run actually executed; any env where the run would not execute must not
  // report the bare 'attached' reasonCode a healthy env reports.
  const readinessPass = readiness.verdict === 'pass' && readiness.reasonCode === 'attached';
  assert.equal(
    readinessPass,
    executedForReal,
    `readiness verdict (pass=${readinessPass}) must predict run-executability (executed=${executedForReal}) on the same env`,
  );
});
