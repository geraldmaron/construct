/**
 * mcp-memory-bridge.test.mjs — verify the stdio MCP bridge in lib/mcp/memory-bridge.mjs.
 *
 * Covers the handshake (initialize/ping) that cm cannot satisfy, the forwarder
 * path against a mock cm HTTP server, and the unreachable-backend path that
 * must return JSON-RPC -32603 without crashing the bridge.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BRIDGE = path.join(ROOT, 'lib', 'mcp', 'memory-bridge.mjs');

function startMockBackend(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { parsed = null; }
        const out = handler(parsed, req);
        res.statusCode = out.status ?? 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out.body ?? {}));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

function spawnBridge(env = {}) {
  const child = spawn(process.execPath, [BRIDGE], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const frames = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!raw) continue;
      try { frames.push(JSON.parse(raw)); } catch { /* skip non-JSON */ }
    }
  });
  child.stderr.setEncoding('utf8');
  const stderr = [];
  child.stderr.on('data', (chunk) => { stderr.push(chunk); });
  return { child, frames, stderr };
}

function send(child, frame) {
  child.stdin.write(`${JSON.stringify(frame)}\n`);
}

async function waitForFrame(frames, predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = frames.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for frame after ${timeoutMs}ms; got ${JSON.stringify(frames)}`);
}

test('bridge answers initialize natively without contacting the backend', async (t) => {
  const { child, frames } = spawnBridge({ CONSTRUCT_MEMORY_BRIDGE_URL: 'http://127.0.0.1:65535/' });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } });

  send(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const initFrame = await waitForFrame(frames, (f) => f.id === 1);

  assert.equal(initFrame.jsonrpc, '2.0');
  assert.equal(initFrame.result.protocolVersion, '2024-11-05');
  assert.equal(initFrame.result.serverInfo.name, 'construct-memory-bridge');
  assert.ok(initFrame.result.capabilities.tools);
  assert.ok(initFrame.result.capabilities.resources);

  send(child, { jsonrpc: '2.0', id: 2, method: 'ping' });
  const pingFrame = await waitForFrame(frames, (f) => f.id === 2);
  assert.deepEqual(pingFrame.result, {});
});

test('bridge forwards tools/list to the cm HTTP backend', async (t) => {
  let observedMethod = null;
  const { server, url } = await startMockBackend((body) => {
    observedMethod = body?.method;
    if (body?.method === 'tools/list') {
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [{ name: 'memory_search' }, { name: 'memory_recent' }] },
        },
      };
    }
    return { status: 200, body: { jsonrpc: '2.0', id: body?.id ?? 0, result: {} } };
  });
  t.after(() => new Promise((r) => server.close(r)));

  const { child, frames } = spawnBridge({ CONSTRUCT_MEMORY_BRIDGE_URL: url });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } });

  send(child, { jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} });
  const frame = await waitForFrame(frames, (f) => f.id === 10);

  assert.equal(observedMethod, 'tools/list');
  assert.equal(frame.error, undefined);
  assert.deepEqual(frame.result.tools.map((t) => t.name), ['memory_search', 'memory_recent']);
});

test('bridge returns JSON-RPC -32603 when the backend is unreachable, without crashing', async (t) => {
  const { child, frames } = spawnBridge({
    CONSTRUCT_MEMORY_BRIDGE_URL: 'http://127.0.0.1:1/',
    CONSTRUCT_MEMORY_BRIDGE_TIMEOUT_MS: '500',
  });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } });

  send(child, { jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} });
  const errorFrame = await waitForFrame(frames, (f) => f.id === 21);

  assert.equal(errorFrame.error.code, -32603);
  assert.match(errorFrame.error.message, /memory backend unreachable/);

  // Bridge must stay up: a follow-up initialize still resolves.
  send(child, { jsonrpc: '2.0', id: 22, method: 'initialize', params: {} });
  const initFrame = await waitForFrame(frames, (f) => f.id === 22);
  assert.equal(initFrame.result.protocolVersion, '2024-11-05');
});

test('bridge ignores notifications/initialized and never replies to it', async (t) => {
  const { child, frames } = spawnBridge({ CONSTRUCT_MEMORY_BRIDGE_URL: 'http://127.0.0.1:65535/' });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } });

  send(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
  // Follow with a request so timing is observable.
  send(child, { jsonrpc: '2.0', id: 30, method: 'ping' });
  const pingFrame = await waitForFrame(frames, (f) => f.id === 30);
  assert.deepEqual(pingFrame.result, {});

  const stray = frames.find((f) => f.method === 'notifications/initialized' || f.id === null);
  assert.equal(stray, undefined, 'bridge should not emit a frame in response to the notification');
});
