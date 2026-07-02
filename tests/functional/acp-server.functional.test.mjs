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

async function runAcpTest(project, envOverrides = {}, promptText) {
  const proc = spawn('node', [BIN, 'acp'], {
    cwd: project,
    env: { ...process.env, CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL, ...envOverrides },
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

    const prompt = promptText || 'refactor the auth module and review it for security';
    send({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: prompt }] } });
    const promptResp = await waitFor((m) => m.id === 3);
    assert.ok(['end_turn', 'cancelled', 'refusal'].includes(promptResp.result.stopReason), `stopReason: ${promptResp.result.stopReason}`);

    const updates = messages.filter((m) => m.method === 'session/update' && m.params?.sessionId === sessionId);
    assert.ok(updates.length >= 1, 'at least one session/update streamed');
    assert.ok(updates.some((u) => u.params.update?.sessionUpdate === 'agent_message_chunk'), 'agent message chunk streamed');

    return { messages, updates, sessionId, promptResp };
  } finally {
    try { proc.kill(); } catch { /* ignore */ }
    try { fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* ignore */ }
  }
}

test('ACP handshake: initialize → session/new → session/prompt runs an orchestration', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-acp-'));
  await runAcpTest(project);
});

test('ACP server: prepare-only honesty — default inline run summary discloses prepare-only', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-acp-inline-'));
  const { updates } = await runAcpTest(project);
  
  // Find the summarize message (the last update should be the summary)
  const summaryUpdate = updates.find((u) => u.params.update?.content?.text?.includes('Orchestration'));
  assert.ok(summaryUpdate, 'summary update should be present');
  
  const summaryText = summaryUpdate.params.update.content.text;
  // Should disclose prepare-only / no specialist execution
  assert.ok(
    summaryText.includes('prepare-only') || 
    summaryText.includes('prepared') || 
    summaryText.includes('no specialist execution'),
    `Summary should disclose prepare-only nature: ${summaryText}`
  );
  
  // Should show workerBackend=inline
  assert.ok(summaryText.includes('workerBackend=inline'), `Summary should show workerBackend=inline: ${summaryText}`);
});

test('ACP server: backend resolution honors config — provider backend shows in summary', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-acp-provider-'));

  // construct.config.json at the project root is the file loadConfig reads
  // (lib/config/project-config.mjs PROJECT_CONFIG_FILENAME).
  const configPath = path.join(project, 'construct.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    orchestration: { workerBackend: 'provider', store: 'filesystem', chainOfThought: 'hidden' }
  }, null, 2));

  // Clearing the model tiers and keys forces a degraded, zero-task run so no real
  // provider call is made — but the resolved workerBackend is recorded before
  // execution, so a config-driven 'provider' must still surface in the summary.
  // Pre-fix ACP hardcoded workerBackend=inline, so this assertion caught the deviation.
  const { updates } = await runAcpTest(project, {
    CX_MODEL_REASONING: '', CX_MODEL_STANDARD: '', CX_MODEL_FAST: '',
    OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '',
  });

  const summaryUpdate = updates.find((u) => u.params.update?.content?.text?.includes('Orchestration'));
  assert.ok(summaryUpdate, 'summary update should be present');

  const summaryText = summaryUpdate.params.update.content.text;
  assert.ok(
    summaryText.includes('workerBackend=provider'),
    `config workerBackend=provider must drive the resolved backend, not the old hardcoded inline: ${summaryText}`,
  );
});
