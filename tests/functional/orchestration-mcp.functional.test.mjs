/**
 * tests/functional/orchestration-mcp.functional.test.mjs — MCP orchestration, in-process.
 *
 * ADR-0022 + ADR-0041: the orchestration engine is the in-process runtime
 * (lib/orchestration/runtime.mjs); the orchestration_run MCP tool drives it
 * directly — no daemon, no port, no token. Proves an MCP host with no subagent
 * primitive reaches a real multi-specialist run through the tool, the run is
 * queryable in-process, a configured-but-unreachable remote service
 * (CONSTRUCT_ORCHESTRATION_URL) fails fast, and the tool carries no dashboard
 * server dependency so the dashboard deletion (web-deprecation.4) cannot break it.
 *
 * @enforces ADR-0022
 * @capability orchestration.routing
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { orchestrationRun, orchestrationStatus } from '../../lib/mcp/tools/orchestration-run.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL = 'anthropic/claude-sonnet-4-6';

function tmpProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-mcp-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  return cwd;
}

// Solo default: the registry resolves from the repo via CX_TOOLKIT_DIR.
// orchestrationRun/orchestrationStatus resolve the run store through the
// machine-scoped state root (ADR-0066), which reads CX_HOME_OVERRIDE from
// real process.env directly — the CX_HOME_OVERRIDE sterileSpawnEnv sets below
// only reaches the in-process `env` option bag these calls thread to model
// resolution, never process.env, so it alone would not isolate a state-root
// write. The module-level pin below (sharing the same homeOverride dir) is
// what actually keeps run storage off the real developer machine's
// ~/.construct/projects/. No remote service is configured
// (CONSTRUCT_ORCHESTRATION_URL is omitted by the allowlist by construction).

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-mcp-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function soloEnv() {
  return sterileSpawnEnv({
    HOME: homeOverride,
    CX_TOOLKIT_DIR: REPO_ROOT,
    OPENROUTER_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    CX_MODEL_REASONING: MODEL,
    CX_MODEL_STANDARD: MODEL,
    CX_MODEL_FAST: MODEL,
  });
}

test('orchestration_run plans a multi-specialist run in-process (no daemon)', async () => {
  const cwd = tmpProject();
  try {
    const result = await orchestrationRun(
      { request: 'design and implement a new authentication architecture', file_count: 20, module_count: 6, host_model: MODEL, wait: true, worker_backend: 'inline' },
      { cwd, env: soloEnv() },
    );
    assert.ok(!result.error, `expected a run, got error: ${result.error}`);
    assert.ok(result.runId, 'run should have an id');
    assert.equal(result.degraded, false, 'a healthy in-process run must not be degraded');
    assert.equal(result.track, 'orchestrated', 'a complex request routes to the orchestrated track');
    assert.ok(Array.isArray(result.specialists) && result.specialists.length > 1, 'an orchestrated run plans more than one specialist');
    assert.ok(Array.isArray(result.tasks) && result.tasks.length > 1, 'an orchestrated run must return a non-empty executed task list');
    assert.ok(result.tasks.every((task) => task.status === 'prepared'), 'inline orchestration tasks stay prepared on the happy path');
    assert.ok(result.tasks.every((task) => task.executor === 'inline:prepared'), 'inline orchestration marks each task as prepared by the inline executor');

    const status = await orchestrationStatus({ run_id: result.runId }, { cwd, env: soloEnv() });
    assert.equal(status.runId, result.runId, 'the run is queryable in-process by id');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('orchestration_run preserves the research workflow hint for evidence-backed requests', async () => {
  const cwd = tmpProject();
  try {
    const result = await orchestrationRun(
      { request: 'do research on oidc', workflow_type: 'research-synthesis', file_count: 1, module_count: 1, wait: true, worker_backend: 'inline' },
      { cwd, env: soloEnv() },
    );
    assert.ok(!result.error, `expected a run, got error: ${result.error}`);
    assert.equal(result.intent, 'research');
    assert.equal(result.track, 'focused');
    assert.equal(result.suggestedWorkflowType, 'research-synthesis');
    assert.deepEqual(result.specialists, ['cx-researcher']);
    assert.equal(result.researchExecutionPolicy?.mode, 'evidence-first');
    assert.ok(Array.isArray(result.researchExecutionPolicy?.toolRouting));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('orchestration_run fails fast when a configured remote service is unreachable', async () => {
  const cwd = tmpProject();
  try {
    const env = { ...soloEnv(), CONSTRUCT_ORCHESTRATION_URL: 'http://127.0.0.1:9' };
    const result = await orchestrationRun(
      { request: 'do something', wait: true },
      { cwd, env, fetchImpl: () => { throw new Error('ECONNREFUSED'); } },
    );
    assert.ok(result.failFast, 'an unreachable remote service must fail fast');
    assert.match(result.error, /not reachable/i);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('the orchestration MCP tool carries no dashboard server import', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'mcp', 'tools', 'orchestration-run.mjs'), 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*server\//, 'orchestration_run must not import from a server module (dashboard-independent)');
});
