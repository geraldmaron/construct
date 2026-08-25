/**
 * cli/local-state.ts — where a ratified project settings file's `state: local`
 * takes effect: the sqlite store rooted inside the repository instead of the
 * user's home directory, and the one refusal that guards it.
 *
 * A repo-local store holds exactly the client facts nobody wants committed by
 * accident — records, notes, decisions, the work log. So `state: local` is
 * refused outright unless the store's path is both covered by the
 * repository's ignore rules and not already tracked. A gitignore check alone
 * is not enough: gitignore has no effect on a path git already tracks, so a
 * store file added to the index before this setting existed would read as
 * "ignored" on a check-ignore alone while still being committable on the next
 * `git add -u`. Both checks are required, and neither substitutes for the
 * other.
 *
 * `state`'s ratification is checked against the home store — the one
 * location this resolution can always reach without first knowing where the
 * operational store will end up living. It is also the same location
 * `construct trust --ratify` writes into: at the moment of that first
 * ratification nothing is ratified yet, so `state` cannot yet resolve to
 * `local`, so the ratifying call itself always lands in the home store before
 * any redirect could apply. Once ratified, `state`'s own env layer
 * (CONSTRUCT_STATE) reaches this resolution the same way it reaches every
 * other preference, so a person can always force `home` for one call — a
 * `construct trust --revoke` issued after redirection is already active
 * included. The CLI flag layer is not threaded through this resolution (no
 * argv is available this early, before any command has parsed its own); it
 * still governs what `construct settings` prints.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { localStateDataDir, resolvePaths } from '../kernel/paths.ts';
import { openStore, storePath, StoreUnavailableError } from '../kernel/store/open.ts';
import { settingsFileRatified } from '../kernel/store/ratifications.ts';
import { gitRoot, resolveSettings } from './settings-file.ts';
import type { ResolveInputs } from './settings-file.ts';

/** Where the store lives for this working directory, and whether it is repo-local. */
export interface StoreLocation {
  readonly path: string;
  readonly local: boolean;
  /** The repository root `state: local` rooted the store under, or null when not local. */
  readonly repoRoot: string | null;
}

/** One git subprocess's exit status; null on a spawn failure (no git, no such directory). */
function gitStatus(cwd: string, args: readonly string[]): number | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status;
}

/**
 * Why a repo-local store at `storeFile` may not be used, or null when it may.
 * Both checks are required, and the tracked check runs first: git's own
 * `check-ignore` stops reporting a path as ignored once that path is
 * tracked — an ignore pattern that would otherwise cover it goes silent
 * rather than being overridden — so a `check-ignore` alone would refuse a
 * tracked-but-ignored path for the wrong reason (or, on a subtly different
 * pattern, not at all). `ls-files --error-unmatch` is the one direct answer
 * to "is this already committable", and it is asked first. A spawn failure
 * (no git binary, not a working tree) fails closed — refused, the same as an
 * explicit "no" — rather than treating "could not tell" as a yes.
 */
export function localStateRefusalReason(repoRoot: string, storeFile: string): string | null {
  if (gitStatus(repoRoot, ['ls-files', '--error-unmatch', '--', storeFile]) === 0) {
    return (
      `${storeFile} is already tracked by git — gitignore has no effect on a ` +
      'tracked path; remove it from the index (git rm --cached) before ' +
      'state: local can take effect'
    );
  }
  if (gitStatus(repoRoot, ['check-ignore', '-q', '--', storeFile]) !== 0) {
    return (
      `${storeFile} is not covered by this repository's ignore rules — add it ` +
      '(or its containing directory) to .gitignore before state: local can take effect'
    );
  }
  return null;
}

/**
 * The store's effective location for this working directory. Home unless a
 * ratified project settings file (or CONSTRUCT_STATE) resolves `state` to
 * `local` and the refusal above clears. A refused activation throws
 * StoreUnavailableError rather than silently falling back to home, so a
 * caller can never mistake a refused repo-local store for the home one it
 * fell back to on its own.
 *
 * Never creates the home store merely to answer this question. Ratification
 * lives inside it, so nothing has ever been ratified in a store that has
 * never been opened, and this checks existence first rather than opening
 * (and thereby creating) one just to find it empty.
 */
export function resolveStoreLocation(
  cwd: string,
  env: NodeJS.ProcessEnv,
  home: string = env.HOME ?? homedir(),
): StoreLocation {
  const homePaths = resolvePaths(env, home);
  const homeStorePath = storePath(homePaths);

  if (!existsSync(homeStorePath)) {
    return { path: homeStorePath, local: false, repoRoot: null };
  }

  const homeStore = openStore(homeStorePath);
  let stateIsLocal: boolean;
  try {
    const inputs: ResolveInputs = {
      paths: homePaths,
      cwd,
      env,
      flags: {},
      home,
      ratified: (repoIdentity, hash) => settingsFileRatified(homeStore, repoIdentity, hash),
    };
    stateIsLocal = resolveSettings(inputs).find((s) => s.key === 'state')?.display === 'local';
  } finally {
    homeStore.close();
  }

  if (!stateIsLocal) return { path: homeStorePath, local: false, repoRoot: null };

  const root = gitRoot(cwd);
  if (root === null) {
    // state: local with no repository to root it in reads the same as it
    // never having been requested — there is nothing here to refuse.
    return { path: homeStorePath, local: false, repoRoot: null };
  }

  const dataDir = localStateDataDir(root);
  const candidate = storePath({ ...homePaths, dataDir });
  const refusal = localStateRefusalReason(root, candidate);
  if (refusal !== null) throw new StoreUnavailableError(candidate, refusal);

  return { path: candidate, local: true, repoRoot: root };
}
