/**
 * lib/engine/registry.mjs — Plugin resolver for the Construct retrieval engine.
 *
 * Resolution order (last-write wins):
 *   1. Built-in defaults (lib/engine/defaults.mjs)
 *   2. plugins.json in the XDG config dir   (operator-level overrides)
 *   3. <project>/.cx/plugins.json  (repo-level overrides)
 *   4. CONSTRUCT_PLUGIN_<LAYER> environment variables (one-off overrides)
 *
 * Plugin entry shape (in plugins.json):
 *   { "layer": "embedder", "package": "github:user/repo#sha", "options": {} }
 *
 * `package` is one of:
 *   - bare module name resolved via standard Node ESM resolution
 *   - absolute path to a local module
 *   - "github:owner/repo#ref" string (resolved via npm/yarn — caller installs out of band)
 *
 * Failures (load error, contract mismatch) fall back to the default impl for
 * that layer and are surfaced via construct doctor / hook telemetry.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LAYERS, assertContract } from './contracts.mjs';
import { loadDefaults } from './defaults.mjs';
import { configDir } from '../config/xdg.mjs';

const ENV_PREFIX = 'CONSTRUCT_PLUGIN_';

function readJsonIfExists(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Build the layered list of override entries from disk and env. Later entries
// take precedence per layer.

function gatherOverrides(rootDir) {
  const overrides = [];

  const userConfig = readJsonIfExists(join(configDir(), 'plugins.json'));
  if (userConfig?.plugins) overrides.push(...userConfig.plugins);

  const projectConfig = readJsonIfExists(join(rootDir, '.cx', 'plugins.json'));
  if (projectConfig?.plugins) overrides.push(...projectConfig.plugins);

  for (const layer of LAYERS) {
    const envKey = `${ENV_PREFIX}${layer.toUpperCase()}`;
    if (process.env[envKey]) {
      overrides.push({ layer, package: process.env[envKey], options: {} });
    }
  }

  return overrides;
}

async function importPlugin(pkg, rootDir) {
  if (typeof pkg !== 'string' || !pkg) {
    throw new Error(`plugin package must be a non-empty string`);
  }

  if (pkg.startsWith('github:')) {
    throw new Error(
      `github: plugin spec '${pkg}' is not auto-installed. Install via 'npm install ${pkg}' first, then reference by package name.`
    );
  }

  if (isAbsolute(pkg) || pkg.startsWith('./') || pkg.startsWith('../')) {
    const abs = isAbsolute(pkg) ? pkg : resolve(rootDir, pkg);
    return import(pathToFileURL(abs).href);
  }

  return import(pkg);
}

async function tryLoadOverride(entry, rootDir) {
  const { layer, package: pkg, options = {} } = entry || {};
  if (!LAYERS.includes(layer)) {
    return { ok: false, layer, error: `unknown layer: ${layer}` };
  }
  try {
    const mod = await importPlugin(pkg, rootDir);
    const factory = mod?.create || mod?.default;
    if (typeof factory !== 'function') {
      return { ok: false, layer, error: `plugin '${pkg}' must export 'create' or default factory` };
    }
    const plugin = await factory(options);
    assertContract(layer, plugin);
    return { ok: true, layer, plugin, source: pkg };
  } catch (err) {
    return { ok: false, layer, error: `plugin '${pkg}' failed: ${err.message}` };
  }
}

/**
 * Resolve every layer to an active plugin.
 *
 * @param {object} opts
 * @param {string} [opts.rootDir]
 * @returns {Promise<{
 *   layers: Record<string, object>,
 *   sources: Record<string, string>,
 *   errors: Array<{ layer: string, error: string }>,
 * }>}
 */
export async function resolveEngine({ rootDir = process.cwd() } = {}) {
  const defaults = await loadDefaults();
  const layers = { ...defaults };
  const sources = Object.fromEntries(LAYERS.map((l) => [l, 'default']));
  const errors = [];

  for (const layer of LAYERS) {
    assertContract(layer, layers[layer]);
  }

  for (const entry of gatherOverrides(rootDir)) {
    const result = await tryLoadOverride(entry, rootDir);
    if (result.ok) {
      layers[result.layer] = result.plugin;
      sources[result.layer] = result.source;
    } else {
      errors.push({ layer: result.layer, error: result.error });
    }
  }

  return { layers, sources, errors };
}

/**
 * Diagnostic summary for `construct doctor` — does not throw.
 */
export async function describeEngine({ rootDir = process.cwd() } = {}) {
  const { layers, sources, errors } = await resolveEngine({ rootDir });
  const summary = LAYERS.map((layer) => ({
    layer,
    id: layers[layer]?.meta?.id || '(missing)',
    source: sources[layer],
    capabilities: { ...layers[layer]?.meta },
  }));
  return { summary, errors };
}
