/**
 * hosts/cursor/mcpconfig.ts — where `construct wire` registers the projection
 * (`construct serve`) in Cursor's own project MCP config.
 *
 * Cursor has no per-invocation role write surface yet — adapter.ts's own
 * header records that gap — so this file carries none of the ephemeral,
 * 0700-temp-dir, dispose-on-exit machinery hosts/claude/mcpconfig.ts and
 * hosts/opencode/mcpconfig.ts use to keep a role's bearer off disk between
 * invocations. There is no bearer here to protect: `construct serve` is
 * read-only (no dispatch, no spend), and what this file writes is a
 * persistent entry naming where the `construct` binary lives, at
 * `.cursor/mcp.json` — the exact path and shape docs/consumer-install.md
 * documents and verifies against two real app repos, not a variant invented
 * here.
 */

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Matches KNOWN_PROJECT_MCP_IDS in kernel/cleanup/catalog.ts and the same key
 * hosts/claude/mcpconfig.ts writes into `.mcp.json`: one server name across
 * every host a project entry is written for, so an uninstall never has to
 * know which host wired it.
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
}

/** The dev-checkout `construct serve` launcher; a packaged install resolves the same relative path inside its own tree. */
const DEFAULT_SERVE_ARGS: readonly string[] = [
  fileURLToPath(new URL('../../../bin/construct.mjs', import.meta.url)),
  'serve',
];

/** The entry `construct wire` places at `mcpServers["construct-mcp"]`. */
export function buildProjectMcpServerEntry(launch: ProjectServeLaunch = {}): Record<string, unknown> {
  return {
    command: launch.command ?? process.execPath,
    args: [...(launch.args ?? DEFAULT_SERVE_ARGS)],
  };
}
