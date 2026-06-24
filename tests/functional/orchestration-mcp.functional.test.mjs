/**
 * tests/functional/orchestration-mcp.functional.test.mjs — MCP orchestration client.
 *
 * Drives the MCP `orchestration_run` / `orchestration_status` tools against a
 * real daemon spawned on an ephemeral port with an isolated HOME (so the token
 * resolves from the isolated configDir()/config.env and runs persist under the
 * isolated ~/.cx). Proves an MCP host with no subagent primitive reaches a real
 * multi-specialist run through a tool, and that an unreachable daemon yields a
 * fail-fast error rather than a silent single-persona fallback. Uses the inline
 * worker backend so the run is hermetic.
 *
 * @enforces ADR-0022
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { configDir } from '../../lib/config/xdg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', '..', 'lib', 'server', 'index.mjs');
const MODEL = 'anthropic/claude-sonnet-4-6';
const TOKEN = ['test', 'dash', 'mcp', 'orch'].join('-');
const PORT = 4352;

let proc;
let home;
let priorHome;
let priorPort;
let priorBindHost;

async function waitForServer(retries = 50) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/status`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

test.before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-mcp-orch-'));
  fs.mkdirSync(configDir(home), { recursive: true });
  fs.writeFileSync(path.join(configDir(home), 'config.env'), `CONSTRUCT_DASHBOARD_TOKEN=${TOKEN}\n`);
  priorHome = process.env.HOME;
  priorPort = process.env.PORT;
  priorBindHost = process.env.BIND_HOST;
  process.env.HOME = home;
  process.env.PORT = String(PORT);
  process.env.BIND_HOST = '127.0.0.1';
  proc = spawn('node', [SERVER], {
    env: { ...process.env, PORT: String(PORT), BIND_HOST: '127.0.0.1', HOME: home, CONSTRUCT_DASHBOARD_TOKEN: TOKEN, CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL },
    stdio: 'ignore',
  });
  await waitForServer();
});

test.after(() => {
  try { proc?.kill(); } catch {}
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
  if (priorPort === undefined) delete process.env.PORT;
  else process.env.PORT = priorPort;
  if (priorBindHost === undefined) delete process.env.BIND_HOST;
  else process.env.BIND_HOST = priorBindHost;
});

test('orchestration_run executes a real run via the daemon and returns task output', async () => {
  const { orchestrationRun } = await import('../../lib/mcp/tools/orchestration-run.mjs');
  const result = await orchestrationRun({
    request: 'refactor the auth module and review it for security',
    requested_strategy: 'orchestrated',
    host: 'VS Code',
    host_model: MODEL,
    file_count: 4,
    timeout_ms: 8000,
  });
  assert.ok(!result.error, `unexpected error: ${result.error}`);
  assert.equal(result.status, 'completed');
  assert.ok(result.runId?.startsWith('run-'));
  assert.ok(result.tasks.length >= 2, 'a specialist chain ran');
  assert.ok(result.tasks.every((t) => t.status === 'prepared' && t.executor === 'inline:prepared'));
});

test('orchestration_status lists runs and fetches one by id', async () => {
  const { orchestrationRun, orchestrationStatus } = await import('../../lib/mcp/tools/orchestration-run.mjs');
  const run = await orchestrationRun({ request: 'design a billing service', requested_strategy: 'orchestrated', host_model: MODEL, timeout_ms: 8000 });
  const list = await orchestrationStatus({ limit: 5 });
  assert.ok(Array.isArray(list.runs) && list.runs.length >= 1);
  const one = await orchestrationStatus({ run_id: run.runId });
  assert.equal(one.runId, run.runId);
  assert.equal(one.status, 'completed');
});

test('an unreachable daemon fails fast (no silent single-persona fallback)', async () => {
  const { orchestrationRun } = await import('../../lib/mcp/tools/orchestration-run.mjs');
  // Point at a closed loopback port — nothing is listening.
  const result = await orchestrationRun({ request: 'x' }, { env: { ...process.env, BIND_HOST: '127.0.0.1', PORT: '4399', CONSTRUCT_ORCHESTRATION_URL: 'http://127.0.0.1:4399' } });
  assert.equal(result.failFast, true);
  assert.match(result.error, /construct dashboard/);
});
