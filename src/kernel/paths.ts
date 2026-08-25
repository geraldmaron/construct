/**
 * kernel/paths.ts — the only module in the codebase permitted to read
 * process.env or os.homedir(). Every other module receives an injected Paths.
 * This boundary is what makes the test suite sterile by construction: the
 * fixture builder constructs a Paths rooted in a tmpdir, and nothing else can escape it.
 */

import { homedir } from 'node:os';
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
}

const APP = 'construct';

export function resolvePaths(
  env: PathsEnv = process.env,
  home: string = env.HOME ?? homedir(),
): Paths {
  return {
    configDir: join(env.XDG_CONFIG_HOME ?? join(home, '.config'), APP),
    stateDir: join(env.XDG_STATE_HOME ?? join(home, '.local', 'state'), APP),
    dataDir: join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), APP),
    cacheDir: join(env.XDG_CACHE_HOME ?? join(home, '.cache'), APP),
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
export function resolveSkillsDir(
  env: PathsEnv = process.env,
  home: string = env.HOME ?? homedir(),
): string {
  return join(home, '.claude', 'skills');
}

/**
 * The repo-local root for the sqlite store when a ratified project settings
 * file declares `state: local`: inside the repository rather than under home.
 * Takes the repository root as an argument rather than discovering one —
 * finding a repository root means walking a checkout looking for its `.git`,
 * and this module stays the one that reads env or home, not the one that
 * walks a checkout.
 */
export function localStateDataDir(repoRoot: string): string {
  return join(repoRoot, '.construct', 'state');
}

/**
 * Every other host reachable by name reads its skills from a documented
 * directory of its own, each a fixed path segment list under home rather than
 * a computed one — a host's convention is a fact this module cites, not a
 * pattern it derives. `claude` is deliberately absent here: it is
 * `resolveSkillsDir` above, and `resolveHostSkillsDir` defers to it rather
 * than duplicating the path.
 *
 * codex reads `~/.agents/skills`, which is not a path of its own: cursor and
 * opencode document reading that same directory, so an install there reaches
 * three hosts at once. Reaching them by one name is a separate decision this
 * table does not make; what it records is where each host says it looks.
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
  home: string = env.HOME ?? homedir(),
): string {
  if (host === 'claude') return resolveSkillsDir(env, home);
  return join(home, ...OTHER_HOST_SKILLS_PATH[host]);
}
