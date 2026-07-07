#!/usr/bin/env node
/**
 * lib/mcp/memory-bridge.mjs — stdio MCP bridge for cass-memory (cm).
 *
 * Editor MCP clients (OpenCode, Claude Code) expect a host to satisfy the MCP
 * HTTP+SSE handshake — GET with `Accept: text/event-stream`, POST `initialize`,
 * `notifications/initialized`, `ping`. cass-memory v0.2.x ships an HTTP server
 * that answers `tools/list`, `tools/call`, `resources/list`, `resources/read`
 * over POST but rejects the handshake calls (405 on GET, "Unsupported method"
 * on POST initialize/ping). That single gap surfaces in editors as
 * "memory SSE error: Non-200 status code (405)" and the memory tools never
 * register.
 *
 * Sits between editor and cm. Speaks the canonical 2026 MCP stdio transport
 * (newline-delimited JSON-RPC on stdin/stdout, logs on stderr), answers the
 * handshake natively, and forwards real work (tools/resources) to cm over its
 * existing HTTP API. Stays up across cm restarts; surfaces backend outages as
 * JSON-RPC `-32603` errors rather than crashing, so the editor can retry
 * without losing the channel.
 *
 * Env:
 *   CONSTRUCT_MEMORY_BRIDGE_URL       cm base URL (default http://127.0.0.1:8765/)
 *   CONSTRUCT_MEMORY_BRIDGE_AUTOSTART set to 1 to spawn `cm serve` if unreachable
 *   CONSTRUCT_MEMORY_BRIDGE_TIMEOUT_MS   per-request timeout (default 5000)
 *
 * Stdout is reserved for protocol frames. All diagnostic output goes to stderr.
 */

import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../roots.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'construct-memory-bridge';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readPackageVersion() {
  try {
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const SERVER_VERSION = readPackageVersion();

function normalizeBackendUrl(raw) {
  const value = (raw && String(raw).trim()) || 'http://127.0.0.1:8765/';
  return value.endsWith('/') ? value : `${value}/`;
}

const BACKEND_URL = normalizeBackendUrl(process.env.CONSTRUCT_MEMORY_BRIDGE_URL);
const REQUEST_TIMEOUT_MS = (() => {
  const raw = Number(process.env.CONSTRUCT_MEMORY_BRIDGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
})();
const AUTOSTART = process.env.CONSTRUCT_MEMORY_BRIDGE_AUTOSTART === '1';

const FORWARDED_METHODS = new Set([
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
]);

function log(...parts) {
  process.stderr.write(`[memory-bridge] ${parts.join(' ')}\n`);
}

function writeFrame(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: '2.0', id, error: err };
}

// cm forwarding uses fetch with an AbortController so a stuck backend never
// strands the editor. Failed call returns a JSON-RPC -32603 error frame, not a
// thrown exception, so the bridge process stays available for retries.

async function forwardToBackend(method, params, id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const body = { jsonrpc: '2.0', id: id ?? 0, method, params: params ?? {} };
    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return jsonRpcError(
        id,
        -32603,
        `memory backend returned HTTP ${res.status} for ${method}`,
        { backend: BACKEND_URL, status: res.status },
      );
    }
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return jsonRpcError(id, -32603, `memory backend returned non-JSON for ${method}`, { backend: BACKEND_URL });
    }
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'error')) {
      return { jsonrpc: '2.0', id, error: parsed.error };
    }
    return jsonRpcResult(id, parsed && parsed.result !== undefined ? parsed.result : parsed);
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err));
    return jsonRpcError(id, -32603, `memory backend unreachable at ${BACKEND_URL} (${reason})`, { backend: BACKEND_URL });
  } finally {
    clearTimeout(timer);
  }
}

// Autostart only fires when CONSTRUCT_MEMORY_BRIDGE_AUTOSTART=1. Detached
// spawn keeps cm alive after the editor disconnects.

let autostartAttempted = false;

function maybeAutostartCm() {
  if (!AUTOSTART || autostartAttempted) return;
  autostartAttempted = true;
  try {
    const port = (() => {
      try {
        const u = new URL(BACKEND_URL);
        return u.port || '8765';
      } catch {
        return '8765';
      }
    })();
    const child = spawn('cm', ['serve', '--port', String(port)], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    log(`autostart: spawned cm serve --port ${port}`);
  } catch (err) {
    log(`autostart failed: ${err?.message || err}`);
  }
}

// Handshake methods resolve natively. cm cannot answer them; forwarding would
// return the same "Unsupported method" surface that triggered this bug.

function handleInitialize(id) {
  return jsonRpcResult(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
  });
}

function handlePing(id) {
  return jsonRpcResult(id, {});
}

async function handleShutdown(id) {
  try { process.stderr.write(''); } catch { /* stderr already closed */ }
  if (id !== undefined && id !== null) writeFrame(jsonRpcResult(id, null));
  setImmediate(() => process.exit(0));
}

async function dispatch(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.jsonrpc !== '2.0') return null;

  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null;
  }
  if (method === 'initialize') return handleInitialize(id);
  if (method === 'ping') return handlePing(id);
  if (method === 'shutdown') return handleShutdown(id);

  if (FORWARDED_METHODS.has(method)) {
    maybeAutostartCm();
    return forwardToBackend(method, params, id);
  }

  if (isNotification) return null;
  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

async function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (err) {
    writeFrame(jsonRpcError(null, -32700, `Parse error: ${err?.message || err}`));
    return;
  }
  try {
    const response = await dispatch(message);
    if (response) writeFrame(response);
  } catch (err) {
    if (message && message.id !== undefined && message.id !== null) {
      writeFrame(jsonRpcError(message.id, -32603, `Internal bridge error: ${err?.message || err}`));
    } else {
      log(`unhandled error on notification: ${err?.message || err}`);
    }
  }
}

export function startBridge({ input = process.stdin, output = process.stdout } = {}) {
  if (output !== process.stdout) {
    const writer = (frame) => output.write(`${JSON.stringify(frame)}\n`);
    return runLoop(input, writer);
  }
  return runLoop(input, (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`));
}

function runLoop(input, writer) {
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (err) {
      writer(jsonRpcError(null, -32700, `Parse error: ${err?.message || err}`));
      return;
    }
    try {
      const response = await dispatch(message);
      if (response) writer(response);
    } catch (err) {
      if (message && message.id !== undefined && message.id !== null) {
        writer(jsonRpcError(message.id, -32603, `Internal bridge error: ${err?.message || err}`));
      } else {
        log(`unhandled error on notification: ${err?.message || err}`);
      }
    }
  });
  rl.on('close', () => process.exit(0));
  return rl;
}

const isMain = (() => {
  try { return isMainModule(import.meta.url); } catch { return false; }
})();

if (isMain) {
  log(`starting (backend=${BACKEND_URL}, autostart=${AUTOSTART ? 'on' : 'off'})`);
  startBridge();
}

export const _testing = {
  dispatch,
  handleLine,
  BACKEND_URL,
  SERVER_VERSION,
};
