/**
 * tests/workplace-loop/directive-executor-equivalence.test.mjs —
 * the equivalence tests
 * needs to retire Oracle's directive-executor.mjs onto the E5 workplace loop.
 *
 * Runs the exact same directive/env/injected-runTask inputs through both
 * lib/oracle/directive-executor.mjs (the existing, still-live path) and
 * lib/workplace-loop/directive-executor.mjs (the E5 re-homed equivalent) and
 * asserts identical outcomes: same ok/output/error/reason, same
 * writeProposalsQueued count, same budget-gating behavior (denied by
 * default, exhausted after the same spend), same ApprovalQueue toolCall
 * shape once enqueued. The one intentional, asserted difference is the
 * `surface` tag on an enqueued queue record (`oracle-directive` vs
 * `workplace-loop-directive`) — correct provenance for a different module,
 * not a behavior regression.
 *
 * Proves what is needed before deleting
 * lib/oracle/directive-executor.mjs: cutting lib/oracle/execute.mjs's
 * `directive-due` case over to lib/workplace-loop/directive-executor.mjs
 * changes no observable behavior for any existing caller.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as oracleExecutor from '../../lib/oracle/directive-executor.mjs';
import * as loopExecutor from '../../lib/workplace-loop/directive-executor.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { tempDir } from '../helpers.mjs';

const MODULES = [
  { name: 'oracle', enabledFn: oracleExecutor.oracleExecuteDirectivesEnabled, executeFn: oracleExecutor.executeDirective, expectedSurface: 'oracle-directive' },
  { name: 'workplace-loop', enabledFn: loopExecutor.workplaceLoopExecuteDirectivesEnabled, executeFn: loopExecutor.executeDirective, expectedSurface: 'workplace-loop-directive' },
];

test('workplaceLoopExecuteDirectivesEnabled agrees with oracleExecuteDirectivesEnabled on every input', () => {
  const cases = [
    { env: {}, cfg: null },
    { env: { CONSTRUCT_ORACLE_EXECUTE_DIRECTIVES: '1' }, cfg: null },
    { env: { CONSTRUCT_ORACLE_EXECUTE_DIRECTIVES: '0' }, cfg: { oracle: { executeDirectives: true } } },
    { env: {}, cfg: { oracle: { executeDirectives: true } } },
  ];
  for (const { env, cfg } of cases) {
    const cwd = tempDir('cx-equiv-flag-', test);
    if (cfg) {
      fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify(cfg));
    }
    assert.equal(
      loopExecutor.workplaceLoopExecuteDirectivesEnabled({ env, cwd }),
      oracleExecutor.oracleExecuteDirectivesEnabled({ env, cwd }),
      `mismatch for env=${JSON.stringify(env)} cfg=${JSON.stringify(cfg)}`,
    );
  }
});

for (const mod of MODULES) {
  test(`${mod.name}: executeDirective is denied by default (unattended budget not configured)`, async () => {
    const projectDir = tempDir(`cx-equiv-budget-${mod.name}-`, test);
    const directive = { id: 'demo', workerProfileId: 'operations', instruction: 'summarize the sprint' };
    const result = await mod.executeFn(directive, { projectDir, env: {} });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unattended-budget-not-configured');
  });
}

test('both modules deny in lockstep for an identical unconfigured-budget input', async () => {
  const directive = { id: 'demo', workerProfileId: 'operations', instruction: 'summarize the sprint' };
  const oracleResult = await oracleExecutor.executeDirective(directive, { projectDir: tempDir('cx-equiv-lockstep-a-', test), env: {} });
  const loopResult = await loopExecutor.executeDirective(directive, { projectDir: tempDir('cx-equiv-lockstep-b-', test), env: {} });
  assert.deepEqual(oracleResult, loopResult);
});

for (const mod of MODULES) {
  test(`${mod.name}: executeDirective runs the specialist and enqueues a recommended write when budget is configured`, async () => {
    const projectDir = tempDir(`cx-equiv-run-${mod.name}-`, test);
    const directive = { id: 'demo', workerProfileId: 'operations', instruction: 'post a status update' };
    const env = { CONSTRUCT_UNATTENDED_BUDGET_ORACLE_DIRECTIVE_DEMO: '100000' };

    let capturedTask = null;
    const fakeRunTask = async ({ task }) => {
      capturedTask = task;
      return {
        output: 'done',
        writeProposals: [{
          providerId: 'jira', writeKind: 'comment', payload: { issueKey: 'OPS-1', body: 'status' },
          requestedBy: { workerProfileId: 'operations' }, surface: 'orchestration-worker', tool: 'jira.comment',
        }],
      };
    };

    const queuePath = path.join(projectDir, 'queue.jsonl');
    const queue = new ApprovalQueue({ persistPath: queuePath });

    const result = await mod.executeFn(directive, { projectDir, env, runTask: fakeRunTask, approvalQueue: queue });

    assert.equal(result.ok, true);
    assert.equal(result.output, 'done');
    assert.equal(result.writeProposalsQueued, 1);
    assert.equal(capturedTask.role, 'operations');
    assert.equal(capturedTask.reason, 'post a status update');

    const pending = queue.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].toolCall.tool, 'jira.comment');
    assert.deepEqual(pending[0].toolCall.args, { issueKey: 'OPS-1', body: 'status' });
    assert.equal(pending[0].toolCall.surface, mod.expectedSurface, 'provenance tag must identify which module enqueued the record');
  });

  test(`${mod.name}: executeDirective records spend so a second call against a small budget is denied`, async () => {
    const projectDir = tempDir(`cx-equiv-spend-${mod.name}-`, test);
    const directive = { id: 'demo', workerProfileId: 'operations', instruction: 'summarize' };
    const env = { CONSTRUCT_UNATTENDED_BUDGET_ORACLE_DIRECTIVE_DEMO: '2000' };
    const fakeRunTask = async () => ({ output: 'ok', providerMeta: { usage: { total_tokens: 900 } } });

    const first = await mod.executeFn(directive, { projectDir, env, runTask: fakeRunTask });
    assert.equal(first.ok, true);

    const second = await mod.executeFn(directive, { projectDir, env, runTask: fakeRunTask });
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'unattended-budget-exhausted');
  });

  test(`${mod.name}: executeDirective returns ok:false with the error message when runTask throws`, async () => {
    const projectDir = tempDir(`cx-equiv-error-${mod.name}-`, test);
    const directive = { id: 'demo', workerProfileId: 'operations', instruction: 'summarize' };
    const env = { CONSTRUCT_UNATTENDED_BUDGET_ORACLE_DIRECTIVE_DEMO: '100000' };
    const failingRunTask = async () => { throw new Error('provider unavailable'); };

    const result = await mod.executeFn(directive, { projectDir, env, runTask: failingRunTask });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'provider unavailable');
  });

  test(`${mod.name}: executeDirective does not touch the queue when the specialist recommends no writes`, async () => {
    const projectDir = tempDir(`cx-equiv-nowrite-${mod.name}-`, test);
    const directive = { id: 'demo', workerProfileId: 'product-manager', instruction: 'summarize the roadmap' };
    const env = { CONSTRUCT_UNATTENDED_BUDGET_ORACLE_DIRECTIVE_DEMO: '100000' };
    const fakeRunTask = async () => ({ output: 'just a summary, no writes' });

    const queuePath = path.join(projectDir, 'queue.jsonl');
    const queue = new ApprovalQueue({ persistPath: queuePath });

    const result = await mod.executeFn(directive, { projectDir, env, runTask: fakeRunTask, approvalQueue: queue });
    assert.equal(result.ok, true);
    assert.equal(result.writeProposalsQueued, 0);
    assert.equal(queue.getPending().length, 0);
  });
}

test('a directive run through both modules with identical injected inputs produces byte-identical results modulo the surface tag', async () => {
  const directive = { id: 'demo', workerProfileId: 'operations', instruction: 'post a status update' };
  const env = { CONSTRUCT_UNATTENDED_BUDGET_ORACLE_DIRECTIVE_DEMO: '100000' };
  const fakeRunTask = async () => ({
    output: 'done',
    writeProposals: [{
      providerId: 'jira', writeKind: 'comment', payload: { issueKey: 'OPS-1', body: 'status' },
      requestedBy: { workerProfileId: 'operations' }, surface: 'orchestration-worker', tool: 'jira.comment',
    }],
  });

  const oracleQueue = new ApprovalQueue({ persistPath: path.join(tempDir('cx-equiv-byte-a-', test), 'queue.jsonl') });
  const loopQueue = new ApprovalQueue({ persistPath: path.join(tempDir('cx-equiv-byte-b-', test), 'queue.jsonl') });

  const oracleResult = await oracleExecutor.executeDirective(directive, { projectDir: tempDir('cx-equiv-byte-c-', test), env, runTask: fakeRunTask, approvalQueue: oracleQueue });
  const loopResult = await loopExecutor.executeDirective(directive, { projectDir: tempDir('cx-equiv-byte-d-', test), env, runTask: fakeRunTask, approvalQueue: loopQueue });

  assert.deepEqual(oracleResult, loopResult);

  const oraclePending = oracleQueue.getPending()[0];
  const loopPending = loopQueue.getPending()[0];
  assert.equal(oraclePending.toolCall.tool, loopPending.toolCall.tool);
  assert.deepEqual(oraclePending.toolCall.args, loopPending.toolCall.args);
  assert.equal(oraclePending.toolCall.surface, 'oracle-directive');
  assert.equal(loopPending.toolCall.surface, 'workplace-loop-directive');
});
