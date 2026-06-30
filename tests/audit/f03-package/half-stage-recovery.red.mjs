/**
 * tests/audit/f03-package/half-stage-recovery.red.mjs — F03 [R4] half-staged project recovery.
 *
 * RED fixtures (must FAIL against current code). lib/install/stage-project.mjs:27-50 can
 * return { staged:true, synced:false }: it stages the `.construct/` launcher and mutates the
 * filesystem, then bails before `sync-specialists.mjs --project` populates `.claude/`, either
 * because the sync script is missing (L28-31) or sync exits non-zero (L46-49). The project is
 * left half-built: launcher present, agents/settings absent. Neither the postinstall hook
 * (bin/construct-postinstall.mjs:112-118, which discards the return value) nor `construct init`
 * (lib/init-unified.mjs:927, same) records this state, and no doctor lane repairs it.
 *
 * Contract these encode (CX-AUDIT-PACKAGE-005): a half-stage must be detectable and repairable
 * — stageProjectAdapters must drop a durable marker when synced=false, and a programmatic repair
 * entry point must exist to drive the project to a synced state (or fully roll back). Each test
 * forces the half-stage branch in a tmp project and asserts the marker / repair contract that
 * does not exist today.
 *
 * Hermetic: every write is under fs.mkdtemp(os.tmpdir()). The sync-missing branch is forced by
 * pointing packageRoot at a tmp dir whose templates/distribution exists but scripts/ does not, so
 * `sync-specialists.mjs` is absent (L28) — no real sync ever runs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { stageProjectAdapters } from '../../../lib/install/stage-project.mjs';

// A package root that triggers the synced=false branch: templates/distribution is present so the
// launcher stages, but scripts/sync-specialists.mjs is absent so the sync step is skipped (L28-31).

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
  // A durable marker under .construct/ (or .cx/) is the minimum: a file naming the partial
  // state so doctor/init can find and repair it. None is written today.

  const markerCandidates = [
    path.join(projectRoot, '.construct', 'stage-state.json'),
    path.join(projectRoot, '.construct', 'half-staged'),
    path.join(projectRoot, '.cx', 'stage-state.json'),
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
