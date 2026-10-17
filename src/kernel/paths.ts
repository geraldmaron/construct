/**
 * kernel/paths.ts — the only module in the codebase permitted to read
 * process.env or os.homedir(). Every other module receives an injected Paths.
 * This boundary is what makes the test suite sterile by construction: the
 * fixture builder constructs a Paths rooted in a tmpdir, and nothing else can escape it.
 */

import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

export interface Paths {
  readonly configDir: string;
  readonly stateDir: string;
  readonly dataDir: string;
  readonly cacheDir: string;
}

export interface PathsEnv {
  XDG_CONFIG_HOME?: string;
  XDG_STATE_HOME?: string;
  XDG_DATA_HOME?: string;
  XDG_CACHE_HOME?: string;
  HOME?: string;
  CLAUDE_CONFIG_DIR?: string;
  CODEX_HOME?: string;
  HERMES_HOME?: string;
}

const APP = 'construct';

/**
 * The XDG base-directory spec requires an empty value to be treated the same
 * as an unset one. Honoring that here is load-bearing: joining an empty base
 * yields a path relative to the cwd, and a resident process handed one would
 * bind its socket and write its store wherever it happened to be started.
 */
function xdgBase(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== '' ? value : fallback;
}

export function resolvePaths(env: PathsEnv = process.env, home: string = xdgBase(env.HOME, homedir())): Paths {
  return {
    configDir: join(xdgBase(env.XDG_CONFIG_HOME, join(home, '.config')), APP),
    stateDir: join(xdgBase(env.XDG_STATE_HOME, join(home, '.local', 'state')), APP),
    dataDir: join(xdgBase(env.XDG_DATA_HOME, join(home, '.local', 'share')), APP),
    cacheDir: join(xdgBase(env.XDG_CACHE_HOME, join(home, '.cache')), APP),
  };
}

/**
 * The personal-tier Agent Skills directory: the ecosystem's convention for
 * skills that belong to a person rather than to one project, which keeps its
 * own `.claude/skills` beside itself. Not XDG — the format names this path, so
 * following it is what makes an installed skill discoverable at all.
 *
 * It reads home the same way resolvePaths does, and for the same reason: this
 * module is the only one permitted to, so a test that redirects HOME redirects
 * every path the tool will touch.
 */
export function resolveSkillsDir(env: PathsEnv = process.env, home: string = xdgBase(env.HOME, homedir())): string {
  return join(home, '.claude', 'skills');
}

/**
 * Where the platform's own scheduler reads a per-user entry from: launchd's
 * LaunchAgents directory on macOS, systemd's user unit directory on Linux.
 * Null on a platform with no user-level scheduler this tool writes to.
 *
 * Both are conventions those platforms document, cited here rather than
 * derived, and both are read through this module for the same reason every
 * other home-rooted path is: a test that redirects HOME redirects this too.
 * systemd reads its user units under `$XDG_CONFIG_HOME/systemd/user`, so the
 * variable is honored; launchd names an absolute path under home and has no
 * equivalent.
 *
 * The environment is a required argument, never defaulted to this process's:
 * a caller states which home it means, so a test cannot reach the real one by
 * forgetting to pass its own.
 */
export function resolveScheduleDir(platform: NodeJS.Platform, env: PathsEnv, home: string = xdgBase(env.HOME, homedir())): string | null {
  if (platform === 'darwin') return join(home, 'Library', 'LaunchAgents');
  if (platform === 'linux') {
    return join(xdgBase(env.XDG_CONFIG_HOME, join(home, '.config')), 'systemd', 'user');
  }
  return null;
}

/**
 * The directory the platform scheduler itself reads for this OS account,
 * from the account database rather than HOME or XDG variables. launchd and a
 * default systemd user manager read their units here whatever the shell
 * exported. A unit is loaded only when it was written to this directory: a
 * redirected HOME (a test, a scratch install) resolves resolveScheduleDir
 * elsewhere, and loading a unit from there would hand a scratch project to
 * the person's real scheduler.
 */
export function resolveAccountScheduleDir(platform: NodeJS.Platform): string | null {
  return resolveScheduleDir(platform, {}, userInfo().homedir);
}

/**
 * Every other host reachable by name reads its skills from a documented
 * directory of its own, each a fixed path segment list under home rather than
 * a computed one — a host's convention is a fact this module cites, not a
 * pattern it derives. `claude` is deliberately absent here: it is
 * `resolveSkillsDir` above, and `resolveHostSkillsDir` defers to it rather
 * than duplicating the path.
 *
 * codex reads `~/.agents/skills`, which is not a path of its own: cursor,
 * opencode, and vscode document reading that same directory, so an install
 * there reaches four hosts at once. vscode also reads `~/.claude/skills`
 * beside its own `~/.copilot/skills`. Reaching them by one name is a separate
 * decision this table does not make; what it records is where each host says
 * it looks.
 */
