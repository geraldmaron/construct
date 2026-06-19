/**
 * tests/functional/resource-write-guard.functional.test.mjs — disk budget
 * enforcement on the real trace writer in an isolated project tmpdir.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { emitTraceEvent } from '../../lib/worker/trace.mjs';
import { measureUsage } from '../../lib/resources/budget.mjs';

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-res-guard-'));
  fs.mkdirSync(path.join(projectRoot, '.git'));
  fs.writeFileSync(
    path.join(projectRoot, 'construct.config.json'),
    JSON.stringify({ version: 1, resources: { disk: { totalCxMaxMb: 1 } } }),
  );
  fs.mkdirSync(path.join(projectRoot, '.cx', 'intake', 'processed'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.cx', 'intake', 'processed', 'heavy.json'),
    'x'.repeat(1_050_000),
  );
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('resource write guard (functional)', () => {
  it('blocks trace append when .cx/ is over cap and reclaim cannot help', () => {
    const before = measureUsage(projectRoot);
    assert.ok(before.totalCxUsageRatio > 1);

    const event = emitTraceEvent({
      rootDir: projectRoot,
      eventType: 'worker.started',
      metadata: { probe: true },
      env: { ...process.env, CONSTRUCT_BUDGET_WARN_IN_TEST: '1' },
    });

    assert.equal(event.budgetSkipped, true);
    const after = measureUsage(projectRoot);
    assert.equal(after.totalCxBytes, before.totalCxBytes);
  });
});
