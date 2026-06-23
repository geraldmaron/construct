/**
 * lib/config/intake-policy.mjs — project-scoped intake watcher policy.
 *
 * Resolves watch zones, scan depth, and additional directories from
 * construct.config.json intakePolicy, with warned fallback to legacy
 * .cx/intake-config.json and env overrides.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { loadProjectConfig, writeProjectConfig, findProjectConfigPath, PROJECT_CONFIG_FILENAME } from './project-config.mjs';
import {
  INTAKE_DEFAULT_MAX_DEPTH,
  INTAKE_HARD_MAX_DEPTH,
  INTAKE_DEPTH_GUIDANCE,
  describeIntakeDepth,
} from '../intake/constants.mjs';
import { INTAKE_CONFIG_FILE } from '../intake/legacy-paths.mjs';

export { INTAKE_DEFAULT_MAX_DEPTH, INTAKE_HARD_MAX_DEPTH, INTAKE_DEPTH_GUIDANCE, describeIntakeDepth };

export const DEFAULT_INTAKE_POLICY = Object.freeze({
  maxDepth: INTAKE_DEFAULT_MAX_DEPTH,
  zones: Object.freeze({
    rootInbox: true,
    projectInbox: true,
    docsIntake: true,
  }),
  additionalDirs: [],
});

function clampDepth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return INTAKE_DEFAULT_MAX_DEPTH;
  return Math.min(Math.floor(n), INTAKE_HARD_MAX_DEPTH);
}

function normalizeDir(dir, rootDir) {
  if (typeof dir !== 'string') return null;
  const trimmed = dir.trim();
  if (!trimmed) return null;
  return isAbsolute(trimmed) ? trimmed : resolve(rootDir, trimmed);
}

function parseEnvDirs(env) {
  const raw = String(env?.CX_INBOX_DIRS ?? '').trim();
  if (!raw) return [];
  return raw.split(':').map((p) => p.trim()).filter(Boolean);
}

function readLegacyIntakeConfig(rootDir) {
  const file = join(rootDir, INTAKE_CONFIG_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function intakePolicyFromProjectConfig(config) {
  const raw = config?.intakePolicy ?? {};
  const zones = raw.zones ?? {};
  return {
    maxDepth: clampDepth(raw.maxDepth ?? DEFAULT_INTAKE_POLICY.maxDepth),
    zones: {
      rootInbox: zones.rootInbox !== false,
      projectInbox: zones.projectInbox !== false,
      docsIntake: zones.docsIntake !== false,
    },
    additionalDirs: Array.isArray(raw.additionalDirs)
      ? raw.additionalDirs.map((d) => String(d).trim()).filter(Boolean)
      : [],
  };
}

export function legacyIntakeToPolicy(stored = {}) {
  return {
    maxDepth: clampDepth(stored.maxDepth ?? INTAKE_DEFAULT_MAX_DEPTH),
    zones: {
      rootInbox: stored.includeArchetypeInbox === true || stored.includeRootInbox === true,
      projectInbox: stored.includeProjectInbox !== false,
      docsIntake: stored.includeDocsIntake !== false,
    },
    additionalDirs: Array.isArray(stored.parentDirs) ? stored.parentDirs : [],
  };
}

export function policyToLegacyIntakeShape(policy) {
  return {
    parentDirs: policy.additionalDirs,
    maxDepth: policy.maxDepth,
    includeProjectInbox: policy.zones.projectInbox,
    includeDocsIntake: policy.zones.docsIntake,
    includeArchetypeInbox: policy.zones.rootInbox,
    includeRootInbox: policy.zones.rootInbox,
  };
}

export function loadIntakePolicy(rootDir, env = process.env) {
  const { config, path: configPath, raw } = loadProjectConfig(rootDir, env);
  const legacy = readLegacyIntakeConfig(rootDir);
  let policy;
  let source = 'default';
  let legacyWarning = null;

  if (configPath && raw?.intakePolicy) {
    policy = intakePolicyFromProjectConfig(config);
    source = 'project-config';
  } else if (legacy) {
    policy = legacyIntakeToPolicy(legacy);
    source = 'legacy-intake-config';
    legacyWarning = `Using deprecated ${INTAKE_CONFIG_FILE}; migrate with \`construct intake config migrate\``;
  } else {
    policy = structuredClone(DEFAULT_INTAKE_POLICY);
    source = 'default';
  }

  const envDirs = parseEnvDirs(env).map((dir) => normalizeDir(dir, rootDir)).filter(Boolean);
  const additionalDirs = []
    .concat(policy.additionalDirs.map((dir) => normalizeDir(dir, rootDir)).filter(Boolean))
    .concat(envDirs);

  const seen = new Set();
  const uniqueDirs = [];
  for (const dir of additionalDirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    uniqueDirs.push(dir);
  }

  const envDepth = env?.CX_INTAKE_MAX_DEPTH;
  const maxDepth = clampDepth(envDepth ?? policy.maxDepth);

  return {
    maxDepth,
    zones: { ...policy.zones },
    additionalDirs: uniqueDirs,
    source,
    legacyWarning,
  };
}

export function resolvedIntakeConfig(rootDir, env = process.env) {
  const policy = loadIntakePolicy(rootDir, env);
  return {
    parentDirs: policy.additionalDirs,
    maxDepth: policy.maxDepth,
    includeProjectInbox: policy.zones.projectInbox,
    includeDocsIntake: policy.zones.docsIntake,
    includeArchetypeInbox: policy.zones.rootInbox,
    includeRootInbox: policy.zones.rootInbox,
    source: policy.source,
    legacyWarning: policy.legacyWarning,
  };
}

export function saveIntakePolicy(rootDir, patch = {}, options = {}) {
  const configPath = findProjectConfigPath(rootDir) ?? join(rootDir, PROJECT_CONFIG_FILENAME);
  const { config } = loadProjectConfig(rootDir, {});
  const current = intakePolicyFromProjectConfig(config.intakePolicy ? config : { intakePolicy: DEFAULT_INTAKE_POLICY });

  const nextZones = { ...current.zones, ...(patch.zones ?? {}) };
  const next = {
    maxDepth: clampDepth(patch.maxDepth ?? current.maxDepth),
    zones: {
      rootInbox: patch.rootInbox !== undefined ? Boolean(patch.rootInbox) : (patch.zones?.rootInbox ?? nextZones.rootInbox),
      projectInbox: patch.projectInbox !== undefined ? Boolean(patch.projectInbox) : (patch.zones?.projectInbox ?? nextZones.projectInbox),
      docsIntake: patch.docsIntake !== undefined ? Boolean(patch.docsIntake) : (patch.zones?.docsIntake ?? nextZones.docsIntake),
    },
    additionalDirs: Array.isArray(patch.additionalDirs)
      ? patch.additionalDirs.map((dir) => normalizeDir(dir, rootDir)).filter(Boolean)
      : current.additionalDirs,
  };

  if (patch.addDir) {
    const dir = normalizeDir(patch.addDir, rootDir);
    if (dir && !next.additionalDirs.includes(dir)) {
      next.additionalDirs = [...next.additionalDirs, dir];
    }
  }
  if (patch.removeDir) {
    const dir = normalizeDir(patch.removeDir, rootDir);
    next.additionalDirs = next.additionalDirs.filter((d) => d !== dir);
  }

  const updated = {
    ...config,
    version: config.version ?? 1,
    intakePolicy: next,
  };

  if (options.dryRun) {
    return { policy: next, configPath, dryRun: true };
  }

  writeProjectConfig(configPath, updated);
  return { policy: next, configPath };
}

export function migrateLegacyIntakeConfig(rootDir) {
  const legacy = readLegacyIntakeConfig(rootDir);
  if (!legacy) {
    return { migrated: false, reason: 'no legacy file' };
  }
  const policy = legacyIntakeToPolicy(legacy);
  saveIntakePolicy(rootDir, policy);
  return { migrated: true, policy };
}
