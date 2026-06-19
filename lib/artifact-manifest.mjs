/**
 * lib/artifact-manifest.mjs — Load and resolve the artifact capability manifest.
 *
 * specialists/artifact-manifest.json is the single source of truth for document
 * type metadata: templates, tone, structure, visuals, and release gates.
 * Consumer projects without a local copy resolve the shipped manifest from the
 * Construct package root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMPTY_MANIFEST = { version: 1, artifacts: {} };

let cached = null;
let cachedRoot = null;

function manifestPathForRoot(root) {
  return path.join(root, 'specialists', 'artifact-manifest.json');
}

export function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    const manifest = manifestPathForRoot(current);
    if (fs.existsSync(manifest)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (fs.existsSync(manifestPathForRoot(PACKAGE_ROOT))) return PACKAGE_ROOT;
  return null;
}

export function loadArtifactManifest({ rootDir, force = false, cwd = process.cwd() } = {}) {
  const resolvedRoot = rootDir ?? findConstructRoot(cwd) ?? PACKAGE_ROOT;
  if (cached && !force && cachedRoot === resolvedRoot) return cached;

  const p = manifestPathForRoot(resolvedRoot);
  if (!fs.existsSync(p)) {
    cached = EMPTY_MANIFEST;
    cachedRoot = resolvedRoot;
    return cached;
  }

  cached = JSON.parse(fs.readFileSync(p, 'utf8'));
  cachedRoot = resolvedRoot;
  return cached;
}

export function getArtifactEntry(type, opts = {}) {
  const manifest = loadArtifactManifest(opts);
  return manifest.artifacts?.[type] ?? null;
}

export function artifactTypes(opts = {}) {
  const manifest = loadArtifactManifest(opts);
  return Object.keys(manifest.artifacts ?? {});
}

export function structureRequirementsFromManifest(opts = {}) {
  const manifest = loadArtifactManifest(opts);
  const out = {};
  for (const [type, entry] of Object.entries(manifest.artifacts ?? {})) {
    if (entry.structureRequirements?.length) out[type] = entry.structureRequirements;
  }
  return out;
}

export function visualRequirementsFromManifest(opts = {}) {
  const manifest = loadArtifactManifest(opts);
  const out = {};
  for (const [type, entry] of Object.entries(manifest.artifacts ?? {})) {
    if (entry.visualRequirements?.length) out[type] = entry.visualRequirements;
  }
  return out;
}

export function loadBrandVoice(cwd = process.cwd()) {
  const p = path.join(cwd, '.cx', 'brand-voice.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function resolveToneForArtifact(type, { cwd = process.cwd(), rootDir } = {}) {
  const entry = getArtifactEntry(type, { rootDir, cwd });
  const brand = loadBrandVoice(cwd);
  const override = brand?.toneOverride?.[type];
  if (override) return override;
  return entry?.toneDefault ?? 'direct';
}

export function templateMetadata(type, { cwd = process.cwd(), rootDir } = {}) {
  const entry = getArtifactEntry(type, { rootDir, cwd });
  if (!entry) return null;
  return {
    type,
    tone: resolveToneForArtifact(type, { cwd, rootDir }),
    toneAllowed: entry.toneAllowed ?? [],
    structureRequirements: entry.structureRequirements ?? [],
    visualRequirements: entry.visualRequirements ?? [],
    primaryOwners: entry.primaryOwners ?? [],
    workflowSkill: entry.workflowSkill ?? null,
    releaseGate: entry.releaseGate ?? null,
  };
}
