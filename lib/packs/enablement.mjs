/**
 * lib/packs/enablement.mjs — durable pack enable/disable lifecycle (LMCP-E3).
 *
 * `loadAllPacks` (loader.mjs) merges every pack it finds on disk across the
 * builtin/user/project tiers unconditionally — correct for authoring-time
 * precedence resolution, but it means dropping a pack manifest into
 * `.construct/packs/` makes it "configured" and already influencing prompt/framework
 * resolution with no explicit operator action (the OTel lesson this bead is
 * named for: configured is not enabled). This module adds an explicit,
 * durable enablement layer on top without changing loadAllPacks' own
 * semantics — existing callers merging all discovered packs (precedence
 * tests, `construct doctor`) are unaffected; a caller that wants
 * enablement-gated packs calls `loadEnabledPacks` instead.
 *
 * State lives at `<rootDir>/.construct/packs.json`:
 *   { "version": 1, "enabled": { "<packId>": { "version": "1.0.0", "enabledAt": "<ISO>", "tier": "project" } } }
 *
 * `@construct/core` (the programmatically-injected builtin foundation pack,
 * see core-pack.mjs) is always enabled — it is not optional and carries no
 * manifest file to enable/disable.
 *
 * `enablePack` refuses to enable a pack whose manifest fails validation —
 * including a compatVersion that exceeds this runtime's PACK_COMPAT_VERSION —
 * naming the exact validation error rather than half-enabling it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configPath } from '../config-dir.mjs';

import { loadAllPacks, resolvePackDirs } from './loader.mjs';
import { validatePackManifest } from './validate.mjs';
import { loadCorePack } from './core-pack.mjs';

const STATE_VERSION = 1;

export function resolveEnablementStatePath(rootDir = process.cwd()) {
  return configPath(rootDir, 'packs.json');
}

/**
 * @param {string} [rootDir]
 * @returns {{ version: number, enabled: Record<string, {version: string, enabledAt: string, tier: string}> }}
 */
export function readEnablementState(rootDir = process.cwd()) {
  const statePath = resolveEnablementStatePath(rootDir);
  if (!existsSync(statePath)) {
    return { version: STATE_VERSION, enabled: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.enabled !== 'object' || parsed.enabled === null) {
      return { version: STATE_VERSION, enabled: {} };
    }
    return { version: parsed.version || STATE_VERSION, enabled: parsed.enabled };
  } catch {
    return { version: STATE_VERSION, enabled: {} };
  }
}

export function writeEnablementState(rootDir, state) {
  const statePath = resolveEnablementStatePath(rootDir);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify({ version: state.version || STATE_VERSION, enabled: state.enabled || {} }, null, 2) + '\n', 'utf8');
}

/**
 * The core pack ships with Construct and is always enabled — it has no
 * manifest file on disk to toggle and every worker profile/framework/prompt it
 * carries is the foundation every deployment mode depends on.
 */
export function isCorePackId(packId, packageRoot) {
  return packId === loadCorePack(packageRoot).id;
}

export function isEnabled(packId, state, { packageRoot } = {}) {
  if (isCorePackId(packId, packageRoot)) return true;
  return Boolean(state?.enabled?.[packId]);
}

/**
 * Scans the three tier directories (project, user, builtin — highest
 * precedence first) for a `pack.manifest.json` whose parsed `id` matches.
 * Returns the parsed manifest alongside its tier/path even when validation
 * would reject it, so `enablePack` can name the exact validation failure
 * instead of reporting a generic "not found".
 *
 * @returns {{ tier: string, packDir: string, manifestPath: string, parsed: object } | null}
 */
function findPackManifest(packId, { rootDir, homeDir } = {}) {
  const dirs = resolvePackDirs({ rootDir, homeDir });
  const tiers = [
    { tier: 'project', dir: dirs.project },
    { tier: 'user', dir: dirs.user },
    { tier: 'builtin', dir: dirs.builtin },
  ];

  for (const { tier, dir } of tiers) {
    if (!existsSync(dir)) continue;
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const entry of entries) {
      const packDir = join(dir, entry.name);
      const manifestPath = join(packDir, 'pack.manifest.json');
      if (!existsSync(manifestPath)) continue;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        continue;
      }
      if (parsed?.id === packId) {
        return { tier, packDir, manifestPath, parsed };
      }
    }
  }
  return null;
}

/**
 * @param {string} packId
 * @param {{ rootDir?: string, homeDir?: string, packageRoot?: string, requestedVersion?: string, knownProviders?: object }} [opts]
 * @returns {{ ok: true, pack: object, tier: string, alreadyCore?: true } | { ok: false, error: string }}
 */
export function enablePack(packId, opts = {}) {
  const { rootDir = process.cwd(), homeDir, packageRoot, requestedVersion, knownProviders } = opts;

  if (isCorePackId(packId, packageRoot)) {
    return { ok: true, alreadyCore: true, pack: { id: packId }, tier: 'builtin' };
  }

  const found = findPackManifest(packId, { rootDir, homeDir });
  if (!found) {
    const dirs = resolvePackDirs({ rootDir, homeDir });
    return { ok: false, error: `pack '${packId}' not found in any builtin/user/project pack directory (looked under ${dirs.project}, ${dirs.user}, ${dirs.builtin})` };
  }

  if (requestedVersion && found.parsed.version !== requestedVersion) {
    return { ok: false, error: `pack '${packId}' on disk is version ${found.parsed.version}, requested ${requestedVersion}` };
  }

  const result = validatePackManifest(found.parsed, { filePath: found.manifestPath, knownProviders });
  if (!result.valid) {
    return { ok: false, error: `pack '${packId}' failed validation: ${result.errors.join('; ')}` };
  }

  const state = readEnablementState(rootDir);
  state.enabled[packId] = { version: found.parsed.version, enabledAt: new Date().toISOString(), tier: found.tier };
  writeEnablementState(rootDir, state);

  return { ok: true, pack: found.parsed, tier: found.tier };
}

/**
 * Idempotent — disabling an already-disabled (or never-enabled) pack still
 * returns ok:true. The core pack cannot be disabled (ADR-0055 foundation tier).
 *
 * @param {string} packId
 * @param {{ rootDir?: string, packageRoot?: string }} [opts]
 * @returns {{ ok: true, wasEnabled: boolean } | { ok: false, error: string }}
 */
export function disablePack(packId, opts = {}) {
  const { rootDir = process.cwd(), packageRoot } = opts;
  if (isCorePackId(packId, packageRoot)) {
    return { ok: false, error: `pack '${packId}' is the core pack and cannot be disabled` };
  }
  const state = readEnablementState(rootDir);
  const wasEnabled = Boolean(state.enabled[packId]);
  delete state.enabled[packId];
  writeEnablementState(rootDir, state);
  return { ok: true, wasEnabled };
}

/**
 * Enablement-gated counterpart to `loadAllPacks` — same merge/precedence,
 * filtered to only the core pack plus whatever the durable state marks
 * enabled. Consumers that must not act on a merely-configured-but-unenabled
 * pack (prompt/framework resolution, embed bindings) should call this
 * instead of loadAllPacks directly.
 *
 * @param {object} opts  same shape as loadAllPacks' opts
 * @returns {{packs: object[], errors: string[], state: object}}
 */
export function loadEnabledPacks(opts = {}) {
  const { packs, errors } = loadAllPacks(opts);
  const state = readEnablementState(opts.rootDir);
  const filtered = packs.filter((p) => isEnabled(p.id, state, { packageRoot: opts.packageRoot }));
  return { packs: filtered, errors, state };
}
