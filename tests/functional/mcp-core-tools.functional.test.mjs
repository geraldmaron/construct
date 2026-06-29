/**
 * tests/functional/mcp-core-tools.functional.test.mjs — Construct MCP stdio smoke.
 *
 * Spawns the real Construct stdio MCP server (lib/mcp/server.mjs), completes the
 * JSON-RPC initialize handshake, and proves three things with no network:
 *   1. tools/list exposes every CORE_TOOL_NAME plus the construct_call meta-tool
 *      (the collapsed surface a host actually sees).
 *   2. Each core tool round-trips through tools/call — the server dispatches it
 *      and returns a result envelope (a tool-level error is still a valid
 *      round-trip; a wedged tool can't hang the suite because the per-call
 *      timeout is pinned low).
 *   3. construct_call reaches a long-tail tool by name (list_teams) and returns
 *      real data from the unified registry — the end-to-end dispatch path the
 *      P0 list_teams/get_team fix restored.
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const SERVER = path.join(REPO, 'lib', 'mcp', 'server.mjs');

const CORE_TOOLS = [
  'orchestration_policy', 'get_skill', 'search_skills', 'knowledge_search',
  'memory_search', 'project_context', 'summarize_diff', 'orchestration_readiness',
];

const SAMPLE_ARGS = {
  orchestration_policy: { request: 'fix a flaky test' },
  get_skill: { name: 'review:code' },
  search_skills: { query: 'review' },
  knowledge_search: { query: 'teams' },
  memory_search: { query: 'registry' },
  project_context: {},
  summarize_diff: { diff: 'diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n@@ -0,0 +1 @@\n+hello\n' },
  orchestration_readiness: { host: 'test-host', session_id: 'mcp-core-test' },
};

function mcpClient(home) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      HOME: home,
      CX_TOOLKIT_DIR: REPO,
      CONSTRUCT_MCP_TOOL_TIMEOUT_MS: '8000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { buffer: '', frames: [] };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    state.buffer += chunk;
    let idx;
    while ((idx = state.buffer.indexOf('\n')) >= 0) {
      const raw = state.buffer.slice(0, idx).trim();
      state.buffer = state.buffer.slice(idx + 1);
      if (raw) { try { state.frames.push(JSON.parse(raw)); } catch { /* non-JSON noise */ } }
    }
  });
  const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
  const waitFor = (id, timeoutMs = 15_000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const hit = state.frames.find((f) => f.id === id);
      if (hit) return resolve(hit);
      if (Date.now() >= deadline) return reject(new Error(`timeout waiting for id=${id}; frames=${state.frames.length}`));
      setTimeout(tick, 40);
    };
    tick();
  });
  return { send, waitFor, kill: () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } } };
}

function envelopeText(frame) {
  return frame?.result?.content?.[0]?.text ?? null;
}

test('Construct MCP stdio server: core surface + per-tool round-trip + construct_call', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-mcp-core-'));
  const c = mcpClient(home);
  let id = 0;
  try {
    c.send({
      jsonrpc: '2.0', id: ++id, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'core-tools-smoke', version: '1' } },
    });
    await c.waitFor(id);
    c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const listId = ++id;
    c.send({ jsonrpc: '2.0', id: listId, method: 'tools/list', params: {} });
    const listed = await c.waitFor(listId);
    const names = (listed.result?.tools || []).map((t) => t.name);
    for (const core of CORE_TOOLS) {
      assert.ok(names.includes(core), `core tool ${core} must be exposed in tools/list`);
    }
    assert.ok(names.includes('call'), 'construct_call meta-tool must be exposed');

    for (const core of CORE_TOOLS) {
      const callId = ++id;
      c.send({ jsonrpc: '2.0', id: callId, method: 'tools/call', params: { name: core, arguments: SAMPLE_ARGS[core] } });
      const frame = await c.waitFor(callId);
      assert.equal(frame.error, undefined, `${core} must not raise a JSON-RPC error (method must dispatch)`);
      assert.ok(typeof envelopeText(frame) === 'string', `${core} must return a tool result envelope`);
    }

    const ccId = ++id;
    c.send({ jsonrpc: '2.0', id: ccId, method: 'tools/call', params: { name: 'construct_call', arguments: { tool: 'list_teams', args: {} } } });
    const ccFrame = await c.waitFor(ccId);
    const ccText = envelopeText(ccFrame);
    assert.ok(typeof ccText === 'string', 'construct_call must return a result envelope');
    const ccPayload = JSON.parse(ccText);
    assert.equal(ccPayload.error, undefined, `construct_call -> list_teams must not error: ${ccText.slice(0, 200)}`);
    const teams = Array.isArray(ccPayload) ? ccPayload : (ccPayload.teams ?? ccPayload.result ?? []);
    assert.ok(Array.isArray(teams) && teams.length > 0, 'list_teams must return teams from the unified registry');
  } finally {
    c.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
