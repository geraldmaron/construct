/**
 * lib/mcp/stdio-mcp-probe.mjs — newline-delimited JSON-RPC probe for stdio MCP servers.
 *
 * Spawns a child MCP process, completes initialize + notifications/initialized, then
 * issues tools/list to capture serialized tool schemas for token-budget fixtures.
 * Stdout is the only protocol channel; stderr is ignored.
 */

import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 25_000;

function parseFrames(chunk, state) {
  state.buffer += chunk;
  let idx;
  while ((idx = state.buffer.indexOf('\n')) >= 0) {
    const raw = state.buffer.slice(0, idx).trim();
    state.buffer = state.buffer.slice(idx + 1);
    if (!raw) continue;
    try {
      state.frames.push(JSON.parse(raw));
    } catch {
      /* non-JSON noise */
    }
  }
}

function send(child, frame) {
  child.stdin.write(`${JSON.stringify(frame)}\n`);
}

function waitForFrame(frames, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const hit = frames.find(predicate);
      if (hit) {
        resolve(hit);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out after ${timeoutMs}ms; frames=${frames.length}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

// Probe a stdio MCP server and return the tools/list result array.

export async function probeStdioMcpTools(command, args, {
  env = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { buffer: '', frames: [] };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => parseFrames(chunk, state));

  const cleanup = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already exited */
    }
  };

  try {
    send(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'construct-mcp-probe', version: '1' },
      },
    });
    await waitForFrame(state.frames, (f) => f.id === 1, timeoutMs);
    send(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
    send(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listFrame = await waitForFrame(state.frames, (f) => f.id === 2, timeoutMs);
    if (listFrame.error) {
      throw new Error(listFrame.error.message || JSON.stringify(listFrame.error));
    }
    return listFrame.result?.tools || [];
  } finally {
    cleanup();
  }
}

// Parse JSON or MCP-over-SSE (event: message / data: {...}) bodies from HTTP MCP hosts.

function parseMcpHttpFrame(text) {
  try {
    return JSON.parse(text);
  } catch {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        return JSON.parse(payload);
      } catch {
        /* try next data line */
      }
    }
    throw new Error('response was not JSON or SSE data');
  }
}

// Probe an HTTP MCP endpoint (GitHub Copilot MCP) with bearer auth.

export async function probeHttpMcpTools(url, headers = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const initBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'construct-mcp-probe', version: '1' },
    },
  };
  const listBody = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
  const commonHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...headers,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  async function postRpc(body, extraHeaders = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...commonHeaders, ...extraHeaders },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    return { res, text };
  }

  try {
    const { res: initRes, text: initText } = await postRpc(initBody);
    if (!initRes.ok) {
      throw new Error(`initialize HTTP ${initRes.status}: ${initText.slice(0, 160)}`);
    }
    parseMcpHttpFrame(initText);

    const sessionId = initRes.headers.get('mcp-session-id')
      || initRes.headers.get('Mcp-Session-Id')
      || null;
    const sessionHeaders = sessionId ? { 'mcp-session-id': sessionId } : {};

    const { res: listRes, text: listText } = await postRpc(listBody, sessionHeaders);
    if (!listRes.ok) {
      throw new Error(`tools/list HTTP ${listRes.status}: ${listText.slice(0, 160)}`);
    }
    const frame = parseMcpHttpFrame(listText);
    if (frame.error) {
      throw new Error(frame.error.message || JSON.stringify(frame.error));
    }
    return frame.result?.tools || [];
  } finally {
    clearTimeout(timer);
  }
}

// Probe the Construct memory stdio bridge, which forwards tools/list to cm.

export async function probeMemoryBridgeTools({
  bridgePath,
  backendUrl = 'http://127.0.0.1:8765/',
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return probeStdioMcpTools(process.execPath, [bridgePath], {
    env: { CONSTRUCT_MEMORY_BRIDGE_URL: backendUrl },
    timeoutMs,
  });
}
