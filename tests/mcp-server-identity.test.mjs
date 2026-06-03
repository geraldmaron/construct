/**
 * tests/mcp-server-identity.test.mjs — construct-mcp advertises meaningful identity.
 *
 * An MCP host renders a server from its initialize response: a host that gets only
 * a name and a hardcoded version shows "<name> · OK" with an empty detail panel
 * (construct-y... reported in-field). These pin that the server reports its real
 * version (a semver string, not the old "1.0.0" stub or the raw version object),
 * a non-empty instructions string, and a readable construct://status resource.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'mcp', 'server.mjs');

function drive(messages, { waitMs = 2500 } = {}) {
  return new Promise((res) => {
    const p = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    messages.forEach((m, i) => setTimeout(() => p.stdin.write(JSON.stringify(m) + '\n'), 300 + i * 400));
    setTimeout(() => {
      const byId = {};
      for (const line of out.split('\n')) { try { const m = JSON.parse(line); if (m.id) byId[m.id] = m; } catch { /* partial */ } }
      p.kill();
      res(byId);
    }, waitMs);
  });
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } };

test('initialize reports a real semver version and non-empty instructions', async () => {
  const r = (await drive([INIT]))[1]?.result;
  assert.ok(r, 'initialize returned a result');
  assert.match(r.serverInfo.version, /^\d+\.\d+\.\d+/, `version should be a semver string, got ${JSON.stringify(r.serverInfo.version)}`);
  assert.notEqual(r.serverInfo.version, '1.0.0', 'version must not be the hardcoded stub');
  assert.equal(typeof r.instructions, 'string');
  assert.ok(r.instructions.length > 40 && /Construct/.test(r.instructions), 'instructions describe the server');
  assert.ok(r.capabilities.resources, 'advertises a resources capability');
});

test('construct://status resource lists and reads as JSON with the version', async () => {
  const byId = await drive([
    INIT,
    { jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'construct://status' } },
  ], { waitMs: 3000 });
  const listed = byId[2]?.result?.resources || [];
  assert.ok(listed.some((x) => x.uri === 'construct://status'), 'construct://status is listed');
  const text = byId[3]?.result?.contents?.[0]?.text;
  assert.ok(text, 'resource read returned content');
  const payload = JSON.parse(text);
  assert.match(payload.version, /^\d+\.\d+\.\d+/);
  assert.ok(Array.isArray(payload.capabilities) && payload.capabilities.length > 0);
});
