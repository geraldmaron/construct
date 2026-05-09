/**
 * lib/parity.mjs — Cross-surface parity verifier.
 *
 * After `construct sync` writes adapters to multiple surfaces (Claude Code,
 * OpenCode, Codex), this module diffs each surface's actual state against the
 * canonical `agents/registry.json`. Used by `construct doctor` to surface
 * silent divergence — for instance, an agent added to the registry that
 * never made it to OpenCode because of a sync regression.
 *
 * Each surface check is independent. A surface that is not installed (no
 * config dir, no agents dir) reports `status: 'absent'` rather than
 * generating a false-negative parity error. Surfaces explicitly opt out per
 * entry via `entry.platforms` (an allowlist, when present); entries without
 * the field are mirrored everywhere.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(MODULE_DIR, '..');

function loadRegistry(rootDir = ROOT_DIR) {
  const file = path.join(rootDir, 'agents', 'registry.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function adapterName(entry, prefix) {
  return entry.isPersona ? entry.name : `${prefix}-${entry.name}`;
}

function entriesForSurface(registry, surface) {
  const prefix = registry.prefix || 'cx';
  const entries = [
    ...(registry.personas || []).map((p) => ({ ...p, isPersona: true })),
    ...(registry.agents || []).map((a) => ({ ...a, isPersona: false })),
  ];

  return entries
    .filter((e) => {
      if (!Array.isArray(e.platforms)) return true;
      return e.platforms.includes(surface);
    })
    .map((e) => adapterName(e, prefix));
}

function diffSets(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((n) => !actualSet.has(n));
  const extra = actual.filter((n) => !expectedSet.has(n));
  return { missing, extra };
}

function checkClaude(registry, { homeDir = os.homedir() } = {}) {
  const dir = path.join(homeDir, '.claude', 'agents');
  if (!fs.existsSync(dir)) return { surface: 'claude', status: 'absent', dir };
  const expected = entriesForSurface(registry, 'claude');
  const actual = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.replace(/\.md$/, ''));
  const { missing, extra } = diffSets(expected, actual);
  return {
    surface: 'claude',
    status: missing.length === 0 && extra.length === 0 ? 'ok' : 'drift',
    dir,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    extra,
  };
}

function checkOpenCode(registry, { homeDir = os.homedir() } = {}) {
  const file = path.join(homeDir, '.config', 'opencode', 'opencode.json');
  if (!fs.existsSync(file)) return { surface: 'opencode', status: 'absent', file };
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { surface: 'opencode', status: 'unreadable', file, error: err.message };
  }
  const expected = entriesForSurface(registry, 'opencode');
  const actual = Object.keys(config.agent || config.agents || {});
  const { missing, extra } = diffSets(expected, actual);
  return {
    surface: 'opencode',
    status: missing.length === 0 && extra.length === 0 ? 'ok' : 'drift',
    file,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    extra,
  };
}

/**
 * Run parity checks across every supported surface. Never throws — returns a
 * structured report so callers can render it however they like.
 */
export function checkParity({ rootDir = ROOT_DIR, homeDir = os.homedir() } = {}) {
  const registry = loadRegistry(rootDir);
  const surfaces = [
    checkClaude(registry, { homeDir }),
    checkOpenCode(registry, { homeDir }),
  ];

  const ok = surfaces.every((s) => s.status === 'ok' || s.status === 'absent');
  const summary = surfaces.map((s) => {
    if (s.status === 'absent') return `${s.surface}: not installed`;
    if (s.status === 'unreadable') return `${s.surface}: unreadable (${s.error})`;
    if (s.status === 'ok') return `${s.surface}: ok (${s.actualCount}/${s.expectedCount})`;
    const parts = [];
    if (s.missing.length) parts.push(`missing: ${s.missing.join(', ')}`);
    if (s.extra.length) parts.push(`extra: ${s.extra.join(', ')}`);
    return `${s.surface}: drift — ${parts.join(' · ')}`;
  });

  return { ok, surfaces, summary };
}
