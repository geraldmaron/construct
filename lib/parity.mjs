/**
 * lib/parity.mjs — Cross-surface parity verifier.
 *
 * After `construct sync` writes adapters to multiple surfaces (Claude Code,
 * OpenCode, Codex, Copilot, VS Code, Cursor), the module diffs each surface's actual state against the
 * canonical `specialists/registry.json`. Backs `construct doctor` for surfacing
 * silent divergence — for instance, an agent added to the registry that
 * never made it to OpenCode because of a sync regression.
 *
 * Each surface check is independent. A surface that is not installed (no
 * config dir, no agents dir) reports `status: 'absent'` rather than
 * generating a false-negative parity error. Surfaces explicitly opt out per
 * entry via `entry.platforms` (an allowlist, when present); entries without
 * the field are mirrored everywhere.
 *
 * Surfaces checked:
 *   claude    ~/.claude/agents/*.md
 *   opencode  ~/.config/opencode/opencode.json (agent table)
 *   codex     ~/.codex/agents/*.toml
 *   copilot   ~/.github/prompts/*.prompt.md
 *   vscode    VS Code user settings (github.copilot.mcpServers)
 *   cursor    ~/.cursor/mcp.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(MODULE_DIR, '..');

function loadRegistry(rootDir = ROOT_DIR) {
  const file = path.join(rootDir, 'specialists', 'registry.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function adapterName(entry, prefix) {
  return entry.isPersona ? entry.name : `${prefix}-${entry.name}`;
}

function entriesForSurface(registry, surface, { scope = 'global' } = {}) {
  const prefix = registry.prefix || 'cx';

  // User-scope expects only the `construct` front-door agent. Specialists
  // live with each Construct-managed project (apps/dashboard, apps/docs,
  // and every other repo that runs `construct init`) — see the two-tier
  // sync contract in scripts/sync-specialists.mjs.

  const entries = scope === 'project'
    ? [
        ...(registry.orchestrator ? [{ ...registry.orchestrator, isPersona: true }] : []),
        ...(registry.specialists || []).map((s) => ({ ...s, isPersona: false })),
      ]
    : registry.orchestrator
      ? [{ ...registry.orchestrator, isPersona: true }]
      : [];

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

function checkFileSurface({ surface, kind, dir, extension, expected }) {
  if (!fs.existsSync(dir)) return { surface, kind, status: 'absent', dir };
  const actual = fs.readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .map((name) => name.slice(0, -extension.length));
  const { missing, extra } = diffSets(expected, actual);
  return {
    surface,
    kind,
    status: missing.length === 0 && extra.length === 0 ? 'ok' : 'drift',
    dir,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    extra,
  };
}

function getVSCodeSettingsPaths(homeDir) {
  const platform = os.platform();
  if (platform === 'darwin') {
    return [
      path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
      path.join(homeDir, 'Library', 'Application Support', 'Code - Insiders', 'User', 'settings.json'),
    ];
  }
  if (platform === 'linux') {
    return [
      path.join(homeDir, '.config', 'Code', 'User', 'settings.json'),
      path.join(homeDir, '.config', 'Code - Insiders', 'User', 'settings.json'),
    ];
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');
    return [
      path.join(appData, 'Code', 'User', 'settings.json'),
      path.join(appData, 'Code - Insiders', 'User', 'settings.json'),
    ];
  }
  return [];
}

function checkClaude(registry, { homeDir = os.homedir() } = {}) {
  const expected = entriesForSurface(registry, 'claude');
  return checkFileSurface({
    surface: 'claude',
    kind: 'agents',
    dir: path.join(homeDir, '.claude', 'agents'),
    extension: '.md',
    expected,
  });
}

function checkOpenCode(registry, { homeDir = os.homedir() } = {}) {
  const file = path.join(homeDir, '.config', 'opencode', 'opencode.json');
  if (!fs.existsSync(file)) return { surface: 'opencode', kind: 'agents', status: 'absent', file };
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { surface: 'opencode', kind: 'agents', status: 'unreadable', file, error: err.message };
  }
  const expected = entriesForSurface(registry, 'opencode');
  const actual = Object.keys(config.agent || config.agents || {});
  const { missing, extra } = diffSets(expected, actual);
  return {
    surface: 'opencode',
    kind: 'agents',
    status: missing.length === 0 && extra.length === 0 ? 'ok' : 'drift',
    file,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    extra,
  };
}

function checkCodex(registry, { homeDir = os.homedir() } = {}) {
  const expected = entriesForSurface(registry, 'codex');
  return checkFileSurface({
    surface: 'codex',
    kind: 'agents',
    dir: path.join(homeDir, '.codex', 'agents'),
    extension: '.toml',
    expected,
  });
}

function checkCopilot(registry, { homeDir = os.homedir() } = {}) {
  // Use the same helper as Claude/OpenCode/Codex so all surfaces apply the
  // platform-filter rules identically. The previous implementation dropped
  // entries with internal:true, which produced false drift because the sync
  // script writes every specialist to ~/.github/prompts regardless of the
  // internal flag.
  const expected = entriesForSurface(registry, 'copilot');
  return checkFileSurface({
    surface: 'copilot',
    kind: 'prompts',
    dir: path.join(homeDir, '.github', 'prompts'),
    extension: '.prompt.md',
    expected,
  });
}

function checkVSCode(registry, { homeDir = os.homedir() } = {}) {
  const paths = getVSCodeSettingsPaths(homeDir).filter((settingsPath) => fs.existsSync(settingsPath));
  if (paths.length === 0) return { surface: 'vscode', kind: 'mcps', status: 'absent', paths };
  const expected = Object.keys(registry.mcpServers ?? {}).filter((id) => id !== 'memory');
  const actualSet = new Set();
  for (const settingsPath of paths) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      for (const id of Object.keys(settings['github.copilot.mcpServers'] ?? {})) actualSet.add(id);
    } catch (err) {
      return { surface: 'vscode', kind: 'mcps', status: 'unreadable', file: settingsPath, error: err.message };
    }
  }
  const actual = [...actualSet].sort();
  const { missing, extra } = diffSets(expected, actual);
  return {
    surface: 'vscode',
    kind: 'mcps',
    status: missing.length === 0 && extra.length === 0 ? 'ok' : 'drift',
    paths,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    extra,
  };
}

function checkCursor(registry, { homeDir = os.homedir() } = {}) {
  const file = path.join(homeDir, '.cursor', 'mcp.json');
  if (!fs.existsSync(file)) return { surface: 'cursor', kind: 'mcps', status: 'absent', file };
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { surface: 'cursor', kind: 'mcps', status: 'unreadable', file, error: err.message };
  }
  const expected = Object.keys(registry.mcpServers ?? {}).filter((id) => id !== 'memory');
  const actual = Object.keys(config.mcpServers ?? {});
  const { missing, extra } = diffSets(expected, actual);
  return {
    surface: 'cursor',
    kind: 'mcps',
    status: missing.length === 0 && extra.length === 0 ? 'ok' : 'drift',
    file,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    extra,
  };
}

// Names a v1.0.10 install would have populated at user scope (claude, codex,
// copilot) before the two-tier sync contract moved specialists to project
// scope. Pulled from the live registry so the roster auto-updates as new
// specialists land — anything in this set is "expected legacy state during
// an upgrade," not real drift.
function legacyUserScopeRoster(registry) {
  const prefix = registry.prefix || 'cx';
  const specialists = (registry.specialists || []).map((s) => `${prefix}-${s.name}`);
  return new Set(specialists);
}

/**
 * Run parity checks across every supported surface. Never throws — returns a
 * structured report so callers can render it however they like.
 *
 * A surface that reports `drift` is reclassified to `legacy-install` when the
 * only divergence is extras that all match the v1.0.10 user-scope roster — a
 * dev box mid-upgrade from v1.0.10 (which populated cx-* specialists at user
 * scope) to v1.0.13+ (project scope only). `legacy-install` rolls up to the
 * same overall-ok bucket as `absent` so it doesn't hard-fail the gate; the
 * summary still surfaces the `--fix-legacy-agents` hint.
 */
