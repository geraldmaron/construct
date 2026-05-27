/**
 * lib/doctor/watchers/mcp-protocol.mjs — MCP handshake health probe.
 *
 * Sweeps every MCP server configured in the active editor configs (Claude
 * Code, OpenCode) and performs a real MCP handshake against each: send
 * `initialize`, parse the response, send `tools/list`, report tool count.
 * cass-memory v0.2.x (the original cause of construct-1qt) rejects the
 * handshake outright; this watcher flags servers that fail the handshake so
 * the dashboard surfaces a protocol problem rather than a port-up false
 * positive.
 *
 * Severity defaults to warning. Set `CONSTRUCT_MCP_PROTOCOL_BLOCKING=1` to
 * escalate via `service.down` when a configured server fails the handshake.
 *
 * Tick: 10 min. Cheap — most checks are skipped when no editor configs exist.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { record } from '../audit.mjs';
import { escalate } from '../escalate.mjs';

export const name = 'mcp-protocol';
export const intervalMs = 10 * 60 * 1000;

const PROBE_TIMEOUT_MS = 5000;
const HANDSHAKE_REQUEST_ID = 1;

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

export function collectMcpServers({ home = homedir() } = {}) {
  const servers = [];
  const claudePath = join(home, '.claude', 'settings.json');
  if (existsSync(claudePath)) {
    const cfg = readJson(claudePath);
    for (const [id, entry] of Object.entries(cfg?.mcpServers ?? {})) {
      servers.push({ host: 'claude', id, entry });
    }
  }
  const opencodePath = join(home, '.config', 'opencode', 'opencode.json');
  if (existsSync(opencodePath)) {
    const cfg = readJson(opencodePath);
    for (const [id, entry] of Object.entries(cfg?.mcp ?? {})) {
      servers.push({ host: 'opencode', id, entry });
    }
  }
  return servers;
}

function classifyEntry(entry) {
  if (!entry || typeof entry !== 'object') return { transport: 'unknown' };
  if (entry.type === 'http' || entry.type === 'remote') {
    return { transport: 'http', url: entry.url, headers: entry.headers ?? {} };
  }
  if (entry.type === 'local') {
    const cmd = Array.isArray(entry.command) ? entry.command : [];
    return { transport: 'stdio', command: cmd[0], args: cmd.slice(1), env: entry.environment ?? {} };
  }
  if (entry.command) {
    return { transport: 'stdio', command: entry.command, args: entry.args ?? [], env: entry.env ?? {} };
  }
  return { transport: 'unknown' };
}

async function probeHttp({ url, headers }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const body = {
      jsonrpc: '2.0',
      id: HANDSHAKE_REQUEST_ID,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'construct-doctor', version: '1' } },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status} on initialize` };
    }
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      return { ok: false, reason: 'initialize response was not JSON' };
    }
    if (parsed?.error) {
      return { ok: false, reason: `initialize returned error: ${parsed.error.message ?? parsed.error.code}` };
    }
    if (/Unsupported method/i.test(text)) {
      return { ok: false, reason: 'backend rejects initialize (Unsupported method)' };
    }
    return { ok: true, protocolVersion: parsed?.result?.protocolVersion };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err));
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

function spawnStdioServer({ command, args, env }) {
  const child = spawn(command, args ?? [], {
    env: { ...process.env, ...(env ?? {}) },
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
      try { frames.push(JSON.parse(raw)); } catch { /* skip junk */ }
    }
  });
  child.stderr.on('data', () => { /* swallow */ });
  return { child, frames };
}

async function waitFor(frames, predicate, deadline) {
  while (Date.now() < deadline) {
    const hit = frames.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

async function probeStdio(spec) {
  if (!spec.command) return { ok: false, reason: 'stdio entry missing command' };
  let session;
  try {
    session = spawnStdioServer(spec);
  } catch (err) {
    return { ok: false, reason: `spawn failed: ${err?.message || err}` };
  }
  const { child, frames } = session;
  const deadline = Date.now() + PROBE_TIMEOUT_MS;

  try {
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: HANDSHAKE_REQUEST_ID,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'construct-doctor', version: '1' } },
    }) + '\n');

    const initFrame = await waitFor(frames, (f) => f.id === HANDSHAKE_REQUEST_ID, deadline);
    if (!initFrame) return { ok: false, reason: 'no initialize response within timeout' };
    if (initFrame.error) return { ok: false, reason: `initialize error: ${initFrame.error.message ?? initFrame.error.code}` };

    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');

    const toolsFrame = await waitFor(frames, (f) => f.id === 2, deadline);
    if (!toolsFrame) return { ok: false, reason: 'no tools/list response within timeout' };
    if (toolsFrame.error) return { ok: false, reason: `tools/list error: ${toolsFrame.error.message ?? toolsFrame.error.code}` };

    const tools = toolsFrame.result?.tools ?? [];
    return {
      ok: true,
      protocolVersion: initFrame.result?.protocolVersion,
      toolCount: Array.isArray(tools) ? tools.length : 0,
    };
  } finally {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
}

export async function probeServer({ host, id, entry }) {
  const spec = classifyEntry(entry);
  if (spec.transport === 'unknown') return { host, id, transport: 'unknown', ok: false, reason: 'unrecognized entry shape' };
  const result = spec.transport === 'http' ? await probeHttp(spec) : await probeStdio(spec);
  return { host, id, transport: spec.transport, ...result };
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const samples = [];

  const servers = collectMcpServers();
  for (const server of servers) {
    const result = await probeServer(server);
    samples.push(result);

    if (result.ok) {
      record({
        kind: 'sample',
        watcher: name,
        target: `${result.host}/${result.id}`,
        result: 'ok',
        summary: `${result.host}/${result.id} MCP handshake ok (transport=${result.transport})`,
        context: { protocolVersion: result.protocolVersion, toolCount: result.toolCount },
      });
      continue;
    }

    record({
      kind: 'sample',
      watcher: name,
      target: `${result.host}/${result.id}`,
      result: 'warn',
      summary: `${result.host}/${result.id} MCP handshake failed: ${result.reason}`,
      context: { transport: result.transport, reason: result.reason },
    });
    actions.push({ type: 'protocol-warning', target: `${result.host}/${result.id}`, reason: result.reason });

    if (process.env.CONSTRUCT_MCP_PROTOCOL_BLOCKING === '1') {
      const r = await escalate({
        watcher: name,
        eventType: 'service.down',
        summary: `MCP handshake failed for ${result.host}/${result.id}: ${result.reason}`,
        context: { host: result.host, id: result.id, transport: result.transport, reason: result.reason },
      });
      escalations.push({ eventType: 'service.down', target: `${result.host}/${result.id}`, result: r });
    }
  }

  return { actions, escalations, notes: samples };
}
