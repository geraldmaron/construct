/**
 * kernel/project/lock.ts — the committed record of which skill and workflow
 * versions this project resolved, with their digests and where they came from.
 *
 * The registry writes it and compares against it; this module owns only the
 * file's shape.
 */

import { ProjectFileError, expectFormat, expectRecord, isRecord, refuseForbiddenKeys } from './files.ts';

export const LOCK_FORMAT = 'construct-registry-lock';
export const LOCK_VERSION = 2;

export interface LockedBundle {
  readonly version: string;
  readonly digest: string;
  readonly origin: 'builtin' | 'project';
}

export interface RegistryLock {
  readonly format: typeof LOCK_FORMAT;
  readonly formatVersion: typeof LOCK_VERSION;
  readonly skills: Readonly<Record<string, LockedBundle>>;
  readonly workflows: Readonly<Record<string, LockedBundle>>;
}

export function emptyLock(): RegistryLock {
  return { format: LOCK_FORMAT, formatVersion: LOCK_VERSION, skills: {}, workflows: {} };
}

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function bundles(raw: unknown, path: string, key: string): Record<string, LockedBundle> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new ProjectFileError(path, `"${key}" must be an object keyed by id`);
  const out: Record<string, LockedBundle> = {};
  for (const [id, entry] of Object.entries(raw)) {
    const where = `${path} "${key}.${id}"`;
    if (!isRecord(entry)) throw new ProjectFileError(where, 'must be an object');
    const { version, digest, origin } = entry;
    if (typeof version !== 'string' || !SEMVER.test(version)) throw new ProjectFileError(where, '"version" must be a semantic version');
    if (typeof digest !== 'string' || !DIGEST.test(digest)) throw new ProjectFileError(where, '"digest" must be sha256:<64 hex>');
    if (origin !== 'builtin' && origin !== 'project') throw new ProjectFileError(where, '"origin" must be builtin or project');
    out[id] = { version, digest, origin };
  }
  return out;
}

export function validateLock(raw: unknown, path: string): RegistryLock {
  const record = expectRecord(raw, path);
  expectFormat(record, path, LOCK_FORMAT, LOCK_VERSION);
  refuseForbiddenKeys(record, path);
  return {
    format: LOCK_FORMAT,
    formatVersion: LOCK_VERSION,
    skills: bundles(record.skills, path, 'skills'),
    workflows: bundles(record.workflows, path, 'workflows'),
  };
}
