/**
 * hosts/wiring/wire.ts — put Construct's MCP server into a host's project
 * configuration, say whether it is there, and read back what it starts.
 */

import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { PathsEnv } from '../../kernel/paths.ts';
import {
  clientWiring,
  configPathFor,
  launchFor,
  MCP_SERVER_NAME,
  projectsOfEntry,
  shownPath,
  type ClientWiring,
  type WirableClient,
} from './clients.ts';
import { launchParts, mergeMcpServerEntry, readMcpServerEntry } from './merge-mcp.ts';
import { mergeTomlServerTable, readTomlServerTable } from './merge-toml.ts';
import { mergeYamlServerBlock, readYamlServerBlock } from './merge-yaml.ts';

export interface WiringState {
  readonly client: WirableClient;
  readonly path: string;
  readonly status: 'installed' | 'absent' | 'broken';
  readonly detail: string;
}

function readEntry(w: ClientWiring, path: string): Record<string, unknown> | null {
  if (w.format === 'toml') return readTomlServerTable(path, MCP_SERVER_NAME);
  if (w.format === 'yaml') return readYamlServerBlock(path, MCP_SERVER_NAME);
  return readMcpServerEntry(path, MCP_SERVER_NAME, { serversKey: w.serversKey });
}

function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  return real(a) === real(b);
}

/**
 * For a user-level entry, why it is not this project's: the other project it
 * names, or that it names none (it would serve whatever directory the host
 * starts in). Null when every project it names is this one.
 */
function foreignBinding(w: ClientWiring, entry: Record<string, unknown>, projectRoot: string): string | null {
  if (w.scope !== 'user') return null;
  const named = projectsOfEntry(entry);
  if (named.length === 0) return `starts ${MCP_SERVER_NAME} without naming a project`;
  const other = named.find((p) => !samePath(p, projectRoot));
  return other === undefined ? null : `binds ${MCP_SERVER_NAME} to ${other}`;
}

/** The command and arguments the host file starts, or null when it has no construct entry with a command. */
export function launchOf(client: WirableClient, projectRoot: string, env: PathsEnv): { command: string; args: string[] } | null {
  const w = clientWiring(client)!;
  const entry = readEntry(w, configPathFor(w, projectRoot, env));
  if (!entry || foreignBinding(w, entry, projectRoot) !== null) return null;
  const [command, ...rest] = Array.isArray(entry.command)
    ? entry.command.map(String)
    : typeof entry.command === 'string'
      ? [entry.command]
      : [];
  if (!command) return null;
  return { command, args: Array.isArray(entry.command) ? rest : Array.isArray(entry.args) ? entry.args.map(String) : [] };
}

/** The machine paths an entry starts: an absolute command, and any absolute script ending in construct.mjs. */
function machinePaths(entry: Record<string, unknown>): string[] {
  const [command, ...rest] = launchParts(entry);
  return [command ?? '', ...rest.filter((p) => p.endsWith('construct.mjs'))].filter((p) => isAbsolute(p));
}

export function inspectWiring(client: WirableClient, projectRoot: string, env: PathsEnv): WiringState {
  const w = clientWiring(client)!;
  const path = configPathFor(w, projectRoot, env);
  const shown = shownPath(w, path);
  const entry = readEntry(w, path);
  if (!entry) return { client, path, status: 'absent', detail: `no ${MCP_SERVER_NAME} entry in ${shown}` };
  const foreign = foreignBinding(w, entry, projectRoot);
  if (foreign !== null) return { client, path, status: 'absent', detail: `${shown} ${foreign}, not this project` };
  if (
    (client === 'bob' && entry.disabled === true) ||
    ((client === 'codex' || client === 'opencode' || client === 'hermes') && entry.enabled === false)
  ) {
    return {
      client,
      path,
      status: 'broken',
      detail: `${shown} has construct disabled. Enable construct in ${w.label}'s MCP settings or this file, then restart the server.`,
    };
  }
  const repair = `\`construct init --client=${client}\` rewrites it`;
  const pinned = machinePaths(entry);
  const gone = pinned.find((p) => !existsSync(p));
  if (gone)
    return {
      client,
      path,
      status: 'broken',
      detail: `${shown} starts ${gone}, which no longer exists (another machine's path or an old Node); ${repair}`,
    };
  if (!w.bound(entry))
    return {
      client,
      path,
      status: 'broken',
      detail: `${shown} has a ${MCP_SERVER_NAME} entry that does not start serve --client=${client}; ${repair}`,
    };
  const line = launchParts(entry).join(' ');
  return {
    client,
    path,
    status: 'installed',
    detail:
      pinned.length > 0
        ? `${shown} starts ${line}, a path on this machine only; \`construct init --client=${client}\` writes one that works on any machine`
        : `${shown} starts ${line}`,
  };
}

export function installWiring(client: WirableClient, projectRoot: string, env: PathsEnv): WiringState {
  const w = clientWiring(client)!;
  const path = configPathFor(w, projectRoot, env);
  const launch = launchFor(projectRoot);
  const result =
    w.format === 'toml'
      ? mergeTomlServerTable(path, MCP_SERVER_NAME, w.entry(launch, projectRoot))
      : w.format === 'yaml'
        ? mergeYamlServerBlock(path, MCP_SERVER_NAME, w.entry(launch, projectRoot), {
            // A user-level file serves one project; rebinding it would silently cut the other project off.
            conflict: (existing) => {
              const foreign = foreignBinding(w, existing, projectRoot);
              return foreign === null
                ? null
                : `it already ${foreign}; one ${w.label} profile serves one Construct project, so run ${w.label} for this project with its own HERMES_HOME, or remove that entry first`;
            },
          })
        : mergeMcpServerEntry(path, MCP_SERVER_NAME, w.entry(launch, projectRoot), { serversKey: w.serversKey });
  if (!result.ok) return { client, path, status: 'broken', detail: `could not write ${shownPath(w, path)}: ${result.reason}` };
  const inspected = inspectWiring(client, projectRoot, env);
  if (inspected.status !== 'installed' || result.replaced.length === 0) return inspected;
  return {
    ...inspected,
    detail: `${inspected.detail}; replaced duplicate ${result.replaced.join(', ')}`,
  };
}
