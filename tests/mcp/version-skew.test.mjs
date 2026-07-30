/**
 * tests/mcp/version-skew.test.mjs — construct://status flips restartRequired on version skew.
 *
 * A long-running MCP server caches its version at module load; on a
 * dev-checkout-as-live-install topology the code on disk can change under it
 * with no signal. Drives the real server against an
 * isolated CONSTRUCT_TOOLKIT_DIR whose package.json is mutated mid-run, without
 * restarting the process, and asserts the status resource reports the
 * mismatch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'mcp', 'server.mjs');

function makeToolkitDir(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-version-skew-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'construct', version }, null, 2));
  return dir;
}

test('status resource flips restartRequired when package.json version changes under a running server', async () => {
  const toolkitDir = makeToolkitDir('9.9.9-a');
  const proc = spawn('node', [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CONSTRUCT_TOOLKIT_DIR: toolkitDir },
  });

  const byId = {};
  let out = '';
  proc.stdout.on('data', (d) => {
    out += d;
    for (const line of out.split('\n')) {
      try {
        const m = JSON.parse(line);
        if (m.id) byId[m.id] = m;
      } catch { /* partial line */ }
    }
  });

  const send = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n');
  const waitFor = async (id, timeoutMs = 4000) => {
    const start = Date.now();
    while (!byId[id]) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for response id ${id}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    return byId[id];
  };
  const readStatus = async (id) => {
    send({ jsonrpc: '2.0', id, method: 'resources/read', params: { uri: 'construct://status' } });
    const r = await waitFor(id);
    return JSON.parse(r.result.contents[0].text);
  };

  try {
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    });
    await waitFor(1);

    const before = await readStatus(2);
    assert.equal(before.startedVersion, '9.9.9-a');
    assert.equal(before.diskVersion, '9.9.9-a');
    assert.equal(before.restartRequired, false);

    fs.writeFileSync(path.join(toolkitDir, 'package.json'), JSON.stringify({ name: 'construct', version: '9.9.9-b' }, null, 2));

    const after = await readStatus(3);
    assert.equal(after.startedVersion, '9.9.9-a', 'running snapshot must not change without a restart');
    assert.equal(after.diskVersion, '9.9.9-b', 'current disk version must be re-read on status reads');
    assert.equal(after.restartRequired, true);
  } finally {
    proc.kill();
    rmTmpDir(toolkitDir);
  }
});

test('no behavior change when versions match (idempotent, no restartRequired)', async () => {
  const toolkitDir = makeToolkitDir('1.2.3');
  const proc = spawn('node', [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CONSTRUCT_TOOLKIT_DIR: toolkitDir },
  });

  const byId = {};
  let out = '';
  proc.stdout.on('data', (d) => {
    out += d;
    for (const line of out.split('\n')) {
      try {
        const m = JSON.parse(line);
        if (m.id) byId[m.id] = m;
      } catch { /* partial line */ }
    }
  });
  const send = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n');
  const waitFor = async (id, timeoutMs = 4000) => {
    const start = Date.now();
    while (!byId[id]) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for response id ${id}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    return byId[id];
  };

  try {
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    });
    await waitFor(1);
    send({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'construct://status' } });
    const r = await waitFor(2);
    const payload = JSON.parse(r.result.contents[0].text);
    assert.equal(payload.restartRequired, false);
    assert.equal(payload.startedVersion, payload.diskVersion);
  } finally {
    proc.kill();
    rmTmpDir(toolkitDir);
  }
});
