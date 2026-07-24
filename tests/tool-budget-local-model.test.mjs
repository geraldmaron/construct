/**
 * tests/tool-budget-local-model.test.mjs — isLocalModel + private baseURL locality.
 *
 * Covers loopback/RFC1918/Tailscale CGNAT detection and provider-config lookup
 * so openai-compatible Ollama mirrors (e.g. Corsair over Tailscale) slim prompts
 * and trim heavy MCP the same way as `ollama/*`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decideTrim,
  isLocalModel,
  isLoopbackOrPrivateBaseUrl,
} from '../lib/mcp/tool-budget.mjs';
import { resolveCapabilityTier } from '../lib/model-router.mjs';

describe('isLoopbackOrPrivateBaseUrl', () => {
  it('accepts loopback hosts', () => {
    assert.equal(isLoopbackOrPrivateBaseUrl('http://127.0.0.1:11434/v1'), true);
    assert.equal(isLoopbackOrPrivateBaseUrl('http://localhost:11434/v1'), true);
    assert.equal(isLoopbackOrPrivateBaseUrl('http://[::1]:11434/v1'), true);
  });

  it('accepts RFC1918 and Tailscale CGNAT', () => {
    assert.equal(isLoopbackOrPrivateBaseUrl('http://10.0.0.5:11434/v1'), true);
    assert.equal(isLoopbackOrPrivateBaseUrl('http://192.168.1.10:11434/v1'), true);
    assert.equal(isLoopbackOrPrivateBaseUrl('http://172.16.0.2:11434/v1'), true);
    assert.equal(isLoopbackOrPrivateBaseUrl('http://100.119.72.84:11434/v1'), true);
  });

  it('rejects public hosts', () => {
    assert.equal(isLoopbackOrPrivateBaseUrl('https://api.openai.com/v1'), false);
    assert.equal(isLoopbackOrPrivateBaseUrl('https://openrouter.ai/api/v1'), false);
    assert.equal(isLoopbackOrPrivateBaseUrl('http://8.8.8.8:11434/v1'), false);
  });
});

describe('isLocalModel', () => {
  it('keeps existing ollama/local string heuristics', () => {
    assert.equal(isLocalModel('ollama/gpt-oss:20b'), true);
    assert.equal(isLocalModel('local/anything'), true);
    assert.equal(isLocalModel('anthropic/claude-opus-4-6'), false);
  });

  it('treats openai-compatible providers with private baseURL as local', () => {
    const providers = {
      corsair: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Ollama (Corsair)',
        options: { baseURL: 'http://100.119.72.84:11434/v1' },
      },
    };
    assert.equal(isLocalModel('corsair/qwen3.5:4b', { providers }), true);
    assert.equal(isLocalModel('corsair/qwen3.5:4b'), false, 'without providers, unknown prefix is not local');
  });

  it('does not treat cloud openai-compatible endpoints as local', () => {
    const providers = {
      openrouter: {
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: 'https://openrouter.ai/api/v1' },
      },
    };
    assert.equal(isLocalModel('openrouter/qwen/qwen3-coder:free', { providers }), false);
  });
});

describe('resolveCapabilityTier with providers', () => {
  it('floors a small corsair model when providers mark it private', () => {
    const providers = {
      corsair: {
        options: { baseURL: 'http://100.64.1.2:11434/v1' },
      },
    };
    assert.equal(
      resolveCapabilityTier({ model: 'corsair/qwen3.5:4b', providers }),
      'floor',
    );
  });

  it('keeps full when corsair baseURL is public', () => {
    const providers = {
      corsair: {
        options: { baseURL: 'https://example.com/v1' },
      },
    };
    assert.equal(
      resolveCapabilityTier({ model: 'corsair/qwen3.5:4b', providers }),
      'full',
    );
  });
});

describe('decideTrim with private providers', () => {
  it('trims when default model resolves local via providers', () => {
    const providers = {
      corsair: { options: { baseURL: 'http://100.64.1.2:11434/v1' } },
    };
    assert.equal(
      decideTrim({ surface: 'auto', defaultModel: 'corsair/gpt-oss:20b', providers }),
      true,
    );
  });
});
