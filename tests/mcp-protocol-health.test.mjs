/**
 * mcp-protocol-health.test.mjs — verify the doctor mcp-protocol watcher.
 *
 * Spins up two mock backends:
 *  - A "cm-like" HTTP server that returns 405 on GET and "Unsupported method"
 * for initialize — the exact failure mode behind.
 *  - A working stdio MCP server (the actual memory bridge).
 * Asserts that probeServer flags the broken endpoint and passes the bridge.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { probeServer } from '../lib/doctor/watchers/mcp-protocol.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BRIDGE = path.join(ROOT, 'lib', 'mcp', 'memory-bridge.mjs');

function startCmLikeServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { parsed = null; }
        if (parsed?.method === 'initialize' || parsed?.method === 'ping' || parsed?.method === 'notifications/initialized') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: parsed?.id ?? null,
            error: { code: -32601, message: `Unsupported method: ${parsed?.method}` },
          }));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed?.id ?? null, result: {} }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

test('mcp-protocol watcher flags an HTTP server that rejects initialize', async (t) => {
  const { server, url } = await startCmLikeServer();
  t.after(() => new Promise((r) => server.close(r)));

  const result = await probeServer({
    host: 'opencode',
    id: 'memory',
    entry: { type: 'remote', url },
  });

  assert.equal(result.ok, false);
  assert.equal(result.transport, 'http');
  assert.match(result.reason, /Unsupported method|initialize/i);
});

function startGoodBackend() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { parsed = null; }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        if (parsed?.method === 'tools/list') {
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: { tools: [{ name: 'memory_search' }] },
          }));
          return;
        }
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed?.id ?? null, result: {} }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

test('mcp-protocol watcher passes a working stdio MCP server (the memory bridge)', async (t) => {
  const { server, url } = await startGoodBackend();
  t.after(() => new Promise((r) => server.close(r)));

  const result = await probeServer({
    host: 'opencode',
    id: 'memory',
    entry: {
      type: 'local',
      command: ['node', BRIDGE],
      environment: { CONSTRUCT_MEMORY_BRIDGE_URL: url },
    },
  });

  assert.equal(result.ok, true, `expected ok, got: ${JSON.stringify(result)}`);
  assert.equal(result.transport, 'stdio');
  assert.equal(result.protocolVersion, '2024-11-05');
  assert.equal(result.toolCount, 1);
});

test('mcp-protocol watcher reports stdio handshake failure when forwarded tools/list errors out', async (t) => {
  // The bridge above will reach a dead backend on port 65535 and return -32603
  // when tools/list is forwarded. Re-run the probe to exercise that path.
  const result = await probeServer({
    host: 'opencode',
    id: 'memory',
    entry: {
      type: 'local',
      command: ['node', BRIDGE],
      environment: {
        CONSTRUCT_MEMORY_BRIDGE_URL: 'http://127.0.0.1:1/',
        CONSTRUCT_MEMORY_BRIDGE_TIMEOUT_MS: '500',
      },
    },
  });

  // initialize still passes (handled natively), but tools/list forwards and
  // surfaces a -32603 error. The watcher reports the failure path.
  assert.equal(result.transport, 'stdio');
  assert.equal(result.ok, false);
  assert.match(result.reason, /tools\/list|memory backend unreachable/);
});
