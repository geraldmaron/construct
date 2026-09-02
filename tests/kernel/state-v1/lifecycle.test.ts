/**
 * tests/kernel/state-v1/lifecycle.test.ts — claim/submit separates task done from draft trust.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openStateStore } from '../../../src/kernel/state-v1/open.ts';
import {
  UnsupportedAlphaStoreError,
  UNSUPPORTED_ALPHA_MESSAGE,
} from '../../../src/kernel/state-v1/format.ts';
import { ensureRun, enqueueTask, claimTask, getTask, StaleLeaseError } from '../../../src/kernel/state-v1/tasks.ts';
import { getDeliverableByTask } from '../../../src/kernel/state-v1/deliverables.ts';
import { submitCompletedWork, submitFailedWork } from '../../../src/kernel/state-v1/submit.ts';
import { resolveProjectContext } from '../../../src/kernel/project/context.ts';
import { projectDbPath, projectConfigPath, projectStateDir } from '../../../src/kernel/project/layout.ts';

function tmpRoot(): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'construct-state-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('project layout keeps config and state separate under .construct', () => {
  const root = '/repo/app';
  assert.equal(projectConfigPath(root), '/repo/app/.construct/project.json');
  assert.equal(projectStateDir(root), '/repo/app/.construct/state');
  assert.equal(projectDbPath(root), '/repo/app/.construct/state/construct.sqlite');
});

test('ProjectContext prefers host root over git and cwd', () => {
  const ctx = resolveProjectContext({
    hostProjectRoot: '/host/proj',
    gitRoot: '/git/proj',
    cwd: '/cwd',
    allowCwdFallback: true,
  });
  assert.equal(ctx.rootSource, 'host');
  assert.match(ctx.root, /host\/proj$/);
});

test('ProjectContext refuses empty resolution without cwd fallback', () => {
  assert.throws(() => resolveProjectContext({}), /no project root/);
});

test('claim → submit settles task done and leaves deliverable draft', () => {
  const { root, cleanup } = tmpRoot();
  try {
    const store = openStateStore(join(root, 'construct.sqlite'));
    const at = '2026-08-31T12:00:00.000Z';
    ensureRun(store, { id: 'run-1', outcome: 'review auth', at });
    enqueueTask(store, {
      id: 'task-1',
      runId: 'run-1',
      role: 'security',
      brief: { ask: 'what is missing' },
      at,
    });

    const leased = claimTask(store, {
      owner: 'session:cursor',
      leaseUntil: '2026-08-31T13:00:00.000Z',
      now: at,
    });
    assert.ok(leased);
    assert.equal(leased.state, 'leased');
    assert.equal(leased.token, 1);

    const submitted = submitCompletedWork(store, {
      leased,
      at: '2026-08-31T12:05:00.000Z',
      deliverable: { finding: 'missing MFA on reset' },
    });

    assert.equal(submitted.task.state, 'done');
    assert.ok(submitted.deliverable);
    assert.equal(submitted.deliverable.trustState, 'draft');
    assert.equal(getDeliverableByTask(store, 'task-1')?.trustState, 'draft');
    store.close();
  } finally {
    cleanup();
  }
});

test('expired lease can be reclaimed; stale fence rejects submit', () => {
  const { root, cleanup } = tmpRoot();
  try {
    const store = openStateStore(join(root, 'construct.sqlite'));
    const t0 = '2026-08-31T12:00:00.000Z';
    ensureRun(store, { id: 'run-1', outcome: 'x', at: t0 });
    enqueueTask(store, { id: 'task-1', runId: 'run-1', role: 'r', brief: {}, at: t0 });

    const first = claimTask(store, {
      owner: 'worker-a',
      leaseUntil: '2026-08-31T12:10:00.000Z',
      now: t0,
    });
    assert.ok(first);

    const second = claimTask(store, {
      owner: 'worker-b',
      leaseUntil: '2026-08-31T13:00:00.000Z',
      now: '2026-08-31T12:11:00.000Z',
    });
    assert.ok(second);
    assert.equal(second.leaseOwner, 'worker-b');
    assert.equal(second.token, 2);

    assert.throws(
      () =>
        submitCompletedWork(store, {
          leased: first,
          at: '2026-08-31T12:12:00.000Z',
          deliverable: 'stale',
        }),
      (err: unknown) => err instanceof StaleLeaseError,
    );

    const ok = submitCompletedWork(store, {
      leased: second,
      at: '2026-08-31T12:12:00.000Z',
      deliverable: 'fresh',
    });
    assert.equal(ok.task.state, 'done');
    assert.equal(ok.deliverable?.trustState, 'draft');
    store.close();
  } finally {
    cleanup();
  }
});

test('duplicate submit after done is refused as stale lease', () => {
  const { root, cleanup } = tmpRoot();
  try {
    const store = openStateStore(join(root, 'construct.sqlite'));
    const at = '2026-08-31T12:00:00.000Z';
    ensureRun(store, { id: 'run-1', outcome: 'x', at });
    enqueueTask(store, { id: 'task-1', runId: 'run-1', role: 'r', brief: {}, at });
    const leased = claimTask(store, {
      owner: 'w',
      leaseUntil: '2026-08-31T13:00:00.000Z',
      now: at,
    });
    assert.ok(leased);
    submitCompletedWork(store, { leased, at: '2026-08-31T12:01:00.000Z', deliverable: 'one' });
    assert.throws(
      () =>
        submitCompletedWork(store, {
          leased,
          at: '2026-08-31T12:02:00.000Z',
          deliverable: 'two',
        }),
      (err: unknown) => err instanceof StaleLeaseError,
    );
    assert.equal(getTask(store, 'task-1')?.state, 'done');
    store.close();
  } finally {
    cleanup();
  }
});

test('failed task does not create a draft', () => {
  const { root, cleanup } = tmpRoot();
  try {
    const store = openStateStore(join(root, 'construct.sqlite'));
    const at = '2026-08-31T12:00:00.000Z';
    ensureRun(store, { id: 'run-1', outcome: 'x', at });
    enqueueTask(store, { id: 'task-1', runId: 'run-1', role: 'r', brief: {}, at });
    const leased = claimTask(store, {
      owner: 'w',
      leaseUntil: '2026-08-31T13:00:00.000Z',
      now: at,
    });
    assert.ok(leased);
    const failed = submitFailedWork(store, {
      leased,
      at: '2026-08-31T12:01:00.000Z',
      error: { message: 'boom' },
    });
    assert.equal(failed.state, 'failed');
    assert.equal(getDeliverableByTask(store, 'task-1'), null);
    store.close();
  } finally {
    cleanup();
  }
});

test('note-only submit leaves task leased by default', () => {
  const { root, cleanup } = tmpRoot();
  try {
    const store = openStateStore(join(root, 'construct.sqlite'));
    const at = '2026-08-31T12:00:00.000Z';
    ensureRun(store, { id: 'run-1', outcome: 'x', at });
    enqueueTask(store, { id: 'task-1', runId: 'run-1', role: 'r', brief: {}, at });
    const leased = claimTask(store, {
      owner: 'w',
      leaseUntil: '2026-08-31T13:00:00.000Z',
      now: at,
    });
    assert.ok(leased);
    const result = submitCompletedWork(store, {
      leased,
      at: '2026-08-31T12:01:00.000Z',
      note: 'still reading',
    });
    assert.equal(result.noteOnly, true);
    assert.equal(result.task.state, 'leased');
    assert.equal(result.deliverable, null);
    store.close();
  } finally {
    cleanup();
  }
});

test('legacy schema_version store is refused without migration', () => {
  const { root, cleanup } = tmpRoot();
  try {
    const path = join(root, 'legacy.sqlite');
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', '23')`).run();
    db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY)`);
    db.close();

    assert.throws(
      () => openStateStore(path),
      (err: unknown) => {
        assert.ok(err instanceof UnsupportedAlphaStoreError);
        assert.equal(err.message, UNSUPPORTED_ALPHA_MESSAGE);
        assert.equal(err.foundVersion, 23);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});
