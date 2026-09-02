/**
 * hosts/wiring/clients.ts — where each supported host reads its MCP
 * configuration and what an entry there looks like. Facts each host
 * documents, cited rather than derived; the entry always launches
 * `construct serve` bound to this project and this client.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServersKey } from './merge-mcp.ts';

export const MCP_SERVER_NAME = 'construct';

export const WIRABLE_CLIENTS = ['claude-code', 'cursor', 'vscode', 'opencode'] as const;
export type WirableClient = (typeof WIRABLE_CLIENTS)[number];

/** Hosts a session can be in; some are wired by file, some by hand. */
export const KNOWN_CLIENTS = [...WIRABLE_CLIENTS, 'codex', 'bob', 'unknown'] as const;
export type ClientId = (typeof KNOWN_CLIENTS)[number];

const LAUNCHER = fileURLToPath(new URL('../../../bin/construct.mjs', import.meta.url));

export function serveArgs(client: ClientId, projectRoot: string): string[] {
  return [LAUNCHER, 'serve', `--client=${client}`, `--project=${projectRoot}`];
}

export interface ClientWiring {
  readonly id: WirableClient;
  /** The file the host reads, relative to the project root. */
  readonly relativePath: string;
  readonly serversKey: McpServersKey;
  readonly documentation: string;
  entry(projectRoot: string): Record<string, unknown>;
  bound(entry: Record<string, unknown>): boolean;
}

function argsBound(args: unknown): boolean {
  const list = Array.isArray(args) ? args.map(String) : [];
  return list.some((a) => a.startsWith('--client=')) && list.some((a) => a.startsWith('--project='));
}

export const CLIENT_WIRINGS: readonly ClientWiring[] = Object.freeze([
  {
    id: 'claude-code',
    relativePath: '.mcp.json',
    serversKey: 'mcpServers',
    documentation: 'https://docs.claude.com/en/docs/claude-code/mcp (project-scoped .mcp.json)',
    entry: (root) => ({ type: 'stdio', command: process.execPath, args: serveArgs('claude-code', root) }),
    bound: (e) => argsBound(e.args),
  },
  {
    id: 'cursor',
    relativePath: join('.cursor', 'mcp.json'),
    serversKey: 'mcpServers',
    documentation: 'https://cursor.com/docs/context/mcp (project .cursor/mcp.json)',
    entry: (root) => ({ command: process.execPath, args: serveArgs('cursor', root) }),
    bound: (e) => argsBound(e.args),
  },
  {
    id: 'vscode',
    relativePath: join('.vscode', 'mcp.json'),
    serversKey: 'servers',
    documentation: 'https://code.visualstudio.com/docs/copilot/chat/mcp-servers (workspace .vscode/mcp.json)',
    entry: (root) => ({ type: 'stdio', command: process.execPath, args: serveArgs('vscode', root) }),
    bound: (e) => argsBound(e.args),
  },
  {
    id: 'opencode',
    relativePath: 'opencode.json',
    serversKey: 'mcp',
    documentation: 'https://opencode.ai/docs/mcp-servers (project opencode.json, local servers)',
    entry: (root) => ({ type: 'local', command: [process.execPath, ...serveArgs('opencode', root)], enabled: true }),
    bound: (e) => argsBound(e.command),
  },
]);

export function clientWiring(id: string): ClientWiring | null {
  return CLIENT_WIRINGS.find((c) => c.id === id) ?? null;
}

/** The client id a `--client` value or an ambient host name means. */
export function normalizeClient(raw: string | undefined): ClientId {
  if (!raw) return 'unknown';
  const key = raw.trim().toLowerCase();
  const aliases: Record<string, ClientId> = { claude: 'claude-code', 'claude-code': 'claude-code', cursor: 'cursor', vscode: 'vscode', 'vs-code': 'vscode', opencode: 'opencode', codex: 'codex', bob: 'bob' };
  return aliases[key] ?? 'unknown';
}
