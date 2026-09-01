/**
 * hosts/cursor/mcpconfig.ts — where `construct init` registers interactive MCP
 * (`construct serve`) in Cursor's own project MCP config.
 *
 * Cursor has no per-invocation role write surface yet — adapter.ts's own
 * header records that gap — so this file carries none of the ephemeral,
 * 0700-temp-dir, dispose-on-exit machinery hosts/claude/mcpconfig.ts and
 * hosts/opencode/mcpconfig.ts use to keep a role's bearer off disk between
 * invocations. What this file writes is a persistent entry naming where the
 * `construct` binary lives, at `.cursor/mcp.json` — the path and shape
 * docs/consumer-install.md documents.
 */

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildServeArgs, buildServeEntry } from '../serve-launch.ts';

/**
 * Same server id Claude writes into `.mcp.json`: one name across every host
 * a project entry is written for.
 */
export const PROJECT_MCP_SERVER_NAME = 'construct-mcp';

/** Where Cursor reads this project's own MCP registrations from. */
export function projectMcpConfigPath(cwd: string): string {
  return join(cwd, '.cursor', 'mcp.json');
}

export interface ProjectServeLaunch {
  /** Executable that starts `construct serve`. Defaults to this Node binary. */
  readonly command?: string;
  readonly args?: readonly string[];
  /** Structural session binding for the serve process. */
  readonly client?: string;
  readonly projectRoot?: string;
}

/** The entry `construct wire` / HostIntegrationAdapter places at mcpServers["construct-mcp"]. */
export function buildProjectMcpServerEntry(
  launch: ProjectServeLaunch = {},
  projectRoot: string = process.cwd(),
): Record<string, unknown> {
  const client = launch.client ?? 'cursor';
  const root = launch.projectRoot ?? projectRoot;
  if (launch.args) {
    return {
      command: launch.command ?? process.execPath,
      args: [...launch.args],
    };
  }
  return buildServeEntry({ client, projectRoot: root }, { command: launch.command });
}

/** @deprecated Prefer buildProjectMcpServerEntry with projectRoot; kept for call sites. */
export const DEFAULT_SERVE_ARGS: readonly string[] = [
  fileURLToPath(new URL('../../../bin/construct.mjs', import.meta.url)),
  'serve',
];

export { buildServeArgs };
