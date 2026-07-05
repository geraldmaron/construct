/**
 * tests/functional/secret-resolver.functional.test.mjs — the shared LLM secret
 * resolver (lib/providers/secret-resolver.mjs) and op-aware provider detection.
 *
 * Exercises the real resolver against an isolated HOME: a 1Password op:// ref in
 * config.env resolves through an injected `op read` (no live CLI), the plaintext
 * is cached per reference, plain values pass through, and hasSecret reports
 * presence without ever invoking the CLI. Also asserts that lib/model-router.mjs
 * marks a provider configured when only an op:// reference is present, which is
 * the regression that left Anthropic/OpenAI/OpenRouter reading as unconfigured.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveSecret,
  hasSecret,
  extractOpRef,
  __clearSecretCache,
} from '../../lib/providers/secret-resolver.mjs';
import { configDir } from '../../lib/config/xdg.mjs';

function withTmpHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-secret-'));
  const original = process.env.HOME;
  process.env.HOME = home;
  __clearSecretCache();
  try {
    return fn(home);
  } finally {
    process.env.HOME = original;
    __clearSecretCache();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function writeConfigEnv(home, body) {
  fs.mkdirSync(configDir(home), { recursive: true });
  fs.writeFileSync(path.join(configDir(home), 'config.env'), body);
}

test('extractOpRef recognizes bare and command-substitution forms', () => {
  assert.equal(extractOpRef('op://Dev/Anthropic/credential'), 'op://Dev/Anthropic/credential');
  assert.equal(extractOpRef("$(op read 'op://Dev/OpenAI/api_key')"), 'op://Dev/OpenAI/api_key');
  assert.equal(extractOpRef('sk-plain-1234'), null);
  assert.equal(extractOpRef(''), null);
});

test('resolves an op:// ref from config.env and caches the plaintext', () => {
  withTmpHome((home) => {
    writeConfigEnv(home, 'ANTHROPIC_API_KEY=op://Dev/Anthropic/credential\n');
    const calls = [];
    const opRead = (ref) => { calls.push(ref); return 'sk-resolved'; };
    const first = resolveSecret('ANTHROPIC_API_KEY', { env: {}, cwd: home, opRead });
    const second = resolveSecret('ANTHROPIC_API_KEY', { env: {}, cwd: home, opRead });
    assert.equal(first, 'sk-resolved');
    assert.equal(second, 'sk-resolved');
    assert.deepEqual(calls, ['op://Dev/Anthropic/credential']);
  });
});

test('plain env value passes through without invoking op', () => {
  // Read-hermeticity: cwd must be pinned to an isolated tmpdir, not the
  // default process.cwd(). Without it this resolves the real repo/.env's
  // OPENROUTER_API_KEY (project-env tier) instead of the plain value under
  // test — the exact class of leak construct-neq9.4 guards against.
  withTmpHome((home) => {
    const opRead = () => { throw new Error('op should not be called for a plain value'); };
    assert.equal(resolveSecret('OPENROUTER_API_KEY', { env: { OPENROUTER_API_KEY: 'plain-key' }, cwd: home, opRead }), 'plain-key');
  });
});

test('allowAmbient:false suppresses file discovery for hermetic callers', () => {
  withTmpHome((home) => {
    writeConfigEnv(home, 'OPENAI_API_KEY=op://Dev/OpenAI/key\n');
    const opRead = () => 'should-not-resolve';
    assert.equal(resolveSecret('OPENAI_API_KEY', { env: {}, cwd: home, allowAmbient: false, opRead }), null);
  });
});

test('hasSecret detects an op:// ref without running op read', () => {
  withTmpHome((home) => {
    writeConfigEnv(home, 'OPENAI_API_KEY=op://Dev/OpenAI/key\n');
    assert.equal(hasSecret('OPENAI_API_KEY', { env: {}, cwd: home }), true);
    assert.equal(hasSecret('NOT_SET_ANYWHERE', { env: {}, cwd: home }), false);
  });
});

test('model-router marks a provider configured from an op:// reference', async () => {
  const { getProviderModelCatalog } = await import('../../lib/model-router.mjs');
  const { providers } = getProviderModelCatalog({ env: { ANTHROPIC_API_KEY: 'op://Dev/Anthropic/credential' } });
  const anthropic = providers.find((p) => p.id === 'anthropic');
  assert.equal(anthropic.configured, true);
});
