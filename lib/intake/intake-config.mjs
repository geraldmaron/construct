/**
 * lib/intake/intake-config.mjs — user-facing intake watcher config.
 *
 * Lets the user define which directories the inbox watcher scans and how
 * deep it descends through subdirectories. Persists to
 * `<rootDir>/.cx/intake-config.json` and merges with env-driven defaults so
 * CLI, dashboard, and process env all converge on the same answer.
 *
 * Schema:
 *   {
 *     parentDirs: string[]   // absolute or rootDir-relative
 *     maxDepth: number       // 0 = only the parent dir, no subdirs
 *     includeProjectInbox: boolean  // always include <rootDir>/.cx/inbox
 *     includeDocsIntake: boolean    // include <rootDir>/docs/intake when present
 *   }
 *
 * maxDepth guidance (surfaced verbatim in the dashboard):
 *   0 — only files directly inside the parent dir
 *   1 — parent dir + its immediate subdirs
 *   2 — two levels of subdirs (a common default for project intake roots)
 *   3+ — deep scans; use with care on large trees
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { shouldCreateCx } from '../project-detection.mjs';

export const INTAKE_CONFIG_FILE = '.cx/intake-config.json';
export const INTAKE_DEFAULT_MAX_DEPTH = 4;
export const INTAKE_HARD_MAX_DEPTH = 16;

export const INTAKE_DEPTH_GUIDANCE = [
  { value: 0, label: 'Only this directory', detail: 'Scans files directly in the parent dir, ignores all subdirs.' },
  { value: 1, label: 'One level deep', detail: 'Parent dir plus its immediate subdirs (e.g. parent/intake/file.md).' },
  { value: 2, label: 'Two levels deep', detail: 'Parent and two subdirs. A reasonable default for organized intake roots.' },
  { value: 4, label: 'Four levels (default)', detail: 'Catches most nested layouts without scanning huge trees.' },
  { value: 8, label: 'Deep scan', detail: 'Useful for archives. Slower; skip if the parent contains build output.' },
  { value: INTAKE_HARD_MAX_DEPTH, label: 'Unlimited (capped)', detail: `Walks up to ${INTAKE_HARD_MAX_DEPTH} levels — effectively unlimited. May be slow.` },
];

export const DEFAULT_INTAKE_CONFIG = Object.freeze({
  parentDirs: [],
  maxDepth: INTAKE_DEFAULT_MAX_DEPTH,
  includeProjectInbox: true,
  includeDocsIntake: true,
});

export function intakeConfigPath(rootDir) {
  return join(rootDir, INTAKE_CONFIG_FILE);
}

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

export function loadIntakeConfig(rootDir, env = process.env) {
  const file = intakeConfigPath(rootDir);
  let stored = {};
  if (existsSync(file)) {
    try { stored = JSON.parse(readFileSync(file, 'utf8')); } catch { stored = {}; }
  }

  const parentDirs = []
    .concat(Array.isArray(stored.parentDirs) ? stored.parentDirs : [])
    .concat(parseEnvDirs(env))
    .map((dir) => normalizeDir(dir, rootDir))
    .filter(Boolean);

  const seen = new Set();
  const uniqueDirs = [];
  for (const dir of parentDirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    uniqueDirs.push(dir);
  }

  const envDepth = env?.CX_INTAKE_MAX_DEPTH;
  const maxDepth = clampDepth(envDepth ?? stored.maxDepth ?? DEFAULT_INTAKE_CONFIG.maxDepth);

  return {
    parentDirs: uniqueDirs,
    maxDepth,
    includeProjectInbox: stored.includeProjectInbox !== false,
    includeDocsIntake: stored.includeDocsIntake !== false,
  };
}

export function saveIntakeConfig(rootDir, patch = {}) {
  if (!shouldCreateCx(rootDir)) {
    throw new Error('Refusing to write intake config: directory is not an initialized construct project. Run `construct init` first.');
  }
  const current = loadIntakeConfig(rootDir, {});
  const next = {
    parentDirs: Array.isArray(patch.parentDirs)
      ? patch.parentDirs.map((dir) => normalizeDir(dir, rootDir)).filter(Boolean)
      : current.parentDirs,
    maxDepth: clampDepth(patch.maxDepth ?? current.maxDepth),
    includeProjectInbox: patch.includeProjectInbox !== undefined ? Boolean(patch.includeProjectInbox) : current.includeProjectInbox,
    includeDocsIntake: patch.includeDocsIntake !== undefined ? Boolean(patch.includeDocsIntake) : current.includeDocsIntake,
  };

  const file = intakeConfigPath(rootDir);
  mkdirSync(join(rootDir, '.cx'), { recursive: true });
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export function describeIntakeDepth(depth = INTAKE_DEFAULT_MAX_DEPTH) {
  const value = clampDepth(depth);
  const exact = INTAKE_DEPTH_GUIDANCE.find((g) => g.value === value);
  if (exact) return exact;
  return {
    value,
    label: `Custom depth (${value})`,
    detail: `Walks up to ${value} levels of subdirectories below each parent.`,
  };
}
