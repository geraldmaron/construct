/**
 * lib/registry/surface-map.mjs — ADR-0039 primary interaction surface per command group.
 *
 * Declarative map from CLI command name to primary surface tier. The CLI registry
 * remains the substrate; this file governs discovery posture without removing verbs.
 * LMCP-B7: the tiers/command map ship as lib/registry/manifests/surface-map.default.json
 * (loaded once at module init — this file's exports stay byte-identical to the prior
 * hardcoded dict) with an optional `.cx/registry/surface-map.json` project override
 * merged in per-call by resolveSurfaceMap()/surfaceForCommand()/validateSurfaceMap().
 * An override may add or reassign command entries and replace the tier list; it can
 * never remove a default entry outright (unset keys keep resolving to the default).
 *
 * Surfaces:
 *   agent-mcp — MCP tool canonical; CLI --json twin
 *   thin-cli  — human types this at a prompt
 *   tui       — interactive loop emphasized
 *   internal  — CI/harness only
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DEFAULT_MANIFEST_PATH = path.join(HERE, 'manifests', 'surface-map.default.json');

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadDefaultManifest() {
  const manifest = readJsonIfExists(DEFAULT_MANIFEST_PATH);
  if (!manifest || !Array.isArray(manifest.tiers) || typeof manifest.commands !== 'object') {
    throw new Error(`lib/registry/surface-map.mjs: missing or malformed default manifest at ${DEFAULT_MANIFEST_PATH}`);
  }
  return manifest;
}

const DEFAULT_MANIFEST = loadDefaultManifest();

// Byte-identical to the pre-manifest hardcoded exports: both are read once at
// module init from the default manifest, with no project override applied —
// a direct import of these two names sees exactly the shipped defaults.

export const SURFACE_TIERS = DEFAULT_MANIFEST.tiers;

/** @type {Record<string, string>} */
export const COMMAND_SURFACE = DEFAULT_MANIFEST.commands;

const overrideCache = new Map();

function loadOverride(cwd) {
  if (overrideCache.has(cwd)) return overrideCache.get(cwd);
  const override = readJsonIfExists(path.join(cwd, '.cx', 'registry', 'surface-map.json'));
  overrideCache.set(cwd, override);
  return override;
}

/**
 * resolveSurfaceMap({ cwd } = {})
 *
 * Merges the default manifest with a project's `.cx/registry/surface-map.json`
 * override, when present. `commands` in the override are shallow-merged over
 * the default (an override entry replaces the matching default; every other
 * default entry survives untouched). `tiers` in the override replaces the
 * default tier list wholesale when present.
 */
export function resolveSurfaceMap({ cwd = process.cwd() } = {}) {
  const override = loadOverride(cwd);
  if (!override) return { tiers: SURFACE_TIERS, commands: COMMAND_SURFACE };
  const tiers = Array.isArray(override.tiers) ? override.tiers : SURFACE_TIERS;
  const commands = { ...COMMAND_SURFACE, ...(override.commands && typeof override.commands === 'object' ? override.commands : {}) };
  return { tiers, commands };
}

export function surfaceForCommand(name, { cwd = process.cwd() } = {}) {
  const { commands } = resolveSurfaceMap({ cwd });
  if (commands[name]) return commands[name];
  if (name.includes(':')) return 'internal';
  return 'thin-cli';
}

export function commandsBySurface(commands, { cwd = process.cwd() } = {}) {
  const { tiers } = resolveSurfaceMap({ cwd });
  const grouped = Object.fromEntries(tiers.map((t) => [t, []]));
  for (const cmd of commands) {
    const surface = cmd.surface ?? surfaceForCommand(cmd.name, { cwd });
    grouped[surface]?.push(cmd.name);
  }
  return grouped;
}

/**
 * validateSurfaceMap(commandNames, { cwd } = {})
 *
 * Stricter than surfaceForCommand's runtime fallback: every name must have an
 * explicit entry in the resolved (default + override) command map. This is an
 * opt-in registry/doctor-style check, separate from the CLI's own dispatch
 * path, so the default fallback behavior for unregistered commands stays
 * unaffected.
 */
export function validateSurfaceMap(commandNames, { cwd = process.cwd() } = {}) {
  const { commands } = resolveSurfaceMap({ cwd });
  const errors = commandNames
    .filter((name) => !commands[name])
    .map((name) => `command '${name}' has no surface-map entry (add one to .cx/registry/surface-map.json or lib/registry/manifests/surface-map.default.json)`);
  return { valid: errors.length === 0, errors };
}

export function __clearSurfaceMapOverrideCache() {
  overrideCache.clear();
}
