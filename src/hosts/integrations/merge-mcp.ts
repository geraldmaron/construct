/**
 * hosts/integrations/merge-mcp.ts — merge Construct's MCP key without clobbering others.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type MergeResult =
  | { readonly ok: true; readonly created: boolean; readonly path: string }
  | { readonly ok: false; readonly reason: string; readonly path: string };

export function mergeMcpServerEntry(
  configPath: string,
  serverName: string,
  entry: Record<string, unknown>,
): MergeResult {
  let existing: Record<string, unknown> = {};
  let created = true;
  if (existsSync(configPath)) {
    created = false;
    try {
      const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, reason: 'malformed JSON config', path: configPath };
      }
      existing = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, reason: 'unreadable JSON config', path: configPath };
    }
  }

  const servers =
    existing.mcpServers !== null &&
    typeof existing.mcpServers === 'object' &&
    !Array.isArray(existing.mcpServers)
      ? { ...(existing.mcpServers as Record<string, unknown>) }
      : {};
  servers[serverName] = entry;
  const next = { ...existing, mcpServers: servers };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  try {
    chmodSync(configPath, 0o600);
  } catch {
    // Non-fatal on platforms that ignore chmod.
  }
  return { ok: true, created, path: configPath };
}

export function readMcpServerEntry(
  configPath: string,
  serverName: string,
): Record<string, unknown> | null {
  if (!existsSync(configPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const servers = (parsed as Record<string, unknown>).mcpServers;
    if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) return null;
    const entry = (servers as Record<string, unknown>)[serverName];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    return entry as Record<string, unknown>;
  } catch {
    return null;
  }
}
