/**
 * lib/features.mjs — Feature flag resolution for Construct capabilities.
 *
 * Reads ~/.cx/features.json and project-level .cx/features.json to determine
 * which optional features are active. Provides isFlagEnabled() used throughout
 * the codebase to gate experimental paths without modifying core logic.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { loadPluginRegistry } from './plugin-registry.mjs';

function getHomeDir(overrides = {}) {
  return overrides.homeDir ?? homedir();
}

function getFeaturesFile(overrides = {}) {
  return overrides.featuresFile ?? join(getHomeDir(overrides), '.construct', 'features.json');
}

function getClaudeSettingsPath(overrides = {}) {
  return overrides.claudeSettingsPath ?? join(getHomeDir(overrides), '.claude', 'settings.json');
}

function readEnabledFeatures(overrides = {}) {
  const featuresFile = getFeaturesFile(overrides);
  if (!existsSync(featuresFile)) return null;
  try {
    return JSON.parse(readFileSync(featuresFile, 'utf8'));
  } catch {
    return null;
  }
}

function isFeatureEnabled(id, overrides = {}) {
  const data = readEnabledFeatures(overrides);
  if (!data) return null;
  return (data.enabled ?? []).includes(id);
}

function readClaudeSettings(overrides = {}) {
  const claudeSettings = getClaudeSettingsPath(overrides);
  if (!existsSync(claudeSettings)) return null;
  try {
    return JSON.parse(readFileSync(claudeSettings, 'utf8'));
  } catch {
    return null;
  }
}

function getOpenCodeConfigPaths(overrides = {}) {
  const home = getHomeDir(overrides);
  return overrides.openCodeConfigPaths ?? [
    join(home, '.config', 'opencode', 'opencode.json'),
  ];
}

function readOpenCodeConfig(overrides = {}) {
  for (const p of getOpenCodeConfigPaths(overrides)) {
    if (!existsSync(p)) continue;
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { /* skip */ }
  }
  return null;
}

function getVSCodeSettingsPaths(overrides = {}) {
  if (overrides.vscodeSettingsPaths) return overrides.vscodeSettingsPaths.filter(existsSync);
  const home = getHomeDir(overrides);
  const { platform } = process;
  if (platform === 'darwin') {
    return [
      join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
      join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'settings.json'),
    ].filter(existsSync);
  }
  if (platform === 'linux') {
    return [
      join(home, '.config', 'Code', 'User', 'settings.json'),
      join(home, '.config', 'Code - Insiders', 'User', 'settings.json'),
    ].filter(existsSync);
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return [
      join(appData, 'Code', 'User', 'settings.json'),
      join(appData, 'Code - Insiders', 'User', 'settings.json'),
    ].filter(existsSync);
  }
  return [];
}

