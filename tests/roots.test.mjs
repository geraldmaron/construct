/**
 * tests/roots.test.mjs — Bun-compiled-binary path resolution (construct-qvou).
 *
 * A compiled `bun build --compile` binary collapses every bundled module's
 * import.meta.url/dirname to the same virtual `/$bunfs/root` path and sets
 * process.argv[1] to that same virtual path, which broke two things bin/construct
 * and ~19 lib/*.mjs modules depended on: resolving their own install root, and the
 * standard "was I run directly" script guard. Regression coverage for the failure
 * mode itself (every data-dir read throwing ENOENT, silently, behind exit 0) lives
 * in tests/functional/bun-compiled-binary.functional.test.mjs, gated on Bun being
 * installed; these are hermetic unit tests of the resolution logic that guards it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';

import { isBunCompiledVirtualPath, resolveInstallRoot, isMainModule, packageRoot } from '../lib/roots.mjs';

function withBunVersion(version, fn) {
  const prior = process.versions.bun;
  if (version === undefined) delete process.versions.bun;
  else process.versions.bun = version;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.versions.bun;
    else process.versions.bun = prior;
  }
}

test('isBunCompiledVirtualPath only matches the bunfs prefix, and only under Bun', () => {
  withBunVersion('1.3.14', () => {
    assert.equal(isBunCompiledVirtualPath('/$bunfs/root'), true);
    assert.equal(isBunCompiledVirtualPath('/$bunfs/root/lib/foo.mjs'), true);
    assert.equal(isBunCompiledVirtualPath('/Users/me/construct'), false);
  });
  withBunVersion(undefined, () => {
    // Same literal string never occurs outside a Bun-compiled binary, but the
    // guard must not misfire if it somehow did — it is gated on process.versions.bun.
    assert.equal(isBunCompiledVirtualPath('/$bunfs/root'), false);
  });
});

test('resolveInstallRoot passes through a real path unchanged', () => {
  withBunVersion('1.3.14', () => {
    const real = path.resolve('/Users/me/construct');
    assert.equal(resolveInstallRoot(real), real);
  });
  withBunVersion(undefined, () => {
    assert.equal(resolveInstallRoot('/$bunfs/root'), '/$bunfs/root');
  });
});

test('resolveInstallRoot falls back to the real directory around process.execPath under Bun compile', () => {
  withBunVersion('1.3.14', () => {
    const fakeExecPath = '/opt/construct/dist/construct-darwin-arm64';
    const resolved = resolveInstallRoot('/$bunfs/root', { execPath: fakeExecPath });
    assert.equal(resolved, '/opt/construct');
  });
});

test('resolveInstallRoot supports a deeper upFromBinary for nested-module callers', () => {
  withBunVersion('1.3.14', () => {
    const fakeExecPath = '/opt/construct/dist/construct-darwin-arm64';
    const resolved = resolveInstallRoot('/$bunfs/root', { execPath: fakeExecPath, upFromBinary: 2 });
    assert.equal(resolved, '/opt');
  });
});

test('packageRoot resolves to a real, existing directory containing this package.json', () => {
  assert.ok(fs.existsSync(path.join(packageRoot, 'package.json')));
});

test('isMainModule matches the standard "run directly" comparison outside Bun compile', () => {
  const priorArgv1 = process.argv[1];
  process.argv[1] = '/Users/me/construct/lib/headhunt.mjs';
  try {
    assert.equal(isMainModule('file:///Users/me/construct/lib/headhunt.mjs'), true);
    assert.equal(isMainModule('file:///Users/me/construct/lib/other.mjs'), false);
  } finally {
    process.argv[1] = priorArgv1;
  }
});

test('isMainModule always resolves false under a Bun-compiled binary, even for a literal match', () => {
  const priorArgv1 = process.argv[1];
  process.argv[1] = '/$bunfs/root/construct-darwin-arm64';
  withBunVersion('1.3.14', () => {
    try {
      // Every bundled module's import.meta.url collapses to this same string;
      // a naive comparison would say "yes, I am main" for all of them at once.
      assert.equal(isMainModule('file:///$bunfs/root/construct-darwin-arm64'), false);
    } finally {
      process.argv[1] = priorArgv1;
    }
  });
});
