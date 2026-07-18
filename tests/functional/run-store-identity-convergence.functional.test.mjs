/**
 * tests/functional/run-store-identity-convergence.functional.test.mjs —
 * project identity + SQLite run-store migration, end to end (ADR-0092,
 * disposition-matrix.md M1).
 *
 * Spans two durable-state surfaces at once (project-identity keying +
 * versioned SQLite schema), so a unit test on either module alone could pass
 * while the two disagree on which directory or key a project's run history
 * actually lives under — the CLAUDE.md multi-component-feature case this
 * suite exists for. Exercises the real modules (no mocks) against a real git
 * fixture and a real `node:sqlite` database in an isolated tmpdir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { tempDir } from '../helpers.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { deriveProjectKey } from '../../lib/state-root.mjs';
import { projectKey, resolveRunStore } from '../../lib/orchestration/store.mjs';
import { resolveProjectKey } from '../../lib/embed/daemon.mjs';
import { sqliteAvailable } from '../../lib/orchestration/run-store-sqlite.mjs';
import { SQLITE_MIGRATIONS_TABLE } from '../../lib/db/migrate-sqlite.mjs';

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-identity-runstore-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  rmTmpDir(homeOverride);
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function initFixtureRepo(t) {
  const repo = fs.realpathSync(tempDir('cx-identity-runstore-repo-', t));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/identity-convergence.git'], { cwd: repo });
  return repo;
}

test('a run saved via resolveRunStore(sqlite) lands under the canonical deriveProjectKey directory, migrated to version 1', { skip: !sqliteAvailable() && 'node:sqlite unavailable (Node <22.5)' }, async () => {
  const repo = initFixtureRepo(test);
  const canonical = deriveProjectKey(repo);

  // Every call site that resolves this repo's identity — orchestration/store's
  // projectKey and embed/daemon's resolveProjectKey — must agree with the
  // canonical derivation before the run-store assertions below mean anything.
  assert.equal(projectKey({}, repo), canonical);
  assert.equal(resolveProjectKey({}, repo), canonical);

  const { store, backend } = resolveRunStore({ config: { orchestration: { store: 'sqlite' } }, env: {}, cwd: repo });
  assert.equal(backend, 'sqlite');

  const run = {
    runId: 'run-convergence-1',
    createdAt: new Date().toISOString(),
    status: 'completed',
    execution: { executionMode: 'construct-orchestrated' },
    request: { summary: 'identity convergence functional test' },
  };
  await store.saveRun(run);
  const loaded = await store.loadRun('run-convergence-1');
  assert.equal(loaded.runId, 'run-convergence-1');

  const dbPath = path.join(homeOverride, '.construct', 'projects', canonical, 'runtime', 'orchestration', 'runs.db');
  assert.ok(fs.existsSync(dbPath), `expected the run-store db at the canonical-key path: ${dbPath}`);

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    const migrationRow = db.prepare(`SELECT id FROM ${SQLITE_MIGRATIONS_TABLE} WHERE id = ?`).get('001_run_store');
    assert.ok(migrationRow, 'expected 001_run_store to be recorded as applied, not created via an inline CREATE TABLE');

    const runRow = db.prepare('SELECT run_id, status FROM runs WHERE run_id = ?').get('run-convergence-1');
    assert.equal(runRow.run_id, 'run-convergence-1');
    assert.equal(runRow.status, 'completed');
  } finally {
    db.close();
  }
});
