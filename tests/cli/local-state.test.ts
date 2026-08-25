/**
 * tests/cli/local-state.test.ts — where `state: local` actually takes effect.
 *
 * Two things are under test: the refusal (a repo-local store is allowed only
 * when its path is both covered by the repository's ignore rules and not
 * already tracked — the two checks are independent and both are required),
 * and the resolution around it (an unratified file has no effect, ratifying
 * never needs the store to have moved yet, and asking where the store lives
 * never creates one as a side effect of asking).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localStateDataDir, resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath, StoreUnavailableError } from '../../src/kernel/store/open.ts';
import { ratifySettingsFile } from '../../src/kernel/store/ratifications.ts';
import { discoverProjectSettings, fileValuesToObject } from '../../src/cli/settings-file.ts';
import { localStateRefusalReason, resolveStoreLocation } from '../../src/cli/local-state.ts';

function sh(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

/** A real git repository (git init'd, not a stubbed .git directory) under a home floor. */
function repo(): { home: string; root: string; cleanup(): void } {
  const home = mkdtempSync(join(tmpdir(), 'construct-local-state-'));
  const root = join(home, 'repo');
  mkdirSync(root, { recursive: true });
  sh(root, ['init', '-q']);
  sh(root, ['config', 'user.email', 'test@example.com']);
  sh(root, ['config', 'user.name', 'Test']);
  return { home, root, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// localStateRefusalReason
// ---------------------------------------------------------------------------

test('refused when the store path is not covered by any ignore rule', () => {
  const r = repo();
  try {
    const storeFile = join(localStateDataDir(r.root), 'construct.db');
    const reason = localStateRefusalReason(r.root, storeFile);
    assert.ok(reason !== null);
    assert.match(reason as string, /not covered by this repository's ignore rules/);
  } finally {
    r.cleanup();
  }
});

test('allowed when the store path is ignored and not tracked', () => {
  const r = repo();
  try {
    writeFileSync(join(r.root, '.gitignore'), '.construct/state/\n');
    const storeFile = join(localStateDataDir(r.root), 'construct.db');
    assert.equal(localStateRefusalReason(r.root, storeFile), null);
  } finally {
    r.cleanup();
  }
});

test('refused when the store path is ignored but already tracked — a gitignore check alone is not enough', () => {
  const r = repo();
  try {
    // The store was tracked before state: local, or someone force-added it —
    // gitignore has no effect on a path git already tracks.
    const dataDir = localStateDataDir(r.root);
    mkdirSync(dataDir, { recursive: true });
    const storeFile = join(dataDir, 'construct.db');
    writeFileSync(storeFile, 'not a real store, just tracked');
    writeFileSync(join(r.root, '.gitignore'), '.construct/state/\n');
    sh(r.root, ['add', '-f', '--', storeFile]);

    const reason = localStateRefusalReason(r.root, storeFile);
    assert.ok(reason !== null);
    assert.match(reason as string, /already tracked by git/);
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// resolveStoreLocation
// ---------------------------------------------------------------------------

function homePaths(home: string): { configDir: string; stateDir: string; dataDir: string; cacheDir: string } {
  // The same resolution resolveStoreLocation itself uses internally — a test
  // double here would silently stop testing the real home path.
  return resolvePaths({}, home);
}

test('resolving never creates the home store merely to answer the question', () => {
  const r = repo();
  try {
    const location = resolveStoreLocation(r.root, {}, r.home);
    assert.equal(location.local, false);
    assert.equal(existsSync(storePath(homePaths(r.home))), false);
  } finally {
    r.cleanup();
  }
});

test('an unratified file declaring state: local has zero effect on where the store opens', () => {
  const r = repo();
  try {
    writeFileSync(join(r.root, '.gitignore'), '.construct/state/\n');
    mkdirSync(join(r.root, '.construct'), { recursive: true });
    writeFileSync(join(r.root, '.construct', 'settings.json'), '{"state":"local"}');

    // The home store exists (something else opened it), but this file was
    // never ratified.
    const paths = homePaths(r.home);
    openStore(storePath(paths)).close();

    const location = resolveStoreLocation(r.root, {}, r.home);
    assert.equal(location.local, false);
    assert.equal(location.path, storePath(paths));
  } finally {
    r.cleanup();
  }
});

test('a ratified state: local file, with an ignored and untracked store path, roots the store in the repo', () => {
  const r = repo();
  try {
    writeFileSync(join(r.root, '.gitignore'), '.construct/state/\n');
    mkdirSync(join(r.root, '.construct'), { recursive: true });
    writeFileSync(join(r.root, '.construct', 'settings.json'), '{"state":"local"}');

    const paths = homePaths(r.home);
    const homeStore = openStore(storePath(paths));
    const found = discoverProjectSettings(r.root, r.home);
    assert.ok(found.outcome === 'found');
    ratifySettingsFile(homeStore, {
      repoIdentity: found.repoIdentity,
      contentHash: found.hash,
      path: found.path,
      settings: fileValuesToObject(found.values),
      ratifiedAt: '2026-08-25T00:00:00.000Z',
    });
    homeStore.close();

    const location = resolveStoreLocation(r.root, {}, r.home);
    assert.equal(location.local, true);
    assert.equal(location.repoRoot, r.root);
    assert.equal(location.path, join(localStateDataDir(r.root), 'construct.db'));
  } finally {
    r.cleanup();
  }
});

test('a ratified state: local file whose store path is not ignored is refused, not silently rerouted home', () => {
  const r = repo();
  try {
    // No .gitignore at all this time.
    mkdirSync(join(r.root, '.construct'), { recursive: true });
    writeFileSync(join(r.root, '.construct', 'settings.json'), '{"state":"local"}');

    const paths = homePaths(r.home);
    const homeStore = openStore(storePath(paths));
    const found = discoverProjectSettings(r.root, r.home);
    assert.ok(found.outcome === 'found');
    ratifySettingsFile(homeStore, {
      repoIdentity: found.repoIdentity,
      contentHash: found.hash,
      path: found.path,
      settings: fileValuesToObject(found.values),
      ratifiedAt: '2026-08-25T00:00:00.000Z',
    });
    homeStore.close();

    assert.throws(
      () => resolveStoreLocation(r.root, {}, r.home),
      (error: unknown) =>
        error instanceof StoreUnavailableError && /not covered by this repository's ignore rules/.test(error.message),
    );
  } finally {
    r.cleanup();
  }
});

test('a malformed project settings file never crashes resolution — it falls back to the home store with a clean notice', () => {
  const r = repo();
  const originalWrite = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    captured += typeof chunk === 'string' ? chunk : String(chunk);
    return originalWrite(chunk as never, ...(rest as []));
  }) as typeof process.stderr.write;
  try {
    mkdirSync(join(r.root, '.construct'), { recursive: true });
    writeFileSync(join(r.root, '.construct', 'settings.json'), 'not json at all {{{');

    const paths = homePaths(r.home);
    openStore(storePath(paths)).close();

    const location = resolveStoreLocation(r.root, {}, r.home);
    assert.equal(location.local, false);
    assert.equal(location.path, storePath(paths));
    assert.match(captured, /project settings file was not applied/);
    assert.match(captured, /not valid JSON/);
  } finally {
    process.stderr.write = originalWrite;
    r.cleanup();
  }
});

test('a project settings file carrying an unknown or consent-bearing key never crashes resolution', () => {
  const r = repo();
  const originalWrite = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    captured += typeof chunk === 'string' ? chunk : String(chunk);
    return originalWrite(chunk as never, ...(rest as []));
  }) as typeof process.stderr.write;
  try {
    mkdirSync(join(r.root, '.construct'), { recursive: true });
    writeFileSync(join(r.root, '.construct', 'settings.json'), '{"consent":"on"}');

    const paths = homePaths(r.home);
    openStore(storePath(paths)).close();

    const location = resolveStoreLocation(r.root, {}, r.home);
    assert.equal(location.local, false);
    assert.equal(location.path, storePath(paths));
    assert.match(captured, /project settings file was not applied/);
  } finally {
    process.stderr.write = originalWrite;
    r.cleanup();
  }
});

test('CONSTRUCT_STATE=home forces home even once redirection is ratified and active', () => {
  const r = repo();
  try {
    writeFileSync(join(r.root, '.gitignore'), '.construct/state/\n');
    mkdirSync(join(r.root, '.construct'), { recursive: true });
    writeFileSync(join(r.root, '.construct', 'settings.json'), '{"state":"local"}');

    const paths = homePaths(r.home);
    const homeStore = openStore(storePath(paths));
    const found = discoverProjectSettings(r.root, r.home);
    assert.ok(found.outcome === 'found');
    ratifySettingsFile(homeStore, {
      repoIdentity: found.repoIdentity,
      contentHash: found.hash,
      path: found.path,
      settings: fileValuesToObject(found.values),
      ratifiedAt: '2026-08-25T00:00:00.000Z',
    });
    homeStore.close();

    const forced = resolveStoreLocation(r.root, { CONSTRUCT_STATE: 'home' }, r.home);
    assert.equal(forced.local, false);
    assert.equal(forced.path, storePath(paths));
  } finally {
    r.cleanup();
  }
});
