/**
 * lib/packs/loader.mjs — pack manifest directory loader and merger.
 *
 * Three manifest tiers exist: builtin (shipped with Construct), user (in
 * ~/.config/construct/packs/), and project (in .construct/packs/). Project packs
 * take highest precedence; user packs override builtin. The core pack is
 * programmatically injected at the builtin tier via loadCorePack().
 *
 * `loadPacksFromDir` reads every subdirectory containing pack.manifest.json
 * and validates each one. `mergePackTiers` merges the three tiers by id.
 * `resolvePackDirs` returns the canonical paths for each tier.
 * `loadAllPacks` is a convenience that loads from all tiers.
 *
 * Prompt validation (LMCP-E2): in team/enterprise deployment mode a pack whose
 * declared prompt files are missing or lack valid frontmatter is rejected at
 * load time — the error names the missing file — rather than letting the
 * worker discover the gap mid-run and silently substitute a generic persona.
 * Solo mode does not hard-fail here; the worker records the miss as a visible
 * degraded fallback instead (lib/orchestration/worker.mjs).
 *
 * embedBindings validation (LMCP-E4): every pack's `embedBindings` block is
 * cross-checked against the builtin extension manifests (lib/extensions) so
 * a binding naming an unknown provider id or an undeclared capability fails
 * pack validation with a path, rather than the authority guard discovering
 * the gap at proposal time.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { configPath } from '../config-dir.mjs';
import { fileURLToPath } from 'node:url';

import { validatePackManifest } from './validate.mjs';
import { validatePackPrompts } from './prompts.mjs';
import { loadCorePack } from './core-pack.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { loadManifestsFromDir, resolveManifestDirs } from '../extensions/loader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..', '..');

const PROMPT_HARD_FAIL_MODES = new Set(['team', 'enterprise']);

/**
 * Load builtin extension manifests keyed by id, for embedBindings
 * cross-validation. Only the builtin tier is consulted — the same set every
 * `construct doctor` / pack loader run sees, independent of project overrides.
 */
function loadKnownProviderManifests(packageRoot) {
  const { builtin } = resolveManifestDirs({ rootDir: packageRoot });
  const { manifests } = loadManifestsFromDir(builtin);
  const byId = {};
  for (const m of manifests) byId[m.id] = m;
  return byId;
}

export function loadPacksFromDir(packsBaseDir, opts = {}) {
  const packs = [];
  const errors = [];

  if (!existsSync(packsBaseDir)) {
    return { packs, errors };
  }

  let entries;
  try {
    entries = readdirSync(packsBaseDir, { withFileTypes: true });
  } catch (err) {
    errors.push(`${packsBaseDir}: failed to read directory (${err.message})`);
    return { packs, errors };
  }

  const packDirs = entries.filter(e => e.isDirectory()).map(e => join(packsBaseDir, e.name)).sort();
  const deploymentMode = opts.deploymentMode || getDeploymentMode(opts.env);
  const packageRoot = opts.packageRoot || PACKAGE_ROOT;
  const knownProviders = opts.knownProviders || loadKnownProviderManifests(packageRoot);

  for (const packDir of packDirs) {
    const manifestPath = join(packDir, 'pack.manifest.json');
    if (!existsSync(manifestPath)) continue;

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      errors.push(`${manifestPath}: failed to parse JSON (${err.message})`);
      continue;
    }

    const result = validatePackManifest(parsed, { filePath: manifestPath, strict: opts.strict, knownProviders });
    if (!result.valid) {
      errors.push(...result.errors);
      continue;
    }

    if (PROMPT_HARD_FAIL_MODES.has(deploymentMode)) {
      const promptResult = validatePackPrompts({ ...parsed, _packDir: packDir }, { packageRoot });
      if (!promptResult.valid) {
        errors.push(...promptResult.errors.map((e) => `${manifestPath}: ${e}`));
        continue;
      }
    }

    packs.push({ ...parsed, _tier: opts.tier || 'unknown', _manifestPath: manifestPath, _packDir: packDir });
  }

  return { packs, errors };
}

export function mergePackTiers(builtin = [], user = [], project = []) {
  const map = new Map();

  for (const p of builtin) map.set(p.id, p);
  for (const p of user) map.set(p.id, p);
  for (const p of project) map.set(p.id, p);

  return [...map.values()];
}

export function resolvePackDirs({ rootDir, homeDir } = {}) {
  const home = homeDir ?? (process.env.HOME || process.env.USERPROFILE || '');

  return {
    builtin: join(PACKAGE_ROOT, 'lib', 'packs', 'manifests'),
    user: join(home, '.config', 'construct', 'packs'),
    project: configPath(rootDir || process.cwd(), 'packs'),
  };
}

export function loadAllPacks(opts = {}) {
  const dirs = resolvePackDirs(opts);
  const allErrors = [];
  const deploymentMode = opts.deploymentMode || getDeploymentMode(opts.env);
  const packageRoot = opts.packageRoot || PACKAGE_ROOT;
  const knownProviders = opts.knownProviders || loadKnownProviderManifests(packageRoot);

  const builtinResult = loadPacksFromDir(dirs.builtin, { ...opts, tier: 'builtin', deploymentMode, packageRoot, knownProviders });
  allErrors.push(...builtinResult.errors);

  const userResult = loadPacksFromDir(dirs.user, { ...opts, tier: 'user', deploymentMode, packageRoot, knownProviders });
  allErrors.push(...userResult.errors);

  const projectResult = loadPacksFromDir(dirs.project, { ...opts, tier: 'project', deploymentMode, packageRoot, knownProviders });
  allErrors.push(...projectResult.errors);

  const corePack = loadCorePack(packageRoot);
  let builtinPacks = [...builtinResult.packs, corePack];

  // The core pack ships with Construct and is not read from a manifest file,
  // bypassing loadPacksFromDir's validation loop above; the same hard-fail
  // check still applies under team/enterprise, naming the missing file. The
  // same is true of embedBindings — validated explicitly here so an unknown
  // provider id or undeclared capability in the core pack's own bindings
  // fails loudly instead of silently granting excess authority.
  if (PROMPT_HARD_FAIL_MODES.has(deploymentMode)) {
    const coreResult = validatePackPrompts(corePack, { packageRoot });
    if (!coreResult.valid) {
      allErrors.push(...coreResult.errors.map((e) => `${corePack._sourceDir || '@construct/core'}: ${e}`));
      builtinPacks = builtinResult.packs;
    }
  }

  if (corePack.embedBindings) {
    const coreBindingResult = validatePackManifest(
      { id: corePack.id, version: corePack.version, compatVersion: corePack.compatVersion, embedBindings: corePack.embedBindings },
      { filePath: corePack._sourceDir || '@construct/core', knownProviders }
    );
    if (!coreBindingResult.valid) {
      allErrors.push(...coreBindingResult.errors);
      builtinPacks = builtinPacks.filter((p) => p.id !== corePack.id);
    }
  }

  const merged = mergePackTiers(builtinPacks, userResult.packs, projectResult.packs);

  return { packs: merged, errors: allErrors };
}