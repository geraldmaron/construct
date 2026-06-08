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

  it('returns a GitIntakeQueue in team mode', () => {
    const q = createIntakeQueue(projectRoot, { [DEPLOYMENT_MODE_ENV_KEY]: 'team' });
    assert.ok(q instanceof GitIntakeQueue);
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
});
