/**
 * Static-export sanity. Asserts the dashboard build output has produced an
 * index.html + one HTML file per route in apps/dashboard/app/<route>/. Runs
 * the actual build first (so a fresh checkout passes).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withNextBuildLock } from './_lib/next-build-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const APP = join(REPO_ROOT, 'apps', 'dashboard');
const OUT = join(APP, 'out');
const NEXT_CACHE = join(APP, '.next');

const EXPECTED_ROUTES = [
  '/', '/agents', '/approvals', '/artifacts', '/audit', '/beads',
  '/commands', '/config', '/doctor', '/editor', '/hooks', '/infrastructure',
  '/intake', '/knowledge', '/mcp', '/models', '/performance', '/plugins',
  '/providers', '/resources', '/skills', '/snapshots', '/workflow',
];

test('apps/dashboard builds via next build', { timeout: 360_000 }, async () => {
  // Wipe .next/ before building. Stale incremental cache from a previous
  // partial build causes intermittent `PageNotFoundError: Cannot find
  // module for page: /<route>` during the "Collecting page data" phase.
  // Use `build` (not `build:next`) so the post-build copy-to-server-static
  // step also runs and keeps lib/server/static/ in sync.
  //
  // Retry once on the known-intermittent Next.js 15 export race where
  // `rename(.next/export/500.html → .next/server/pages/500.html)` throws
  // ENOENT. Cause appears to be an internal race between the static-export
  // step and Next.js's own cleanup; reproduces about 1-in-N runs locally
  // under parallel `node --test`, never in isolation. A clean rebuild
  // virtually always succeeds.
  //
  // Hold the cross-process next-build lock across both attempts. The dashboard
  // server suites also run `next build` (via construct dashboard:sync --build)
  // against the same distDir, and node:test runs those files concurrently;
  // without serialization Next.js 15 aborts the loser with "Another next build
  // process is already running".

  let result;
  await withNextBuildLock(REPO_ROOT, async () => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      rmSync(NEXT_CACHE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      result = spawnSync('npm', ['--prefix', APP, 'run', 'build'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 170_000,
      });
      const transientRename = /ENOENT.*rename.*\.next\/(export|server\/pages)\/500\.html/.test(
        `${result.stdout}\n${result.stderr}`,
      );
      if (result.status === 0) break;
      if (!transientRename) break;
    }
  });
  assert.equal(result.status, 0, `dashboard build failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.ok(existsSync(OUT), `expected build output at ${OUT}`);
  assert.ok(existsSync(join(OUT, 'index.html')), 'index.html must exist');
});

test('every expected route produces an index.html in the static export', async () => {
  if (!existsSync(OUT)) {
    // Build will have already run in the test above; skip if not.

    return;
  }

  for (const route of EXPECTED_ROUTES) {
    const path = route === '/' ? 'index.html' : `${route.replace(/^\//, '')}/index.html`;
    const full = join(OUT, path);
    assert.ok(existsSync(full), `expected ${path} after build`);
  }
});

test('all generated HTML files are non-empty', () => {
  if (!existsSync(OUT)) return;
  const walk = (dir) => {
    let count = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) count += walk(join(dir, entry.name));
      else if (entry.name.endsWith('.html')) {
        const stat = statSync(join(dir, entry.name));
        assert.ok(stat.size > 200, `empty html: ${join(dir, entry.name)} (${stat.size} bytes)`);
        count++;
      }
    }
    return count;
  };
  const total = walk(OUT);
  assert.ok(total >= EXPECTED_ROUTES.length, `expected ≥${EXPECTED_ROUTES.length} html files; got ${total}`);
});
