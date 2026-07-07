/**
 * lib/storage/backend-registry.mjs — kind:'storage' provider resolution.
 *
 * Run-store selection uses the same extension-manifest substrate as queue
 * selection: builtin backends are always available, while project/user storage
 * manifests can name an implementation without central dispatch edits.
 */

import { loadManifestsFromDir, mergeManifests, resolveManifestDirs } from '../extensions/loader.mjs';

export const BUILTIN_STORAGE_BACKENDS = ['filesystem', 'sqlite', 'postgres'];
export const SUPPORTED_RUN_STORE_IMPLEMENTATIONS = ['filesystem', 'sqlite', 'postgres'];

export class UnregisteredStorageProviderError extends Error {
  constructor(backend) {
    super(
      `Storage backend '${backend}' has no registered kind:'storage' provider. ` +
      `Builtin providers: ${BUILTIN_STORAGE_BACKENDS.join(', ')}.`,
    );
    this.name = 'UnregisteredStorageProviderError';
    this.backend = backend;
  }
}

export class UnsupportedStorageProviderError extends Error {
  constructor(backend, implementation) {
    super(
      `Storage backend '${backend}' resolves to unsupported run-store implementation ` +
      `'${implementation || 'unknown'}'. Supported implementations: ` +
      `${SUPPORTED_RUN_STORE_IMPLEMENTATIONS.join(', ')}.`,
    );
    this.name = 'UnsupportedStorageProviderError';
    this.backend = backend;
    this.implementation = implementation || null;
  }
}

export function listStorageProviders({ rootDir = process.cwd(), env = process.env } = {}) {
  const homeDir = env?.HOME || env?.USERPROFILE || undefined;
  const dirs = resolveManifestDirs({ rootDir, homeDir });
  const builtin = loadManifestsFromDir(dirs.builtin).manifests;
  const user = loadManifestsFromDir(dirs.user).manifests;
  const project = loadManifestsFromDir(dirs.project).manifests;
  return mergeManifests(builtin, user, project).filter((m) => m.kind === 'storage');
}

export function findStorageProvider(backend, { rootDir = process.cwd(), env = process.env } = {}) {
  if (!backend) return null;
  return listStorageProviders({ rootDir, env }).find((m) => m.id === backend) || null;
}

export function runStoreImplementationFor(provider) {
  const impl = provider?.operations?.runStore || provider?.runStore || provider?.implementation;
  return typeof impl === 'string' && impl.trim() ? impl.trim().toLowerCase() : null;
}

export function resolveStorageBackend(backend, { rootDir = process.cwd(), env = process.env } = {}) {
  const requested = String(backend || '').trim().toLowerCase();
  if (!requested) return null;
  if (BUILTIN_STORAGE_BACKENDS.includes(requested)) {
    return { backend: requested, implementation: requested, provider: null };
  }

  const provider = findStorageProvider(requested, { rootDir, env });
  if (!provider) throw new UnregisteredStorageProviderError(requested);

  const implementation = runStoreImplementationFor(provider);
  if (!SUPPORTED_RUN_STORE_IMPLEMENTATIONS.includes(implementation)) {
    throw new UnsupportedStorageProviderError(requested, implementation);
  }

  return { backend: requested, implementation, provider };
}
