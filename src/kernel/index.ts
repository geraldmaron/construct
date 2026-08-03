/**
 * kernel/index.ts — public kernel surface. Pure libraries only: no CLI, no
 * host, no ambient filesystem or environment access outside paths.ts.
 */

export { resolvePaths } from './paths.ts';
export type { Paths, PathsEnv } from './paths.ts';
export { findUntaggedClaims } from './verify/claims.ts';
export type { UntaggedClaim } from './verify/claims.ts';
export { buildCleanupCatalog } from './cleanup/catalog.ts';
export type { CleanupItem, CleanupScope, CleanupRisk, CleanupTarget } from './cleanup/catalog.ts';
export { detectedItems, selectedItems, applyCleanup } from './cleanup/run.ts';
export type { CleanupOptions, CleanupOutcome, CleanupResult } from './cleanup/run.ts';
