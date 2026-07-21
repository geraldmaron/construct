/**
 * lib/demo-manifest.mjs — canonical Demo Manifest loader (schemas/demo-manifest.schema.json).
 *
 * Reconciles the scattered demo-definition sources into one shape:
 * schemas/project-demo.schema.json (identity + script/tape) and
 * schemas/demo-recording.schema.json (Playwright recording engine config) are
 * different concerns, not merged — the Manifest's optional `recording` field
 * carries the latter's shape and the top-level fields carry the former's.
 * Neither prior schema nor lib/demo-recording.mjs's behavior is migrated or
 * changed by this module (construct-tsyfe.5.5's job); this loader only adds a
 * single entry point that resolves either shape into a canonical Manifest.
 *
 * Search order for a standalone Manifest (schema: construct/demo-manifest/1):
 * `.construct/demos/manifests/` then `templates/demos/manifests/`. For
 * backward-compatible discovery, the same search also falls through to
 * lib/demo-recording.mjs's existing dirs (`.construct/demos/recordings/`,
 * `templates/demos/recordings/`) and wraps a legacy recording-shaped file
 * into Manifest form (`reconciledFrom: 'demo-recording-legacy'`).
 *
 * A demo whose on-disk definition does not validate against the Manifest
 * schema fails loudly (`{ ok: false, errors }`), never silently skipped.
 *
 * `status` is the single authoritative state vocabulary
 * (DEMO_MANIFEST_STATUSES) shared with construct-tsyfe.5.2's demo-state
 * module — that module consumes this list rather than redefining it.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configPath } from './config-dir.mjs';
import { demoRecordingSearchDirs, loadDemoRecordingValidated } from './demo-recording.mjs';
import { nodeId } from './graph/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

export const DEMO_MANIFEST_SCHEMA = 'construct/demo-manifest/1';

export const DEMO_MANIFEST_STATUSES = Object.freeze([
  'declared', 'ready', 'served', 'executed', 'recorded', 'verified', 'certified',
  'script-only', 'degraded', 'failed', 'unavailable',
]);

export const DEMO_MANIFEST_GRAPH_NODE_TYPE = 'demo-manifest';

export function demoManifestSearchDirs({ cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  return [
    configPath(cwd, 'demos', 'manifests'),
    path.join(repoRoot, 'templates', 'demos', 'manifests'),
    ...demoRecordingSearchDirs({ cwd, repoRoot }),
  ];
}

export function resolveDemoManifestPath(name, { cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  for (const dir of demoManifestSearchDirs({ cwd, repoRoot })) {
    const candidate = path.join(dir, `${name}.json`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function listDemoManifestNames({ cwd = process.cwd(), repoRoot = REPO_ROOT } = {}) {
  const seen = new Set();
  const out = [];
  for (const dir of demoManifestSearchDirs({ cwd, repoRoot })) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const name = path.basename(file, '.json');
      if (seen.has(name)) continue;
      const loaded = loadDemoManifest(name, { cwd, repoRoot });
      if (!loaded.ok) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out.sort();
}

/**
 * Hand-rolled validator mirroring schemas/demo-manifest.schema.json's
 * required fields, const, enum, and pattern constraints (ADR-0001: no Ajv).
 * Returns { valid, errors } — errors name the offending field, never silent.
 */
export function validateDemoManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return { valid: false, errors: ['manifest is not an object'] };

  if (manifest.schema !== DEMO_MANIFEST_SCHEMA) errors.push(`schema must equal ${DEMO_MANIFEST_SCHEMA}`);
  if (typeof manifest.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)) {
    errors.push('name required, lowercase slug ([a-z0-9][a-z0-9-]*)');
  }
  if (typeof manifest.title !== 'string' || !manifest.title) errors.push('title required');

  if (manifest.status !== undefined && !DEMO_MANIFEST_STATUSES.includes(manifest.status)) {
    errors.push(`status must be one of: ${DEMO_MANIFEST_STATUSES.join(', ')}`);
  }
  if (manifest.fallbackSurface !== undefined && !['tape', 'playwright'].includes(manifest.fallbackSurface)) {
    errors.push('fallbackSurface must be tape or playwright');
  }
  if (manifest.script !== undefined && (typeof manifest.script !== 'string' || !manifest.script.endsWith('.json'))) {
    errors.push('script must be a .json path');
  }
  if (!manifest.script && !manifest.tape && !manifest.recording) {
    errors.push('at least one of script, tape, or recording is required');
  }

  if (manifest.recording !== undefined) {
    if (typeof manifest.recording !== 'object' || manifest.recording === null || Array.isArray(manifest.recording)) {
      errors.push('recording must be an object');
    } else {
      if (manifest.recording.engine !== undefined && manifest.recording.engine !== 'playwright') {
        errors.push(`recording.engine unsupported: ${manifest.recording.engine}`);
      }
      if (!manifest.recording.spec) errors.push('recording.spec is required when recording is present');
    }
  }

  if (manifest.commands !== undefined) {
    const badCommands = !Array.isArray(manifest.commands)
      || manifest.commands.some((c) => typeof c !== 'string' || !c.trim());
    if (badCommands) errors.push('commands must be an array of non-empty strings');
  }

  return { valid: errors.length === 0, errors };
}

