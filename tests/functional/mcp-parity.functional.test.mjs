/**
 * tests/functional/mcp-parity.functional.test.mjs — End-to-end MCP parity.
 *
 * Boots the real construct-mcp stdio server as a child process, performs the
 * JSON-RPC initialize/tools-list/tools-call handshake, and asserts the PR #67
 * surfaces (profiles, outcomes, knowledge_add, learning_status) are reachable
 * over MCP — not just unit-callable. This is the loop that subagents take when
 * they talk to Construct.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SERVER = path.join(REPO, 'lib', 'mcp', 'server.mjs');

function startServer() {
  const proc = spawn(process.execPath, [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CX_TOOLKIT_DIR: REPO },
  });

  let buffered = '';
  const pending = new Map();
  let nextId = 1;

  proc.stdout.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    let idx;
    while ((idx = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, idx);
      buffered = buffered.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`MCP request ${method} timed out`));
        }
      }, 10_000);
    });
  }

  return { proc, send };
}

async function withServer(fn) {
  const { proc, send } = startServer();
  try {
    await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'parity-test', version: '0.0.0' },
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await fn(send);
  } finally {
    proc.kill('SIGTERM');
  }
}

function callResult(response) {
  const text = response?.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

test('construct-mcp registers the PR #67 profile/learning tools', async () => {
  await withServer(async (send) => {
    const list = await send('tools/list', {});
    const names = new Set(list.result.tools.map((t) => t.name));
    for (const expected of [
      'profile_show', 'profile_list', 'profile_drafts', 'profile_health',
      'outcomes_summary', 'outcomes_record', 'knowledge_add',
      'profile_create', 'profile_archive', 'sandbox_list', 'learning_status',
    ]) {
      assert.ok(names.has(expected), `MCP tool ${expected} not registered`);
    }
  });
});

test('profile_show + profile_list reach Construct state over MCP', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-parity-show-'));
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ version: 1, profile: 'rnd' }, null, 2));

  await withServer(async (send) => {
    const show = await send('tools/call', { name: 'profile_show', arguments: { cwd } });
    const parsed = callResult(show);
    assert.equal(parsed.id, 'rnd');
    assert.ok(Array.isArray(parsed.roles));

    const list = await send('tools/call', { name: 'profile_list', arguments: {} });
    const catalog = callResult(list);
    assert.ok(Array.isArray(catalog.profiles));
    assert.ok(catalog.profiles.some((p) => p.id === 'rnd'));
  });
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('outcomes_record refuses without confirm but writes JSONL when confirmed (via MCP)', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-parity-outcomes-'));
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ version: 1, profile: 'rnd' }, null, 2));

  await withServer(async (send) => {
    const reject = await send('tools/call', {
      name: 'outcomes_record',
      arguments: { cwd, role: 'cx-engineer', success: true },
    });
    const rejectBody = callResult(reject);
    assert.ok(rejectBody.error && rejectBody.error.includes('confirm=true'));

    const accept = await send('tools/call', {
      name: 'outcomes_record',
      arguments: { cwd, confirm: true, role: 'cx-engineer', success: true, notes: 'parity test' },
    });
    const acceptBody = callResult(accept);
    assert.ok(acceptBody.ok);
  });

  const file = path.join(cwd, '.cx', 'outcomes', 'cx-engineer.jsonl');
  assert.ok(fs.existsSync(file), 'outcomes_record did not write JSONL via MCP');
  const entry = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.equal(entry.success, true);
  assert.equal(entry.source, 'mcp');
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('learning_status delivers a structured dashboard over MCP', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-parity-learning-'));
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ version: 1, profile: 'rnd' }, null, 2));

  await withServer(async (send) => {
    const res = await send('tools/call', { name: 'learning_status', arguments: { cwd } });
    const body = callResult(res);
    assert.equal(body.profile.id, 'rnd');
    assert.equal(body.research.count, 0);
    assert.equal(typeof body.observations.total, 'number');
  });
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
