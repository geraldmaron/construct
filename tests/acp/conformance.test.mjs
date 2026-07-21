/**
 * tests/acp/conformance.test.mjs — ACP protocol conformance against lib/acp/server.mjs.
 *
 * Drives the real runAcpServer entrypoint with fixture JSON-RPC requests and
 * asserts response shapes for initialize, session/new, session/prompt, and
 * session/cancel. session/update notifications are asserted for lifecycle
 * sequencing during session/prompt. fetchImpl is injected so CI stays hermetic.
 *
 * @enforces construct-tsyfe.9.3, ADR-0023
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { runAcpServer } from '../../lib/acp/server.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function createAcpHarness({ cwd, fetchImpl, env = process.env } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  let buffer = '';

  output.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        try { messages.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    }
  });

  const server = runAcpServer({
    input,
    output,
    defaultCwd: cwd ?? process.cwd(),
    fetchImpl: fetchImpl ?? (async () => { throw new Error('network disabled in test'); }),
    env,
  });

  const send = (msg) => input.write(`${JSON.stringify(msg)}\n`);
  const waitFor = (pred, ms = 8000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const hit = messages.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() > deadline) return reject(new Error(`timeout waiting for message: ${JSON.stringify(messages.slice(-3))}`));
      setTimeout(tick, 25);
    };
    tick();
  });

  return {
    send,
    waitFor,
    messages: () => messages,
    close: () => {
      server.close();
      input.destroy();
      output.destroy();
    },
  };
}

test('ACP initialize returns protocolVersion and agentCapabilities', async () => {
  const harness = createAcpHarness({});
  try {
    harness.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    const init = await harness.waitFor((m) => m.id === 1);
    assert.equal(init.jsonrpc, '2.0');
    assert.equal(init.result.protocolVersion, 1);
    assert.ok(init.result.agentCapabilities?.promptCapabilities);
    assert.deepEqual(init.result.authMethods, []);
    assert.equal(init.error, undefined);
  } finally {
    harness.close();
  }
});

test('ACP session/new returns a sessionId', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-acp-conf-'));
  const harness = createAcpHarness({ cwd: project });
  try {
    harness.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: project, mcpServers: [] } });
    const created = await harness.waitFor((m) => m.id === 2);
    assert.equal(typeof created.result.sessionId, 'string');
    assert.ok(created.result.sessionId.length > 0);
  } finally {
    harness.close();
    rmTmpDir(project);
  }
});

test('ACP session/prompt streams session/update then returns stopReason', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-acp-conf-prompt-'));
  const harness = createAcpHarness({ cwd: project });
  try {
    harness.send({ jsonrpc: '2.0', id: 10, method: 'session/new', params: { cwd: project, mcpServers: [] } });
    const created = await harness.waitFor((m) => m.id === 10);
    const sessionId = created.result.sessionId;

    harness.send({
      jsonrpc: '2.0',
      id: 11,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'refactor the auth module and review it for security' }] },
    });
    const promptResp = await harness.waitFor((m) => m.id === 11);
    assert.ok(['end_turn', 'cancelled', 'refusal'].includes(promptResp.result.stopReason));

    const updates = harness.messages().filter((m) => m.method === 'session/update' && m.params?.sessionId === sessionId);
    assert.ok(updates.length >= 1, 'expected at least one session/update notification');
    for (const update of updates) {
      assert.equal(update.params.update.sessionUpdate, 'agent_message_chunk');
      assert.equal(update.params.update.content.type, 'text');
      assert.equal(typeof update.params.update.content.text, 'string');
    }

    const texts = updates.map((u) => u.params.update.content.text);
    assert.ok(
      texts.some((t) => /Planned|Running|Completed|Error|Orchestration/i.test(t)),
      `expected lifecycle text in updates: ${texts.join(' | ')}`,
    );
  } finally {
    harness.close();
    rmTmpDir(project);
  }
});

test('ACP session/cancel responds for a known session', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-acp-conf-cancel-'));
  const harness = createAcpHarness({ cwd: project });
  try {
    harness.send({ jsonrpc: '2.0', id: 20, method: 'session/new', params: { cwd: project, mcpServers: [] } });
    const created = await harness.waitFor((m) => m.id === 20);
    const sessionId = created.result.sessionId;

    harness.send({ jsonrpc: '2.0', id: 21, method: 'session/cancel', params: { sessionId } });
    const cancelled = await harness.waitFor((m) => m.id === 21);
    assert.deepEqual(cancelled.result, {});
    assert.equal(cancelled.error, undefined);
  } finally {
    harness.close();
    rmTmpDir(project);
  }
});

test('ACP unknown sessionId returns JSON-RPC invalid params error', async () => {
  const harness = createAcpHarness({});
  try {
    harness.send({
      jsonrpc: '2.0',
      id: 30,
      method: 'session/prompt',
      params: { sessionId: 'missing', prompt: [{ type: 'text', text: 'hello' }] },
    });
    const resp = await harness.waitFor((m) => m.id === 30);
    assert.equal(resp.error.code, -32602);
    assert.match(resp.error.message, /Unknown sessionId/);
  } finally {
    harness.close();
  }
});

test('ACP unknown method returns JSON-RPC method not found error', async () => {
  const harness = createAcpHarness({});
  try {
    harness.send({ jsonrpc: '2.0', id: 40, method: 'session/unknown', params: {} });
    const resp = await harness.waitFor((m) => m.id === 40);
    assert.equal(resp.error.code, -32601);
    assert.match(resp.error.message, /Method not found/);
  } finally {
    harness.close();
  }
});
