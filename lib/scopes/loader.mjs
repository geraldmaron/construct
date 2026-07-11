/**
 * lib/scopes/loader.mjs — Work-scope loader (intake lens + org enrichment).
 *
 * Curated scopes live in specialists/org/scopes/<id>.json. Named custom
 * scopes reuse the builtin -> user -> project precedence construct-rf26.13
 * established for specialists/teams (lib/registry/assemble.mjs): an id also
 * resolves from ~/.construct/org/scopes/<id>.json (shared across every
 * project on the machine) and <cwd>/.construct/org/scopes/<id>.json (git-tracked,
 * highest precedence), instead of a scope-specific mechanism. A later tier's
 * fields shallow-merge over an earlier tier's on id collision.
 *
 * The single-file <cwd>/.construct/scope.json escape hatch (custom: true) still
 * works for an anonymous, one-off override — it predates rf26.13 and stays
 * for the "just this project, no id to remember" case — but a named, reusable
 * custom profile should live under the tiered org/scopes/ layer so it can be
 * switched to with `construct scope set <id>` like a curated one.
 *
 * construct.config.json's scope field selects the active curated/custom id
 * (default rnd). Teams and roles are not authored in scope files — enrich.mjs
 * attaches them from specialists/org at load time.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { configPath } from '../config-dir.mjs';
import { parseJsonc } from '../jsonc.mjs';
import { fileURLToPath } from 'node:url';

import { enrichScope } from './enrich.mjs';
import { homeDir } from '../paths.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '..', '..');
const SCOPES_DIR = join(REPO_ROOT, 'specialists', 'org', 'scopes');

export const DEFAULT_SCOPE_ID = 'rnd';

function userScopesDir() {
  return join(homeDir(), '.construct', 'org', 'scopes');
}

function projectScopesDir(cwd) {
  return configPath(cwd, 'org', 'scopes');
}

function readScopeTier(dir, id) {
  const p = join(dir, `${id}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function resolveScopeRaw(id, cwd) {
  const tiers = [SCOPES_DIR, userScopesDir(), projectScopesDir(cwd)];
  let merged = null;
  for (const dir of tiers) {
    const raw = readScopeTier(dir, id);
    if (!raw) continue;
    merged = merged ? { ...merged, ...raw } : raw;
  }
  return merged;
}

export function loadScope(id, opts = {}) {
  if (!id || typeof id !== 'string') return null;
  const cwd = opts.cwd || process.cwd();
  const raw = resolveScopeRaw(id, cwd);
  if (!raw) return null;
  return enrichScope(raw, opts);
}

export function listScopes() {
  if (!existsSync(SCOPES_DIR)) return [];
  return readdirSync(SCOPES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((id) => {
      try {
        const raw = JSON.parse(readFileSync(join(SCOPES_DIR, `${id}.json`), 'utf8'));
        return raw?.id === id && raw?.intake?.types && raw?.intake?.stages;
      } catch {
        return false;
      }
    })
    .sort();
}

export function loadCustomScope(cwd) {
  if (!cwd) return null;
  const path = configPath(cwd, 'scope.json');
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && raw.custom === true) return raw;
    return null;
  } catch {
    return null;
  }
}

export function resolveActiveScope(cwd, configScopeId = null) {
  const rootDir = REPO_ROOT;
  const enrichOpts = { rootDir, cwd };
  if (configScopeId) {
    const s = loadScope(configScopeId, enrichOpts);
    if (s) return s;
  }
  const custom = loadCustomScope(cwd);
  if (custom) return enrichScope(custom, enrichOpts);
  const fromConfig = readScopeFromProjectConfig(cwd);
  if (fromConfig) {
    const s = loadScope(fromConfig, enrichOpts);
    if (s) return s;
  }
  return loadScope(DEFAULT_SCOPE_ID, enrichOpts) ?? minimalRndFallback();
}

function readScopeFromProjectConfig(cwd) {
  if (!cwd) return null;
  const p = join(cwd, 'construct.config.json');
  if (!existsSync(p)) return null;
  try {
    const raw = parseJsonc(readFileSync(p, 'utf8'));
    return typeof raw?.scope === 'string' ? raw.scope : null;
  } catch {
    return null;
  }
}

function minimalRndFallback() {
  return {
    id: 'rnd',
    displayName: 'Software R&D',
    roles: [],
    intake: { types: [], stages: [] },
    docTemplates: [],
    hooks: { sessionReflect: 'on', sessionOptimize: 'on' },
    rebrand: { intakeQueueLabel: 'R&D intake queue', signalNoun: 'signal' },
  };
}
