/**
 * tests/process-budget.test.mjs — RSS cap resolution from construct.config.json.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadProcessBudgets, memoryCapMbFor } from '../lib/resources/process-budget.mjs';

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-proc-budget-'));
  fs.mkdirSync(path.join(projectRoot, '.git'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('process budgets', () => {
  it('loads defaults when config is absent', () => {
    const b = loadProcessBudgets(projectRoot);
    assert.equal(b.embedDaemonMaxRssMb, 800);
    assert.equal(b.mcpServerMaxRssMb, 250);
    assert.equal(b.workerReplicaMaxRssMb, 256);
  });

  it('reads overrides from construct.config.json', () => {
    fs.writeFileSync(
      path.join(projectRoot, 'construct.config.json'),
      JSON.stringify({
        version: 1,
        resources: { process: { embedDaemonMaxRssMb: 512, workerReplicaMaxRssMb: 128 } },
      }),
    );
    assert.equal(memoryCapMbFor('embed-daemon', projectRoot), 512);
    assert.equal(memoryCapMbFor('oracle', projectRoot), 128);
  });
});
