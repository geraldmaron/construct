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
 */
export function sterileHome(): string {
  const previous = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'construct-home-'));
  process.env.HOME = home;
  after(() => {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}
