/**
 * tests/functional/orchestration-server.functional.test.mjs — orchestration daemon API.
 *
 * Spawns the real Construct server on an ephemeral port with a dashboard token,
 * then drives the engine as a thin client: POST a run (202 + runId, background
 * execution), poll the run to a terminal state with per-task records, and open
 * the SSE stream. Asserts the auth gate (401 without a token) and that a
 * credential canary never appears in any response body. Uses the default inline
 * worker backend so the run is hermetic (no provider network call); provider
 * execution is unit-tested in tests/orchestration-runtime.test.mjs.
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
const TOKEN = ['test', 'dash', 'orch'].join('-');
const CANARY = 'sk-canary-must-not-leak-4242';
const PORT = 4351;
const BASE = `http://127.0.0.1:${PORT}`;

let proc;
let home;

async function waitForServer(retries = 50) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/auth/status`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

test.before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-srv-'));
  // The dashboard token is sourced from configDir()/config.env, not the process
  // env, so write it there in the isolated HOME before the server starts.
  fs.mkdirSync(configDir(home), { recursive: true });
  fs.writeFileSync(path.join(configDir(home), 'config.env'), `CONSTRUCT_DASHBOARD_TOKEN=${TOKEN}\n`);
  proc = spawn('node', [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      BIND_HOST: '127.0.0.1',
      HOME: home,
      CONSTRUCT_DASHBOARD_TOKEN: TOKEN,
      ANTHROPIC_API_KEY: CANARY,
      CX_MODEL_REASONING: MODEL,
      CX_MODEL_STANDARD: MODEL,
      CX_MODEL_FAST: MODEL,
    },
    stdio: 'ignore',
  });
  await waitForServer();
});

test.after(() => {
  try { proc?.kill(); } catch {}
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
});

const authed = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

test('POST /api/orchestration/runs starts a background run (202 + runId)', async () => {
  const res = await fetch(`${BASE}/api/orchestration/runs`, {
    method: 'POST',
    headers: authed,
    body: JSON.stringify({ request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, host: 'VS Code', fileCount: 4, moduleCount: 2 }),
  });
  assert.equal(res.status, 202);
  const env = await res.json();
  assert.match(env.contractVersion, /^\d+\.\d+\.\d+/);
  assert.ok(env.data.runId);
  assert.ok(env.data.tasks.length >= 2, 'a specialist chain was planned');
  assert.ok(!JSON.stringify(env).includes(CANARY), 'no credential leak');
});

test('GET /api/orchestration/runs/:id polls to a terminal state with task records', async () => {
  const start = await (await fetch(`${BASE}/api/orchestration/runs`, { method: 'POST', headers: authed, body: JSON.stringify({ request: 'design a system end to end', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 3 }) })).json();
  const runId = start.data.runId;
  let run;
  for (let i = 0; i < 50; i += 1) {
    const env = await (await fetch(`${BASE}/api/orchestration/runs/${runId}`, { headers: authed })).json();
    run = env.data;
    if (['completed', 'completed-with-failures', 'cancelled', 'error'].includes(run.status)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(run.status, 'completed');
  assert.ok(run.tasks.every((t) => t.status === 'prepared'), 'inline backend prepared every task');
  assert.ok(run.tasks.every((t) => t.executor === 'inline:prepared'));
});

test('GET /api/orchestration/runs lists recent runs', async () => {
  const env = await (await fetch(`${BASE}/api/orchestration/runs?limit=5`, { headers: authed })).json();
  assert.ok(Array.isArray(env.data.runs));
  assert.ok(env.data.runs.length >= 1);
});

test('SSE stream emits the run state', async () => {
  const start = await (await fetch(`${BASE}/api/orchestration/runs`, { method: 'POST', headers: authed, body: JSON.stringify({ request: 'refactor x', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 3 }) })).json();
  const runId = start.data.runId;
  const res = await fetch(`${BASE}/api/orchestration/runs/${runId}/events`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let seen = '';
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += dec.decode(value);
    if (/snapshot|completed/.test(seen)) break;
  }
  await reader.cancel();
  assert.match(seen, /"runId":"run-/);
  assert.match(seen, /snapshot|completed/);
});

test('a wrong token is rejected by the auth gate (401)', async () => {
  const res = await fetch(`${BASE}/api/orchestration/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token' }, body: JSON.stringify({ request: 'x' }) });
  assert.equal(res.status, 401);
});

test('a no-credential request is rejected (CSRF or auth, never executes)', async () => {
  const res = await fetch(`${BASE}/api/orchestration/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: 'x' }) });
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

// A no-token daemon is open by design; the orchestration API must stay CSRF-exempt
// so a programmatic POST with no cookie and no Authorization header (the default
// CLI / MCP path) reaches it instead of being rejected by the double-submit check.
test('a no-token daemon accepts the orchestration POST (CSRF-exempt programmatic API)', async () => {
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-notoken-'));
  const port2 = 4353;
  const { CONSTRUCT_DASHBOARD_TOKEN, ...cleanEnv } = process.env;
  const proc2 = spawn('node', [SERVER], {
    env: { ...cleanEnv, PORT: String(port2), BIND_HOST: '127.0.0.1', HOME: home2, CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port2}/api/auth/status`)).ok) break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const res = await fetch(`http://127.0.0.1:${port2}/api/orchestration/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: 'refactor and review', requestedStrategy: 'orchestrated', hostModel: MODEL }),
    });
    assert.equal(res.status, 202, 'no-token daemon must accept the orchestration POST');
    const env = await res.json();
    assert.ok(env.data.runId, 'run started');
  } finally {
    try { proc2.kill(); } catch {}
    try { fs.rmSync(home2, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
});
