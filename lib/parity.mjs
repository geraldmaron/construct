/**
 * lib/parity.mjs — Cross-surface parity verifier.
 *
 * After `construct sync` writes adapters to multiple surfaces (Claude Code,
 * OpenCode, Codex, Copilot, VS Code, Cursor), the module diffs each surface's actual state against the
 * canonical `specialists/unified-registry.json`. Backs `construct doctor` for surfacing
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
 *   vscode    VS Code user mcp.json (servers)
 *   cursor    ~/.cursor/mcp.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(MODULE_DIR, '..');

// VS Code and Cursor user settings are JSONC: line/block comments and trailing
// commas are valid and common. Strict JSON.parse rejects them, producing a
// false "unreadable" parity failure on a perfectly valid editor config. This
// strips comments string-aware (so `//` inside a "https://…" value survives)
// and drops trailing commas before parsing.

function parseJsonc(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; out += '\n'; continue; }
    if (ch === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1; i += 1; continue; }
    out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function readJsoncFile(file) {
  return parseJsonc(fs.readFileSync(file, 'utf8'));
}

function loadRegistry(rootDir = ROOT_DIR) {
  const file = path.join(rootDir, 'specialists', 'unified-registry.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function adapterName(entry, prefix) {
  return entry.isPersona ? entry.name : `${prefix}-${entry.name}`;
}

function entriesForSurface(registry, surface, { scope = 'global' } = {}) {
  const prefix = registry.prefix || 'cx';

  // Support both legacy format (registry.orchestrator) and unified format
  // (orchestrator lives in registry.specialists with role:'orchestrator').
  // Unified format stores name:'orchestrator' but the adapter name is 'construct'
  // (hardcoded in unifiedToLegacyRegistry) — normalize it here so parity matches.
  const rawOrchestrator = registry.orchestrator
    || Object.values(registry.specialists || {}).find((s) => s.role === 'orchestrator');
  const orchestratorEntry = rawOrchestrator && rawOrchestrator.name !== 'construct'
    ? { ...rawOrchestrator, name: 'construct' }
    : rawOrchestrator;

  // User-scope expects only the `construct` front-door agent. Specialists
  // live with each Construct-managed project (apps/docs,
  // and every other repo that runs `construct init`) — see the two-tier
  // sync contract in scripts/sync-specialists.mjs.

  const entries = scope === 'project'
    ? [
        ...(orchestratorEntry ? [{ ...orchestratorEntry, isPersona: true }] : []),
        ...Object.values(registry.specialists || {})
          .filter((s) => s.role !== 'orchestrator')
          .map((s) => ({ ...s, isPersona: false })),
      ]
    : orchestratorEntry
      ? [{ ...orchestratorEntry, isPersona: true }]
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

// Construct ensures its own MCP servers are present; it does not own the user's
// full editor MCP list. A non-registry server the user added (e.g. playwright) is
// not drift — only a MISSING registry server is, which is a real sync regression.
// A rename still surfaces, since the new name registers as missing. Agent surfaces
// keep extra-detection (legacy cx-* cleanup), so this applies to MCP kinds only.

function mcpStatus(missing) {
  return missing.length === 0 ? 'ok' : 'drift';
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

function getVSCodeUserMcpPaths(homeDir) {
  const platform = os.platform();
  if (platform === 'darwin') {
    return [
      path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'),
      path.join(homeDir, 'Library', 'Application Support', 'Code - Insiders', 'User', 'mcp.json'),
    ];
  }
  if (platform === 'linux') {
    return [
      path.join(homeDir, '.config', 'Code', 'User', 'mcp.json'),
      path.join(homeDir, '.config', 'Code - Insiders', 'User', 'mcp.json'),
    ];
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');
    return [
      path.join(appData, 'Code', 'User', 'mcp.json'),
      path.join(appData, 'Code - Insiders', 'User', 'mcp.json'),
    ];
  }
  return [];
}

function checkClaude(registry, { homeDir = os.homedir() } = {}) {
  // Global ~/.claude/agents ships no agent — the project orchestrator is the
  // front door, and a global agent doubles in editors that read both scopes
  // (VS Code). The expected user-scope set is therefore empty.
  return checkFileSurface({
    surface: 'claude',
    kind: 'agents',
    dir: path.join(homeDir, '.claude', 'agents'),
    extension: '.md',
    expected: [],
  });
}

const OPENCODE_BUILTIN_AGENTS = new Set(['title', 'summary', 'compaction']);

function checkOpenCode(registry, { homeDir = os.homedir() } = {}) {
  const file = path.join(homeDir, '.config', 'opencode', 'opencode.json');
  if (!fs.existsSync(file)) return { surface: 'opencode', kind: 'agents', status: 'absent', file };
  let config;
  try {
    config = readJsoncFile(file);
  } catch (err) {
    return { surface: 'opencode', kind: 'agents', status: 'unreadable', file, error: err.message };
  }
  const expected = entriesForSurface(registry, 'opencode');
  const actual = Object.keys(config.agent || config.agents || {})
    .filter((id) => !OPENCODE_BUILTIN_AGENTS.has(id));
  const { missing, extra } = diffSets(expected, actual);

  // OpenCode's own system agents (title/summary/compaction) are filtered from
  // `actual` above, so any remaining extra is real drift here. checkParity then
  // reclassifies drift → legacy-install when every extra is a registry cx-*
  // specialist (a soft upgrade state), via reclassifyLegacy.

  return {
    surface: 'opencode',
    kind: 'agents',
    status: (missing.length === 0 && extra.length === 0) ? 'ok' : 'drift',
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
  const expected = Object.keys(registry.mcpServers ?? {}).filter((id) => id !== 'memory');
  const actualSet = new Set();
  const paths = [];

  // An empty or hand-malformed user `mcp.json` is a normal VS Code state (a
  // 0-byte file is common) — global Construct MCP is opt-in there, so an
  // unparseable file counts as "not configured", not a hard parity failure.

  for (const mcpPath of getVSCodeUserMcpPaths(homeDir)) {
    if (!fs.existsSync(mcpPath)) continue;
    if (!fs.readFileSync(mcpPath, 'utf8').trim()) continue;
    let config;
    try { config = readJsoncFile(mcpPath); } catch { continue; }
    paths.push(mcpPath);
    for (const id of Object.keys(config.servers ?? {})) actualSet.add(id);
  }
  if (paths.length === 0) return { surface: 'vscode', kind: 'mcps', status: 'absent', paths };

  // `memory` is the optional local cm bridge — sync writes it, but it is not
  // required (excluded from `expected`), so it must not count as drift-extra.
  const actual = [...actualSet].filter((id) => id !== 'memory').sort();
  const { missing, extra } = diffSets(expected, actual);
  return {
    surface: 'vscode',
    kind: 'mcps',
    status: mcpStatus(missing),
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
    config = readJsoncFile(file);
  } catch (err) {
    return { surface: 'cursor', kind: 'mcps', status: 'unreadable', file, error: err.message };
  }
  const expected = Object.keys(registry.mcpServers ?? {}).filter((id) => id !== 'memory');
  const actual = Object.keys(config.mcpServers ?? {}).filter((id) => id !== 'memory');
  const { missing, extra } = diffSets(expected, actual);
  return {
    surface: 'cursor',
    kind: 'mcps',
    status: mcpStatus(missing),
    file,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    extra,
  };
}

function checkProjectMcp(registry, { projectDir, surface, relPath, configKey }) {
  const file = path.join(projectDir, relPath);
  if (!fs.existsSync(file)) {
    return { surface, scope: 'project', kind: 'mcps', status: 'absent', file };
  }
  let config;
  try {
    config = readJsoncFile(file);
  } catch (err) {
    return { surface, scope: 'project', kind: 'mcps', status: 'unreadable', file, error: err.message };
  }
  const servers = config[configKey] ?? {};
  const expected = Object.keys(registry.mcpServers ?? {}).filter((id) => id !== 'memory');
  const actual = Object.keys(servers).filter((id) => id !== 'memory');
  const { missing, extra } = diffSets(expected, actual);
  return {
    surface,
    scope: 'project',
    kind: 'mcps',
    status: mcpStatus(missing),
    file,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    extra,
  };
}

function checkProjectCursorRules({ projectDir }) {
  const pointer = path.join(projectDir, '.cursor', 'rules', 'construct.mdc');
  if (!fs.existsSync(pointer)) {
    return { surface: 'cursor', scope: 'project', kind: 'rules', status: 'absent', file: pointer };
  }
  const text = fs.readFileSync(pointer, 'utf8');
  const stale = !text.includes('Generated by construct sync');
  return {
    surface: 'cursor',
    scope: 'project',
    kind: 'rules',
    status: stale ? 'drift' : 'ok',
    file: pointer,
    stale,
  };
}

function checkProjectClaudeAgent({ projectDir, registry }) {
  const expected = registry.orchestrator?.name || 'construct';
  const file = path.join(projectDir, '.claude', 'agents', `${expected}.md`);
  if (!fs.existsSync(file)) {
    return { surface: 'claude', scope: 'project', kind: 'agents', status: 'absent', file, expected: [expected] };
  }
  return { surface: 'claude', scope: 'project', kind: 'agents', status: 'ok', file, expected: [expected], actual: [expected] };
}

/**
 * Project-scoped adapter parity for Construct-managed repos (.cx/ or .construct/).
 * Checks `.cursor/mcp.json`, `.vscode/mcp.json`, front-door rule, and construct agent.
 */