export function normalizeDemoManifest(raw, name) {
  return {
    schema: DEMO_MANIFEST_SCHEMA,
    name: raw.name || name,
    title: raw.title || name,
    summary: raw.summary || null,
    project: raw.project || null,
    status: raw.status || 'declared',
    script: raw.script || null,
    tape: raw.tape || null,
    fallbackSurface: raw.fallbackSurface || 'tape',
    recording: raw.recording || null,
    commands: raw.commands || [],
    createdAt: raw.createdAt || null,
    sourcePath: raw.sourcePath || null,
    reconciledFrom: raw.reconciledFrom || 'manifest',
  };
}

/**
 * Reconcile a legacy schemas/demo-recording.schema.json file (found via
 * lib/demo-recording.mjs's existing search dirs) into Manifest shape, without
 * migrating the underlying file on disk.
 */
function reconcileLegacyRecording(name, opts) {
  const legacy = loadDemoRecordingValidated(name, opts);
  if (!legacy.ok) return { ok: false, errors: legacy.errors || [`not a valid legacy demo recording: ${name}`] };
  const manifest = normalizeDemoManifest({
    name,
    title: legacy.recording.title || name,
    status: 'declared',
    recording: legacy.recording,
    sourcePath: legacy.recording.sourcePath,
    reconciledFrom: 'demo-recording-legacy',
  }, name);
  return { ok: true, manifest, sourcePath: legacy.recording.sourcePath };
}

/**
 * The canonical reconciling loader: resolves a demo definition from either a
 * standalone Demo Manifest or (backward-compatibly) a legacy
 * schemas/demo-recording.schema.json file, and validates it. A definition
 * that fails validation returns `{ ok: false, errors }` — it is never
 * silently skipped.
 */
export function loadDemoManifest(name, opts = {}) {
  const filePath = resolveDemoManifestPath(name, opts);
  if (!filePath) return { ok: false, errors: [`demo manifest not found: ${name}`] };

  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [err.message || 'invalid JSON'], sourcePath: filePath };
  }

  if (raw.schema !== DEMO_MANIFEST_SCHEMA) {
    const reconciled = reconcileLegacyRecording(name, opts);
    if (!reconciled.ok) {
      return {
        ok: false,
        errors: [`not a Demo Manifest and not a valid legacy demo recording: ${reconciled.errors.join('; ')}`],
        sourcePath: filePath,
      };
    }
    return { ok: true, manifest: reconciled.manifest, sourcePath: reconciled.sourcePath || filePath };
  }

  const validated = validateDemoManifest(raw);
  if (!validated.valid) return { ok: false, errors: validated.errors, sourcePath: filePath };
  return { ok: true, manifest: normalizeDemoManifest({ ...raw, sourcePath: filePath }, name), sourcePath: filePath };
}

/**
 * Graph-write helper: one Demo Manifest becomes one `demo-manifest` node.
 * Wiring this into the full graph-build
 * pipeline with file/package/test edges is construct-4uxq0.11.7's job; this
 * helper only needs to produce a node whose type is in
 * lib/graph/store.mjs's NODE_TYPES.
 */
export function demoManifestGraphNode(manifest) {
  const id = nodeId(DEMO_MANIFEST_GRAPH_NODE_TYPE, manifest.name);
  return {
    id,
    type: DEMO_MANIFEST_GRAPH_NODE_TYPE,
    name: manifest.title || manifest.name,
    attrs: {
      status: manifest.status || 'declared',
      script: manifest.script || null,
      tape: manifest.tape || null,
      project: manifest.project || null,
      reconciledFrom: manifest.reconciledFrom || 'manifest',
    },
  };
}
