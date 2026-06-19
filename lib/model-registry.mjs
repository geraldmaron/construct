/**
 * lib/model-registry.mjs — compatibility re-exports for model tier resolution.
 *
 * Canonical implementation lives in lib/model-router.mjs. This module keeps
 * the legacy import path stable while CONSTRUCT_MODEL_* env aliases remain
 * supported for one release cycle via normalizeEnvAssignments in the router.
 */

export {
  resolveModelTiers,
  getModelForTier,
  getModelSource,
  validateModelTiers,
  formatModelStatus,
  readCurrentModels,
  setTierModel,
} from './model-router.mjs';
