/**
 * lib/scopes/loader.mjs — Work-scope loader (intake lens + org enrichment).
 *
 * Curated scopes live in specialists/org/scopes/<id>.json. Custom overrides
 * use <cwd>/.cx/scope.json with custom: true. construct.config.json scope
 * field selects the active scope id (default rnd).
 *
 * Teams and roles are not authored in scope files — enrich.mjs attaches them
 * from specialists/org at load time.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enrichScope } from './enrich.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '..', '..');
const SCOPES_DIR = join(REPO_ROOT, 'specialists', 'org', 'scopes');

export const DEFAULT_SCOPE_ID = 'rnd';

export function loadScope(id, opts = {}) {
  if (!id || typeof id !== 'string') return null;
  const path = join(SCOPES_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return enrichScope(raw, opts);
  } catch {
    return null;
  }
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
  const path = join(cwd, '.cx', 'scope.json');
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
  const enrichOpts = { rootDir };
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
    const raw = JSON.parse(readFileSync(p, 'utf8'));
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
