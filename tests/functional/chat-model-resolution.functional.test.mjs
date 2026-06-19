/**
 * tests/functional/chat-model-resolution.functional.test.mjs — validated chat
 * model resolution when CX_MODEL pins or explicit picks target providers missing
 * credentials or model ids outside the shipped allowlist.
 *
 * Exercises resolveValidatedChatModel and isChatModelAvailable from the real
 * router with an isolated HOME and injected env — no network, no live Copilot
 * credential bleed. Asserts stale Copilot pins fall through to the next
 * configured provider and that op://-backed keys count as configured.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isChatModelAvailable,
  resolveValidatedChatModel,
} from '../../lib/model-router.mjs';

function withIsolatedHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-model-res-'));
  const prior = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn(home);
  } finally {
    process.env.HOME = prior;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('isChatModelAvailable rejects unconfigured provider', () => {
  withIsolatedHome(() => {
    const check = isChatModelAvailable('github-copilot/gpt-5.4', { env: {} });
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'provider_not_configured');
  });
});

test('isChatModelAvailable accepts op://-backed anthropic key', () => {
  withIsolatedHome(() => {
    const env = { ANTHROPIC_API_KEY: 'op://Dev/Anthropic/credential' };
    const check = isChatModelAvailable('anthropic/claude-sonnet-4-6', { env });
    assert.equal(check.ok, true);
  });
});

test('isChatModelAvailable rejects stale copilot model id when copilot is configured', () => {
  withIsolatedHome((home) => {
    fs.mkdirSync(path.join(home, '.construct', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(home, '.construct', 'auth', 'github-copilot.json'), JSON.stringify({ oauth_token: 'ghu_X' }));
    const check = isChatModelAvailable('github-copilot/gpt-5.1', { env: {} });
    assert.equal(check.ok, false);
    assert.equal(check.reason, 'model_not_available');
  });
});

test('resolveValidatedChatModel falls through stale CX_MODEL pin to configured anthropic', () => {
  withIsolatedHome(() => {
    const env = {
      CX_MODEL_STANDARD: 'github-copilot/gpt-5.1',
      ANTHROPIC_API_KEY: 'sk-test-anthropic',
    };
    const result = resolveValidatedChatModel({ env });
    assert.equal(result.id, 'anthropic/claude-sonnet-4-6');
    assert.match(result.notice, /gpt-5\.1/);
    assert.match(result.notice, /anthropic\/claude-sonnet-4-6/);
  });
});

test('resolveValidatedChatModel honors valid pin when provider is configured', () => {
  withIsolatedHome(() => {
    const env = {
      CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
      ANTHROPIC_API_KEY: 'sk-test',
    };
    const result = resolveValidatedChatModel({ env });
    assert.equal(result.id, 'anthropic/claude-sonnet-4-6');
    assert.equal(result.source, 'pin');
    assert.equal(result.notice, null);
  });
});

test('explicit --model request falls through when unavailable', () => {
  withIsolatedHome(() => {
    const env = { ANTHROPIC_API_KEY: 'sk-test' };
    const result = resolveValidatedChatModel({
      env,
      requested: 'github-copilot/gpt-5.4',
    });
    assert.equal(result.id, 'anthropic/claude-sonnet-4-6');
    assert.match(result.notice, /github-copilot/);
  });
});

test('isChatModelAvailable accepts openrouter/openrouter/free when key is configured', () => {
  withIsolatedHome(() => {
    const env = { OPENROUTER_API_KEY: 'sk-or-test' };
    const check = isChatModelAvailable('openrouter/openrouter/free', { env });
    assert.equal(check.ok, true);
    assert.equal(check.provider, 'openrouter');
  });
});

test('isChatModelAvailable accepts generic openrouter vendor slugs', () => {
  withIsolatedHome(() => {
    const env = { OPENROUTER_API_KEY: 'sk-or-test' };
    const check = isChatModelAvailable('openrouter/mistralai/mistral-small:free', { env });
    assert.equal(check.ok, true);
    assert.equal(check.provider, 'openrouter');
  });
});

test('resolveValidatedChatModel honors pinned openrouter/openrouter/free', () => {
  withIsolatedHome(() => {
    const env = {
      OPENROUTER_API_KEY: 'sk-or-test',
      ANTHROPIC_API_KEY: 'sk-test',
    };
    const result = resolveValidatedChatModel({
      env,
      requested: 'openrouter/openrouter/free',
    });
    assert.equal(result.id, 'openrouter/openrouter/free');
    assert.equal(result.source, 'explicit');
    assert.equal(result.notice, null);
  });
});
