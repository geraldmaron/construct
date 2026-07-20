/**
 * tests/oracle/execute-directive-due.test.mjs — construct-p4cba.6 (WS-B5)
 * executeApprovedAction's 'directive-due' case: toast-only by default,
 * unattended execution only behind oracle.executeDirectives.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { executeApprovedAction } from '../../lib/oracle/execute.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { tempDir } from '../helpers.mjs';

// Worker Profile dispatch/recordAndMaybeInvoke resolve machine-scoped pending
// paths off the real $HOME by default — CONSTRUCT_HOME_OVERRIDE keeps every test
// in this file off the real developer machine.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-directive-due-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

function makeAction(overrides = {}) {
  return {
    id: 'oracle-1',
    kind: 'directive-due',
    summary: "Run directive 'demo': post a status update",
    directiveId: 'demo',
    directiveWorkerProfileId: 'operations',
    directiveInstruction: 'post a status update',
    directiveOutput: { kind: 'beads' },
    ...overrides,
  };
}

test('directive-due is toast-only when oracle.executeDirectives is not set (default)', async () => {
  const projectDir = tempDir('cx-directive-due-off-', test);
  const homeDir = tempDir('cx-directive-due-off-home-', test);

  const result = await executeApprovedAction(makeAction(), {
    rootDir: projectDir, projectDir, homeDir,
    directiveExecutorOpts: { env: {} },
  });

  assert.equal(result.ok, true);
  assert.equal(result.workerProfileId, 'operations');
  assert.equal(result.assignment.workerProfileId, 'operations');
  assert.ok(result.artifactPath, 'toast dispatch still writes a routing artifact');
  assert.equal('output' in result, false, 'no LLM output when execution is not enabled');
});

test('directive-due executes unattended when oracle.executeDirectives is on and budget allows it', async () => {
  const projectDir = tempDir('cx-directive-due-on-', test);
  const homeDir = tempDir('cx-directive-due-on-home-', test);

  const queuePath = path.join(projectDir, 'queue.jsonl');
  const queue = new ApprovalQueue({ persistPath: queuePath });

  let capturedTask = null;
  const runTask = async ({ task }) => {
    capturedTask = task;
    return {
      output: 'summary posted',
      writeProposals: [{
        providerId: 'jira', writeKind: 'comment', payload: { issueKey: 'OPS-1', body: 'status' },
        requestedBy: { workerProfileId: 'operations' }, surface: 'orchestration-worker', tool: 'jira.comment',
      }],
    };
  };

  const result = await executeApprovedAction(makeAction(), {
    rootDir: projectDir, projectDir, homeDir,
    directiveExecutorOpts: {
      env: { CONSTRUCT_ORACLE_EXECUTE_DIRECTIVES: '1', CONSTRUCT_UNATTENDED_BUDGET_ORACLE_DIRECTIVE_DEMO: '100000' },
      runTask,
      approvalQueue: queue,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.directiveId, 'demo');
  assert.equal(result.output, 'summary posted');
  assert.equal(result.writeProposalsQueued, 1);
  assert.equal(capturedTask.reason, 'post a status update');
  assert.equal(queue.getPending().length, 1);
});

test('directive-due falls back to toast-only when the enable flag is on but the budget is not configured', async () => {
  const projectDir = tempDir('cx-directive-due-nobudget-', test);
  const homeDir = tempDir('cx-directive-due-nobudget-home-', test);

  const result = await executeApprovedAction(makeAction(), {
    rootDir: projectDir, projectDir, homeDir,
    directiveExecutorOpts: { env: { CONSTRUCT_ORACLE_EXECUTE_DIRECTIVES: '1' } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unattended-budget-not-configured');
});

test('dryRun short-circuits before any dispatch or execution', async () => {
  const projectDir = tempDir('cx-directive-due-dryrun-', test);
  const homeDir = tempDir('cx-directive-due-dryrun-home-', test);

  const result = await executeApprovedAction(makeAction(), {
    rootDir: projectDir, projectDir, homeDir, dryRun: true,
  });

  assert.deepEqual(result, { ok: true, dryRun: true, kind: 'directive-due' });
});
