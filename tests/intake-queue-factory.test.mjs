/**
 * tests/intake-queue-factory.test.mjs — backend selection contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  createIntakeQueue,
  FilesystemIntakeQueue,
  GitIntakeQueue,
  INTAKE_QUEUE_BACKEND_ENV_KEY,
} from '../lib/intake/queue.mjs';
import { DEPLOYMENT_MODE_ENV_KEY } from '../lib/deployment-mode.mjs';
import { PostgresIntakeQueue } from '../lib/queue/pg-queue.mjs';

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-intake-factory-'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('createIntakeQueue backend selection', () => {
  it('returns a FilesystemIntakeQueue in solo mode (default)', () => {
    const q = createIntakeQueue(projectRoot, {});
    assert.ok(q instanceof FilesystemIntakeQueue);
  });

  it('team mode fails loud without Postgres unless degraded override is explicit', () => {
    assert.throws(
      () => createIntakeQueue(projectRoot, { [DEPLOYMENT_MODE_ENV_KEY]: 'team' }),
      /team mode requires postgres-queue/,
    );
  });

  it('team mode can explicitly degrade to GitIntakeQueue when Postgres is unavailable', () => {
    const q = createIntakeQueue(projectRoot, {
      [DEPLOYMENT_MODE_ENV_KEY]: 'team',
      CONSTRUCT_DEGRADED_OK: 'postgres-queue',
    });
    assert.ok(q instanceof GitIntakeQueue);
    assert.equal(q.degraded, true);
    assert.equal(q.degradedReason, 'postgres-unavailable');
  });

  it('honors CONSTRUCT_INTAKE_QUEUE_BACKEND override (filesystem in team mode)', () => {
    const q = createIntakeQueue(projectRoot, {
      [DEPLOYMENT_MODE_ENV_KEY]: 'team',
      [INTAKE_QUEUE_BACKEND_ENV_KEY]: 'filesystem',
    });
    assert.ok(q instanceof FilesystemIntakeQueue);
  });

  it('returned queue carries the IntakeQueue contract — six methods', () => {
    const q = createIntakeQueue(projectRoot, {});
    for (const method of ['enqueue', 'listPending', 'count', 'read', 'markProcessed', 'markSkipped']) {
      assert.equal(typeof q[method], 'function', `IntakeQueue must implement ${method}`);
    }
  });

  it('explicit postgres backend instantiates the registered Postgres queue provider', () => {
    const sql = () => Promise.resolve([]);
    sql.json = (value) => value;
    const q = createIntakeQueue(projectRoot, { [INTAKE_QUEUE_BACKEND_ENV_KEY]: 'postgres' }, { sql });
    assert.ok(q instanceof PostgresIntakeQueue);
    assert.equal(q.tenantId, 'local');
    assert.equal(typeof q.claim, 'function');
    assert.equal(typeof q.heartbeat, 'function');
  });

  it('explicit postgres backend fails loud when no SQL client is configured', () => {
    assert.throws(
      () => createIntakeQueue(projectRoot, { [INTAKE_QUEUE_BACKEND_ENV_KEY]: 'postgres' }),
      /requires DATABASE_URL or CONSTRUCT_DATABASE_URL/,
    );
  });
});
