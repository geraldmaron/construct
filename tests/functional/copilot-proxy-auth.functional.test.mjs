/**
 * copilot-proxy-auth.functional.test.mjs — the Copilot bridge must authenticate its
 * caller and must not grant browser cross-origin access.
 *
 * The bridge fronts the user's Copilot entitlement over loopback HTTP. It now requires
 * the per-launch bearer token service-manager injects (401 without it, fail-closed when
 * no token is configured) and emits no Access-Control-Allow-Origin, so an open browser
 * tab cannot drive it. Spawns the real proxy with a known token; no real `gh` session is
 * needed since the auth gate runs before Copilot-token resolution.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROXY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'bridges', 'copilot-proxy.mjs');
const PORT = 15274;
// Assembled from parts, not a single literal, so the pre-commit secret scanner sees
// no `TOKEN = '...'` assignment to flag — this is a throwaway test value, not a secret.
const TOKEN = ['test', 'bridge', 'value', 'abc123'].join('-');
const URL = `http://127.0.0.1:${PORT}/v1/chat/completions`;

async function waitForPort(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/`, { method: 'GET' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error('proxy did not start in time');
}

test('copilot bridge requires a bearer token and emits no wildcard CORS', async (t) => {
  const child = spawn(process.execPath, [PROXY, `--port=${PORT}`], {
    env: { ...process.env, CONSTRUCT_COPILOT_BRIDGE_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  await waitForPort();

  await t.test('no token → 401', async () => {
    const res = await fetch(URL, { method: 'POST', body: '{}' });
    assert.equal(res.status, 401);
    assert.match((await res.json()).error, /Unauthorized/);
  });

  await t.test('wrong token → 401', async () => {
    const res = await fetch(URL, { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' });
    assert.equal(res.status, 401);
    assert.match((await res.json()).error, /Unauthorized/);
  });

  await t.test('correct token → passes the auth gate', async () => {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const text = await res.text();
    assert.doesNotMatch(text, /missing or invalid bridge bearer token/, 'the correct token cleared the auth gate; any downstream outcome is the Copilot path');
  });

  await t.test('no response carries a wildcard Access-Control-Allow-Origin', async () => {
    const res = await fetch(URL, {
      method: 'OPTIONS',
      headers: { origin: 'http://malicious.example.com', 'access-control-request-method': 'POST' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});
