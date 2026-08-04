/**
 * hosts/opencode/mcpconfig.ts — the OpenCode-side registration that gives a role
 * its write surface (construct-nv0).
 *
 * construct-r67.14 wired the write surface into ONE host, which satisfies host
 * independence as a proof but not as a property: this adapter accepted
 * `context.roleEnv` and ignored it, so a run dispatched to OpenCode had no write
 * surface at all. This module is the missing link, and it copies the SHAPE of
 * hosts/claude/mcpconfig.ts — config to a 0600 file in a 0700 per-invocation
 * directory, disposed on every exit path — while deliberately copying none of
 * its flag vocabulary, because OpenCode's does not exist.
 *
 * Two things are different here, both measured against opencode 1.15.4 rather
 * than assumed, and both recorded as named expectations in pin.ts:
 *
 * 1. There is no `--mcp-config`. `opencode run --help` lists no MCP flag at all;
 *    registration is a config file, located by the OPENCODE_CONFIG environment
 *    variable. That is not a downgrade for the rule that matters — the bearer
 *    must never ride argv — it is a strengthening, since no path and no JSON go
 *    on the command line at all.
 *
 * 2. THERE IS NO `--strict-mcp-config` EQUIVALENT, AND ISOLATION IS NOT
 *    ACHIEVABLE. This is a finding, not a gap to paper over. Measured: with
 *    OPENCODE_CONFIG pointed at a file registering exactly one server, `opencode
 *    mcp list` reported that server PLUS all nine servers registered in the
 *    operator's own configuration. OPENCODE_CONFIG_DIR behaves the same way.
 *    Both seams MERGE with the global configuration; neither replaces it.
 *
 *    So a role dispatched to OpenCode can reach whatever MCP servers the
 *    operator has registered, and Construct cannot currently prevent that. The
 *    Claude adapter's guarantee — the role's authority is exactly two writes —
 *    does NOT hold on this host, and any claim that it does would be false.
 *    What Construct still controls is its own surface: the bearer is scoped to
 *    one run, one task and one lease, so a wider tool reach does not widen the
 *    role's authority over CONSTRUCT's store. The operator's other servers are
 *    the operator's own risk, and now a stated one.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The MCP server name, matching the Claude adapter's so a role's instructions
 * do not have to know which host it landed on.
 */
export const MCP_SERVER_NAME = 'construct';

/** The two writes a role is ever granted, same set as every other surface. */
export const ROLE_TOOLS: readonly string[] = ['submit_draft', 'append_work_log'];

/** The dev-checkout launcher; a packaged install overrides it via config. */
export const DEFAULT_ROLE_SERVE_COMMAND: readonly string[] = [
  process.execPath,
  fileURLToPath(new URL('../../../bin/construct.mjs', import.meta.url)),
  'role-serve',
];

/**
 * The environment variable OpenCode reads its configuration path from. Delivery
 * is by environment rather than argv — see the header, point 1.
 */
export const CONFIG_ENV_VAR = 'OPENCODE_CONFIG';

export interface RoleServeLaunch {
  /** Full argv of the server process, executable first. */
  readonly command?: readonly string[];
  /**
   * Environment the server needs beyond the role env — the store location,
   * typically. Merged UNDER roleEnv, so it can never overwrite the scope.
   */
  readonly env?: Readonly<Record<string, string>>;
}

export interface WrittenOpenCodeConfig {
  /** Value for OPENCODE_CONFIG. Never inline JSON; see the header. */
  readonly path: string;
  /** Idempotent; safe to call on a path that is already gone. */
  dispose(): void;
}

/**
 * The config object OpenCode reads. Exported so tests can assert its shape
 * without writing a file.
 *
 * Note `environment` rather than Claude's `env`, and `command` as a single argv
 * array rather than command-plus-args: this is OpenCode's schema, and copying
 * the Claude adapter's key names here would produce a config that parses and
 * silently registers nothing.
 */
export function buildOpenCodeConfig(
  roleEnv: Readonly<Record<string, string>>,
  launch: RoleServeLaunch = {},
): Record<string, unknown> {
  return {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      [MCP_SERVER_NAME]: {
        type: 'local',
        command: [...(launch.command ?? DEFAULT_ROLE_SERVE_COMMAND)],
        enabled: true,
        environment: { ...launch.env, ...roleEnv },
      },
    },
  };
}

/**
 * Write the config where only this user can read it, and hand back the path.
 * The caller must call dispose() — the adapter does it in a finally, so a
 * timeout or a throw removes the bearer from disk just as a clean exit does.
 */
export function writeOpenCodeConfig(
  roleEnv: Readonly<Record<string, string>>,
  launch: RoleServeLaunch = {},
): WrittenOpenCodeConfig {
  const dir = mkdtempSync(join(tmpdir(), 'construct-oc-mcp-'));
  chmodSync(dir, 0o700);
  const path = join(dir, 'opencode.json');
  writeFileSync(path, `${JSON.stringify(buildOpenCodeConfig(roleEnv, launch), null, 2)}\n`, {
    mode: 0o600,
  });
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
