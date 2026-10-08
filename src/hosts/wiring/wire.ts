/**
 * hosts/wiring/wire.ts — put Construct's MCP server into a host's project
 * configuration, say whether it is there, and read back what it starts.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { clientWiring, launchFor, MCP_SERVER_NAME, type ClientWiring, type WirableClient } from './clients.ts';
import { launchParts, mergeMcpServerEntry, readMcpServerEntry } from './merge-mcp.ts';
import { mergeTomlServerTable, readTomlServerTable } from './merge-toml.ts';

export interface WiringState {
  readonly client: WirableClient;
  readonly path: string;
  readonly status: 'installed' | 'absent' | 'broken';
  readonly detail: string;
}

function readEntry(w: ClientWiring, path: string): Record<string, unknown> | null {
  return w.format === 'toml' ? readTomlServerTable(path, MCP_SERVER_NAME) : readMcpServerEntry(path, MCP_SERVER_NAME, { serversKey: w.serversKey });
}

/** The command and arguments the host file starts, or null when it has no construct entry with a command. */
export function launchOf(client: WirableClient, projectRoot: string): { command: string; args: string[] } | null {
  const w = clientWiring(client)!;
  const entry = readEntry(w, join(projectRoot, w.relativePath));
  if (!entry) return null;
  const [command, ...rest] = Array.isArray(entry.command) ? entry.command.map(String) : typeof entry.command === 'string' ? [entry.command] : [];
  if (!command) return null;
  return { command, args: Array.isArray(entry.command) ? rest : Array.isArray(entry.args) ? entry.args.map(String) : [] };
}

/** The machine paths an entry starts: an absolute command, and any absolute script ending in construct.mjs. */
function machinePaths(entry: Record<string, unknown>): string[] {
  const [command, ...rest] = launchParts(entry);
  return [command ?? '', ...rest.filter((p) => p.endsWith('construct.mjs'))].filter((p) => isAbsolute(p));
}

export function inspectWiring(client: WirableClient, projectRoot: string): WiringState {
  const w = clientWiring(client)!;
  const path = join(projectRoot, w.relativePath);
  const entry = readEntry(w, path);
  if (!entry) return { client, path, status: 'absent', detail: `no ${MCP_SERVER_NAME} entry in ${w.relativePath}` };
  const repair = `\`construct init --client=${client}\` rewrites it`;
  const pinned = machinePaths(entry);
  const gone = pinned.find((p) => !existsSync(p));
  if (gone) return { client, path, status: 'broken', detail: `${w.relativePath} starts ${gone}, which no longer exists (another machine's path or an old Node); ${repair}` };
  if (!w.bound(entry)) return { client, path, status: 'broken', detail: `${w.relativePath} has a ${MCP_SERVER_NAME} entry that does not start serve --client=${client}; ${repair}` };
  const line = launchParts(entry).join(' ');
  return {
    client,
    path,
    status: 'installed',
    detail: pinned.length > 0
      ? `${w.relativePath} starts ${line}, a path on this machine only; \`construct init --client=${client}\` writes one that works on any machine`
      : `${w.relativePath} starts ${line}`,
  };
}

export function installWiring(client: WirableClient, projectRoot: string): WiringState {
  const w = clientWiring(client)!;
  const path = join(projectRoot, w.relativePath);
  const launch = launchFor(projectRoot);
  const result = w.format === 'toml'
    ? mergeTomlServerTable(path, MCP_SERVER_NAME, w.entry(launch))
    : mergeMcpServerEntry(path, MCP_SERVER_NAME, w.entry(launch), { serversKey: w.serversKey });
  if (!result.ok) return { client, path, status: 'broken', detail: `could not write ${w.relativePath}: ${result.reason}` };
  const inspected = inspectWiring(client, projectRoot);
  if (inspected.status !== 'installed' || result.replaced.length === 0) return inspected;
  return {
    ...inspected,
    detail: `${inspected.detail}; replaced duplicate ${result.replaced.join(', ')}`,
  };
}
