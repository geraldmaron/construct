/**
 * tests/functional/copilot-auth.functional.test.mjs — the GitHub Copilot OAuth
 * device flow + token exchange (lib/providers/copilot-auth.mjs) and the worker's
 * Copilot execution path.
 *
 * Drives the real flow against an isolated HOME with an injected fetch and clock:
 * device-code request, polling through authorization_pending to an access token,
 * persistence to both Construct's store and the shared ~/.config/github-copilot
 * store, exchange for a short-lived session token with in-process caching, and
 * refresh of an expired access token from the refresh token. Also asserts the
 * orchestration worker routes a github-copilot/* model through the session token
 * rather than an API key. No live account, gh CLI, or network is involved.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir } from '../../lib/config/xdg.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function withTmpHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-copilot-'));
  const original = process.env.HOME;
  process.env.HOME = home;
  return Promise.resolve(fn(home)).finally(() => {
    process.env.HOME = original;
    rmTmpDir(home);
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('device flow: request code, poll through pending, capture tokens', async () => {
  const mod = await import('../../lib/providers/copilot-auth.mjs');
  mod.__resetCopilotCache();
  let polls = 0;
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/login/device/code')) {
      return jsonResponse({ device_code: 'DEV', user_code: 'WXYZ-7890', verification_uri: 'https://github.com/login/device', interval: 0, expires_in: 900 });
    }
    if (u.includes('/login/oauth/access_token')) {
      polls += 1;
      if (polls < 2) return jsonResponse({ error: 'authorization_pending' });
      return jsonResponse({ access_token: 'ghu_ACCESS', refresh_token: 'ghr_REFRESH', expires_in: 28800 });
    }
    return jsonResponse({}, 404);
  };
  const device = await mod.requestDeviceCode({ fetchImpl });
  assert.equal(device.userCode, 'WXYZ-7890');
  const tokens = await mod.pollForAccessToken({ deviceCode: device.deviceCode, interval: 0, expiresIn: 900, fetchImpl });
  assert.equal(tokens.accessToken, 'ghu_ACCESS');
  assert.equal(tokens.refreshToken, 'ghr_REFRESH');
});

test('persist writes both stores and getCopilotToken exchanges + caches', async () => {
  await withTmpHome(async (home) => {
    const mod = await import('../../lib/providers/copilot-auth.mjs');
    mod.__resetCopilotCache();
    let exchanges = 0;
    const fetchImpl = async (url) => {
      if (String(url).includes('copilot_internal/v2/token')) {
        exchanges += 1;
        return jsonResponse({ token: 'tid=SESSION', expires_at: Math.floor(Date.now() / 1000) + 1500 });
      }
      return jsonResponse({}, 404);
    };
    mod.persistOAuth({ accessToken: 'ghu_ACCESS', refreshToken: 'ghr_REFRESH', expiresAt: null, user: 'tester' });

    assert.ok(fs.existsSync(path.join(configDir(home), 'auth', 'github-copilot.json')));
    assert.ok(fs.existsSync(path.join(home, '.config', 'github-copilot', 'apps.json')));
    assert.equal(mod.hasStoredCredential(), true);

    const t1 = await mod.getCopilotToken({ fetchImpl });
    const t2 = await mod.getCopilotToken({ fetchImpl });
    assert.equal(t1, 'tid=SESSION');
    assert.equal(t2, 'tid=SESSION');
    assert.equal(exchanges, 1);
  });
});

test('refreshes an expired access token before exchange', async () => {
  await withTmpHome(async (home) => {
    const mod = await import('../../lib/providers/copilot-auth.mjs');
    mod.__resetCopilotCache();
    fs.mkdirSync(path.join(configDir(home), 'auth'), { recursive: true });
    fs.writeFileSync(path.join(configDir(home), 'auth', 'github-copilot.json'), JSON.stringify({
      oauth_token: 'ghu_OLD',
      refresh_token: 'ghr_REFRESH',
      oauth_expires_at: 1,
    }));
    let refreshed = false;
    let exchangedWith = null;
    const fetchImpl = async (url, init) => {
      const u = String(url);
      if (u.includes('/login/oauth/access_token')) {
        refreshed = true;
        return jsonResponse({ access_token: 'ghu_NEW', refresh_token: 'ghr_REFRESH2', expires_in: 28800 });
      }
      if (u.includes('copilot_internal/v2/token')) {
        exchangedWith = init.headers.Authorization;
        return jsonResponse({ token: 'tid=NEW', expires_at: Math.floor(Date.now() / 1000) + 1500 });
      }
      return jsonResponse({}, 404);
    };
    const token = await mod.getCopilotToken({ fetchImpl });
    assert.equal(token, 'tid=NEW');
    assert.equal(refreshed, true);
    assert.equal(exchangedWith, 'Bearer ghu_NEW');
  });
});

test('getCopilotToken without a stored credential gives an actionable error', async () => {
  await withTmpHome(async () => {
    const mod = await import('../../lib/providers/copilot-auth.mjs');
    mod.__resetCopilotCache();
    await assert.rejects(() => mod.getCopilotToken({ fetchImpl: async () => jsonResponse({}, 404) }), /construct creds login copilot/);
  });
});

test('normalizeToken strips whitespace from stored oauth before exchange', async () => {
  await withTmpHome(async (home) => {
    const mod = await import('../../lib/providers/copilot-auth.mjs');
    mod.__resetCopilotCache();
    fs.mkdirSync(path.join(configDir(home), 'auth'), { recursive: true });
    fs.writeFileSync(path.join(configDir(home), 'auth', 'github-copilot.json'), JSON.stringify({ oauth_token: 'ghu_TEST\n' }));
    let authHeader = null;
    const fetchImpl = async (url, init) => {
      if (String(url).includes('copilot_internal/v2/token')) {
        authHeader = init?.headers?.Authorization;
        return jsonResponse({ token: 'tid=SESSION', expires_at: Math.floor(Date.now() / 1000) + 1500 });
      }
      return jsonResponse({}, 404);
    };
    const token = await mod.getCopilotToken({ fetchImpl });
    assert.equal(token, 'tid=SESSION');
    assert.equal(authHeader, 'Bearer ghu_TEST');
  });
});

test('worker routes a github-copilot model through the session token', async () => {
  await withTmpHome(async (home) => {
    const copilot = await import('../../lib/providers/copilot-auth.mjs');
    copilot.__resetCopilotCache();
    fs.mkdirSync(path.join(configDir(home), 'auth'), { recursive: true });
    fs.writeFileSync(path.join(configDir(home), 'auth', 'github-copilot.json'), JSON.stringify({ oauth_token: 'ghu_ACCESS' }));
    const { runTaskViaProvider } = await import('../../lib/orchestration/worker.mjs');
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('copilot_internal/v2/token')) return jsonResponse({ token: 'tid=S', expires_at: Math.floor(Date.now() / 1000) + 1500 });
      if (u.includes('api.githubcopilot.com/chat/completions')) return jsonResponse({ choices: [{ message: { content: 'copilot output' } }] });
      return jsonResponse({}, 404);
    };
    const result = await runTaskViaProvider({ task: { role: 'engineer' }, run: { request: { summary: 'do a thing' } }, model: 'github-copilot/gpt-4o', env: {}, fetchImpl });
    assert.equal(result.provider, 'github-copilot');
    assert.equal(result.output, 'copilot output');
  });
});
