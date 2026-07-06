/**
 * tests/functional/provider-poll.functional.test.mjs — live provider polling.
 *
 * Stubs global.fetch and the Ollama lister so each provider poller is exercised
 * without network or a running model server, and asserts the normalized model
 * shape (free, pricing, capabilities) plus the unreachable-not-fabricated rule.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const OPENROUTER_PAYLOAD = {
  data: [
    {
      id: 'anthropic/claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
      context_length: 200000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      supported_parameters: ['tools', 'reasoning'],
      architecture: { input_modalities: ['text', 'image'] },
    },
    {
      id: 'meta-llama/llama-3.3-70b-instruct:free',
      name: 'Llama 3.3 70B (free)',
      context_length: 131072,
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: ['tools'],
      architecture: { input_modalities: ['text'] },
    },
  ],
};

test('pollOpenRouter normalizes pricing, free flag, and capabilities', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('openrouter.ai')) {
      return { ok: true, json: async () => OPENROUTER_PAYLOAD };
    }
    return { ok: false, json: async () => ({}) };
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const { pollOpenRouter } = await import('../../lib/models/provider-poll.mjs');
  const models = await pollOpenRouter({ env: { OPENROUTER_API_KEY: 'test' } });

  const sonnet = models.find((m) => m.id === 'openrouter/anthropic/claude-3.5-sonnet');
  assert.ok(sonnet);
  assert.equal(sonnet.free, false);
  assert.equal(sonnet.pricing.input, 3);
  assert.equal(sonnet.pricing.output, 15);
  assert.equal(sonnet.reasoning, true);
  assert.equal(sonnet.vision, true);
  assert.equal(sonnet.tools, true);

  const free = models.find((m) => m.id.endsWith(':free'));
  assert.equal(free.free, true);
});

test('pollOpenRouter returns null when the endpoint is unreachable', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  t.after(() => { globalThis.fetch = realFetch; });

  const { pollOpenRouter } = await import('../../lib/models/provider-poll.mjs');
  const result = await pollOpenRouter({ env: { OPENROUTER_API_KEY: 'test' } });
  assert.equal(result, null);
});

test('pollOpenAI keeps chat families and drops embeddings/audio', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [
      { id: 'gpt-4o' },
      { id: 'o3-mini' },
      { id: 'text-embedding-3-large' },
      { id: 'whisper-1' },
      { id: 'dall-e-3' },
    ] }),
  });
  t.after(() => { globalThis.fetch = realFetch; });

  const { pollOpenAI } = await import('../../lib/models/provider-poll.mjs');
  const models = await pollOpenAI({ env: { OPENAI_API_KEY: 'test' } });
  const ids = models.map((m) => m.id);
  assert.deepEqual(ids.sort(), ['openai/gpt-4o', 'openai/o3-mini']);
  assert.equal(models.find((m) => m.id === 'openai/o3-mini').reasoning, true);
});

test('pollOpenAI returns null without a key', async () => {
  const { pollOpenAI } = await import('../../lib/models/provider-poll.mjs');
  assert.equal(await pollOpenAI({ env: {} }), null);
});

test('pollConfiguredProviders resolves a plain API key with no 1Password involved', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('api.openai.com')
    ? { ok: true, json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'o3-mini' }] }) }
    : { ok: false, json: async () => ({}) });
  t.after(() => { globalThis.fetch = realFetch; });

  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-plain-home-'));
  t.after(() => rmTmpDir(homeDir));

  const { pollConfiguredProviders } = await import('../../lib/models/provider-poll.mjs');
  const groups = await pollConfiguredProviders({
    env: { OPENAI_API_KEY: 'sk-plain-test' },
    cwd: homeDir,
    homeDir,
  });

  const openai = groups.find((g) => g.id === 'openai');
  assert.ok(openai, 'openai group present from a plain env key');
  assert.deepEqual(openai.models.map((m) => m.id).sort(), ['openai/gpt-4o', 'openai/o3-mini']);
});

test('pollConfiguredProviders serves a fresh cache without polling (no secret resolution)', async (t) => {
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('must not poll when cache is fresh'); };
  t.after(() => { globalThis.fetch = realFetch; });

  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-poll-fresh-'));
  t.after(() => rmTmpDir(homeDir));

  const env = { OPENAI_API_KEY: 'sk-plain-test' };
  const { getProviderModelCatalog } = await import('../../lib/model-router.mjs');
  const { providers } = getProviderModelCatalog({ env, cwd: homeDir });
  const gids = [...new Set(
    providers.filter((p) => p.configured).map((p) => (p.id.startsWith('openrouter') ? 'openrouter' : p.id)),
  )];

  const { pollConfiguredProviders, writeProviderCatalogCache } = await import('../../lib/models/provider-poll.mjs');
  writeProviderCatalogCache(
    gids.map((gid) => ({
      id: gid,
      label: gid,
      models: [{ id: `${gid}/cached-model`, label: 'cached-model', provider: gid, source: 'live' }],
    })),
    { homeDir },
  );

  const groups = await pollConfiguredProviders({ env, cwd: homeDir, homeDir });

  const openai = groups.find((g) => g.id === 'openai');
  assert.ok(openai, 'openai group served from fresh cache');
  assert.deepEqual(openai.models.map((m) => m.id), ['openai/cached-model']);
  assert.equal(openai.models[0].source, 'cached');
  assert.equal(openai.live, false);
  assert.equal(fetchCalls, 0, 'a fresh cache must not trigger any live poll');
});

test('pollConfiguredProviders never fabricates: unreachable provider yields a disabled hint', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  t.after(() => { globalThis.fetch = realFetch; });

  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-poll-home-'));
  t.after(() => rmTmpDir(homeDir));

  const { pollConfiguredProviders } = await import('../../lib/models/provider-poll.mjs');
  const groups = await pollConfiguredProviders({
    env: { ANTHROPIC_API_KEY: 'test' },
    cwd: homeDir,
    homeDir,
  });

  const anthropic = groups.find((g) => g.id === 'anthropic');
  assert.ok(anthropic, 'anthropic group present (configured via key)');
  assert.equal(anthropic.models.length, 1);
  assert.equal(anthropic.models[0].source, 'hint');
  assert.equal(anthropic.models[0].disabled, true);
});
