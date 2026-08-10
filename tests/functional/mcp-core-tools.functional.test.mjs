/**
 * tests/functional/mcp-core-tools.functional.test.mjs — Construct MCP stdio smoke.
 *
 * Spawns the real Construct stdio MCP server (lib/mcp/server.mjs), completes the
 * JSON-RPC initialize handshake, and proves three things with no network:
 *   1. tools/list exposes every CORE_TOOL_NAME plus the `call` gateway
 *      (the collapsed surface a host actually sees).
 *   2. Each core tool round-trips through tools/call with schema-aligned SAMPLE_ARGS
 *      (get_skill.path, search_skills.pattern). get_skill and search_skills must
 *      return usable payloads — not only a dispatch envelope that embeds an
 *      INVALID_INPUT / missing-arg error. Per-call timeout is pinned low so a
 *      wedged tool cannot hang the suite.
 *   3. `call` reaches a canonical registry tool by name and returns
 *      real worker-profile data from the unified registry.
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

const CORE_TOOLS = [
  'orchestration_policy', 'get_skill', 'search_skills', 'knowledge_search',
  'memory_search', 'project_context', 'summarize_diff', 'orchestration_readiness',
];

const SAMPLE_ARGS = {
  orchestration_policy: { request: 'fix a flaky test' },
  get_skill: { path: 'docs/artifact-authorship' },
  search_skills: { pattern: 'artifact authorship' },
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
      CONSTRUCT_TOOLKIT_DIR: REPO,
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

function envelopePayload(frame) {
  const text = envelopeText(frame);
  assert.ok(typeof text === 'string', 'tool result envelope must include text content');
  return JSON.parse(text);
}

test('Construct MCP stdio server: core surface + per-tool round-trip + call gateway', async () => {
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

    const getSkillSchema = (listed.result?.tools || []).find((t) => t.name === 'get_skill')?.inputSchema;
    assert.ok(getSkillSchema?.properties?.path, 'tools/list get_skill schema must declare path');
    assert.ok(getSkillSchema?.required?.includes('path'), 'tools/list get_skill must require path');
    assert.equal(getSkillSchema?.properties?.name, undefined, 'tools/list get_skill must not declare name');

    const searchSkillsSchema = (listed.result?.tools || []).find((t) => t.name === 'search_skills')?.inputSchema;
    assert.ok(searchSkillsSchema?.properties?.pattern, 'tools/list search_skills schema must declare pattern');
    assert.ok(searchSkillsSchema?.required?.includes('pattern'), 'tools/list search_skills must require pattern');
    assert.equal(searchSkillsSchema?.properties?.query, undefined, 'tools/list search_skills must not declare query');

    const payloads = {};
    for (const core of CORE_TOOLS) {
      const callId = ++id;
      c.send({ jsonrpc: '2.0', id: callId, method: 'tools/call', params: { name: core, arguments: SAMPLE_ARGS[core] } });
      const frame = await c.waitFor(callId);
      assert.equal(frame.error, undefined, `${core} must not raise a JSON-RPC error (method must dispatch)`);
      payloads[core] = envelopePayload(frame);
    }

    assert.equal(payloads.get_skill.error, undefined, `get_skill must not error: ${JSON.stringify(payloads.get_skill).slice(0, 200)}`);
    assert.equal(typeof payloads.get_skill.content, 'string', 'get_skill must return skill body content');
    assert.ok(payloads.get_skill.content.length > 200, `get_skill body too short: ${payloads.get_skill.content.length}`);

    assert.equal(payloads.search_skills.error, undefined, `search_skills must not error: ${JSON.stringify(payloads.search_skills).slice(0, 200)}`);
    assert.ok(
      Array.isArray(payloads.search_skills.results) && payloads.search_skills.results.length > 0,
      `search_skills must return matches: ${JSON.stringify(payloads.search_skills).slice(0, 300)}`,
    );

    const ccId = ++id;
    c.send({ jsonrpc: '2.0', id: ccId, method: 'tools/call', params: { name: 'call', arguments: { tool: 'list_worker_profiles', args: {} } } });
    const ccFrame = await c.waitFor(ccId);
    const ccPayload = envelopePayload(ccFrame);
    assert.equal(ccPayload.error, undefined, `call -> list_worker_profiles must not error: ${JSON.stringify(ccPayload).slice(0, 200)}`);
    assert.ok(Array.isArray(ccPayload.workerProfiles) && ccPayload.workerProfiles.length > 0, 'list_worker_profiles must return canonical registry data');
  } finally {
    c.kill();
    rmTmpDir(home);
  }
});
