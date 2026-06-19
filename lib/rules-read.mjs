/**
 * lib/rules-read.mjs — read rule files with reference telemetry.
 *
 * Central read path for enforcement and sync tooling so `construct rules usage`
 * can roll up which rules are actually loaded at runtime.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { logRuleCall } from './telemetry/rule-calls.mjs';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function normalizeRulePath(rel) {
  const trimmed = String(rel || '').replace(/^\.\//, '');
  if (trimmed.startsWith('rules/')) return trimmed;
  return `rules/${trimmed.replace(/\.md$/, '')}.md`;
}

export function readRuleFile(rel, { rootDir = REPO_ROOT, source = 'validation', callerContext, env } = {}) {
  const rulePath = normalizeRulePath(rel);
  logRuleCall({ rulePath, source, callerContext }, { env });
  return fs.readFileSync(path.join(rootDir, rulePath), 'utf8');
}
