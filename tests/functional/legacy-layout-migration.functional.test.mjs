/**
 * tests/functional/legacy-layout-migration.functional.test.mjs — the ADR-0074
 * reconciler that folds a pre-consolidation two-directory footprint (`.cx/` +
 * top-level launcher) into one `.construct/` with the launcher at
 * `.construct/launcher/`.
 *
 * Asserts: detection fires only on a legacy layout; apply() folds `.cx/` into
 * `.construct/` without clobbering newer `.construct/` state, relocates the
 * top-level launcher files, and is idempotent (detect() is false afterward).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import reconciler from '../../lib/reconcile/legacy-layout-migration.mjs';

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(prev);
  }
}

function mk(dir, rel, body = '') {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

test('detect() is false on a clean consolidated layout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-layout-clean-'));
  try {
    mk(dir, '.construct/context.md', '# ctx\n');
    mk(dir, '.construct/launcher/run.mjs', '// stub\n');
    const res = await withCwd(dir, () => reconciler.detect());
    assert.equal(res.needsRepair, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detect() fires on a legacy .cx/ dir and on a top-level launcher', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-layout-legacy-'));
  try {
    mk(dir, '.cx/context.md', '# ctx\n');
    mk(dir, '.construct/run.mjs', '// legacy launcher\n');
    const res = await withCwd(dir, () => reconciler.detect());
    assert.equal(res.needsRepair, true);
    assert.equal(res.details.legacyConfig, true);
    assert.ok(res.details.strayLauncherFiles.includes('run.mjs'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('apply() folds .cx/ into .construct/ and relocates the launcher, idempotently', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-layout-apply-'));
  try {
    mk(dir, '.cx/context.md', '# legacy ctx\n');
    mk(dir, '.cx/knowledge/internal/note.md', '# note\n');
    mk(dir, '.cx/org/specialists/cx-widget.json', '{}');
    mk(dir, '.construct/run.mjs', '// legacy launcher\n');
    mk(dir, '.construct/version', '1.0.0\n');
    mk(dir, '.construct/observations/obs.json', '{}');

    await withCwd(dir, () => reconciler.apply());

    assert.ok(fs.existsSync(path.join(dir, '.construct/context.md')), 'context folded');
    assert.ok(fs.existsSync(path.join(dir, '.construct/knowledge/internal/note.md')), 'nested knowledge folded');
    assert.ok(fs.existsSync(path.join(dir, '.construct/org/specialists/cx-widget.json')), 'org folded');
    assert.ok(fs.existsSync(path.join(dir, '.construct/observations/obs.json')), 'pre-existing .construct state preserved');
    assert.ok(fs.existsSync(path.join(dir, '.construct/launcher/run.mjs')), 'launcher relocated');
    assert.ok(fs.existsSync(path.join(dir, '.construct/launcher/version')), 'version relocated');
    assert.equal(fs.existsSync(path.join(dir, '.cx')), false, 'legacy .cx removed');
    assert.equal(fs.existsSync(path.join(dir, '.construct/run.mjs')), false, 'top-level launcher removed');

    const after = await withCwd(dir, () => reconciler.detect());
    assert.equal(after.needsRepair, false, 'idempotent: nothing left to migrate');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('apply() never clobbers newer .construct/ state when folding .cx/', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-layout-noclobber-'));
  try {
    mk(dir, '.cx/context.md', 'OLD\n');
    mk(dir, '.construct/context.md', 'NEW\n');
    await withCwd(dir, () => reconciler.apply());
    assert.equal(fs.readFileSync(path.join(dir, '.construct/context.md'), 'utf8'), 'NEW\n', 'newer .construct/ file kept');
    assert.equal(fs.existsSync(path.join(dir, '.cx')), false, 'legacy .cx removed after fold');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
