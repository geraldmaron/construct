/**
 * tests/harness/sterile.ts — every test that touches the filesystem or env
 * goes through this. It creates a tmpdir, builds a Paths rooted there, and
 * hands back a cleanup function. v2's history is a long list of tests that
 * quietly wrote into a real ~/.construct; this harness exists so that class
 * of bug cannot recur.
 */

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
