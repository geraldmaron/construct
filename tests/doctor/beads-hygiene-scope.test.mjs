/**
 * tests/doctor/beads-hygiene-scope.test.mjs — beads hygiene skipped without .beads/.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';
import { checkBeadsHygieneForDoctor } from '../../lib/doctor/beads-hygiene.mjs';

test('skips beads hygiene when project has no .beads directory', () => {
  const dir = tempDir('doctor-beads-hygiene-');
  try {
    const result = checkBeadsHygieneForDoctor(dir, {
      detectBeadsDrift: () => ({ counts: { stuckInProgress: 9, mergeDrift: 9, staleOpen: 0 } }),
    });
    assert.equal(result.run, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runs beads hygiene when .beads exists', () => {
  const dir = tempDir('doctor-beads-hygiene-');
  try {
    fs.mkdirSync(`${dir}/.beads`, { recursive: true });
    const result = checkBeadsHygieneForDoctor(dir, {
      detectBeadsDrift: () => ({ counts: { stuckInProgress: 1, mergeDrift: 0, staleOpen: 0 } }),
    });
    assert.equal(result.run, true);
    assert.equal(result.pass, false);
    assert.match(result.label, /stuck in_progress/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
