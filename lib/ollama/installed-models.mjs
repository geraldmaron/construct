/**
 * lib/ollama/installed-models.mjs — detect which Ollama model tags are installed locally.
 *
 * Construct model ids use the `ollama/<native>` form; Ollama's OpenAI-compatible API
 * expects the native tag (e.g. `llama3.2:3b`). This module lists `/api/tags` (or falls
 * back to `ollama list`) so availability checks and chat errors can distinguish "server
 * up but model not pulled" from auth or routing problems. Results are cached briefly
 * because the picker and router may call this many times per session.
 */

import { spawnSync } from 'node:child_process';
import { resolveFirstSecret } from '../providers/secret-resolver.mjs';

const CACHE_MS = 2500;
let cache = { at: 0, models: null, listable: false };

function ollamaBaseUrl(env = process.env) {
  const fromEnv = resolveFirstSecret(['OLLAMA_BASE_URL', 'OLLAMA_HOST'], { env, allowAmbient: true });
  const base = (fromEnv || 'http://localhost:11434').replace(/\/+$/, '');
  return base.endsWith('/v1') ? base.slice(0, -3) : base;
}

function parseTagsResponse(body) {
  const data = typeof body === 'string' ? JSON.parse(body) : body;
  const names = (data?.models || [])
    .map((entry) => entry?.name || entry?.model)
    .filter(Boolean);
  return new Set(names);
}

function listViaTagsApi(baseUrl) {
  const url = `${baseUrl}/api/tags`;
  const r = spawnSync('curl', ['-s', '--connect-timeout', '2', url], { encoding: 'utf8', timeout: 4000 });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  try {
    return parseTagsResponse(r.stdout);
  } catch {
    return null;
  }
}

function listViaCli() {
  const r = spawnSync('ollama', ['list'], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return null;
  const names = r.stdout.trim().split('\n').slice(1)
    .map((line) => line.split(/\s+/).filter(Boolean)[0])
    .filter(Boolean);
  return new Set(names);
}

export function toOllamaNativeModelId(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  return modelId.replace(/^ollama\//, '');
}

export function listInstalledOllamaModels({ env = process.env, now = Date.now(), refresh = false } = {}) {
  if (cache.pinned) {
    return { models: cache.models, listable: cache.listable };
  }
  if (!refresh && cache.models && (now - cache.at) < CACHE_MS) {
    return { models: cache.models, listable: cache.listable };
  }

  const baseUrl = ollamaBaseUrl(env);
  let models = listViaTagsApi(baseUrl);
  if (!models) models = listViaCli();

  if (!models) {
    cache = { at: now, models: null, listable: false };
    return { models: null, listable: false };
  }

  cache = { at: now, models, listable: true };
  return { models, listable: true };
}

/**
 * @returns {boolean|null} true when installed, false when listable and missing, null when unknown
 */
export function isOllamaModelInstalled(modelId, opts = {}) {
  const native = toOllamaNativeModelId(modelId);
  if (!native) return null;
  const { models, listable } = listInstalledOllamaModels(opts);
  if (!listable || !models) return null;
  return models.has(native);
}

export function formatOllamaModelMissingMessage(nativeModel, { constructId = null } = {}) {
  const id = nativeModel || toOllamaNativeModelId(constructId) || 'the model';
  return `Ollama model '${id}' is not installed locally. Pull it with: ollama pull ${id} (or: construct ollama pull ${id})`;
}

export function resetInstalledOllamaModelsCacheForTests() {
  cache = { at: 0, models: null, listable: false, pinned: false };
}

// Serializes cache injection across parallel test files so a neighbor's reset/probe
// cannot stomp a pinned list mid-assertion (ubuntu-latest CI flakes).
let cacheTestTail = Promise.resolve();

export function runWithInstalledOllamaCacheForTests(models, fn) {
  const run = cacheTestTail.then(async () => {
    cache = {
      at: Date.now(),
      models: models instanceof Set ? models : new Set(models),
      listable: true,
      pinned: true,
    };
    try {
      return await fn();
    } finally {
      cache = { at: 0, models: null, listable: false, pinned: false };
    }
  });
  cacheTestTail = run.catch(() => {});
  return run;
}

// pinned bypasses the TTL so an injected cache survives slow provider probes that
// run between injection and read; without it the entry can age out mid-test and
// trigger a real (server-down) probe, flaking availability assertions.
export function setInstalledOllamaModelsCacheForTests(models, { listable = true, now = Date.now() } = {}) {
  cache = {
    at: now,
    models: models instanceof Set ? models : new Set(models),
    listable,
    pinned: true,
  };
}
