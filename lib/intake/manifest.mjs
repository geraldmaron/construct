/**
 * lib/intake/manifest.mjs — SHA-256 dedup manifest for intake-archetype projects.
 *
 * Projects that scaffold the intake archetype (profile.capabilities.intake)
 * drop raw source files into `inbox/`. The manifest records which source
 * files have already been processed (by content hash, not path) so the
 * intake runtime can refuse to reprocess an unchanged file and so a moved
 * or renamed file still dedups correctly.
 *
 * Storage: <projectRoot>/.cx/intake/manifest.json
 *
 * Shape:
 *   {
 *     "version": 1,
 *     "files": {
 *       "<sha256>": {
 *         "sourcePath": "inbox/notes-2026-05-29.md",
 *         "processedAt": "2026-05-29T19:00:00.000Z",
 *         "intakeId": "intake-1779164832122-onxe",
 *         "createdBy": "Gerald Dagher <gerald@example.com>",
 *         "createdByAgent": "claude-opus-4-7"
 *       }
 *     }
 *   }
 *
 * Pure functions over the JSON. Callers own the rootDir; no implicit cwd.
 * Atomic writes go through write-rename so a crash mid-write cannot leave
 * the manifest half-written.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const MANIFEST_REL_PATH = '.cx/intake/manifest.json';
export const MANIFEST_VERSION = 1;

function manifestPath(rootDir) {
  return join(rootDir, MANIFEST_REL_PATH);
}

function emptyManifest() {
  return { version: MANIFEST_VERSION, files: {} };
}

export function loadManifest(rootDir) {
  const p = manifestPath(rootDir);
  if (!existsSync(p)) return emptyManifest();
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object' || typeof raw.files !== 'object') {
      return emptyManifest();
    }
    return raw;
  } catch {
    return emptyManifest();
  }
}

export function saveManifest(rootDir, manifest) {
  const p = manifestPath(rootDir);
  const dir = join(rootDir, '.cx', 'intake');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(manifest, null, 2) + '\n';
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, payload, 'utf8');
  renameSync(tmp, p);
}

export function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function hasFile(rootDir, sha) {
  if (!sha) return false;
  const manifest = loadManifest(rootDir);
  return Boolean(manifest.files[sha]);
}

export function recordFile(rootDir, sha, entry) {
  if (!sha) throw new Error('recordFile: sha is required');
  const manifest = loadManifest(rootDir);
  manifest.files[sha] = {
    sourcePath: entry?.sourcePath ?? null,
    processedAt: entry?.processedAt ?? new Date().toISOString(),
    intakeId: entry?.intakeId ?? null,
    createdBy: entry?.createdBy ?? null,
    createdByAgent: entry?.createdByAgent ?? null,
  };
  saveManifest(rootDir, manifest);
  return manifest.files[sha];
}

export function manifestStats(rootDir) {
  const manifest = loadManifest(rootDir);
  const entries = Object.values(manifest.files);
  return {
    total: entries.length,
    version: manifest.version,
  };
}
