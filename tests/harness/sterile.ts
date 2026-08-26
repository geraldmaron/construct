/**
 * tests/harness/sterile.ts — every test that touches the filesystem or env
 * goes through this. It creates a tmpdir, builds a Paths rooted there, and
 * hands back a cleanup function. v2's history is a long list of tests that
 * quietly wrote into a real ~/.construct; this harness exists so that class
 * of bug cannot recur.
 */

import { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Paths } from '../../src/kernel/paths.ts';
import { AMBIENT_ENV_KEYS } from '../../src/hosts/ambient.ts';

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
