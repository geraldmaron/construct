/**
 * tests/functional/mcp-procedure-invoke.functional.test.mjs
 *
 * Hermetic MCP smoke for Embedded Contract procedure_invoke:
 *   - tools/list must NOT expose workflow_invoke (retired)
 *   - procedure_invoke is reachable via the call gateway
 *   - schema requires procedure_id (not workflow_type)
 *   - proposal-only invoke with procedure_id round-trips without INVALID_INPUT
 *
 * P0: schema still required workflow_type while the
 * handler and CLI only accept procedure_id.
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

function mcpClient(cwd, home) {
  const child = spawn(process.execPath, [SERVER], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      CONSTRUCT_HOME_OVERRIDE: home,
      CONSTRUCT_TOOLKIT_DIR: REPO,
      CONSTRUCT_MCP_TOOL_TIMEOUT_MS: '15000',
      CI: 'true',
      NODE_ENV: 'test',
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
      if (raw) {
        try { state.frames.push(JSON.parse(raw)); } catch { /* non-JSON noise */ }
      }
    }
  });
  const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
  const waitFor = (id, timeoutMs = 20_000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const hit = state.frames.find((f) => f.id === id);
      if (hit) return resolve(hit);
      if (Date.now() >= deadline) {
        return reject(new Error(`timeout waiting for id=${id}; frames=${state.frames.length}`));
      }
      setTimeout(tick, 40);
    };
    tick();
  });
  return {
    send,
    waitFor,
    kill: () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } },
  };
}

function envelopeText(frame) {
  return frame?.result?.content?.[0]?.text ?? null;
}

test('MCP procedure_invoke requires procedure_id; workflow_invoke absent', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-mcp-proc-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-mcp-proc-cwd-'));
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  const c = mcpClient(cwd, home);
  let id = 0;
  try {
    c.send({
      jsonrpc: '2.0', id: ++id, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'procedure-invoke-smoke', version: '1' },
      },
    });
    await c.waitFor(id);
    c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const listId = ++id;
    c.send({ jsonrpc: '2.0', id: listId, method: 'tools/list', params: {} });
    const listed = await c.waitFor(listId);
    const tools = listed.result?.tools || [];
    const flat = tools.map((t) => t.name);
    assert.equal(flat.includes('workflow_invoke'), false, 'workflow_invoke must not be flat');
    assert.equal(flat.includes('procedure_invoke'), false, 'procedure_invoke is long-tail via call');
    assert.ok(flat.includes('call'), 'call gateway required');
    assert.ok(flat.includes('project_context'), 'project_context must be flat core');

    const callTool = tools.find((t) => t.name === 'call');
    const enumNames = callTool?.inputSchema?.properties?.tool?.enum || [];
    assert.equal(enumNames.includes('workflow_invoke'), false, 'workflow_invoke must not be in call enum');
    assert.ok(enumNames.includes('procedure_invoke'), 'procedure_invoke must be in call enum');
    assert.ok(enumNames.includes('capability_describe'), 'capability_describe must be in call enum');

    const procDef = tools.find((t) => t.name === 'procedure_invoke');
    assert.equal(procDef, undefined, 'procedure_invoke is not flat; schema lives in catalog behind call');

    // Discover schema via find_tool or by calling with missing required field
    const badId = ++id;
    c.send({
      jsonrpc: '2.0', id: badId, method: 'tools/call',
      params: {
        name: 'call',
        arguments: {
          tool: 'procedure_invoke',
          args: { approval_mode: 'proposal-only', input: 'missing id' },
        },
      },
    });
    const bad = await c.waitFor(badId);
    const badText = envelopeText(bad) || '';
    assert.match(badText, /procedure_id/, `missing procedure_id must mention procedure_id: ${badText.slice(0, 300)}`);
    assert.doesNotMatch(badText, /required property 'workflow_type'/, 'must not require retired workflow_type');

    const okId = ++id;
    c.send({
      jsonrpc: '2.0', id: okId, method: 'tools/call',
      params: {
        name: 'call',
        arguments: {
          tool: 'procedure_invoke',
          args: {
            procedure_id: 'memo-draft',
            approval_mode: 'proposal-only',
            input: 'One-paragraph status: SSO login 500 after cutover; mitigation in flight.',
          },
        },
      },
    });
    const ok = await c.waitFor(okId, 45_000);
    assert.equal(ok.error, undefined, `procedure_invoke JSON-RPC error: ${JSON.stringify(ok.error)}`);
    const okText = envelopeText(ok);
    assert.ok(typeof okText === 'string', 'procedure_invoke must return envelope text');
    const payload = JSON.parse(okText);
    assert.equal(payload.error, undefined, `procedure_invoke tool error: ${okText.slice(0, 400)}`);
    assert.ok(payload.data || payload.contractVersion, 'versioned contract envelope expected');

    const wfId = ++id;
    c.send({
      jsonrpc: '2.0', id: wfId, method: 'tools/call',
      params: { name: 'call', arguments: { tool: 'workflow_invoke', args: {} } },
    });
    const wf = await c.waitFor(wfId);
    const wfText = envelopeText(wf) || '';
    assert.match(wfText, /Unknown tool:\s*workflow_invoke/i, `workflow_invoke must be unknown: ${wfText.slice(0, 200)}`);
  } finally {
    c.kill();
    rmTmpDir(home);
    rmTmpDir(cwd);
  }
});
