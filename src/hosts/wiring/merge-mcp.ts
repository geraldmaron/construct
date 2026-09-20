/**
 * hosts/wiring/merge-mcp.ts — add or read one server entry in a host's MCP
 * configuration file without disturbing the rest of it.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type McpServersKey = 'mcpServers' | 'servers' | 'mcp';

export type MergeResult =
  | { readonly ok: true; readonly created: boolean; readonly path: string; readonly replaced: readonly string[] }
  | { readonly ok: false; readonly reason: string; readonly path: string };

type ReadConfig = { readonly kind: 'absent' } | { readonly kind: 'problem'; readonly problem: string } | { readonly kind: 'config'; readonly config: Record<string, unknown> };

function readConfig(path: string): ReadConfig {
  if (!existsSync(path)) return { kind: 'absent' };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'problem', problem: 'the file is not a JSON object' };
    return { kind: 'config', config: parsed as Record<string, unknown> };
  } catch {
    return { kind: 'problem', problem: 'the file is not valid JSON' };
  }
}

function commandParts(entry: Record<string, unknown>): string[] {
  const parts: string[] = [];
  if (typeof entry.command === 'string') parts.push(entry.command);
  else if (Array.isArray(entry.command)) parts.push(...entry.command.map(String));
  if (Array.isArray(entry.args)) parts.push(...entry.args.map(String));
  return parts;
}

/** True when this host entry launches this package's `serve`. */
export function launchesConstructServe(entry: unknown): boolean {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const parts = commandParts(entry as Record<string, unknown>);
  const hasBin = parts.some((p) => /(?:^|[/\\])construct(?:\.mjs)?$/.test(p) || p === 'construct');
  return hasBin && parts.includes('serve');
}

export function mergeMcpServerEntry(path: string, serverName: string, entry: Record<string, unknown>, opts: { readonly serversKey?: McpServersKey; readonly seed?: Record<string, unknown> } = {}): MergeResult {
  const key = opts.serversKey ?? 'mcpServers';
  const current = readConfig(path);
  if (current.kind === 'problem') return { ok: false, reason: current.problem, path };
  const existing: Record<string, unknown> = current.kind === 'config' ? current.config : { ...(opts.seed ?? {}) };
  const servers = existing[key] !== null && typeof existing[key] === 'object' && !Array.isArray(existing[key]) ? { ...(existing[key] as Record<string, unknown>) } : {};
  const replaced: string[] = [];
  for (const [name, candidate] of Object.entries(servers)) {
    if (name === serverName) continue;
    if (launchesConstructServe(candidate)) {
      delete servers[name];
      replaced.push(name);
    }
  }
  servers[serverName] = entry;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...existing, [key]: servers }, null, 2)}\n`, 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // platforms without modes
  }
  return { ok: true, created: current.kind === 'absent', path, replaced };
}

export function readMcpServerEntry(path: string, serverName: string, opts: { readonly serversKey?: McpServersKey } = {}): Record<string, unknown> | null {
  const current = readConfig(path);
  if (current.kind !== 'config') return null;
  const servers = current.config[opts.serversKey ?? 'mcpServers'];
  if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) return null;
  const entry = (servers as Record<string, unknown>)[serverName];
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
}
