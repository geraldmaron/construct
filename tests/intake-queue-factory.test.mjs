/**
 * tests/intake-queue-factory.test.mjs — backend selection contract.
 *
 * createIntakeQueue picks the backend from CONSTRUCT_INTAKE_QUEUE_BACKEND
 * override first, then deploymentMode (solo → filesystem, team/enterprise
 * → postgres). When postgres is selected but DATABASE_URL is missing,
 * the factory throws a clear configuration error so callers fail loudly
 * rather than silently degrading to a filesystem backend.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  createIntakeQueue,
  FilesystemIntakeQueue,
  INTAKE_QUEUE_BACKEND_ENV_KEY,
} from '../lib/intake/queue.mjs';
import { DEPLOYMENT_MODE_ENV_KEY } from '../lib/deployment-mode.mjs';

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

  it('returns a FilesystemIntakeQueue when CONSTRUCT_DEPLOYMENT_MODE=solo', () => {
    const q = createIntakeQueue(projectRoot, { [DEPLOYMENT_MODE_ENV_KEY]: 'solo' });
    assert.ok(q instanceof FilesystemIntakeQueue);
  });

  it('throws a configuration error in team mode without DATABASE_URL', () => {
    assert.throws(
      () => createIntakeQueue(projectRoot, { [DEPLOYMENT_MODE_ENV_KEY]: 'team' }),
      /requires a configured DATABASE_URL/,
    );
  });

  it('throws a configuration error in enterprise mode without DATABASE_URL', () => {
    assert.throws(
      () => createIntakeQueue(projectRoot, { [DEPLOYMENT_MODE_ENV_KEY]: 'enterprise' }),
      /requires a configured DATABASE_URL/,
    );
  });

  it('honors CONSTRUCT_INTAKE_QUEUE_BACKEND override (filesystem in team mode)', () => {
    const q = createIntakeQueue(projectRoot, {
      [DEPLOYMENT_MODE_ENV_KEY]: 'team',
      [INTAKE_QUEUE_BACKEND_ENV_KEY]: 'filesystem',
    });
    assert.ok(q instanceof FilesystemIntakeQueue);
  });

  it('honors CONSTRUCT_INTAKE_QUEUE_BACKEND override (postgres in solo mode → needs DATABASE_URL)', () => {
    assert.throws(
      () => createIntakeQueue(projectRoot, { [INTAKE_QUEUE_BACKEND_ENV_KEY]: 'postgres' }),
      /requires a configured DATABASE_URL/,
    );
  });

  it('accepts an explicit sql client and project for postgres backend', async () => {
    const { PostgresIntakeQueue } = await import('../lib/intake/queue.mjs');
    const fakeSql = Object.assign(() => Promise.resolve([]), { begin: async () => null, json: (v) => v, end: async () => {} });
    const q = createIntakeQueue(projectRoot, { [INTAKE_QUEUE_BACKEND_ENV_KEY]: 'postgres' }, { sql: fakeSql, project: 'test-project' });
    assert.ok(q instanceof PostgresIntakeQueue);
    assert.equal(q.project, 'test-project');
  });

  it('returned queue carries the IntakeQueue contract — six methods', () => {
    const q = createIntakeQueue(projectRoot, {});
    for (const method of ['enqueue', 'listPending', 'count', 'read', 'markProcessed', 'markSkipped', 'reopen']) {
      assert.equal(typeof q[method], 'function', `IntakeQueue must implement ${method}`);
    }
  });
});