function readJSON(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function getHostSupport(mcp, host) {
  const support = mcp?.hostSupport?.[host];
  if (!support) return { mode: 'managed' };
  if (typeof support === 'string') return { mode: support };
  if (typeof support === 'object') return { mode: support.mode ?? 'managed', ...support };
  return { mode: 'managed' };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the set of IDs to match against host configs for a given MCP entry.
 * Includes the canonical id, any declared aliases, and the OpenCode mapping.
 */
function getMcpMatchIds(mcp) {
  const ids = new Set([mcp.id]);
  for (const alias of mcp.aliases ?? []) {
    ids.add(alias);
  }
  return ids;
}

/**
 * Check whether any of the given IDs appear as keys in a config object.
 */
function configHasAny(config, ids) {
  if (!config || typeof config !== 'object') return false;
  for (const id of ids) {
    if (id in config) return true;
  }
  return false;
}

/**
 * Resolve all project-level .mcp.json paths to check.
 * Claude Code supports .mcp.json at project root and in .claude/ directories.
 */
function getProjectMcpPaths(overrides = {}) {
  if (overrides.projectMcpPaths) return overrides.projectMcpPaths;
  const cwd = overrides.cwd ?? process.cwd();
  return [
    join(cwd, '.mcp.json'),
    join(cwd, '.claude', 'mcp.json'),
  ];
}

/**
 * Load Claude.ai server-side managed MCP IDs.
 * These are integrations connected through Claude.ai's web interface
 * (e.g., Notion, Google Drive) that aren't discoverable from local config.
 * Users declare them via ~/.construct/claude-ai-mcps.json: { "mcps": ["notion", "slack"] }
 */
function getClaudeAiManagedMcps(overrides = {}) {
  const p = overrides.claudeAiMcpsPath ?? join(getHomeDir(overrides), '.construct', 'claude-ai-mcps.json');
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(data?.mcps) ? data.mcps : [];
  } catch {
    return [];
  }
}

/**
 * Resolve Claude marketplace plugin directories to scan for .mcp.json files.
 */
function getMarketplaceMcpPaths(overrides = {}) {
  if (overrides.marketplaceMcpPaths) return overrides.marketplaceMcpPaths;
  const home = getHomeDir(overrides);
  const marketplaceRoot = join(home, '.claude', 'plugins', 'marketplaces');
  if (!existsSync(marketplaceRoot)) return [];

  const paths = [];
  try {
    for (const marketplace of readdirSync(marketplaceRoot)) {
      const extDir = join(marketplaceRoot, marketplace, 'external_plugins');
      if (!existsSync(extDir)) continue;
      try {
        for (const plugin of readdirSync(extDir)) {
          const mcpFile = join(extDir, plugin, '.mcp.json');
          if (existsSync(mcpFile)) paths.push(mcpFile);
        }
      } catch { /* skip unreadable dirs */ }
    }
  } catch { /* skip unreadable marketplace root */ }
  return paths;
}

function getMcpPlatforms(mcp, overrides = {}) {
  const platforms = [];
  const matchIds = getMcpMatchIds(mcp);

  // --- Claude.ai server-side managed MCPs ---
  const cloudMcps = getClaudeAiManagedMcps(overrides);
  if (cloudMcps.some((id) => matchIds.has(id))) {
    platforms.push('Claude.ai');
  }

  // --- Claude Code: user settings (~/.claude/settings.json) ---
  const claudeSettings = readClaudeSettings(overrides);
  if (getHostSupport(mcp, 'claude').mode === 'managed' && configHasAny(claudeSettings?.mcpServers, matchIds)) {
    platforms.push('Claude Code');
  }

  // --- Claude Code: project-level .mcp.json ---
  if (!platforms.includes('Claude Code')) {
    for (const p of getProjectMcpPaths(overrides)) {
      if (!existsSync(p)) continue;
      const projectMcp = readJSON(p);
      if (configHasAny(projectMcp?.mcpServers, matchIds) || configHasAny(projectMcp, matchIds)) {
        platforms.push('Claude Code');
        break;
      }
    }
  }

  // --- Claude marketplace plugins (~/.claude/plugins/marketplaces/*/external_plugins/*/.mcp.json) ---
  if (!platforms.includes('Claude Code')) {
    for (const p of getMarketplaceMcpPaths(overrides)) {
      const pluginMcp = readJSON(p);
      if (configHasAny(pluginMcp, matchIds)) {
        platforms.push('Claude Code');
        break;
      }
    }
  }

  // --- OpenCode ---
  const ocConfig = readOpenCodeConfig(overrides);
  const ocIds = new Set([...matchIds]);
  if (getHostSupport(mcp, 'opencode').mode === 'managed' && configHasAny(ocConfig?.mcp, ocIds)) {
    platforms.push('OpenCode');
  }

  // --- VS Code / Copilot ---
  for (const p of getVSCodeSettingsPaths(overrides)) {
    const settings = readJSON(p);
    if (configHasAny(settings?.['github.copilot.mcpServers'], matchIds)) {
      const label = p.includes('Insiders') ? 'VS Code Insiders' : 'VS Code';
      if (!platforms.includes(label)) platforms.push(label);
    }
  }

  // --- Cursor ---
  const cursorMcpPath = overrides.cursorMcpPath ?? join(getHomeDir(overrides), '.cursor', 'mcp.json');
  if (existsSync(cursorMcpPath)) {
    const cursorConfig = readJSON(cursorMcpPath);
    if (configHasAny(cursorConfig?.mcpServers, matchIds)) {
      platforms.push('Cursor');
    }
  }

  // --- Codex ---
  const codexConfigPath = overrides.codexConfigPath ?? join(getHomeDir(overrides), '.codex', 'config.toml');
  if (existsSync(codexConfigPath)) {
    const codexConfig = readFileSync(codexConfigPath, 'utf8');
    const codexSupport = getHostSupport(mcp, 'codex');
    if (codexSupport.mode === 'plugin' && codexSupport.plugin) {
      const pattern = new RegExp(`\\[plugins\\.${JSON.stringify(codexSupport.plugin)}\\]\\s*\\nenabled = true`, 'm');
      if (pattern.test(codexConfig)) platforms.push(codexSupport.label ?? 'Codex Plugin');
    } else if (codexSupport.mode === 'managed') {
      const idAlts = [...matchIds].map(escapeRegExp).join('|');
      const pattern = new RegExp(`^\\[mcp_servers\\.("?)(?:${idAlts})\\1\\]`, 'm');
      if (pattern.test(codexConfig)) platforms.push('Codex');
    }
  }

  return platforms;
}

/**
 * Build features dynamically from the plugin registry.
 * Each MCP reports configured state when present in host configs and unavailable when missing.
 */
function buildFeatures(overrides = {}) {
  const registry = loadPluginRegistry({
    cwd: overrides.cwd ?? process.cwd(),
    homeDir: getHomeDir(overrides),
    env: overrides.env ?? process.env,
  });
  return registry.mcps.map((mcp) => ({
    id: mcp.id,
    name: mcp.name,
    category: mcp.category,
    description: mcp.description,
    degradedMessage: mcp.degradedMessage,
    usedBy: mcp.usedBy ?? [],
    async check() {
      const platforms = getMcpPlatforms(mcp, overrides);
      if (platforms.length > 0) {
        return { status: 'configured', message: `Configured in ${platforms.join(', ')}` };
      }
      return { status: 'unavailable', message: 'Not configured in any host' };
    },
  }));
}

export const FEATURES = buildFeatures();

export function getFeatureById(id) {
  return FEATURES.find(f => f.id === id) ?? null;
}

export async function checkAllFeatures(overrides = {}) {
  const data = readEnabledFeatures(overrides);
  const enabledIds = data?.enabled ?? null;
  const features = buildFeatures(overrides);

  return Promise.all(
    features.map(async (feature) => {
      const isCore = feature.category === 'core';
      const enabled = isCore ? true : (enabledIds === null ? null : enabledIds.includes(feature.id));
      if (enabled === false) {
        return {
          id: feature.id,
          name: feature.name,
          category: feature.category,
          description: feature.description,
          degradedMessage: feature.degradedMessage,
          usedBy: feature.usedBy,
          enabled: false,
          status: 'disabled',
          message: feature.degradedMessage,
        };
      }

      const result = await feature.check();
      return {
        id: feature.id,
        name: feature.name,
        category: feature.category,
        description: feature.description,
        degradedMessage: feature.degradedMessage,
        usedBy: feature.usedBy,
        enabled: enabled ?? true,
        ...result,
      };
    })
  );
}

export { readEnabledFeatures, isFeatureEnabled };
