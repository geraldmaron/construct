/**
 * tests/cli/launcher.test.ts — which build bin/construct.mjs actually runs
 * (construct-0dj).
 *
 * The launcher chooses between a checkout's src/ and a build's dist/. That
 * choice is invisible at every surface: a subprocess test spawning the launcher
 * reports on whichever tree it picked, and says nothing about which one that
 * was. When the preference ran dist-first, `npm run smoke` leaving a gitignored
 * dist/ behind was enough to make every subprocess test in the suite silently
 * exercise a stale build — a false green nothing announces.
 *
 * So the rule is asserted directly rather than inferred from the suite passing.
 * Both trees are planted in a scratch directory as decoys that print which one
 * ran, and the real launcher file is copied in beside them. Copying rather than
 * pointing at the repo's own src/ and dist/ is deliberate: the test must be able
 * to state what happens when a dist/ exists WITHOUT creating one in the
 * developer's checkout, which is the very condition the bug needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

/**
 * Plants a fake package root: the real launcher, plus whichever of the two
 * trees the case calls for. Each tree's `main` prints its own name, so the
 * launcher's choice is readable from stdout rather than argued about.
 */
function plant(trees: { src?: boolean; dist?: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'construct-launcher-'));
  mkdirSync(join(root, 'bin'), { recursive: true });
  copyFileSync(LAUNCHER, join(root, 'bin', 'construct.mjs'));

  if (trees.src) {
    mkdirSync(join(root, 'src', 'cli'), { recursive: true });
    // Typed syntax on purpose: this file is only loadable if Node's native type
    // stripping is doing the work, which is how a dev checkout runs.
    writeFileSync(
      join(root, 'src', 'cli', 'index.ts'),
      'export async function main(): Promise<number> { console.log("ran:src"); return 0; }\n',
    );
  }
  if (trees.dist) {
    mkdirSync(join(root, 'dist', 'cli'), { recursive: true });
    writeFileSync(
      join(root, 'dist', 'cli', 'index.js'),
      'export async function main() { console.log("ran:dist"); return 0; }\n',
    );
  }
  return root;
}

async function run(root: string): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [join(root, 'bin', 'construct.mjs')]);
  return stdout.trim();
}

test('a checkout carrying a stale dist/ still runs src/ — the build under review', async () => {
  const root = plant({ src: true, dist: true });
  try {
    assert.equal(await run(root), 'ran:src');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the presence of dist/ changes nothing about what a checkout runs', async () => {
  const withoutDist = plant({ src: true });
  const withDist = plant({ src: true, dist: true });
  try {
    // The acceptance criterion in its own words: the same result either way.
    assert.equal(await run(withoutDist), await run(withDist));
  } finally {
    rmSync(withoutDist, { recursive: true, force: true });
    rmSync(withDist, { recursive: true, force: true });
  }
});

test('a packaged install, which ships no src/, runs dist/', async () => {
  const root = plant({ dist: true });
  try {
    assert.equal(await run(root), 'ran:dist');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
