/**
 * lib/codex-config.mjs — helpers for Construct-managed Codex config blocks.
 *
 * Keeps Codex agent and MCP generation in one place so setup and sync do not
 * leave stale tables behind in ~/.codex/config.toml.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();

export function getCodexConfigPath(homeDir = HOME) {
  return path.join(homeDir, '.codex', 'config.toml');
}

export function readCodexConfig(configPath = getCodexConfigPath()) {
  if (!fs.existsSync(configPath)) return '';
  return fs.readFileSync(configPath, 'utf8');
}

export function writeCodexConfig(text, configPath = getCodexConfigPath()) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const cleaned = removeDanglingConstructMcpMarkers(removeDanglingConstructMcpTimeouts(text));
  fs.writeFileSync(configPath, `${cleaned.trimEnd()}\n`);
}

export function tomlString(value) {
  return JSON.stringify(value);
}

function tomlValue(value) {
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value).map(([key, val]) => `${key} = ${tomlValue(val)}`).join(', ')} }`;
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return tomlString(String(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function removeTomlTables(text, tableNames) {
  let next = text;
  for (const tableName of tableNames) {
    const pattern = new RegExp(`\\n?\\[${escapeRegExp(tableName)}\\]\\n[\\s\\S]*?(?=\\n\\[|(?![\\s\\S]))`);
    next = next.replace(pattern, '\n');
  }
  return next.replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function removeDanglingConstructMcpTimeouts(text) {
  return text.replace(/\nstartup_timeout_sec = 20\ntool_timeout_sec = 60\n(?=\n# BEGIN CONSTRUCT AGENTS)/g, '\n');
}

export function removeDanglingConstructMcpMarkers(text) {
  return text.replace(/\n# BEGIN CONSTRUCT MCP SERVERS(?:\n\s*)?(?=(?:# BEGIN CONSTRUCT AGENTS)|(?:# BEGIN CONSTRUCT MCP SERVERS)|(?![\s\S]))/g, '\n');
}

function resolveTemplateString(value, resolvedValues) {
  return String(value).replace(/__([A-Z0-9_]+)__/g, (_, name) => resolvedValues[name] ?? `__${name}__`);
}

function resolveArgs(args, resolvedValues) {
  return (args ?? []).map((arg) =>
    typeof arg === 'string' ? resolveTemplateString(arg, resolvedValues) : arg,
  );
}

function resolveEnv(env, resolvedValues) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return {};
  return Object.fromEntries(
    Object.entries(env)
      .map(([key, value]) => [key, typeof value === 'string' ? resolveTemplateString(value, resolvedValues) : value])
      .filter(([, value]) => typeof value !== 'string' || !value.includes('__')),
  );
}

export function buildCodexMcpEntry(id, mcpDef, resolvedValues = {}) {
  if (mcpDef.type === 'url') {
    const entry = {
      url: resolveTemplateString(mcpDef.url, resolvedValues),
      startup_timeout_sec: 20,
      tool_timeout_sec: 60,
    };

    if (id === 'github') {
      entry.bearer_token_env_var = 'GITHUB_TOKEN';
    } else {
      const authorization = mcpDef.headers?.Authorization;
      const match = typeof authorization === 'string' ? authorization.match(/^Bearer __([A-Z0-9_]+)__$/) : null;
      if (match) entry.bearer_token_env_var = match[1];
    }

    return entry;
  }

  return {
    command: mcpDef.command,
    ...(Array.isArray(mcpDef.args) && mcpDef.args.length > 0 ? { args: resolveArgs(mcpDef.args, resolvedValues) } : {}),
    ...(Object.keys(resolveEnv(mcpDef.env, resolvedValues)).length > 0 ? { env: resolveEnv(mcpDef.env, resolvedValues) } : {}),
    startup_timeout_sec: 20,
    tool_timeout_sec: 60,
  };
}

export function serializeCodexMcpTable(id, entry) {
  const lines = [`[mcp_servers.${tomlString(id)}]`];
  for (const [key, value] of Object.entries(entry)) {
    lines.push(`${key} = ${tomlValue(value)}`);
  }
  return lines.join('\n');
}