export function checkParity({ rootDir = ROOT_DIR, homeDir = os.homedir() } = {}) {
  const registry = loadRegistry(rootDir);
  const legacyRoster = legacyUserScopeRoster(registry);
  const surfaces = [
    checkClaude(registry, { homeDir }),
    checkOpenCode(registry, { homeDir }),
    checkCodex(registry, { homeDir }),
    checkCopilot(registry, { homeDir }),
    checkVSCode(registry, { homeDir }),
    checkCursor(registry, { homeDir }),
  ].map((s) => reclassifyLegacy(s, legacyRoster));

  const ok = surfaces.every((s) => s.status === 'ok' || s.status === 'absent' || s.status === 'legacy-install');
  const summary = surfaces.map((s) => {
    if (s.status === 'absent') return `${s.surface}: not installed`;
    if (s.status === 'unreadable') return `${s.surface}: unreadable (${s.error})`;
    if (s.status === 'ok') return `${s.surface}: ok (${s.actualCount}/${s.expectedCount} ${s.kind})`;
    if (s.status === 'legacy-install') {
      return `${s.surface}: legacy v1.0.10 install — ${s.extra.length} stale ${s.kind} (run \`construct doctor --fix-legacy-agents\`)`;
    }
    const parts = [];
    if (s.missing.length) parts.push(`missing: ${s.missing.join(', ')}`);
    if (s.extra.length) parts.push(`extra: ${s.extra.join(', ')}`);
    return `${s.surface}: drift — ${parts.join(' · ')}`;
  });

  return { ok, surfaces, summary };
}

function reclassifyLegacy(surface, legacyRoster) {
  if (surface.status !== 'drift') return surface;
  if ((surface.missing?.length ?? 0) !== 0) return surface;
  if (!surface.extra?.length) return surface;
  const allLegacy = surface.extra.every((name) => legacyRoster.has(name));
  if (!allLegacy) return surface;
  return { ...surface, status: 'legacy-install' };
}
