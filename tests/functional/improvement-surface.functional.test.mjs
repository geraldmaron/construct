/**
 * tests/functional/improvement-surface.functional.test.mjs — the governed
 * improvement operator surface.
 *
 * Drives submit → review → approve → apply through the real CLI module and
 * asserts durable artifacts under `.construct/improvement/proposals/`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

import { runDeterministicGates, buildEvaluationReport } from '../../lib/evals/gates.mjs';
import { runImprovementCli } from '../../lib/improvement/cli.mjs';
import { loadRecord, proposalRecordPath } from '../../lib/improvement/store.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const ITEM = {
  schemaVersion: 1, id: 'eval-surface-1', taskFamily: 'engineering',
  taskInput: { prompt: 'fix' }, capabilitySnapshot: { capabilityClass: 'hosted-direct' },
  allowedTools: ['read'], expectedEvidenceBehavior: { requirement: 'required', citationsRequired: true },
  expectedContractResult: { outcome: 'pass' }, redaction: { state: 'raw' }, sourceTraceIds: ['trace-surface'],
  humanLabel: { provenance: 'human' }, split: 'test', expiry: null,
};
const BUDGETS = { maxCost: 0.5, maxLatencyMs: 30000 };

function evalReport() {
  const candidate = {
    contractResult: { outcome: 'pass' }, citedSourceIds: ['trace-surface'], evidence: { provided: true },
    toolsUsed: ['read'], permissionViolations: [], cost: 0.2, latencyMs: 9000,
    output: { ok: true }, outputStructured: true,
  };
  const deterministic = runDeterministicGates(candidate, ITEM, BUDGETS);
  return buildEvaluationReport({ baseline: { ...candidate, cost: 0.4 }, candidate, deterministic, judges: [{ verdict: 'pass' }] });
}

function traceFixture() {
  return {
    schemaVersion: 1, id: 'st-surface-1',
    workerProfile: { id: 'engineer', profileId: 'balanced', capabilityClass: 'hosted-direct' },
    versions: { prompt: 'p1' },
    upstream: { evidenceComplete: true, inputsPresent: true },
    provider: { executionError: false, degraded: false },
    workerProfileOutput: { evidenceVerdict: 'fail' },
    handoff: { inputValid: true, schemaValid: true, output: {} },
    downstream: { consumerError: false, outcome: 'accepted' },
    evaluator: { abstained: false, confidence: 0.9 },
    sourceTraceIds: ['src-surface'], humanCorrection: null,
  };
}

function writeJson(dir, name, data) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

test('CLI improvement surface closes submit → approve → apply with durable records', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'cx-improvement-'));
  try {
    fs.mkdirSync(path.join(tmp, '.construct', 'improvement'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.construct', 'improvement', 'approvers.json'),
      JSON.stringify({ identities: ['test-operator'] }),
    );

    const traceFile = writeJson(tmp, 'trace.json', traceFixture());
    const datasetFile = writeJson(tmp, 'dataset.json', ITEM);
    const reportFile = writeJson(tmp, 'report.json', evalReport());

    const submitCode = await runImprovementCli([
      'submit',
      `--trace=${traceFile}`,
      `--dataset=${datasetFile}`,
      `--report=${reportFile}`,
      '--trigger=human-correction',
      '--approver=test-operator',
      '--json',
    ], { projectDir: tmp });
    assert.equal(submitCode, 0);

    const record = loadRecord(tmp, 'prop-st-surface-1');
    assert.ok(record, 'proposal file exists');
    assert.equal(record.proposal.state, 'awaiting_approval');
    assert.equal(record.governance.admissible, true);
    assert.ok(fs.existsSync(proposalRecordPath(tmp, 'prop-st-surface-1')));

    const approveCode = await runImprovementCli(['approve', 'prop-st-surface-1', '--identity=test-operator', '--json'], { projectDir: tmp });
    assert.equal(approveCode, 0);
    const approved = loadRecord(tmp, 'prop-st-surface-1');
    assert.equal(approved.proposal.state, 'approved');
    assert.ok(approved.rolloutPlan);

    const applyCode = await runImprovementCli(['apply', 'prop-st-surface-1', '--json'], { projectDir: tmp });
    assert.equal(applyCode, 0);
    const applied = loadRecord(tmp, 'prop-st-surface-1');
    assert.equal(applied.proposal.state, 'applied');
    assert.ok(applied.proposal.rollout?.appliedAt);
  } finally {
    rmTmpDir(tmp);
  }
});
