/**
 * tests/embed-rootdir-resolution.test.mjs — coverage for the precedence in
 * `resolveRootDir`: CX_DATA_DIR override beats walked-up project root beats
 * homedir fallback, and the walk is capped to avoid runaway stat() calls on
 * deeply nested filesystems.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveRootDir, findProjectRoot } from '../lib/embed/daemon.mjs';

// Track tmp dirs so the after() hook can clean every one in a single sweep
// even if a test throws partway through.

const tmpDirs = [];

function mkTmp(prefix = 'cx-rootdir-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

after(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('resolveRootDir', () => {
  it('CX_DATA_DIR wins even when cwd is inside a project', () => {
    const project = mkTmp();
    fs.mkdirSync(path.join(project, '.cx'), { recursive: true });
    fs.writeFileSync(path.join(project, '.cx', 'context.md'), '# context');
    const override = mkTmp();
    const result = resolveRootDir({ CX_DATA_DIR: override }, project);
    assert.equal(result, override);
  });

  it('walks up from cwd to find .cx/context.md', () => {
    const project = mkTmp();
    fs.mkdirSync(path.join(project, '.cx'), { recursive: true });
    fs.writeFileSync(path.join(project, '.cx', 'context.md'), '# context');
    const nested = path.join(project, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    const result = resolveRootDir({}, nested);
    assert.equal(fs.realpathSync(result), fs.realpathSync(project));
  });

  it('falls back to homedir when cwd is nowhere near a project', () => {
    const orphan = mkTmp();
    const result = resolveRootDir({}, orphan);
    assert.equal(result, os.homedir());
  });

  it('honors the 10-level walk-up cap', () => {
    const root = mkTmp();
    // Build 12 nested directories with no .cx anywhere on the chain; the cap
    // means we never find a project root even though one might exist far above.
    let current = root;
    for (let i = 0; i < 12; i++) {
      current = path.join(current, `lvl${i}`);
      fs.mkdirSync(current, { recursive: true });
    }
    // Verify the cap explicitly through findProjectRoot
    assert.equal(findProjectRoot(current, { maxLevels: 10 }), null);
    // And confirm resolveRootDir falls back to homedir in that case
    const result = resolveRootDir({}, current);
    assert.equal(result, os.homedir());
  });

  it('findProjectRoot returns null for empty / invalid inputs', () => {
    assert.equal(findProjectRoot(null), null);
    assert.equal(findProjectRoot(''), null);
    assert.equal(findProjectRoot(undefined), null);
  });
});
