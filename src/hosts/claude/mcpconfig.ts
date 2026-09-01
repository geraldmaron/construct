/**
 * hosts/claude/mcpconfig.ts — the host-side registration that gives a role its
 * write surface.
 *
 * Earlier work built the chain up to the seam: the coordinator mints a scoped
 * bearer per dispatch, hands it to the adapter as `context.roleEnv`, and
 * `construct role-serve` speaks MCP over stdio against it. What was missing is
 * the last link — a real host that actually launches that server. This module
 * is that link for the Claude Code CLI.
 *
 * The one rule that shapes the whole file: the bearer must never ride argv.
 * `--mcp-config` accepts inline JSON as well as a path, and inline is the
 * obvious thing to write — but argv is world-readable through `ps`, which is
 * the exact channel kernel/run/roleenv.ts exists to avoid. So the config is
 * written to a 0600 file inside a 0700 per-invocation directory, the PATH is
 * what goes on the command line, and the directory is removed when the
 * invocation ends however it ends.
 *
 * Putting the role env in the config's own `env` block rather than in the
 * adapter's child environment is the same reasoning one level down: the host
 * process never holds the bearer either, so it cannot leak it into a session
 * transcript. The measured claim that it does not is pin expectation
 * `bearer-appears-in-no-host-transcript`.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServeEntry } from '../serve-launch.ts';

/**
 * The MCP server name. Tools reach the model as `mcp__<server>__<tool>`, so
 * this string is load-bearing on the allow-list below — pin expectation
 * `mcp-tool-names-are-namespaced`.
 */
export const MCP_SERVER_NAME = 'construct';

/** The three writes a role is ever granted. Same const-not-parameter discipline as ROLE_GRANTS. */
export const ROLE_TOOLS: readonly string[] = ['submit_draft', 'append_work_log', 'record_external_read'];

/** What the model is allowed to call, under --strict-mcp-config: these and nothing else. */
export const ROLE_TOOL_NAMES: readonly string[] = ROLE_TOOLS.map(
  (tool) => `mcp__${MCP_SERVER_NAME}__${tool}`,
);

/** The dev-checkout launcher; a packaged install overrides it via ClaudeConfig. */
export const DEFAULT_ROLE_SERVE_COMMAND = process.execPath;
export const DEFAULT_ROLE_SERVE_ARGS: readonly string[] = [
  fileURLToPath(new URL('../../../bin/construct.mjs', import.meta.url)),
  'role-serve',
];

export interface RoleServeLaunch {
  /** Executable that starts the MCP server. */
  readonly command?: string;
  readonly args?: readonly string[];
  /**
   * Environment the server needs beyond the role env — the store location,
   * typically. Merged UNDER roleEnv, so it can never overwrite the scope.
   */
  readonly env?: Readonly<Record<string, string>>;
}

export interface WrittenMcpConfig {
  /** Path to pass to `--mcp-config`. Never the JSON itself; see the header. */
  readonly path: string;
  /** Idempotent; safe to call on a path that is already gone. */
  dispose(): void;
}

/** The config object `--mcp-config` reads. Exported so tests can assert its shape. */
export function buildMcpConfig(
  roleEnv: Readonly<Record<string, string>>,
  launch: RoleServeLaunch = {},
): Record<string, unknown> {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'stdio',
        command: launch.command ?? DEFAULT_ROLE_SERVE_COMMAND,
        args: [...(launch.args ?? DEFAULT_ROLE_SERVE_ARGS)],
        env: { ...launch.env, ...roleEnv },
      },
    },
  };
}

/**
 * Write the config where only this user can read it, and hand back the path.
 * The caller must call dispose() — the adapter does it in a finally, so a
 * timeout or a throw removes the bearer from disk just as a clean exit does.
 */
export function writeMcpConfig(
  roleEnv: Readonly<Record<string, string>>,
  launch: RoleServeLaunch = {},
): WrittenMcpConfig {
  const dir = mkdtempSync(join(tmpdir(), 'construct-mcp-'));
  chmodSync(dir, 0o700);
  const path = join(dir, 'mcp.json');
  writeFileSync(path, `${JSON.stringify(buildMcpConfig(roleEnv, launch), null, 2)}\n`, { mode: 0o600 });
  // writeFileSync's mode is masked by umask on creation, so state it outright.
  chmodSync(path, 0o600);
  let disposed = false;
  return {
    path,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * The flags that turn the written config into a reachable write surface.
 *
 * `--strict-mcp-config` is not optional politeness: without it the CLI merges
 * the user's own configured MCP servers into the run, so a role would inherit
 * whatever write surfaces the developer happens to have registered. The role's
 * authority is supposed to be exactly the role writes.
 */
export function mcpArgsFor(configPath: string): readonly string[] {
  return ['--mcp-config', configPath, '--strict-mcp-config', '--allowedTools', ROLE_TOOL_NAMES.join(',')];
}

/**
 * The persistent project-level registration `construct init` writes — distinct
 * from the per-invocation role config above it in this file. That config is a
 * bearer's write surface, minted per dispatch and disposed the moment the
 * invocation ends. This one names the interactive MCP plane (`construct
 * serve`), lives at a fixed path inside the target repo, and is meant to
 * outlive any single invocation.
 *
 * Claude Code reads project-scoped MCP servers from `.mcp.json` at the repo
 * root. The server id is `construct-mcp` (same key Cursor writes). The shape
 * below (bare `command`/`args`, no `type`, no `env`) is the one
 * docs/consumer-install.md documents.
 */
export const PROJECT_MCP_SERVER_NAME = 'construct-mcp';

/** Where Claude Code reads this project's own MCP registrations from. */
export function projectMcpConfigPath(cwd: string): string {
  return join(cwd, '.mcp.json');
}

export interface ProjectServeLaunch {
  /** Executable that starts `construct serve`. Defaults to this Node binary. */
  readonly command?: string;
  readonly args?: readonly string[];
  readonly client?: string;
  readonly projectRoot?: string;
}

/** The entry `construct wire` / HostIntegrationAdapter places at mcpServers["construct-mcp"]. */
export function buildProjectMcpServerEntry(
  launch: ProjectServeLaunch = {},
  projectRoot: string = process.cwd(),
): Record<string, unknown> {
  const client = launch.client ?? 'claude-code';
  const root = launch.projectRoot ?? projectRoot;
  if (launch.args) {
    return {
      command: launch.command ?? process.execPath,
      args: [...launch.args],
    };
  }
  return buildServeEntry({ client, projectRoot: root }, { command: launch.command });
}

/** @deprecated Prefer buildProjectMcpServerEntry with projectRoot. */
export const DEFAULT_SERVE_ARGS: readonly string[] = [
  fileURLToPath(new URL('../../../bin/construct.mjs', import.meta.url)),
  'serve',
];

