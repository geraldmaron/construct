/**
 * lib/compat-surfaces.mjs — compat surface registry and tombstone evaluation.
 *
 * Centralizes retirement metadata for CLI compat aliases documented in
 * lib/cli-compat-catalog.mjs. evaluateCompatSurface() answers whether a
 * surface's stated expiration window has passed; formatRetiredCliMessage()
 * emits stable replacement guidance for hard-removed flag forms.
 */

import { CLI_SUNSET_DECISIONS } from './cli-compat-catalog.mjs';

export const COMPAT_SURFACE_REGISTRY = Object.freeze({
  matrix: Object.freeze({
    id: 'matrix',
    surface: CLI_SUNSET_DECISIONS.matrix.surface,
    status: 'removed',
    adr: 'ADR-0053',
    replacement: CLI_SUNSET_DECISIONS.matrix.replacement,
    deprecatedSince: '1.5.0',
    removeAfterReleaseCycles: 2,
    removedAt: '2.0.0',
  }),
  'install --scope': Object.freeze({
    id: 'install --scope',
    surface: CLI_SUNSET_DECISIONS['install --scope'].surface,
    status: 'removed',
    adr: 'ADR-0071',
    replacement: CLI_SUNSET_DECISIONS['install --scope'].replacement,
    deprecatedSince: '1.9.0',
    removeAfterReleaseCycles: 1,
    removedAt: '2.0.0',
  }),
  'models --reset': Object.freeze({
    id: 'models --reset',
    surface: CLI_SUNSET_DECISIONS['models --reset'].surface,
    status: 'removed',
    adr: null,
    replacement: CLI_SUNSET_DECISIONS['models --reset'].replacement,
    deprecatedSince: '1.8.0',
    removeAfterReleaseCycles: 1,
    removedAt: '2.0.0',
  }),
  'models --set': Object.freeze({
    id: 'models --set',
    surface: CLI_SUNSET_DECISIONS['models --set'].surface,
    status: 'removed',
    adr: null,
    replacement: CLI_SUNSET_DECISIONS['models --set'].replacement,
    deprecatedSince: '1.8.0',
    removeAfterReleaseCycles: 1,
    removedAt: '2.0.0',
  }),
  'models --poll': Object.freeze({
    id: 'models --poll',
    surface: CLI_SUNSET_DECISIONS['models --poll'].surface,
    status: 'removed',
    adr: null,
    replacement: CLI_SUNSET_DECISIONS['models --poll'].replacement,
    deprecatedSince: '1.8.0',
    removeAfterReleaseCycles: 1,
    removedAt: '2.0.0',
  }),
});

const MODELS_FLAG_TO_SURFACE = Object.freeze({
  '--reset': 'models --reset',
  '--poll': 'models --poll',
});

export function listCompatSurfaces() {
  return Object.values(COMPAT_SURFACE_REGISTRY);
}

export function resolveCompatSurface(id) {
  return COMPAT_SURFACE_REGISTRY[id] ?? null;
}

export function resolveModelsRetiredSurface(flag) {
  if (flag.startsWith('--set=')) return COMPAT_SURFACE_REGISTRY['models --set'];
  return COMPAT_SURFACE_REGISTRY[MODELS_FLAG_TO_SURFACE[flag]] ?? null;
}

export function evaluateCompatSurface(id, { now = new Date() } = {}) {
  const entry = resolveCompatSurface(id);
  if (!entry) {
    return { ok: false, known: false, expired: false, removed: false, message: `Unknown compat surface: ${id}` };
  }

  const removed = entry.status === 'removed';
  const expired = removed || isPastRemovalWindow(entry, now);

  return {
    ok: true,
    known: true,
    id: entry.id,
    status: entry.status,
    expired,
    removed,
    replacement: entry.replacement,
    adr: entry.adr,
    surface: entry.surface,
  };
}

function isPastRemovalWindow(entry, now) {
  if (!entry.removedAt) return false;
  const [major] = String(entry.removedAt).split('.').map(Number);
  if (!Number.isFinite(major)) return false;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const syntheticMajor = year - 2020 + Math.floor(month / 6);
  return syntheticMajor >= major;
}

export function formatRetiredCliMessage(entryOrId, { attempted = null } = {}) {
  const entry = typeof entryOrId === 'string' ? resolveCompatSurface(entryOrId) : entryOrId;
  if (!entry) {
    return attempted
      ? `Unknown option: ${attempted}. Run \`construct --help\` for supported commands.`
      : 'Retired CLI surface.';
  }
  const attempt = attempted ? ` (${attempted})` : '';
  const adr = entry.adr ? ` per ${entry.adr}` : '';
  return `Retired CLI surface${attempt}: ${entry.surface}${adr}. Use ${entry.replacement} instead.`;
}
