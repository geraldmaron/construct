/**
 * tests/functional/graphrag-ask.functional.test.mjs — End-to-end GraphRAG.
 *
 * Stand up a project with seeded entities, boot the real MCP server, and
 * drive `knowledge_graph_ask` over stdio JSON-RPC. Asserts the wire-level
 * contract (request reaches the handler, response is structured JSON) plus
 * the routing contract (auth-cluster query lands on the auth cluster).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SERVER = path.join(REPO, 'lib', 'mcp', 'server.mjs');

function seedProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'graphrag-fn-'));
  fs.mkdirSync(path.join(cwd, '.construct', 'observations'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.construct', 'observations', 'entities.json'), JSON.stringify([
    { name: 'oauth', summary: 'authentication protocol', relatedEntities: ['session', 'jwt'] },
    { name: 'session', summary: 'authentication state', relatedEntities: ['oauth', 'jwt'] },
    { name: 'jwt', summary: 'authentication token', relatedEntities: ['oauth', 'session'] },
    { name: 'logger', summary: 'observability logging output', relatedEntities: ['span', 'trace'] },
    { name: 'span', summary: 'observability span', relatedEntities: ['logger', 'trace'] },
    { name: 'trace', summary: 'observability trace data', relatedEntities: ['logger', 'span'] },
  ], null, 2));
  return cwd;
}

function startServer() {
  const proc = spawn(process.execPath, [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CONSTRUCT_TOOLKIT_DIR: REPO },
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
      clientInfo: { name: 'graphrag-test', version: '0.0.0' },
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

test('knowledge_graph_ask is registered as an MCP tool', async () => {
  await withServer(async (send) => {
    const list = await send('tools/list', {});
    const tools = list.result.tools;
    const names = tools.map((t) => t.name);
    // The context-budget tool gateway exposes only core tools flat; the long
    // tail is reachable through the construct_call dispatcher, so a registered
    // tool is either in the flat list or in the dispatcher's enum.
    const dispatchable = tools.find((t) => t.name === 'call')?.inputSchema?.properties?.tool?.enum || [];
    assert.ok(
      names.includes('knowledge_graph_ask') || dispatchable.includes('knowledge_graph_ask'),
      'knowledge_graph_ask must be registered (flat or via construct_call)',
    );
  });
});

test('knowledge_graph_ask routes an auth-cluster query to the auth community over MCP', async () => {
  const cwd = seedProject();
  await withServer(async (send) => {
    const res = await send('tools/call', {
      name: 'knowledge_graph_ask',
      arguments: { cwd, query: 'authentication token', top_k: 5 },
    });
    const body = callResult(res);
    assert.equal(body.totalEntities, 6);
    assert.ok(Array.isArray(body.communities));
    assert.ok(body.communities.length >= 1, 'expected at least one community in response');
    const top = body.communities[0];
    const overlap = ['oauth', 'session', 'jwt'].filter((n) => top.topMembers.includes(n));
    assert.ok(overlap.length >= 1, `top community ${top.topMembers.join(',')} should overlap with auth cluster`);
  });
  rmTmpDir(cwd);
});

test('knowledge_graph_ask returns empty result gracefully for a project with no entities', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'graphrag-empty-'));
  await withServer(async (send) => {
    const res = await send('tools/call', {
      name: 'knowledge_graph_ask',
      arguments: { cwd, query: 'anything' },
    });
    const body = callResult(res);
    assert.equal(body.totalEntities, 0);
    assert.deepEqual(body.communities, []);
  });
  rmTmpDir(cwd);
});