export function checkProjectParity({ rootDir = ROOT_DIR, projectDir = rootDir } = {}) {
  const cxPresent = fs.existsSync(path.join(projectDir, '.cx')) || fs.existsSync(path.join(projectDir, '.construct'));
  if (!cxPresent) {
    return { ok: true, skipped: true, surfaces: [], summary: ['project: not a Construct project'] };
  }
  const registry = loadRegistry(rootDir);
  const surfaces = [
    checkProjectClaudeAgent({ projectDir, registry }),
    checkProjectMcp(registry, { projectDir, surface: 'cursor', relPath: '.cursor/mcp.json', configKey: 'mcpServers' }),
    checkProjectMcp(registry, { projectDir, surface: 'vscode', relPath: '.vscode/mcp.json', configKey: 'servers' }),
    checkProjectCursorRules({ projectDir }),
  ];
  const ok = surfaces.every((s) => s.status === 'ok' || s.status === 'absent');
  const summary = surfaces.map((s) => {
    if (s.status === 'absent') return `${s.surface} (project): missing ${s.kind}`;
    if (s.status === 'unreadable') return `${s.surface} (project): unreadable (${s.error})`;
    if (s.status === 'ok') return `${s.surface} (project): ok`;
    if (s.stale) return `${s.surface} (project): stale construct.mdc — run \`npm run adapters\``;
    const parts = [];
    if (s.missing?.length) parts.push(`missing: ${s.missing.join(', ')}`);
    if (s.extra?.length) parts.push(`extra: ${s.extra.join(', ')}`);
    return `${s.surface} (project): drift — ${parts.join(' · ')}`;
  });
  return { ok, skipped: false, surfaces, summary };
}

// Names a v1.0.10 install would have populated at user scope (claude, codex,
// copilot) before the two-tier sync contract moved specialists to project
// scope. Pulled from the live registry so the roster auto-updates as new
// specialists land — anything in this set is "expected legacy state during
// an upgrade," not real drift.
function legacyUserScopeRoster(registry) {
  const prefix = registry.prefix || 'cx';
  const specialists = Object.values(registry.specialists || {}).map((s) => `${prefix}-${s.name}`);
  // The front-door agent is project-scoped too now, so a leftover `construct.md`
  // in user-scope `.claude/agents` is a soft upgrade state, not real drift.
  const frontDoor = registry.orchestrator?.name ? [registry.orchestrator.name] : [];
  return new Set([...specialists, ...frontDoor]);
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
