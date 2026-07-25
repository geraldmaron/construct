/**
 * tests/beads-automation-plan-sync.test.mjs — lib/beads-automation.mjs's
 * syncPlanWithBeads() must resolve each bead's real status from `bd show
 * <id> --json`, which returns a top-level array, not a bare object.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { syncPlanWithBeads } from '../lib/beads-automation.mjs';

test('syncPlanWithBeads resolves a real bead status, never the literal string "unknown"', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const probe = spawnSync('bd', ['list', '--json'], { cwd: process.cwd(), encoding: 'utf8' });
  if (probe.status !== 0) {
    t.skip('bd not available/initialized in this environment');
    return;
  }
  const beads = JSON.parse(probe.stdout || '[]');
  const anyBead = Array.isArray(beads) ? beads[0] : null;
  if (!anyBead?.id) {
    t.skip('no beads in this repo to sync against');
    return;
  }

  // bd resolves its database by walking up from cwd, so the scratch dir must
  // live inside the repo tree, not an unrelated os.tmpdir() root.

  const scratchRoot = path.join(process.cwd(), '.construct', 'tmp');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratchRoot, 'plan-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const planPath = path.join(dir, 'plan.md');
  fs.writeFileSync(
    planPath,
    `# Plan\n\n| Bead | Status | Notes |\n|---|---|---|\n| ${anyBead.id} | pending | test row |\n`,
  );

  await syncPlanWithBeads({ cwd: dir, dryRun: false });

  const after = fs.readFileSync(planPath, 'utf8');
  assert.ok(after.includes(anyBead.id), 'plan.md still references the bead');
  assert.ok(
    !new RegExp(`\\|\\s*${anyBead.id}\\s*\\|\\s*unknown\\s*\\|`).test(after),
    `expected a real status, not the literal "unknown":\n${after}`,
  );
  assert.match(after, new RegExp(`\\|\\s*${anyBead.id}\\s*\\|\\s*${anyBead.status}\\s*\\|`));

  const updatedRow = after.split('\n').find((l) => l.includes(anyBead.id));
  assert.ok(!updatedRow.includes('||'), `expected a well-formed table row, no doubled pipe:\n${updatedRow}`);
  assert.equal((updatedRow.match(/\|/g) || []).length, 4, `expected exactly 4 pipes for a 3-column row:\n${updatedRow}`);
});
