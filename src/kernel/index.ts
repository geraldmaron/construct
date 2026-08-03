/**
 * kernel/index.ts — public kernel surface. Pure libraries only: no CLI, no
 * host, no ambient filesystem or environment access outside paths.ts.
 */

export { resolvePaths } from './paths.ts';
export type { Paths, PathsEnv } from './paths.ts';
export { findUntaggedClaims } from './verify/claims.ts';
export type { UntaggedClaim } from './verify/claims.ts';
