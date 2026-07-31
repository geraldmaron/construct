/**
 * lib/reconcile/mcp-entry-reconcile.mjs — strip Codex `[mcp_servers.<id>]`
 * tables whose `bearer_token_env_var` references an unset env var from configs
 * written before the sync-time fix.
 *
 * Codex aborts at startup when an MCP server's bearer_token_env_var names an
 * env var that is unset. The sync writer now omits such entries, but a config
 * written by an earlier version still carries them. This repair removes exactly
 * those construct-managed tables from the global `~/.codex/config.toml` and a
 * project `.codex/config.toml` when present, preserving every other table.
 *
 * Detection mirrors the sync-time gate (codexMcpEnvResolves): an entry whose
 * token env var resolves is kept; only unresolved-credential tables are pruned.
 * Tables with no credential requirement are never touched. Removal is scoped to
 * registry-managed MCP ids by exact table name, so user-authored mcp_servers
 * tables are out of scope. Safety: `auto`. detect() reads only; apply() is
 * idempotent because removeTomlTables drains the matched tables to none.
 */

import fs from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { homeDir, constructDir } from '../paths.mjs';
import {
  getCodexConfigPath,
  buildCodexMcpEntry,
  removeTomlTables,
  tomlString,
} from '../codex-config.mjs';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function registryMcpServers() {
  for (const rootDir of [constructDir(), fileURLToPath(new URL('../..', import.meta.url))]) {
    try {
      const registry = loadRegistry({ rootDir, skipValidation: true });
      if (registry?.mcpServers && Object.keys(registry.mcpServers).length > 0) {
        return registry.mcpServers;
      }
    } catch { /* try next root */ }
  }
  try {
    const templatePath = path.join(constructDir(), 'platforms', 'claude', 'settings.template.json');
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    return template.mcpServers || {};
  } catch {
    return {};
  }
}

function hasMcpTable(text, id) {
  return new RegExp(`^\\[mcp_servers\\.(?:${escapeRegExp(id)}|${escapeRegExp(tomlString(id))})\\]`, 'm').test(text);
}

// An entry with no bearer_token_env_var has no credential requirement and is
// always valid. An entry whose token env var is set resolves; an unset value
// (undefined or empty string) is the abort condition Codex hits at startup.

function tokenResolves(id, def, env) {
  const entry = buildCodexMcpEntry(id, def, env);
  const tokenVar = entry?.bearer_token_env_var;
  if (!tokenVar) return true;
  const val = env[tokenVar];
  return val !== undefined && val !== '';
}

function configTargets() {
  const targets = [{ scope: 'global', file: getCodexConfigPath(homeDir()) }];
  const projectConfig = path.join(process.cwd(), '.codex', 'config.toml');
  if (fs.existsSync(projectConfig)) targets.push({ scope: 'project', file: projectConfig });
  return targets;
}

function unresolvedTables(text, registryMcp, env) {
  const ids = [];
  for (const id of Object.keys(registryMcp)) {
    if (!hasMcpTable(text, id)) continue;
    if (tokenResolves(id, registryMcp[id], env)) continue;
    ids.push(id);
  }
  return ids;
}

async function detect() {
  const registryMcp = registryMcpServers();
  if (Object.keys(registryMcp).length === 0) {
    return { needsRepair: false, summary: 'No registry MCP servers to reconcile.' };
  }
  const env = process.env;
  const offenders = [];
  for (const target of configTargets()) {
    let text = '';
    try {
      if (!fs.existsSync(target.file)) continue;
      text = fs.readFileSync(target.file, 'utf8');
    } catch {
      continue;
    }
    const ids = unresolvedTables(text, registryMcp, env);
    if (ids.length > 0) offenders.push({ ...target, ids });
  }
  if (offenders.length === 0) {
    return { needsRepair: false, summary: 'No Codex MCP tables reference an unset token env var.' };
  }
  const total = offenders.reduce((acc, o) => acc + o.ids.length, 0);
  return {
    needsRepair: true,
    summary: `${total} Codex MCP table${total === 1 ? '' : 's'} reference an unset token env var (${offenders.map((o) => `${o.scope}: ${o.ids.join(', ')}`).join('; ')}).`,
    details: { offenders: offenders.map((o) => ({ scope: o.scope, ids: o.ids })) },
  };
}

async function apply() {
  const registryMcp = registryMcpServers();
  const env = process.env;
  let removed = 0;
  const scopes = [];
  for (const target of configTargets()) {
    if (!fs.existsSync(target.file)) continue;
    const text = fs.readFileSync(target.file, 'utf8');
    const ids = unresolvedTables(text, registryMcp, env);
    if (ids.length === 0) continue;

    // Strip both the bare and quoted table forms per id, matching the names
    // the sync writer emits, so a table written either way is removed.

    const tableNames = ids.flatMap((id) => [`mcp_servers.${id}`, `mcp_servers.${tomlString(id)}`]);
    const cleaned = removeTomlTables(text, tableNames);
    fs.writeFileSync(target.file, `${cleaned.trimEnd()}\n`, 'utf8');
    removed += ids.length;
    scopes.push(`${target.scope}: ${ids.join(', ')}`);
  }
  if (removed === 0) return { summary: 'Already clean.' };
  return { summary: `Removed ${removed} unresolved Codex MCP table${removed === 1 ? '' : 's'} (${scopes.join('; ')}).` };
}

export default {
  id: 'mcp-entry-reconcile',
  description: 'Strip Codex MCP tables whose bearer_token_env_var references an unset env var from existing configs.',
  safety: 'auto',
  detect,
  apply,
};
