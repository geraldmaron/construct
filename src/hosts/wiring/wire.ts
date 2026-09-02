/**
 * hosts/wiring/wire.ts — put Construct's MCP server into a host's project
 * configuration, and say whether it is there.
 */

import { join } from 'node:path';
import { clientWiring, MCP_SERVER_NAME, type WirableClient } from './clients.ts';
import { mergeMcpServerEntry, readMcpServerEntry } from './merge-mcp.ts';

export interface WiringState {
  readonly client: WirableClient;
  readonly path: string;
  readonly status: 'installed' | 'absent' | 'broken';
  readonly detail: string;
}

export function inspectWiring(client: WirableClient, projectRoot: string): WiringState {
  const w = clientWiring(client)!;
  const path = join(projectRoot, w.relativePath);
  const entry = readMcpServerEntry(path, MCP_SERVER_NAME, { serversKey: w.serversKey });
  if (!entry) return { client, path, status: 'absent', detail: `no ${MCP_SERVER_NAME} entry in ${w.relativePath}` };
  return w.bound(entry)
    ? { client, path, status: 'installed', detail: `${w.relativePath} launches construct serve bound to this project` }
    : { client, path, status: 'broken', detail: `${w.relativePath} has a ${MCP_SERVER_NAME} entry that is not bound to a client and project` };
}

export function installWiring(client: WirableClient, projectRoot: string): WiringState {
  const w = clientWiring(client)!;
  const path = join(projectRoot, w.relativePath);
  const result = mergeMcpServerEntry(path, MCP_SERVER_NAME, w.entry(projectRoot), { serversKey: w.serversKey });
  if (!result.ok) return { client, path, status: 'broken', detail: `could not write ${w.relativePath}: ${result.reason}` };
  return inspectWiring(client, projectRoot);
}
