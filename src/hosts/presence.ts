/**
 * hosts/presence.ts — what this machine has installed, read from the PATH a
 * caller hands in. The one PATH search in the codebase: delegation finds an
 * executor's CLI with it, and doctor finds the command a host file starts.
 */

import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** The first executable file named `name` on env.PATH, or null when none is. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // absent, a directory, or not executable here
    }
  }
  return null;
}
