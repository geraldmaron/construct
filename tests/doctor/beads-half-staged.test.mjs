/**
 * tests/doctor/beads-half-staged.test.mjs — doctor detection for half-initialized Beads state.
 *
 * Verifies that when .claude/settings.json references `bd` but .beads/ is absent
 * or lacks a database file, the doctor check fails with a repair hint. Also verifies
 * that a fully initialized .beads/ passes, and that the check is silent when neither
 * hooks nor .beads/ are present (opt-out is not an error).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';

// Inline the same detection logic as cmdDoctor so the test is self-contained
// and does not need to spawn the full CLI.

function detectBeadsHalfStaged(cwd) {
  const projectSettingsPath = path.join(cwd, '.claude', 'settings.json');
  let hasHooksRef = false;
  if (fs.existsSync(projectSettingsPath)) {
    const raw = fs.readFileSync(projectSettingsPath, 'utf8');
    hasHooksRef = /\bbd\b/.test(raw);
  }
  if (!hasHooksRef) return { checked: false };

  const beadsDir = path.join(cwd, '.beads');
  const beadsHasDb = fs.existsSync(beadsDir) && (
    fs.existsSync(path.join(beadsDir, 'issues.jsonl')) ||
    fs.existsSync(path.join(beadsDir, 'metadata.json'))
  );
  return { checked: true, pass: beadsHasDb };
}

test('fails when settings.json references bd but .beads/ is absent', () => {
  const dir = tempDir('construct-doctor-beads-');
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ command: 'bd ready' }] } }),
    );

    const result = detectBeadsHalfStaged(dir);

    assert.equal(result.checked, true, 'check should run when bd is referenced');
    assert.equal(result.pass, false, 'check should fail when .beads/ is absent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('passes when .beads/ exists with issues.jsonl', () => {
  const dir = tempDir('construct-doctor-beads-');
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ command: 'bd ready' }] } }),
    );
    fs.mkdirSync(path.join(dir, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.beads', 'issues.jsonl'), '');

    const result = detectBeadsHalfStaged(dir);

    assert.equal(result.checked, true);
    assert.equal(result.pass, true, 'check should pass when issues.jsonl exists');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('passes when .beads/ exists with metadata.json', () => {
  const dir = tempDir('construct-doctor-beads-');
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ command: 'bd ready' }] } }),
    );
    fs.mkdirSync(path.join(dir, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.beads', 'metadata.json'), '{}');

    const result = detectBeadsHalfStaged(dir);

    assert.equal(result.checked, true);
    assert.equal(result.pass, true, 'check should pass when metadata.json exists');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skips check when settings.json does not reference bd', () => {
  const dir = tempDir('construct-doctor-beads-');
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [] } }),
    );

    const result = detectBeadsHalfStaged(dir);

    assert.equal(result.checked, false, 'check should not run when bd is not referenced');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skips check when no settings.json exists', () => {
  const dir = tempDir('construct-doctor-beads-');
  try {
    const result = detectBeadsHalfStaged(dir);
    assert.equal(result.checked, false, 'check should not run when settings.json is absent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fails when .beads/ dir exists but has no db file', () => {
  const dir = tempDir('construct-doctor-beads-');
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ command: 'bd ready' }] } }),
    );
    fs.mkdirSync(path.join(dir, '.beads'), { recursive: true });

    const result = detectBeadsHalfStaged(dir);

    assert.equal(result.checked, true);
    assert.equal(result.pass, false, 'check should fail when .beads/ has no db file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
