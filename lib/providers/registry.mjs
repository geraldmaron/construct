/**
 * lib/providers/registry.mjs — provider resolution + lifecycle.
 *
 * Resolution order (last-write wins):
 *
 *   1. Built-in factories under `lib/providers/<id>/index.mjs` (loaded lazily).
 *   2. Operator overrides at `~/.construct/providers.json`:
 *        { "providers": [{ "id": "...", "package": "...", "options": {} }] }
 *   3. Project overrides at `<projectRoot>/.cx/providers.json` (same shape).
 *
 * Built-in providers ship with the package. Plugin providers are arbitrary
 * npm modules (or local paths) that export the contract. The registry runs
 * `assertProviderContract` against every loaded provider before returning
 * it, so a misconfigured plugin produces a clear error rather than a runtime
 * surprise inside core code.
 *
 * Provider config (auth tokens, default queries, allowlists) is layered:
 * `~/.construct/config.env` for credentials, `<projectRoot>/.cx/providers.yaml`
 * for non-secret per-project settings. The YAML file references env vars
 * by name so secrets never land in source control.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertProviderContract } from './contract.mjs';
import { getBreaker } from './circuit-breaker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const BUILT_INS = ['github', 'atlassian-jira', 'atlassian-confluence', 'slack', 'salesforce'];

function readJsonIfExists(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { return null; }
}

async function loadFactoryFromPackage(pkg, rootDir) {
  if (!pkg || typeof pkg !== 'string') {
    throw new Error('provider plugin package must be a non-empty string');
  }
  if (pkg.startsWith('github:')) {
    throw new Error(
      `github: plugin spec '${pkg}' is not auto-installed. ` +
      `Install via 'npm install ${pkg}' first, then reference by package name.`
    );
  }
  if (isAbsolute(pkg) || pkg.startsWith('./') || pkg.startsWith('../')) {
    const abs = isAbsolute(pkg) ? pkg : resolve(rootDir, pkg);
    return import(pathToFileURL(abs).href);
  }
  return import(pkg);
}

async function loadBuiltIn(id) {
  const candidate = join(HERE, id, 'index.mjs');
  if (!existsSync(candidate)) return null;
  return import(pathToFileURL(candidate).href);
}

// Wrap every async I/O method on a provider with its per-id circuit breaker
// so a downed remote system fails fast for the cooldown window instead of
// blocking every caller on the same broken backend. `health` is intentionally
// not wrapped — it's the probe consumers use to surface the breaker's state.
const BREAKER_METHODS = ['read', 'search', 'watch', 'write', 'webhook'];

function wrapWithBreaker(provider) {
  const breaker = getBreaker(`provider:${provider.meta.id}`, {
    failureThreshold: 5,
    cooldownMs: 30_000,
  });
  for (const method of BREAKER_METHODS) {
    if (typeof provider[method] !== 'function') continue;
    const original = provider[method].bind(provider);
    provider[method] = (...args) => breaker.run(original, ...args);
  }
  return provider;
}

async function instantiate(mod, options) {
  const factory = mod?.create || mod?.default;
  if (typeof factory !== 'function') {
    throw new Error(`provider module must export a 'create' or default factory`);
  }
  const instance = await factory(options || {});
  assertProviderContract(instance);
  return wrapWithBreaker(instance);
}

function gatherOverrides(rootDir) {
  const out = [];
  const userConfig = readJsonIfExists(join(homedir(), '.construct', 'providers.json'));
  if (userConfig?.providers) out.push(...userConfig.providers);
  const projectConfig = readJsonIfExists(join(rootDir, '.cx', 'providers.json'));
  if (projectConfig?.providers) out.push(...projectConfig.providers);
  return out;
}

/**
 * Resolve every provider Construct should know about. Returns:
 *
 *   { providers: { [id]: instance }, errors: [...], sources: { [id]: 'built-in'|'plugin:<pkg>' } }
 */
export async function resolveProviders({ rootDir = process.cwd(), env = process.env } = {}) {
  const providers = {};
  const sources = {};
  const errors = [];

  for (const id of BUILT_INS) {
    try {
      const mod = await loadBuiltIn(id);
      if (!mod) continue;
      const instance = await instantiate(mod, { env });
      providers[id] = instance;
      sources[id] = 'built-in';
    } catch (err) {
      errors.push({ id, source: 'built-in', error: err.message });
    }
  }

  for (const entry of gatherOverrides(rootDir)) {
    const id = entry?.id;
    const pkg = entry?.package;
    if (!id || !pkg) {
      errors.push({ id: id || '(unknown)', source: 'override', error: 'override entry must have id and package' });
      continue;
    }
    try {
      const mod = await loadFactoryFromPackage(pkg, rootDir);
      const instance = await instantiate(mod, { env, ...(entry.options || {}) });
      if (instance.meta.id !== id) {
        errors.push({ id, source: pkg, error: `meta.id is '${instance.meta.id}' but override declared id='${id}'` });
        continue;
      }
      providers[id] = instance;
      sources[id] = `plugin:${pkg}`;
    } catch (err) {
      errors.push({ id, source: pkg, error: err.message });
    }
  }

  return { providers, sources, errors };
}

export async function describeProviders({ rootDir = process.cwd(), env = process.env } = {}) {
  const { providers, sources, errors } = await resolveProviders({ rootDir, env });
  const summary = await Promise.all(
    Object.entries(providers).map(async ([id, p]) => {
      let health = { ok: false, detail: 'health probe not invoked' };
      try { health = await p.health({}); } catch (err) { health = { ok: false, detail: err.message }; }
      return {
        id,
        displayName: p.meta.displayName,
        description: p.meta.description || null,
        capabilities: [...p.meta.capabilities],
        source: sources[id],
        health,
      };
    })
  );
  return { summary, errors };
}
