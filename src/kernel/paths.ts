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
