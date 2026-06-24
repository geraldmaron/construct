/**
 * lib/intake/intake-config.mjs — intake watcher config facade.
 *
 * Reads and writes intake policy via construct.config.json intakePolicy, the
 * only config source (single-zone model, ADR-0045 §C).
 */

import { shouldCreateCx } from '../project-detection.mjs';
import {
  resolvedIntakeConfig,
  saveIntakePolicy,
  DEFAULT_INTAKE_POLICY,
} from '../config/intake-policy.mjs';
import {
  INTAKE_DEFAULT_MAX_DEPTH,
  INTAKE_HARD_MAX_DEPTH,
  INTAKE_DEPTH_GUIDANCE,
  describeIntakeDepth,
} from './constants.mjs';

export {
  INTAKE_DEFAULT_MAX_DEPTH,
  INTAKE_HARD_MAX_DEPTH,
  INTAKE_DEPTH_GUIDANCE,
  describeIntakeDepth,
  DEFAULT_INTAKE_POLICY,
};

export const DEFAULT_INTAKE_CONFIG = Object.freeze({
  parentDirs: [],
  maxDepth: INTAKE_DEFAULT_MAX_DEPTH,
});

export function loadIntakeConfig(rootDir, env = process.env) {
  return resolvedIntakeConfig(rootDir, env);
}

export function saveIntakeConfig(rootDir, patch = {}) {
  if (!shouldCreateCx(rootDir)) {
    throw new Error('Refusing to write intake config: directory is not an initialized construct project. Run `construct init` first.');
  }

  const policyPatch = {};
  if (patch.maxDepth !== undefined) policyPatch.maxDepth = patch.maxDepth;
  if (Array.isArray(patch.parentDirs)) policyPatch.additionalDirs = patch.parentDirs;

  const { policy } = saveIntakePolicy(rootDir, policyPatch);
  return policyToConfigShape(policy);
}

function policyToConfigShape(policy) {
  return {
    parentDirs: policy.additionalDirs,
    maxDepth: policy.maxDepth,
  };
}
