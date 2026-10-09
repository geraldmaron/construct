/**
 * tests/harness/sterile.ts — every test that touches the filesystem or env
 * goes through this. It creates a tmpdir, builds a Paths rooted there, and
 * hands back a cleanup function. v2's history is a long list of tests that
 * quietly wrote into a real ~/.construct; this harness exists so that class
 * of bug cannot recur.
 */

import { after } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Paths } from '../../src/kernel/paths.ts';
import { AMBIENT_ENV_KEYS as HOST_MARKER_KEYS } from '../../src/hosts/ambient.ts';
import { IDENTITY_ENV_KEYS } from '../../src/hosts/identity.ts';
import { findOnPath } from '../../src/hosts/presence.ts';

/** Every variable a host sets that Construct reads: presence markers and session ids. */
const AMBIENT_ENV_KEYS = [...HOST_MARKER_KEYS, ...IDENTITY_ENV_KEYS] as const;

export interface SterileFixture {
  readonly root: string;
  readonly paths: Paths;
  cleanup(): void;
}

export function sterile(): SterileFixture {
  const root = mkdtempSync(join(tmpdir(), 'construct-test-'));
  const paths: Paths = {
    configDir: join(root, 'config'),
    stateDir: join(root, 'state'),
    dataDir: join(root, 'data'),
    cacheDir: join(root, 'cache'),
  };
  return {
    root,
    paths,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Moves HOME to a tmpdir for the whole of one test file, and removes it when
 * the file finishes. Redirecting HOME redirects every path this tool resolves
 * from home, which now includes the agent skills directory a dispatch reads to
 * find out what method the machine can offer a role. Without this a suite run
 * would describe whoever ran it: a developer with skills installed and a clean
 * checkout would see different offers, and a test that asserted on them would
 * pass on one machine and fail on the next.
 *
 * Call it once at module scope. The test runner gives each file its own
 * process, so the swap cannot reach a test in another file.
 *
 * Also clears ambient-host markers. Whoever runs the suite is itself very
 * likely a detected host, and `outcome` / `work` now treat that session as
 * the worker. A file that only moved HOME would still inherit the runner's
 * `CURSOR_AGENT` and take the in-session path instead of the keyword map.
 */
export function sterileHome(): string {
  const previous = process.env.HOME;
  const previousAmbient = new Map(AMBIENT_ENV_KEYS.map((key) => [key, process.env[key]]));
  const home = mkdtempSync(join(tmpdir(), 'construct-home-'));
  process.env.HOME = home;
  for (const key of AMBIENT_ENV_KEYS) delete process.env[key];
  after(() => {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    for (const [key, value] of previousAmbient) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}

/**
 * Clears every env var ambient-host detection reads, for the whole of one
 * test file, and restores whatever was there when the file finishes. Whoever
 * runs the suite is itself very likely a detected host — an agent session
 * running its own tests carries exactly the markers this module looks for —
 * so a test that wants a machine with no ambient host, or wants to control
 * which one it sees, needs that starting from a known-clear slate rather than
 * whatever launched the test runner.
 *
 * Call it once at module scope, the same as `sterileHome`.
 */
export function sterileAmbientEnv(): void {
  const previous = new Map(AMBIENT_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of AMBIENT_ENV_KEYS) delete process.env[key];
  after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

/** The tools a sterile PATH carries from this machine, each found once on the PATH the suite started with. */
const SYSTEM_TOOLS = ['git', 'ps', 'sh'] as const;
let systemTools: ReadonlyMap<string, string> | null = null;

/** This checkout's launcher, which the sterile PATH names `construct`. */
export const CHECKOUT_LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

/**
 * A PATH directory, `<root>/bin`, holding only what a test may run: git, ps,
 * and sh from this machine, node as the runtime running the suite, and
 * construct as this checkout's launcher. A test under it never starts a
 * global install or a host CLI the developer happens to have, and a check
 * that looks for `construct` on PATH finds this checkout. A test that needs
 * another binary adds it here rather than inheriting the real PATH.
 */
export function sterileBin(root: string): string {
  systemTools ??= new Map(SYSTEM_TOOLS.flatMap((name) => {
    const found = findOnPath(name, process.env);
    return found ? [[name, found] as const] : [];
  }));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const [name, target] of systemTools) symlinkSync(target, join(bin, name));
  symlinkSync(process.execPath, join(bin, 'node'));
  symlinkSync(CHECKOUT_LAUNCHER, join(bin, 'construct'));
  return bin;
}