const OTHER_HOST_SKILLS_PATH: Record<string, readonly string[]> = {
  // https://bob.ibm.com/docs/ide/features/skills — checked 2026-08-24
  bob: ['.bob', 'skills'],
  // https://opencode.ai/docs/skills — checked 2026-08-24
  opencode: ['.config', 'opencode', 'skills'],
  // https://cursor.com/docs/skills — checked 2026-08-24
  cursor: ['.cursor', 'skills'],
  // https://learn.chatgpt.com/docs/build-skills — checked 2026-08-24
  codex: ['.agents', 'skills'],
  // https://code.visualstudio.com/docs/agent-customization/agent-skills — checked 2026-10-08
  vscode: ['.copilot', 'skills'],
  // Hermes Agent website/docs/user-guide/features/skills.md — checked 2026-10-17; HERMES_HOME moves it (resolveHostSkillsDir)
  hermes: ['.hermes', 'skills'],
};

/** Every host name `--host` accepts, `claude` included, in a stable order. */
export const SKILLS_HOST_NAMES = ['claude', ...Object.keys(OTHER_HOST_SKILLS_PATH)] as const;
export type SkillsHostName = (typeof SKILLS_HOST_NAMES)[number];

/**
 * The skills directory a named host documents, so a user reaches it by name
 * instead of memorizing its path. Reads home the same way resolveSkillsDir
 * does and for the same reason: this is the module allowed to.
 */
export function resolveHostSkillsDir(
  host: SkillsHostName,
  env: PathsEnv = process.env,
  home: string = xdgBase(env.HOME, homedir()),
): string {
  if (host === 'claude') return resolveSkillsDir(env, home);
  if (host === 'hermes') return join(resolveHermesHome(env, home), 'skills');
  return join(home, ...OTHER_HOST_SKILLS_PATH[host]);
}

/**
 * Claude Code's configuration directory: CLAUDE_CONFIG_DIR when set, else
 * `.claude` under home. Read here for the same reason as every home-rooted
 * path: a test that redirects HOME redirects this too.
 */
export function resolveClaudeConfigDir(env: PathsEnv = process.env, home: string = xdgBase(env.HOME, homedir())): string {
  const configured = env.CLAUDE_CONFIG_DIR;
  return configured && configured.trim() ? configured : join(home, '.claude');
}

/**
 * Claude Code's user-scope configuration file, which holds MCP servers added
 * with `claude mcp add -s user`: `.claude.json` in CLAUDE_CONFIG_DIR when set,
 * else in home. Read here for the same reason as every home-rooted path.
 */
export function resolveClaudeUserConfigFile(env: PathsEnv, home: string = xdgBase(env.HOME, homedir())): string {
  const configured = env.CLAUDE_CONFIG_DIR;
  return configured && configured.trim() ? join(configured, '.claude.json') : join(home, '.claude.json');
}

/**
 * Hermes Agent's data directory: HERMES_HOME when set, else `.hermes` under
 * home. Hermes reads its MCP servers only from `config.yaml` here, never from
 * a project file (Hermes Agent website/docs/user-guide/features/mcp.md and
 * getting-started/installation.md, checked 2026-10-17).
 */
export function resolveHermesHome(env: PathsEnv = process.env, home: string = xdgBase(env.HOME, homedir())): string {
  return xdgBase(env.HERMES_HOME, join(home, '.hermes'));
}

/** The agent hosts whose per-user configuration directories `resolveHostConfigDirs` names. */
export type ConfigHostName = 'claude-code' | 'cursor' | 'vscode' | 'opencode' | 'codex' | 'bob' | 'hermes';

/**
 * Where each agent host keeps its per-user configuration. A directory that
 * exists is evidence the host has run on this machine, which is how setup
 * finds a host whose command is not on this shell's PATH (an editor started
 * from the desktop). Read here for the same reason as every home-rooted path.
 * Codex honors CODEX_HOME, Claude Code CLAUDE_CONFIG_DIR, OpenCode
 * XDG_CONFIG_HOME, and Hermes HERMES_HOME.
 */
export function resolveHostConfigDirs(
  env: PathsEnv = process.env,
  home: string = xdgBase(env.HOME, homedir()),
): Readonly<Record<ConfigHostName, readonly string[]>> {
  const codexHome = env.CODEX_HOME;
  return {
    'claude-code': [resolveClaudeConfigDir(env, home)],
    cursor: [join(home, '.cursor')],
    vscode: [join(home, '.vscode'), join(home, '.vscode-insiders')],
    opencode: [join(xdgBase(env.XDG_CONFIG_HOME, join(home, '.config')), 'opencode')],
    codex: [codexHome && codexHome.trim() ? codexHome : join(home, '.codex')],
    bob: [join(home, '.bob')],
    hermes: [resolveHermesHome(env, home)],
  };
}

/** Where an administrator's managed Claude Code settings live on this platform, if anywhere. */
export function managedClaudeSettingsPath(platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  if (platform === 'linux') return '/etc/claude-code/managed-settings.json';
  return null;
}
