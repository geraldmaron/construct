/**
 * tests/functional/artifact-release-gate.functional.test.mjs — end-to-end artifact gate in tmpdir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtifactRelease } from '../../lib/artifact-release-gate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('artifact gate blocks PRD missing required sections', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-gate-'));
  try {
    const f = join(dir, 'bad-prd.md');
    writeFileSync(f, '# PRD\n\n## Problem\n\nOnly one section.\n');
    const r = validateArtifactRelease({ filePath: f, type: 'prd', rootDir: REPO });
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('artifact gate accepts bypass with documented reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-gate-bypass-'));
  try {
    const f = join(dir, 'draft-prd.md');
    writeFileSync(
      f,
      '---\ncx_release_gate: bypass\ncx_release_gate_reason: executive draft review only\n---\n\n# PRD\n',
    );
    const r = validateArtifactRelease({ filePath: f, type: 'prd', rootDir: REPO, cwd: dir });
    assert.equal(r.ok, true);
    assert.equal(r.bypassed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
