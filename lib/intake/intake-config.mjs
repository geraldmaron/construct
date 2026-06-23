/**
 * lib/intake/intake-config.mjs — intake watcher config facade.
 *
 * Reads and writes intake policy via construct.config.json intakePolicy.
 * Legacy .cx/intake-config.json remains a warned compatibility fallback.
 */

import { shouldCreateCx } from '../project-detection.mjs';
import {
  loadIntakePolicy,
  resolvedIntakeConfig,
  saveIntakePolicy,
  migrateLegacyIntakeConfig,
  DEFAULT_INTAKE_POLICY,
} from '../config/intake-policy.mjs';
import {
  INTAKE_DEFAULT_MAX_DEPTH,
  INTAKE_HARD_MAX_DEPTH,
  INTAKE_DEPTH_GUIDANCE,
  describeIntakeDepth,
} from './constants.mjs';
import { INTAKE_CONFIG_FILE } from './legacy-paths.mjs';
import { join } from 'node:path';

export {
  INTAKE_DEFAULT_MAX_DEPTH,
  INTAKE_HARD_MAX_DEPTH,
  INTAKE_DEPTH_GUIDANCE,
  describeIntakeDepth,
  INTAKE_CONFIG_FILE,
  migrateLegacyIntakeConfig,
  DEFAULT_INTAKE_POLICY,
};

export const DEFAULT_INTAKE_CONFIG = Object.freeze({
  parentDirs: [],
  maxDepth: INTAKE_DEFAULT_MAX_DEPTH,
  includeProjectInbox: true,
  includeDocsIntake: true,
  includeArchetypeInbox: true,
  includeRootInbox: true,
});

export function intakeConfigPath(rootDir) {
  return join(rootDir, INTAKE_CONFIG_FILE);
}

export function loadIntakeConfig(rootDir, env = process.env) {
  const cfg = resolvedIntakeConfig(rootDir, env);
  if (cfg.legacyWarning && process.stderr.isTTY) {
    process.stderr.write(`[intake-config] ${cfg.legacyWarning}\n`);
  }
  return cfg;
}

export function saveIntakeConfig(rootDir, patch = {}) {
  if (!shouldCreateCx(rootDir)) {
    throw new Error('Refusing to write intake config: directory is not an initialized construct project. Run `construct init` first.');
  }

  const policyPatch = {};
  if (patch.maxDepth !== undefined) policyPatch.maxDepth = patch.maxDepth;
  if (patch.includeProjectInbox !== undefined) policyPatch.projectInbox = patch.includeProjectInbox;
  if (patch.includeDocsIntake !== undefined) policyPatch.docsIntake = patch.includeDocsIntake;
  if (patch.includeArchetypeInbox !== undefined || patch.includeRootInbox !== undefined) {
    policyPatch.rootInbox = patch.includeRootInbox ?? patch.includeArchetypeInbox;
  }
  if (Array.isArray(patch.parentDirs)) policyPatch.additionalDirs = patch.parentDirs;

  const { policy } = saveIntakePolicy(rootDir, policyPatch);
  return policyToLegacyShape(policy);
}

function policyToLegacyShape(policy) {
  return {
    parentDirs: policy.additionalDirs,
    maxDepth: policy.maxDepth,
    includeProjectInbox: policy.zones.projectInbox,
    includeDocsIntake: policy.zones.docsIntake,
    includeArchetypeInbox: policy.zones.rootInbox,
    includeRootInbox: policy.zones.rootInbox,
  };
}
