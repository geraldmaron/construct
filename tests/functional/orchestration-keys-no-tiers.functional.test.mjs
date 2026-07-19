/**
 * tests/functional/orchestration-keys-no-tiers.functional.test.mjs
 *
 * Guards construct-neq9.2: the incident machine state — a provider API key
 * present, no CONSTRUCT_MODEL_ or CONSTRUCT_MODEL_ tier vars — was exercised by zero
 * tests before this file (every existing suite either injects all three tiers
 * or blanks the keys, i.e. the exact inverse of the machine that produced
 * incident run-02158a157d53). Verifies the runtime resolves a model from the
 * credential family (resolveEmbeddedModel's `credential-family-fallback`) and
 * `orchestration_run` executes real tasks — never a silent degraded run with
 * empty tasks reported as completed — both in-process and over the real
 * spawned MCP server, and that an op://-ref credential resolves identically
 * to a bare one without ever shelling out to `op` (presence-only detection).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { resolveExecution } from '../../lib/embedded-contract/execution.mjs';
import { orchestrationRun } from '../../lib/mcp/tools/orchestration-run.mjs';
import { sterileSpawnEnv, createOpStub } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(REPO_ROOT, 'lib', 'mcp', 'server.mjs');
const REQUEST = 'design and implement a new authentication architecture';

function keysNoTiersEnv(overrides = {}) {
  // The exact incident machine state: a real (here fake-but-present) provider
  // key, and deliberately NO CONSTRUCT_MODEL_REASONING/STANDARD/FAST or
  // CONSTRUCT_MODEL_* — sterileSpawnEnv's allowlist already omits them by
  // construction, so simply not naming them here is the fixture.
  return sterileSpawnEnv({
    ANTHROPIC_API_KEY: 'sk-ant-fake-but-present',
    OPENROUTER_API_KEY: '',
    ...overrides,
  });
}

function tmpProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-keys-no-tiers-'));
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  return cwd;
}

test('keys-no-tiers: resolveExecution resolves a model from the credential family, never a silent config-error degrade', () => {
  const env = keysNoTiersEnv();
  const result = resolveExecution({ requestedStrategy: 'auto', useConstruct: true }, { env, cwd: process.cwd() });

  assert.notStrictEqual(
    result.degraded === true && result.executionMode === 'construct-prompt-only',
    true,
    'silent degraded completion on keys-no-tiers machine (incident run-02158a157d53 shape)',
  );
  assert.equal(result.modelResolution?.resolutionSource, 'credential-family-fallback', 'a present key with no tier pin must resolve via the credential family');
  assert.equal(result.degraded, false, 'a resolvable credential family must not report degraded');
  assert.equal(result.executionMode, 'construct-orchestrated');
});

test('keys-no-tiers: orchestration_run (in-process) executes real tasks, never persists degraded:true with an empty task list as completed', async () => {
  const cwd = tmpProject();
  // orchestrationRun's trace emission resolves the machine-scoped state root
  // (ADR-0066) via CONSTRUCT_HOME_OVERRIDE read in-process, not via the `env` option
  // above — pin it or the run writes into the real developer machine's home.
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = cwd;
  try {
    const result = await orchestrationRun(
      { request: REQUEST, file_count: 20, module_count: 6, wait: true, worker_backend: 'inline' },
      { cwd, env: keysNoTiersEnv() },
    );
    assert.ok(!result.error, `expected a run, got error: ${result.error}`);

    const silentlyDegraded = result.degraded === true && Array.isArray(result.tasks) && result.tasks.length === 0
      && String(result.status || '').startsWith('completed');
    assert.notStrictEqual(silentlyDegraded, true, 'silent degraded completion on keys-no-tiers machine (incident run-02158a157d53)');
    assert.ok(Array.isArray(result.tasks) && result.tasks.length > 0, 'a keys-present run must resolve real tasks, not degrade to an empty plan');
    assert.equal(result.degraded, false);
  } finally {
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
    rmTmpDir(cwd);
  }
});

test('keys-no-tiers: the real spawned MCP server drives orchestration_run end to end without silent degradation', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-keys-no-tiers-mcp-'));
  const project = path.join(home, 'project');
  fs.mkdirSync(path.join(home, '.construct'), { recursive: true });
  fs.mkdirSync(path.join(project, '.construct'), { recursive: true });
  t.after(() => rmTmpDir(home));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: project,
    env: sterileSpawnEnv({
      HOME: home,
      USERPROFILE: home,
      CONSTRUCT_HOME_OVERRIDE: home,
      CONSTRUCT_DEV_PATH: REPO_ROOT,
      ANTHROPIC_API_KEY: 'sk-ant-fake-but-present',
      OPENROUTER_API_KEY: '',
    }),
  });
  const client = new Client({ name: 'keys-no-tiers-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  t.after(() => client.close());

  const res = await client.callTool({
    name: 'orchestration_run',
    arguments: { request: REQUEST, file_count: 20, module_count: 6, wait: true, worker_backend: 'inline' },
  });
  const text = res?.content?.find((c) => c.type === 'text')?.text;
  const run = JSON.parse(text);

  const silentlyDegraded = run.degraded === true && Array.isArray(run.tasks) && run.tasks.length === 0
    && String(run.status || '').startsWith('completed');
  assert.notStrictEqual(silentlyDegraded, true, 'spawned-server run must not silently persist a degraded empty-task completion');
  assert.ok(Array.isArray(run.tasks) && run.tasks.length > 0, 'the spawned-server run must resolve real tasks on a keys-no-tiers machine');
  assert.equal(run.degraded, false);
});

test('op:// divergence: a stored op:// credential resolves the same model as a bare key, and is never read through op', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-keys-no-tiers-op-'));
  try {
    const { binDir, logPath } = createOpStub(root);
    const bareEnv = keysNoTiersEnv();
    const opRefEnv = keysNoTiersEnv({
      ANTHROPIC_API_KEY: 'op://Vault/Anthropic/credential',
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      OP_READ_LOG: logPath,
    });

    const bare = resolveExecution({ requestedStrategy: 'auto', useConstruct: true }, { env: bareEnv, cwd: process.cwd() });
    const viaOpRef = resolveExecution({ requestedStrategy: 'auto', useConstruct: true }, { env: opRefEnv, cwd: process.cwd() });

    assert.equal(viaOpRef.modelResolution?.resolutionSource, bare.modelResolution?.resolutionSource, 'op://-backed and bare credentials must resolve through the same source');
    assert.equal(viaOpRef.modelResolution?.selectedModel, bare.modelResolution?.selectedModel, 'op://-backed and bare credentials must resolve the same model');
    assert.equal(viaOpRef.degraded, false);

    const log = fs.readFileSync(logPath, 'utf8');
    assert.equal(log, '', 'credential-family detection is presence-only and must never shell out to op');
  } finally {
    rmTmpDir(root);
  }
});
