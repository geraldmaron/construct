/**
 * tests/project-root.test.mjs — covers lib/project-root.mjs:
 *   - findProjectRoot walks upward for `.cx/` or `.construct/` markers
 *   - stops at $HOME (so ~ doesn't look like a project)
 *   - projectIdFor is deterministic + stable per absolute path
 *   - resolveProjectScopedPath returns project path when in a project,
 *     the global doctor-root path otherwise
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { findProjectRoot, projectIdFor, resolveProjectScope, resolveProjectScopedPath, _resetCache } from '../lib/project-root.mjs';
import { doctorRoot } from '../lib/config/xdg.mjs';

function makeTmp(prefix = 'cx-pr-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('findProjectRoot returns null when no marker is found', () => {
  _resetCache();
  const { dir, cleanup } = makeTmp();
  try {
    assert.equal(findProjectRoot(dir), null);
  } finally { cleanup(); }
});

test('findProjectRoot never treats the OS tmpdir itself as a project root, even with a leaked marker there', (t) => {
  _resetCache();
  const tmpRootMarker = join(tmpdir(), '.construct');
  const preExisting = existsSync(tmpRootMarker);
  if (!preExisting) mkdirSync(tmpRootMarker, { recursive: true });
  t.after(() => { if (!preExisting) rmSync(tmpRootMarker, { recursive: true, force: true }); });
  const { dir, cleanup } = makeTmp();
  try {
    assert.equal(findProjectRoot(dir), null,
      'a marker-less fixture under the shared tmpdir must not resolve $TMPDIR as its project root');
  } finally { cleanup(); }
});

test('findProjectRoot compares its stop dirs symlink-tolerantly (macOS /var vs /private/var)', () => {
  _resetCache();
  const { dir, cleanup } = makeTmp();
  try {
    const realDir = realpathSync.native(dir);
    assert.equal(findProjectRoot(realDir), null,
      'a realpath-form cwd must still stop at the (possibly symlink-form) tmpdir boundary');
  } finally { cleanup(); }
});

test('findProjectRoot returns the dir containing a .cx/ marker', () => {
  _resetCache();
  const { dir, cleanup } = makeTmp();
  try {
    mkdirSync(join(dir, '.cx'), { recursive: true });
    assert.equal(findProjectRoot(dir), dir);
  } finally { cleanup(); }
});

test('findProjectRoot accepts .construct/ as a marker', () => {
  _resetCache();
  const { dir, cleanup } = makeTmp();
  try {
    mkdirSync(join(dir, '.construct'), { recursive: true });
    assert.equal(findProjectRoot(dir), dir);
  } finally { cleanup(); }
});

test('findProjectRoot walks upward and stops at the first matching ancestor', () => {
  _resetCache();
  const { dir, cleanup } = makeTmp();
  try {
    const nested = join(dir, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(dir, '.cx'), { recursive: true });
    assert.equal(findProjectRoot(nested), dir);
  } finally { cleanup(); }
});

test('findProjectRoot stops at $HOME — does not look at filesystem root', () => {
  // $HOME has its own .cx for the user, which would otherwise make every
  // cwd resolve to "HOME as the project root" and break the contract.

  _resetCache();
  const fakeHome = homedir();
  // Use a tmp dir OUTSIDE $HOME to confirm; if cwd is under $HOME, the
  // walk should still terminate at $HOME (not bubble up further).

  const outside = mkdtempSync(join(tmpdir(), 'cx-outside-home-'));
  try {
    // No markers anywhere up to root.

    const result = findProjectRoot(outside);
    assert.equal(result, null, `cwd outside HOME with no marker must return null; got ${result}`);
  } finally { rmSync(outside, { recursive: true, force: true }); }
});

test('projectIdFor is deterministic and 12 hex chars', () => {
  const id1 = projectIdFor('/Users/test/projects/myapp');
  const id2 = projectIdFor('/Users/test/projects/myapp');
  assert.equal(id1, id2);
  assert.match(id1, /^[0-9a-f]{12}$/);

  const id3 = projectIdFor('/Users/test/projects/other');
  assert.notEqual(id1, id3, 'different paths must produce different ids');
});

test('resolveProjectScope returns null outside a project, scope object inside', () => {
  _resetCache();
  const outside = mkdtempSync(join(tmpdir(), 'cx-outside-'));
  const inside = mkdtempSync(join(tmpdir(), 'cx-inside-'));
  try {
    mkdirSync(join(inside, '.cx'), { recursive: true });

    assert.equal(resolveProjectScope(outside), null);
    const scope = resolveProjectScope(inside);
    assert.ok(scope, 'inside a project must return a scope object');
    assert.equal(scope.projectRoot, inside);
    assert.equal(scope.cxDir, join(inside, '.construct'));
    assert.match(scope.projectId, /^[0-9a-f]{12}$/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(inside, { recursive: true, force: true });
  }
});

test('resolveProjectScopedPath returns project path inside a project, doctor-root path outside', () => {
  _resetCache();
  const outside = mkdtempSync(join(tmpdir(), 'cx-outside-'));
  const inside = mkdtempSync(join(tmpdir(), 'cx-inside-'));
  try {
    mkdirSync(join(inside, '.cx'), { recursive: true });

    const insideP = resolveProjectScopedPath('audit-reads.jsonl', { cwd: inside, ensureDir: false });
    assert.equal(insideP, join(inside, '.construct', 'audit-reads.jsonl'));

    const outsideP = resolveProjectScopedPath('audit-reads.jsonl', { cwd: outside, ensureDir: false });
    assert.equal(outsideP, join(doctorRoot(), 'audit-reads.jsonl'));
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(inside, { recursive: true, force: true });
  }
});
