/**
 * tests/overrides-resolver.test.mjs — single-helper override contract.
 *
 * Pins the {original → override → backup} flow for every editable
 * Construct primitive. Verifies: resolver picks override over original
 * when one exists, applyEdit snapshots prior content into a timestamped
 * backup, restoreFromBackup is the inverse, .cx/.gitignore excludes
 * backups/ automatically, and pruneBackups respects the 60-day cap.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  resolveOverride,
  readResolved,
  applyEdit,
  listBackups,
  restoreFromBackup,
  pruneBackups,
  describeOverrides,
  SUPPORTED_CATEGORIES,
} from '../lib/overrides/resolver.mjs';

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-overrides-'));
  fs.mkdirSync(path.join(projectRoot, '.git'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function writeOriginal(category, name, content, opts = {}) {
  const dir = path.join(projectRoot, opts.dir || category);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, opts.filename || `${name}.md`), content);
}

describe('resolveOverride', () => {
  it('returns the original when no override exists', () => {
    writeOriginal('personas', 'construct', '# Construct persona');
    const r = resolveOverride(projectRoot, 'personas', 'construct');
    assert.equal(r.source, 'original');
    assert.equal(r.overrideExists, false);
    assert.ok(r.path.endsWith('personas/construct.md'));
  });

  it('returns the override when one exists', () => {
    writeOriginal('personas', 'construct', '# Construct persona');
    applyEdit(projectRoot, 'personas', 'construct', '# Atlas persona');
    const r = resolveOverride(projectRoot, 'personas', 'construct');
    assert.equal(r.source, 'override');
    assert.equal(r.overrideExists, true);
    assert.ok(r.path.includes('.cx/personas/construct.md'));
  });

  it('reports source=missing when neither original nor override exists', () => {
    const r = resolveOverride(projectRoot, 'personas', 'phantom');
    assert.equal(r.source, 'missing');
    assert.equal(r.path, null);
  });

  it('handles singleFile categories (contracts, role-manifests)', () => {
    fs.mkdirSync(path.join(projectRoot, 'specialists'));
    fs.writeFileSync(path.join(projectRoot, 'specialists', 'contracts.json'), '{}');
    const r = resolveOverride(projectRoot, 'contracts', 'ignored-name');
    assert.equal(r.source, 'original');
    assert.ok(r.path.endsWith('specialists/contracts.json'));
  });

  it('throws on unknown category', () => {
    assert.throws(
      () => resolveOverride(projectRoot, 'made-up-category', 'foo'),
      /unknown override category/,
    );
  });
});

describe('applyEdit', () => {
  it('writes the override file and returns the path it wrote', () => {
    writeOriginal('personas', 'construct', '# original');
    const r = applyEdit(projectRoot, 'personas', 'construct', '# changed');
    assert.ok(fs.existsSync(r.overridePath));
    assert.equal(fs.readFileSync(r.overridePath, 'utf8'), '# changed');
    assert.equal(r.wrote, '# changed'.length);
  });

  it('snapshots the prior content to .cx/backups/<category>/<name>.<iso>.<ext>', () => {
    writeOriginal('personas', 'construct', '# original');
    const r = applyEdit(projectRoot, 'personas', 'construct', '# changed');
    assert.ok(r.backupPath, 'first edit must back up the original');
    assert.equal(fs.readFileSync(r.backupPath, 'utf8'), '# original');
    assert.match(r.backupPath, /\.cx\/backups\/personas\/construct\..+\.md$/);
  });

  it('snapshots subsequent edits from the override, not the original', () => {
    writeOriginal('personas', 'construct', '# original');
    applyEdit(projectRoot, 'personas', 'construct', '# v1');
    const r2 = applyEdit(projectRoot, 'personas', 'construct', '# v2');
    assert.ok(r2.backupPath, 'second edit must back up v1');
    assert.equal(fs.readFileSync(r2.backupPath, 'utf8'), '# v1');
  });

  it('does not write a backup when content is identical', () => {
    writeOriginal('personas', 'construct', '# same');
    const r = applyEdit(projectRoot, 'personas', 'construct', '# same');
    assert.equal(r.backupPath, null);
  });

  it('creates .cx/.gitignore excluding backups/ on first apply', () => {
    writeOriginal('personas', 'construct', '# x');
    applyEdit(projectRoot, 'personas', 'construct', '# y');
    const gi = fs.readFileSync(path.join(projectRoot, '.cx', '.gitignore'), 'utf8');
    assert.match(gi, /^backups\/$/m);
  });
});

describe('listBackups + restoreFromBackup', () => {
  it('lists backups newest-first by mtime', async () => {
    writeOriginal('personas', 'construct', '# v0');
    applyEdit(projectRoot, 'personas', 'construct', '# v1');
    await new Promise((r) => setTimeout(r, 10));
    applyEdit(projectRoot, 'personas', 'construct', '# v2');
    const backups = listBackups(projectRoot, 'personas', 'construct');
    assert.equal(backups.length, 2);
    assert.ok(backups[0].mtimeMs >= backups[1].mtimeMs);
  });

  it('restoreFromBackup replaces the current override with the backup content', async () => {
    writeOriginal('personas', 'construct', '# v0');
    applyEdit(projectRoot, 'personas', 'construct', '# v1');
    await new Promise((r) => setTimeout(r, 20));
    applyEdit(projectRoot, 'personas', 'construct', '# v2');
    const backups = listBackups(projectRoot, 'personas', 'construct');
    const oldest = backups[backups.length - 1];
    restoreFromBackup(projectRoot, 'personas', 'construct', oldest.filename);
    const current = readResolved(projectRoot, 'personas', 'construct');
    assert.equal(current.content, '# v0');
  });
});

describe('pruneBackups', () => {
  it('deletes backups older than the cap and keeps newer ones', () => {
    writeOriginal('personas', 'construct', '# v0');
    applyEdit(projectRoot, 'personas', 'construct', '# v1');
    const backups = listBackups(projectRoot, 'personas', 'construct');
    const fresh = backups[0].path;
    const oldDir = path.join(projectRoot, '.cx', 'backups', 'personas');
    const stalePath = path.join(oldDir, 'construct.stale.md');
    fs.writeFileSync(stalePath, '# stale');
    const sevenYearsAgo = Date.now() - 7 * 365 * 24 * 60 * 60 * 1000;
    fs.utimesSync(stalePath, sevenYearsAgo / 1000, sevenYearsAgo / 1000);

    const result = pruneBackups(projectRoot, { maxDays: 60 });
    assert.ok(result.pruned.includes(stalePath));
    assert.ok(fs.existsSync(fresh), 'fresh backup must remain');
    assert.ok(!fs.existsSync(stalePath), 'stale backup must be deleted');
  });

  it('is a no-op when .cx/backups/ does not exist', () => {
    const result = pruneBackups(projectRoot, { maxDays: 60 });
    assert.deepEqual(result.pruned, []);
  });
});

describe('describeOverrides', () => {
  it('returns an empty per-category map when no overrides exist', () => {
    const summary = describeOverrides(projectRoot);
    for (const cat of SUPPORTED_CATEGORIES) {
      assert.deepEqual(summary[cat], []);
    }
  });

  it('lists every override file per category', () => {
    writeOriginal('personas', 'construct', '# x');
    applyEdit(projectRoot, 'personas', 'construct', '# y');
    applyEdit(projectRoot, 'personas', 'cx-explorer', '# z');
    const summary = describeOverrides(projectRoot);
    assert.ok(summary.personas.includes('construct.md'));
    assert.ok(summary.personas.includes('cx-explorer.md'));
  });
});
