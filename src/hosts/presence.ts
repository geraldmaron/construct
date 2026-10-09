/**
 * hosts/presence.ts — what this machine has installed, read from the PATH and
 * the configuration directories a caller hands in. The one PATH search in the
 * codebase: delegation finds an executor's CLI with it, doctor finds the
 * command a host file starts, and init finds the agent hosts to offer.
 */

import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { CLIENT_WIRINGS, type WirableClient } from './wiring/clients.ts';

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

/** An agent host found on this machine, and what showed it is here. */
export interface PresentHost {
  readonly client: WirableClient;
  readonly evidence: string;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The agent hosts installed here, in the order hosts are listed everywhere
 * else. A host is present when one of its commands is on env.PATH or one of
 * its configuration directories exists. `configDirs` comes from
 * resolveHostConfigDirs, the module allowed to read home.
 */
export function presentHosts(env: NodeJS.ProcessEnv, configDirs: Readonly<Partial<Record<WirableClient, readonly string[]>>>): PresentHost[] {
  const found: PresentHost[] = [];
  for (const w of CLIENT_WIRINGS) {
    const binary = w.binaries.map((name) => ({ name, path: findOnPath(name, env) })).find((b) => b.path !== null);
    if (binary) {
      found.push({ client: w.id, evidence: `${binary.name} on PATH (${binary.path!})` });
      continue;
    }
    const dir = (configDirs[w.id] ?? []).find(isDirectory);
    if (dir) found.push({ client: w.id, evidence: `found ${dir}` });
  }
  return found;
}
