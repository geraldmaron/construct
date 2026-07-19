/**
 * tests/audit/f03-package/half-stage-recovery.red.mjs — F03 [R4] half-staged project recovery.
 *
 * Regression guard for CX-AUDIT-PACKAGE-005. lib/install/stage-project.mjs can return
 * { staged:true, synced:false } when it stages the `.construct/` launcher but bails before
 * `sync-worker-profiles.mjs --project` populates `.claude/` (the sync script is missing, or sync
 * exits non-zero), leaving the project half-built. stageProjectAdapters now records the outcome
 * in a durable `.construct/stage-state.json` marker and exports repairStagedProject to re-drive
 * a half-staged project to a synced state. Each test forces the half-stage branch in a tmp
 * project and asserts the marker exists and a repair entry point is callable.
 *
 * Hermetic: every write is under fs.mkdtemp(os.tmpdir()). The sync-missing branch is forced by
 * pointing packageRoot at a tmp dir whose templates/distribution exists but scripts/ does not, so
 * `sync-worker-profiles.mjs` is absent (L28) — no real sync ever runs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { stageProjectAdapters } from '../../../lib/install/stage-project.mjs';

// A package root that triggers the synced=false branch: templates/distribution is present so the
// launcher stages, but scripts/sync-worker-profiles.mjs is absent so the sync step is skipped (L28-31).

function makeSynclessPackageRoot() {
  const pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f03-pkg-'));
  const distDir = path.join(pkgRoot, 'templates', 'distribution');
  fs.mkdirSync(distDir, { recursive: true });
  for (const name of ['run.mjs', 'bootstrap.sh', 'bootstrap.ps1']) {
    fs.writeFileSync(path.join(distDir, name), '// launcher stub\n');
  }
  return pkgRoot;
}

function makeProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f03-proj-'));
}

test('[R4] half-stage (synced=false) must leave a durable marker in the project', (t) => {
  const pkgRoot = makeSynclessPackageRoot();
  const projectRoot = makeProject();
  t.after(() => {
    try { fs.rmSync(pkgRoot, { recursive: true, force: true }); } catch { /* tmp */ }
    try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch { /* tmp */ }
  });

  const result = stageProjectAdapters({ projectRoot, packageRoot: pkgRoot, pkgVersion: '0.0.0-test' });

  assert.equal(result.staged, true, 'precondition: launcher staged');
  assert.equal(result.synced, false, 'precondition: sync skipped, so this is the half-stage branch');

  // The half-stage must be recoverable without re-deriving it from filesystem heuristics.
  // A durable marker under .construct/ (or .construct/) is the minimum: a file naming the partial
  // state so doctor/init can find and repair it. None is written today.

  const markerCandidates = [
    path.join(projectRoot, '.construct', 'launcher', 'stage-state.json'),
    path.join(projectRoot, '.construct', 'half-staged'),
    path.join(projectRoot, '.construct', 'stage-state.json'),
  ];
  const found = markerCandidates.find((p) => fs.existsSync(p));
  assert.ok(
    found,
    `expected a durable half-stage marker (one of: ${markerCandidates.join(', ')}); stageProjectAdapters returned synced=false but recorded nothing`,
  );
});

test('[R4] a programmatic repair entry point must exist for a half-staged project', async (t) => {
  const pkgRoot = makeSynclessPackageRoot();
  const projectRoot = makeProject();
  t.after(() => {
    try { fs.rmSync(pkgRoot, { recursive: true, force: true }); } catch { /* tmp */ }
    try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch { /* tmp */ }
  });

  const result = stageProjectAdapters({ projectRoot, packageRoot: pkgRoot, pkgVersion: '0.0.0-test' });
  assert.equal(result.synced, false, 'precondition: half-stage branch');

  // A half-stage needs a named repair path: a function the doctor/init layer can call to
  // re-run sync (or roll the launcher back) and reach a coherent state. Probe the modules
  // that own staging for any such export. None exists today, so this resolves to undefined.

  const stageMod = await import('../../../lib/install/stage-project.mjs');
  const adaptersMod = await import('../../../lib/adapters-sync.mjs');
  const repairFn =
    stageMod.repairStagedProject ||
    stageMod.resumeStaging ||
    stageMod.recoverHalfStage ||
    adaptersMod.repairStagedProject ||
    adaptersMod.recoverHalfStage;

  assert.equal(
    typeof repairFn,
    'function',
    'expected a half-stage repair entry point (repairStagedProject / resumeStaging / recoverHalfStage) on stage-project.mjs or adapters-sync.mjs; none is exported',
  );
});
