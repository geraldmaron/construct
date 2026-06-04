/**
 * tests/functional/acp-server.functional.test.mjs — Construct ACP server.
 *
 * Spawns `construct acp` and drives the Agent Client Protocol handshake over
 * stdio (newline-delimited JSON-RPC 2.0): initialize → session/new →
 * session/prompt. Asserts the protocol contract (protocolVersion, sessionId,
 * a streamed session/update, a terminal stopReason) and that the prompt runs a
 * real orchestration through the same engine the daemon/MCP tool use. Inline
 * worker backend keeps it hermetic.
 *
 * @enforces ADR-0023
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'bin', 'construct');
const MODEL = 'anthropic/claude-sonnet-4-6';

test('ACP handshake: initialize → session/new → session/prompt runs an orchestration', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-acp-'));
  const proc = spawn('node', [BIN, 'acp'], {
    cwd: project,
    env: { ...process.env, CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL },
    stdio: ['pipe', 'pipe', 'ignore'],
  });

  const messages = [];
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) { try { messages.push(JSON.parse(line)); } catch { /* skip */ } }
    }
  });

  const send = (msg) => proc.stdin.write(`${JSON.stringify(msg)}\n`);
  const waitFor = (pred, ms = 8000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const hit = messages.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() > deadline) return reject(new Error('timeout waiting for message'));
      setTimeout(tick, 25);
    };
    tick();
  });

  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    const init = await waitFor((m) => m.id === 1);
    assert.equal(init.result.protocolVersion, 1);
    assert.ok(init.result.agentCapabilities, 'agentCapabilities present');

    send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: project, mcpServers: [] } });
    const newSession = await waitFor((m) => m.id === 2);
    const sessionId = newSession.result.sessionId;
    assert.ok(sessionId, 'sessionId returned');

    send({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: 'refactor the auth module and review it for security' }] } });
    const prompt = await waitFor((m) => m.id === 3);
    assert.ok(['end_turn', 'cancelled', 'refusal'].includes(prompt.result.stopReason), `stopReason: ${prompt.result.stopReason}`);
    assert.equal(prompt.result.stopReason, 'end_turn');

    const updates = messages.filter((m) => m.method === 'session/update' && m.params?.sessionId === sessionId);
    assert.ok(updates.length >= 1, 'at least one session/update streamed');
    assert.ok(updates.some((u) => u.params.update?.sessionUpdate === 'agent_message_chunk'), 'agent message chunk streamed');
  } finally {
    try { proc.kill(); } catch { /* ignore */ }
    try { fs.rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
