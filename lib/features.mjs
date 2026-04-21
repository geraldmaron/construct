/**
 * lib/features.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(__dirname, 'mcp-catalog.json');

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

// OpenCode uses 'cass' for what Claude Code calls 'memory'
const OC_ID_MAP = { memory: 'cass' };

function getMcpPlatforms(serverId, overrides = {}) {
  const platforms = [];

  const claudeSettings = readClaudeSettings(overrides);
  if (claudeSettings?.mcpServers && serverId in claudeSettings.mcpServers) {
    platforms.push('Claude Code');
  }

  const ocConfig = readOpenCodeConfig(overrides);
  const ocId = OC_ID_MAP[serverId] ?? serverId;
  if (ocConfig?.mcp && ocId in ocConfig.mcp) {
    platforms.push('OpenCode');
  }

  for (const p of getVSCodeSettingsPaths(overrides)) {
    const settings = readJSON(p);
    if (settings?.['github.copilot.mcpServers'] && serverId in settings['github.copilot.mcpServers']) {
      const label = p.includes('Insiders') ? 'VS Code Insiders' : 'VS Code';
      if (!platforms.includes(label)) platforms.push(label);
    }
  }

  const cursorMcpPath = overrides.cursorMcpPath ?? join(getHomeDir(overrides), '.cursor', 'mcp.json');
  if (existsSync(cursorMcpPath)) {
    const cursorConfig = readJSON(cursorMcpPath);
    if (cursorConfig?.mcpServers && serverId in cursorConfig.mcpServers) {
      platforms.push('Cursor');
    }
  }

  return platforms;
}

function readCatalog() {
  if (!existsSync(CATALOG_PATH)) return { mcps: [] };
  try {
    return JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  } catch {
    return { mcps: [] };
  }
}

/**
 * Build features dynamically from mcp-catalog.json.
 * Each MCP reports configured state when present in host configs and unavailable when missing.
 */
function buildFeatures(overrides = {}) {
  const catalog = readCatalog();
  return catalog.mcps.map((mcp) => ({
    id: mcp.id,
    name: mcp.name,
    category: mcp.category,
    description: mcp.description,
    degradedMessage: mcp.degradedMessage,
    usedBy: mcp.usedBy ?? [],
    async check() {
      const platforms = getMcpPlatforms(mcp.id, overrides);
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
