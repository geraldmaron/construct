/**
 * tests/functional/mcp-tool-schema-enforcement.functional.test.mjs — dispatch-path
 * schema enforcement (construct-tsyfe.9.1).
 *
 * Spawns the real Construct stdio MCP server (lib/mcp/server.mjs) and sends a
 * deliberately malformed tools/call for one representative tool from each of
 * the four hardcoded catalogs (project/skills/memory/workflow) plus one
 * self-registered (*.tool.mjs) tool, asserting each is rejected with a typed
 * `{ error: { code: 'INVALID_INPUT', ... } }` structuredContent — never a
 * JSON-RPC-level error, never an unhandled exception, and never a silent
 * pass-through into handler logic. A final round-trip with a well-formed call
 * proves the enforcement does not also reject valid input (Non-goal: tool
 * business logic for well-formed calls is unchanged).
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const SERVER = path.join(REPO, 'lib', 'mcp', 'server.mjs');

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

function structuredResult(frame) {
  assert.equal(frame.error, undefined, `must not raise a JSON-RPC-level error: ${JSON.stringify(frame.error)}`);
  const sc = frame.result?.structuredContent;
  assert.ok(sc && typeof sc === 'object', 'tools/call must return structuredContent');
  return sc;
}

// One representative per hardcoded catalog slice plus one self-registered
// (*.tool.mjs) tool, each called with input that violates its own declared
// inputSchema (a missing required field or a wrong-typed field).

const MALFORMED_CASES = [
  { category: 'project', name: 'scan_file', args: {} },
  { category: 'skills', name: 'get_skill', args: { path: 12345 } },
  { category: 'memory', name: 'memory_search', args: { limit: 'ten' } },
  { category: 'workflow', name: 'workflow_update_task', args: {} },
];

test('Construct MCP stdio server: malformed tool input is rejected as a typed INVALID_INPUT error, not a crash', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-mcp-schema-'));
  const c = mcpClient(home);
  let id = 0;
  try {
    c.send({
      jsonrpc: '2.0', id: ++id, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'schema-enforcement-test', version: '1' } },
    });
    await c.waitFor(id);
    c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    for (const { category, name, args } of MALFORMED_CASES) {
      const callId = ++id;
      c.send({ jsonrpc: '2.0', id: callId, method: 'tools/call', params: { name, arguments: args } });
      const frame = await c.waitFor(callId);
      const sc = structuredResult(frame);
      assert.ok(sc.error && typeof sc.error === 'object', `[${category}] ${name} must return a structured error, not a bare string, for malformed input`);
      assert.equal(sc.error.code, 'INVALID_INPUT', `[${category}] ${name} must report code INVALID_INPUT`);
      assert.ok(typeof sc.error.message === 'string' && sc.error.message.length > 0, `[${category}] ${name} error must carry a message`);
    }

    // The self-registered tool (lib/mcp/tools/orchestration-task-result.tool.mjs)
    // is long-tail, reached only through the `call` gateway.
    const selfRegId = ++id;
    c.send({
      jsonrpc: '2.0', id: selfRegId, method: 'tools/call',
      params: { name: 'call', arguments: { tool: 'orchestration_task_result', args: {} } },
    });
    const selfRegFrame = await c.waitFor(selfRegId);
    const selfRegSc = structuredResult(selfRegFrame);
    assert.ok(selfRegSc.error && typeof selfRegSc.error === 'object', 'orchestration_task_result (self-registered) must return a structured error for malformed input');
    assert.equal(selfRegSc.error.code, 'INVALID_INPUT', 'orchestration_task_result must report code INVALID_INPUT');

    // A well-formed call to one of the same tools must still succeed normally —
    // enforcement rejects malformed input without touching well-formed dispatch.
    const okId = ++id;
    c.send({ jsonrpc: '2.0', id: okId, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'schema validation' } } });
    const okFrame = await c.waitFor(okId);
    const okSc = structuredResult(okFrame);
    assert.equal(okSc.error, undefined, 'a well-formed memory_search call must not be rejected');
  } finally {
    c.kill();
    rmTmpDir(home);
  }
});
