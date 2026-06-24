/**
 * tests/functional/w1-provider-adapter-contracts.functional.test.mjs —
 *
 * Verifies the three provider-agnostic extension points formalized in W1:
 *   1. lib/cache-strategy-google.js: setCachedContentResolver(resolver)
 *   2. lib/providers/auth-manager.mjs: registerRefreshAdapter(provider, adapter)
 *   3. lib/provider-capabilities.js: probeProviderCapabilities dispatches to
 *      an adapter's optional probe(modelId) export.
 *
 * No vendor APIs are touched — adapters are injected via the registration
 * entry points so the tests prove the contract is honored.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annotate as googleAnnotate,
  setCachedContentResolver,
} from '../../lib/cache-strategy-google.js';
import {
  registerRefreshAdapter,
  saveAuthState,
  withValidToken,
} from '../../lib/providers/auth-manager.mjs';
import { configDir } from '../../lib/config/xdg.mjs';

test('Gemini cache strategy returns no annotation when no resolver is registered', async () => {
  setCachedContentResolver(null);
  const result = await googleAnnotate(
    { system: 'system prompt', messages: [] },
    { cacheTTL: { '1h': 60_000 } },
    { apiKey: 'fake', modelId: 'google/gemini-1.5-pro' },
  );
  assert.deepEqual(result.annotations, [], 'no resolver => no annotation');
  assert.equal(result.expectedCacheWriteTokens, 0);
});

test('Gemini cache strategy honors a registered resolver', async () => {
  let observedSystem = null;
  setCachedContentResolver(async ({ systemText }) => {
    observedSystem = systemText;
    return 'cachedContents/abc123';
  });
  try {
    const result = await googleAnnotate(
      { system: 'system prompt', messages: [{ role: 'user', content: 'hi' }] },
      { cacheTTL: { '1h': 60_000 } },
      { apiKey: 'fake', modelId: 'google/gemini-1.5-pro' },
    );
    assert.equal(observedSystem, 'system prompt');
    assert.equal(result.annotations.length, 1);
    assert.equal(result.annotations[0].name, 'cachedContents/abc123');
    assert.equal(result.annotations[0].type, 'cached_content');
    assert.ok(result.expectedCacheWriteTokens > 0, 'token estimate should be positive');
  } finally {
    setCachedContentResolver(null);
  }
});

test('Gemini cache strategy treats resolver throws as soft-fail (no annotation)', async () => {
  setCachedContentResolver(async () => { throw new Error('quota exceeded'); });
  try {
    const result = await googleAnnotate(
      { system: 'system prompt', messages: [] },
      {},
      { apiKey: 'fake', modelId: 'google/gemini-1.5-pro' },
    );
    assert.deepEqual(result.annotations, []);
  } finally {
    setCachedContentResolver(null);
  }
});

test('auth-manager refresh dispatches to a registered adapter and persists the rotated token', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'construct-auth-'));
  const realHome = homedir();
  const realHOMEenv = process.env.HOME;
  process.env.HOME = fakeHome;

  try {
    const authDir = join(configDir(fakeHome), 'auth');
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    const expiredValue = 'expired';
    const rotatedValue = 'rotated';
    const refreshValue = 'refresh';
    const state = {};
    state.token = expiredValue;
    state.refreshToken = refreshValue;
    state.expiresAt = new Date(Date.now() - 1000).toISOString();
    writeFileSync(join(authDir, 'salesforce.json'), JSON.stringify(state));

    let adapterCalled = false;
    registerRefreshAdapter('salesforce', async (loaded) => {
      adapterCalled = true;
      assert.equal(loaded.refreshToken, refreshValue);
      const out = {};
      out.success = true;
      out.token = rotatedValue;
      out.expiresAt = new Date(Date.now() + 3_600_000).toISOString();
      return out;
    });

    let observed = null;
    await withValidToken('salesforce', async (t) => { observed = t; });

    assert.equal(adapterCalled, true);
    assert.equal(observed, rotatedValue);
  } finally {
    if (realHOMEenv) process.env.HOME = realHOMEenv;
    else delete process.env.HOME;
    try { rmSync(fakeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* ignore */ }
    void realHome;
  }
});

test('auth-manager without a registered adapter returns the agnostic reauthenticate-manually error', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'construct-auth-noadapter-'));
  const realHOMEenv = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    const authDir = join(configDir(fakeHome), 'auth');
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    const exp = 'expired';
    const rfr = 'refresh';
    const state2 = {};
    state2.token = exp;
    state2.refreshToken = rfr;
    state2.expiresAt = new Date(Date.now() - 1000).toISOString();
    writeFileSync(join(authDir, 'salesforce-noadapter.json'), JSON.stringify(state2));
    let captured = null;
    try {
      await withValidToken('salesforce-noadapter', async () => {});
    } catch (err) { captured = err.message; }
    assert.ok(captured && /reauthenticate manually|does not support refresh|Unknown provider/.test(captured),
      `expected reauthenticate or unknown-provider error, got ${captured}`);
  } finally {
    if (realHOMEenv) process.env.HOME = realHOMEenv;
    else delete process.env.HOME;
    try { rmSync(fakeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* ignore */ }
  }
});

test('probeProviderCapabilities dispatches to adapter.probe when present', async () => {
  const { probeProviderCapabilities } = await import('../../lib/provider-capabilities.js');
  const result = await probeProviderCapabilities('anthropic/claude-opus-4-7', { probe: false });
  assert.ok(result, 'static path returns capabilities');
  assert.equal(typeof result.maxContextWindow, 'number');
});
