/**
 * Removes pre-project-scope Construct footprints from user-global tool config.
 *
 * Opt-in only: strips legacy ambient adapters/MCP/state that can slow unrelated
 * Claude/Codex/OpenCode sessions, but never uninstalls a current global
 * `construct` CLI package.
 */

import fs from 'node:fs';
import path from 'node:path';

import { removeTomlTables, tomlString } from '../codex-config.mjs';

const CONSTRUCT_MCP_KEYS = ['memory', 'cass', 'construct-mcp'];

function exists(p) {
  try { fs.statSync(p); return true; } catch { return false; }
}

function rm(p, { dryRun, removed, label }) {
  if (!exists(p)) return false;
  removed.push(label || p);
  if (!dryRun) fs.rmSync(p, { recursive: true, force: true });
  return true;
}

function readJson(filePath) {
  if (!exists(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function writeJson(filePath, value, { dryRun, removed, label }) {
  removed.push(label || filePath);
  if (!dryRun) fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function hasConstructText(value) {
  return /construct|\.cx|\.construct/i.test(JSON.stringify(value ?? ''));
}

function stripClaudeSettings(homeDir, opts) {
  const filePath = path.join(homeDir, '.claude', 'settings.json');
  const settings = readJson(filePath);
  if (!settings || typeof settings !== 'object') return;
  let changed = false;

  if (settings.hooks && hasConstructText(settings.hooks)) {
    delete settings.hooks;
    changed = true;
  }

  if (settings.mcpServers && typeof settings.mcpServers === 'object') {
    for (const key of CONSTRUCT_MCP_KEYS) {
      if (key in settings.mcpServers) {
        delete settings.mcpServers[key];
        changed = true;
      }
    }
    if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
  }

  if (changed) writeJson(filePath, settings, { ...opts, label: '~/.claude/settings.json Construct entries' });
}

function stripOpenCode(homeDir, opts) {
  const filePath = path.join(homeDir, '.config', 'opencode', 'opencode.json');
  const config = readJson(filePath);
  if (!config || typeof config !== 'object') return;
  let changed = false;

  if (config.agent?.construct) {
    delete config.agent.construct;
    changed = true;
    if (Object.keys(config.agent).length === 0) delete config.agent;
  }

  if (config.mcp && typeof config.mcp === 'object') {
    for (const key of CONSTRUCT_MCP_KEYS) {
      if (key in config.mcp) {
        delete config.mcp[key];
        changed = true;
      }
    }
    if (Object.keys(config.mcp).length === 0) delete config.mcp;
  }

  if (Array.isArray(config.plugin)) {
    const next = config.plugin.filter((entry) => !/construct/i.test(String(entry)));
    if (next.length !== config.plugin.length) {
      config.plugin = next;
      changed = true;
    }
    if (config.plugin.length === 0) delete config.plugin;
  }

  if (changed) writeJson(filePath, config, { ...opts, label: '~/.config/opencode/opencode.json Construct entries' });
}

function stripVsCode(homeDir, opts) {
  const userDir = path.join(homeDir, 'Library', 'Application Support', 'Code', 'User');
  const mcpPath = path.join(userDir, 'mcp.json');
  const mcp = readJson(mcpPath);
  if (mcp?.servers && typeof mcp.servers === 'object') {
    let changed = false;
    for (const key of CONSTRUCT_MCP_KEYS) {
      if (key in mcp.servers) {
        delete mcp.servers[key];
        changed = true;
      }
    }
    if (changed) writeJson(mcpPath, mcp, { ...opts, label: 'VS Code mcp.json Construct servers' });
  }

  const settingsPath = path.join(userDir, 'settings.json');
  const settings = readJson(settingsPath);
  const copilotServers = settings?.['github.copilot.mcpServers'];
  if (copilotServers && typeof copilotServers === 'object') {
    let changed = false;
    for (const key of CONSTRUCT_MCP_KEYS) {
      if (key in copilotServers) {
        delete copilotServers[key];
        changed = true;
      }
    }
    if (Object.keys(copilotServers).length === 0) delete settings['github.copilot.mcpServers'];
    if (changed) writeJson(settingsPath, settings, { ...opts, label: 'VS Code settings.json Construct Copilot MCP servers' });
  }
}

function stripCodex(homeDir, opts) {
  const filePath = path.join(homeDir, '.codex', 'config.toml');
  if (!exists(filePath)) return;
  const existing = fs.readFileSync(filePath, 'utf8');
  let next = existing
    .replace(/\n?# BEGIN CONSTRUCT MCP SERVERS[\s\S]*?(?=\n# END CONSTRUCT MCP SERVERS\n)/g, '\n')
    .replace(/\n# END CONSTRUCT MCP SERVERS\n?/g, '\n')
    .replace(/\n?# BEGIN CONSTRUCT AGENTS[\s\S]*?(?=\n# END CONSTRUCT AGENTS\n)/g, '\n')
    .replace(/\n# END CONSTRUCT AGENTS\n?/g, '\n');
  const tables = [
    ...CONSTRUCT_MCP_KEYS.flatMap((key) => [`mcp_servers.${key}`, `mcp_servers.${tomlString(key)}`]),
    'agents.construct',
    `agents.${tomlString('construct')}`,
  ];
  next = removeTomlTables(next, tables);
  if (next.trimEnd() === existing.trimEnd()) return;
  opts.removed.push('~/.codex/config.toml Construct tables');
  if (!opts.dryRun) fs.writeFileSync(filePath, `${next.trimEnd()}\n`, 'utf8');
}

function rmConstructNamedChildren(dir, opts, labelPrefix) {
  if (!exists(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (/construct/i.test(entry)) rm(path.join(dir, entry), { ...opts, label: `${labelPrefix}/${entry}` });
  }
}

export function cleanupLegacyGlobalConstruct({ homeDir, dryRun = false } = {}) {
  const removed = [];
  const opts = { dryRun, removed };

  rm(path.join(homeDir, '.construct'), { ...opts, label: '~/.construct' });
  rm(path.join(homeDir, '.local', 'share', 'construct'), { ...opts, label: '~/.local/share/construct' });
  rm(path.join(homeDir, 'Library', 'LaunchAgents', 'dev.construct.pressure-release.plist'), {
    ...opts,
    label: 'Construct pressure-release LaunchAgent',
  });

  rm(path.join(homeDir, '.github', 'prompts', 'construct.prompt.md'), { ...opts, label: '~/.github/prompts/construct.prompt.md' });
  rm(path.join(homeDir, '.github', 'prompts', '.construct-manifest'), { ...opts, label: '~/.github/prompts/.construct-manifest' });
  rm(path.join(homeDir, '.config', 'opencode', 'plugin', 'construct-fallback.js'), {
    ...opts,
    label: '~/.config/opencode/plugin/construct-fallback.js',
  });

  stripClaudeSettings(homeDir, opts);
  stripOpenCode(homeDir, opts);
  stripVsCode(homeDir, opts);
  stripCodex(homeDir, opts);

  rmConstructNamedChildren(path.join(homeDir, '.claude', 'projects'), opts, '~/.claude/projects');
  rmConstructNamedChildren(path.join(homeDir, '.claude', 'plans'), opts, '~/.claude/plans');
  rmConstructNamedChildren(path.join(homeDir, '.cursor', 'projects'), opts, '~/.cursor/projects');
  rmConstructNamedChildren(path.join(homeDir, '.cursor', 'plans'), opts, '~/.cursor/plans');
  rm(path.join(homeDir, '.gemini', 'history', 'construct'), { ...opts, label: '~/.gemini/history/construct' });
  rm(path.join(homeDir, '.gemini', 'tmp', 'construct'), { ...opts, label: '~/.gemini/tmp/construct' });
  rmConstructNamedChildren(path.join(homeDir, 'Library', 'Caches', 'claude-cli-nodejs'), opts, 'Claude cache');

  return { removed, dryRun };
}
