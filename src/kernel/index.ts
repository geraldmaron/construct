/**
 * kernel/index.ts — public kernel surface for the packaged export.
 */

export * from './state/index.ts';
export * from './work/index.ts';
export * from './safety/containment.ts';

export * from './context/retrieval.ts';
export { snapshotItemRef } from './source/manifest.ts';
export { EXECUTION_PATHS, type OutcomeIntent } from './workflow/intake.ts';
export type { ReviewerIdentity, SemanticContract, SemanticWitness } from './workflow/semantic-review.ts';
