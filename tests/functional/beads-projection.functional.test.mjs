/**
 * tests/functional/beads-projection.functional.test.mjs — day-one proof for the
 * Beads projection / field authority / reconciliation surface
 * (construct-b0nny.27 / E8).
 *
 * Spans the importer + reconciliation + durable JSONL store at once (CLAUDE.md's
 * multi-component-feature rule) by importing the real module in an isolated
 * tmpdir and asserting on the persisted artifact — plus one real-binary spawn
 * of `construct tracker-projection` to prove the CLI path. The corpus is this
 * program's OWN bd history (construct-b0nny + .1 … .31, incl. spike sub-beads),
 * frozen at tests/tracker-projection/fixtures/beads-program-corpus.json — a
 * captured snapshot, not a live bd read, so a sibling agent mutating bd cannot
 * make the assertions flap. The three acceptance criteria are each a test here:
 * raw-record preservation with zero data loss, drift detection of an
 * intentionally introduced drift, and field-authority (domain survives, tracker
 * absorbs).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { importBeads, verifyRawRecords } from '../../lib/tracker-projection/import-beads.mjs';
import { buildProjection, canonicalJson } from '../../lib/tracker-projection/projection.mjs';
import { reconcileAll } from '../../lib/tracker-projection/reconcile.mjs';
import { writeProjections, loadProjections, upsertProjections } from '../../lib/tracker-projection/store.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');
const FIXTURE = path.join(REPO_ROOT, 'tests', 'tracker-projection', 'fixtures', 'beads-program-corpus.json');

const corpus = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const PROGRAM_ISSUES = corpus.issues;

function freshRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'beads-projection-b0nny27-')));
}

// --- acceptance criterion: raw-record preservation, zero data loss ---

test('every program bead imports with its full raw record preserved (zero data loss)', () => {
  assert.ok(PROGRAM_ISSUES.length >= 30, `real corpus should be non-trivial (got ${PROGRAM_ISSUES.length})`);
  const { projections, stats } = importBeads(PROGRAM_ISSUES, { workspace: 'ws-b0nny' });

  assert.equal(stats.imported, PROGRAM_ISSUES.length);
  assert.equal(stats.skipped.length, 0);

  const verification = verifyRawRecords(projections, PROGRAM_ISSUES);
  assert.equal(verification.ok, true, `raw-record mismatches: ${JSON.stringify(verification.mismatches)}`);
  assert.equal(verification.checked, PROGRAM_ISSUES.length);

  const byId = new Map(PROGRAM_ISSUES.map((i) => [i.id, i]));
  for (const projection of projections) {
    const original = byId.get(projection.external_id);
    assert.equal(canonicalJson(projection.raw_record), canonicalJson(original), `${projection.external_id} raw_record diverged`);
    for (const key of Object.keys(original)) {
      assert.ok(key in projection.raw_record, `${projection.external_id} lost field ${key}`);
    }
  }
});

test('raw records survive even for fields the projection model does not use', () => {
  const { projections } = importBeads(PROGRAM_ISSUES);
  const unusedFields = ['dependency_count', 'dependent_count', 'comment_count', 'created_by', 'started_at'];
  const present = new Set();
  for (const projection of projections) {
    for (const f of unusedFields) if (f in projection.raw_record) present.add(f);
  }
  assert.ok(present.size > 0, 'the corpus exercises at least one model-unused field');
  for (const projection of projections) {
    const original = PROGRAM_ISSUES.find((i) => i.id === projection.external_id);
    for (const f of unusedFields) {
      if (f in original) assert.equal(canonicalJson(projection.raw_record[f]), canonicalJson(original[f]), `${projection.external_id}.${f} not preserved`);
    }
  }
});

// --- acceptance criterion: reconciliation detects an intentionally introduced drift ---

test('reconciliation detects an intentionally introduced domain-owned drift and reports it', () => {
  const root = freshRoot();
  try {
    const { projections } = importBeads(PROGRAM_ISSUES, { workspace: 'ws-b0nny' });
    writeProjections(root, projections);

    const clean = reconcileAll(loadProjections(root), PROGRAM_ISSUES);
    assert.equal(clean.ok, true, 'freshly imported projections reconcile in_sync against their own corpus');
    assert.equal(clean.counts.drifted, 0);

    const originalTitle = PROGRAM_ISSUES.find((i) => i.id === 'construct-b0nny.23').title;
    const drifted = structuredClone(PROGRAM_ISSUES);
    drifted.find((i) => i.id === 'construct-b0nny.23').title = 'INTENTIONAL DRIFT — tracker rewrote a domain-owned field';

    const report = reconcileAll(loadProjections(root), drifted);
    assert.equal(report.ok, false, 'drift makes the report not ok');
    assert.equal(report.counts.drifted, 1, 'exactly the one mutated bead drifts');
    assert.equal(report.drifted[0].external_id, 'construct-b0nny.23');
    const titleConflict = report.drifted[0].conflicts.find((c) => c.field === 'title');
    assert.ok(titleConflict, 'the drifted field is named');
    assert.equal(titleConflict.domain, originalTitle, 'the domain value is reported, not clobbered');
    assert.equal(titleConflict.tracker, 'INTENTIONAL DRIFT — tracker rewrote a domain-owned field');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a tracker-owned change to the same corpus is absorbed, not flagged as drift', () => {
  const { projections } = importBeads(PROGRAM_ISSUES, { workspace: 'ws-b0nny' });
  const bumped = structuredClone(PROGRAM_ISSUES);
  const target = bumped.find((i) => i.id === 'construct-b0nny.23');
  target.status = target.status === 'closed' ? 'open' : 'closed';

  const report = reconcileAll(projections, bumped);
  assert.equal(report.counts.drifted, 0, 'a bd-owned status change is not a conflict');
  assert.equal(report.counts.absorbed, 1, 'it is absorbed as a legitimate tracker update');
});

// --- acceptance criterion: bd remains readable/independent; the store is durable ---

test('the durable projection store round-trips the whole program corpus and reloads with bd absent', () => {
  const root = freshRoot();
  try {
    const { projections } = importBeads(PROGRAM_ISSUES, { workspace: 'ws-b0nny' });
    const { count } = writeProjections(root, projections);
    assert.equal(count, PROGRAM_ISSUES.length);

    const reloaded = loadProjections(root);
    assert.equal(reloaded.length, PROGRAM_ISSUES.length, 'store loads without any bd process');
    const b0nnyIds = reloaded.map((p) => p.external_id).filter((id) => id === 'construct-b0nny' || id.startsWith('construct-b0nny.'));
    assert.equal(b0nnyIds.length, PROGRAM_ISSUES.length);

    upsertProjections(root, projections);
    assert.equal(loadProjections(root).length, PROGRAM_ISSUES.length, 're-import does not duplicate rows');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- real-binary spawn: the CLI path is wired, reports zero data loss, and
// leaves bd fully functional. Runs from REPO_ROOT so bd resolves this repo's
// .beads; the ephemeral projection store it writes under .construct/ is removed
// afterward unless it pre-existed, so the test leaves no residue. ---

test('construct tracker-projection import|status runs against live bd without breaking the tracker', () => {
  const home = freshRoot();
  const env = { ...process.env, HOME: home, CONSTRUCT_HOME_OVERRIDE: home };
  const storeDir = path.join(REPO_ROOT, '.construct', 'tracker-projections');
  const storePreexisted = fs.existsSync(storeDir);

  const before = spawnSync('bd', ['list', '--limit', '1', '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (!before.stdout) {
    assert.ok(true, 'bd unavailable in this environment — CLI wiring covered by module-level tests');
    fs.rmSync(home, { recursive: true, force: true });
    return;
  }

  try {
    const imported = spawnSync(process.execPath, [BIN, 'tracker-projection', 'import', '--json'], {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env,
    });
    assert.equal(imported.status, 0, imported.stderr);
    const body = JSON.parse(imported.stdout);
    assert.equal(body.ok, true, 'CLI import reports zero data loss');
    assert.ok(body.persisted >= 1);
    assert.equal(body.rawRecordPreservation.ok, true);

    const status = spawnSync(process.execPath, [BIN, 'tracker-projection', 'status', '--json'], {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env,
    });
    assert.equal(status.status, 0, status.stderr);
    assert.ok(JSON.parse(status.stdout).count >= 1);

    const bdStillWorks = spawnSync('bd', ['list', '--limit', '1', '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.ok(bdStillWorks.stdout.length > 0, 'bd remains fully functional after projection import');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    if (!storePreexisted) fs.rmSync(storeDir, { recursive: true, force: true });
  }
});
