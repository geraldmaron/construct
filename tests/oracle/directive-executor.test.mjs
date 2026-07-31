/**
 * tests/oracle/directive-executor.test.mjs
 * directive execution + budget gating + write-proposal enqueueing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { oracleExecuteDirectivesEnabled, executeDirective } from '../../lib/oracle/directive-executor.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { tempDir } from '../helpers.mjs';

test('oracleExecuteDirectivesEnabled defaults to false with no config or env', () => {
  const cwd = tempDir('cx-directive-exec-flag-', test);
  assert.equal(oracleExecuteDirectivesEnabled({ env: {}, cwd }), false);
});

test('oracleExecuteDirectivesEnabled reads oracle.executeDirectives from construct.config.json', () => {
  const cwd = tempDir('cx-directive-exec-flag-cfg-', test);
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ oracle: { executeDirectives: true } }));
  assert.equal(oracleExecuteDirectivesEnabled({ env: {}, cwd }), true);
});

test('oracleExecuteDirectivesEnabled: env var overrides config either direction', () => {
  const cwd = tempDir('cx-directive-exec-flag-env-', test);
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ oracle: { executeDirectives: true } }));
  assert.equal(oracleExecuteDirectivesEnabled({ env: { CONSTRUCT_ORACLE_EXECUTE_DIRECTIVES: '0' }, cwd }), false);

  const cwd2 = tempDir('cx-directive-exec-flag-env2-', test);
  assert.equal(oracleExecuteDirectivesEnabled({ env: { CONSTRUCT_ORACLE_EXECUTE_DIRECTIVES: '1' }, cwd: cwd2 }), true);
});

test('executeDirective is denied by default (unattended budget not configured)', async () => {
  const projectDir = tempDir('cx-directive-exec-budget-', test);
  const directive = { id: 'demo', workerProfileId: 'operations', instruction: 'summarize the sprint' };

  const result = await executeDirective(directive, { projectDir, env: {} });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unattended-budget-not-configured');
});

test('executeDirective runs the assigned Worker Profile and enqueues a recommended write when budget is configured', async () => {
  const projectDir = tempDir('cx-directive-exec-run-', test);
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

  const result = await executeDirective(directive, { projectDir, env, runTask: fakeRunTask, approvalQueue: queue });

  assert.equal(result.ok, true);
  assert.equal(result.output, 'done');
  assert.equal(result.writeProposalsQueued, 1);
  assert.equal(capturedTask.role, 'operations');
  assert.equal(capturedTask.reason, 'post a status update');

  const pending = queue.getPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].toolCall.tool, 'jira.comment');
  assert.deepEqual(pending[0].toolCall.args, { issueKey: 'OPS-1', body: 'status' });
});

test('executeDirective records spend so a second call against a small budget is denied', async () => {
  const projectDir = tempDir('cx-directive-exec-spend-', test);
  const directive = { id: 'demo', workerProfileId: 'operations', instruction: 'summarize' };
  // Pre-call budget checks use the fixed DEFAULT_TOKEN_ESTIMATE (1500), not the
  // eventual actual usage — the cap must clear that first estimate-based check
  // (2000 >= 1500) but be exhausted by the recorded 900 real tokens before the
  // second call's own 1500-token estimate (900 + 1500 > 2000).
  const env = { CONSTRUCT_UNATTENDED_BUDGET_ORACLE_DIRECTIVE_DEMO: '2000' };
  const fakeRunTask = async () => ({ output: 'ok', providerMeta: { usage: { total_tokens: 900 } } });

  const first = await executeDirective(directive, { projectDir, env, runTask: fakeRunTask });
  assert.equal(first.ok, true);

  const second = await executeDirective(directive, { projectDir, env, runTask: fakeRunTask });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'unattended-budget-exhausted');
});

test('executeDirective returns ok:false with the error message when runTask throws', async () => {
  const projectDir = tempDir('cx-directive-exec-error-', test);
  const directive = { id: 'demo', workerProfileId: 'operations', instruction: 'summarize' };
  const env = { CONSTRUCT_UNATTENDED_BUDGET_ORACLE_DIRECTIVE_DEMO: '100000' };
  const failingRunTask = async () => { throw new Error('provider unavailable'); };

  const result = await executeDirective(directive, { projectDir, env, runTask: failingRunTask });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'provider unavailable');
});

test('executeDirective does not touch the queue when the Worker Profile recommends no writes', async () => {
  const projectDir = tempDir('cx-directive-exec-nowrite-', test);
  const directive = { id: 'demo', workerProfileId: 'product-manager', instruction: 'summarize the roadmap' };
  const env = { CONSTRUCT_UNATTENDED_BUDGET_ORACLE_DIRECTIVE_DEMO: '100000' };
  const fakeRunTask = async () => ({ output: 'just a summary, no writes' });

  const queuePath = path.join(projectDir, 'queue.jsonl');
  const queue = new ApprovalQueue({ persistPath: queuePath });

  const result = await executeDirective(directive, { projectDir, env, runTask: fakeRunTask, approvalQueue: queue });

  assert.equal(result.ok, true);
  assert.equal(result.writeProposalsQueued, 0);
  assert.equal(queue.getPending().length, 0);
});
