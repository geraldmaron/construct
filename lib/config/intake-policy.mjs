/**
 * lib/config/intake-policy.mjs — project-scoped intake watcher policy.
 *
 * Resolves the canonical drop zone, scan depth, and additional directories from
 * construct.config.json intakePolicy (the only config source), with env
 * overrides and a default when intakePolicy is absent.
 *
 * Single-zone model (ADR-0045 §C): the only drop zone is the project-root
 * `inbox/`, always watched. `additionalDirs` (opt-in extra dirs) and `maxDepth`
 * remain configurable. There are no other zones — `.construct/inbox/` and `docs/intake/`
 * are not watched and not scaffolded.
 */

import { isAbsolute, join, resolve } from 'node:path';
import { loadProjectConfig, writeProjectConfig, findProjectConfigPath, PROJECT_CONFIG_FILENAME } from './project-config.mjs';
import {
  INTAKE_DEFAULT_MAX_DEPTH,
  INTAKE_HARD_MAX_DEPTH,
  INTAKE_DEPTH_GUIDANCE,
  describeIntakeDepth,
} from '../intake/constants.mjs';

export { INTAKE_DEFAULT_MAX_DEPTH, INTAKE_HARD_MAX_DEPTH, INTAKE_DEPTH_GUIDANCE, describeIntakeDepth };

export const DEFAULT_INTAKE_POLICY = Object.freeze({
  maxDepth: INTAKE_DEFAULT_MAX_DEPTH,
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

export function intakePolicyFromProjectConfig(config) {
  const raw = config?.intakePolicy ?? {};
  return {
    maxDepth: clampDepth(raw.maxDepth ?? DEFAULT_INTAKE_POLICY.maxDepth),
    additionalDirs: Array.isArray(raw.additionalDirs)
      ? raw.additionalDirs.map((d) => String(d).trim()).filter(Boolean)
      : [],
  };
}

export function loadIntakePolicy(rootDir, env = process.env) {
  const { config, path: configPath, raw } = loadProjectConfig(rootDir, env);
  let policy;
  let source = 'default';

  if (configPath && raw?.intakePolicy) {
    policy = intakePolicyFromProjectConfig(config);
    source = 'project-config';
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
    additionalDirs: uniqueDirs,
    source,
  };
}

export function resolvedIntakeConfig(rootDir, env = process.env) {
  const policy = loadIntakePolicy(rootDir, env);
  return {
    parentDirs: policy.additionalDirs,
    maxDepth: policy.maxDepth,
    source: policy.source,
  };
}

export function saveIntakePolicy(rootDir, patch = {}, options = {}) {
  const configPath = findProjectConfigPath(rootDir) ?? join(rootDir, PROJECT_CONFIG_FILENAME);
  const { config } = loadProjectConfig(rootDir, {});
  const current = intakePolicyFromProjectConfig(config.intakePolicy ? config : { intakePolicy: DEFAULT_INTAKE_POLICY });

  const next = {
    maxDepth: clampDepth(patch.maxDepth ?? current.maxDepth),
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
