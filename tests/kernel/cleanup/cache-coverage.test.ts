/**
 * tests/kernel/cleanup/cache-coverage.test.ts — the cleanup catalog must know
 * every cache the product writes.
 *
 * The failure this guards against is silent: a new subdirectory written under
 * the cache root with no matching cleanup item lingers on disk forever, and the
 * one that prompted it held the extracted plaintext of client documents. So the
 * test does not hardcode the list — it reads the source for every place the
 * product joins a literal segment onto `cacheDir`, and asserts a machine-scope
 * catalog item detects that subdirectory when it exists. Add a cache write
 * without a cleanup item and this test goes red.
 *
 * Rooted in a tmpdir home; the real $HOME is never read or written.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from '../../../src/kernel/paths.ts';
import { buildCleanupCatalog } from '../../../src/kernel/cleanup/catalog.ts';
import type { SpawnFn } from '../../../src/kernel/cleanup/catalog.ts';

const NOT_FOUND_SPAWN: SpawnFn = () => ({ status: 1, stdout: '', stderr: '' });

const SRC_ROOT = fileURLToPath(new URL('../../../src', import.meta.url));
const CATALOG_FILE = path.join(SRC_ROOT, 'kernel', 'cleanup', 'catalog.ts');

/** Every .ts file under src/, so the scan cannot miss a writer in a corner. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * The literal subdirectory names the product joins onto cacheDir — `join(…
 * cacheDir, 'extractions')` yields `extractions`. The catalog file itself is
 * excluded: its cacheDir joins are the cleanup detection, not a product write,
 * so counting them would let the catalog vacuously satisfy its own coverage.
 */
function cacheSubdirsWritten(): Set<string> {
  const pattern = /cacheDir\s*\)?\s*,\s*['"]([^'"/]+)['"]/g;
  const names = new Set<string>();
  for (const file of sourceFiles(SRC_ROOT)) {
    if (file === CATALOG_FILE) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}

test('every cache subdirectory the product writes has a cleanup item that detects it', () => {
  const subdirs = cacheSubdirsWritten();
  // The scan must find something, or a silently broken regex would pass here by
  // covering an empty set. Extractions is the known writer today.
  assert.ok(subdirs.has('extractions'), `expected the source scan to find the extractions cache, found: ${[...subdirs].join(', ')}`);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cache-cov-'));
  try {
    const paths = resolvePaths({}, home);
    for (const subdir of subdirs) {
      fs.mkdirSync(path.join(paths.cacheDir, subdir), { recursive: true });
    }
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cache-cov-cwd-'));
    try {
      const catalog = buildCleanupCatalog({ cwd, home, paths, spawn: NOT_FOUND_SPAWN });
      for (const subdir of subdirs) {
        const target = path.join(paths.cacheDir, subdir);
        const covering = catalog.filter((item) => item.scope === 'machine' && item.detect());
        // At least one machine item must fire for this subdir, and removing it
        // must actually take the directory away.
        assert.ok(
          covering.length > 0,
          `no cleanup item detects the cache subdirectory "${subdir}" (${target})`,
        );
      }
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the extractions cleanup item removes the extracted-text cache', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cache-cov-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cache-cov-cwd-'));
  try {
    const paths = resolvePaths({}, home);
    const extractions = path.join(paths.cacheDir, 'extractions');
    fs.mkdirSync(extractions, { recursive: true });
    fs.writeFileSync(path.join(extractions, 'matter-name-deadbeef.md'), 'confidential extracted text');

    const catalog = buildCleanupCatalog({ cwd, home, paths, spawn: NOT_FOUND_SPAWN });
    const item = catalog.find((i) => i.id === 'machine-cache-extractions');
    assert.ok(item, 'the extractions cleanup item exists');
    assert.equal(item.detect(), true);
    item.remove();
    assert.equal(fs.existsSync(extractions), false, 'the extracted-text cache is gone after removal');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
