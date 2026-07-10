/**
 * tests/init-update-guide.test.mjs — construct_guide migration helpers.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyConstructGuideUpdate,
  isStaleConstructGuide,
  needsConstructGuideUpdate,
} from '../lib/init-update-guide.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const SHIPPED = fs.readFileSync(
  path.join(ROOT_DIR, 'templates', 'docs', 'construct_guide.md'),
  'utf8',
);

test('isStaleConstructGuide detects R&D-specific legacy copy', () => {
  assert.equal(isStaleConstructGuide('# Welcome\n\nR&D intake queue\n'), true);
  assert.equal(isStaleConstructGuide(SHIPPED), false);
});

test('needsConstructGuideUpdate proposes refresh for stale .cx guide', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-guide-update-'));
  try {
    fs.mkdirSync(path.join(projectDir, '.construct'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.construct', 'construct_guide.md'),
      '# Welcome\n\nDrop files for R&D classification.\n',
    );
    const state = needsConstructGuideUpdate(projectDir);
    assert.equal(state.needed, true);
    assert.equal(state.located.location, '.construct');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('applyConstructGuideUpdate writes shipped template and removes root legacy', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-guide-apply-'));
  try {
    fs.writeFileSync(path.join(projectDir, 'construct_guide.md'), '# legacy root\n');
    const dest = applyConstructGuideUpdate(projectDir, SHIPPED);
    assert.equal(dest, path.join(projectDir, '.construct', 'construct_guide.md'));
    assert.equal(fs.existsSync(path.join(projectDir, 'construct_guide.md')), false);
    assert.match(fs.readFileSync(dest, 'utf8'), /construct intake --help/);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
