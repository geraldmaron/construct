/**
 * tests/orchestration/write-proposal-worker-integration.test.mjs —
 * end-to-end wiring of a specialist's fenced write-proposal block through
 * runTaskViaProvider and executeTaskViaProvider.
 *
 * Exercises the real code paths with a fake fetchImpl (the established
 * pattern in tests/orchestration-worker.test.mjs) rather than a live
 * provider — this feature is free-text parsing, not tool-calling, so no
 * vendor API shape is exercised here beyond the plain text response every
 * one of runTaskViaProvider's call paths already returns.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTaskViaProvider } from '../../lib/orchestration/worker.mjs';
import { planRun, executeRun } from '../../lib/orchestration/runtime.mjs';
import { tempDir } from '../helpers.mjs';

// executeRun resolves trace/state paths through the machine-scoped state root
// — CONSTRUCT_HOME_OVERRIDE keeps that off the real developer machine's
// $HOME for the whole file (same isolation as tests/orchestration/provenance.test.mjs).

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-write-proposal-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL, ANTHROPIC_API_KEY: 'sk-test' };

test('runTaskViaProvider surfaces a fenced write-proposal block as writeProposals', async () => {
  const task = { role: 'product-manager', reason: 'draft the PRD update', handoffContract: null };
  const run = { request: { summary: 'update the checkout PRD' } };
  const specialistText = [
    'Drafted the update. Recommending a tracking PR:',
    '```write-proposal',
    '{"providerId": "github", "writeKind": "pr", "payload": {"title": "Update checkout PRD", "head": "prd-update", "base": "main"}}',
    '```',
  ].join('\n');
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: specialistText }] }) });

  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test' }, fetchImpl });

  assert.equal(result.output, specialistText, 'the specialist free-text output is unmodified');
  assert.equal(result.writeProposals.length, 1);
  assert.equal(result.writeProposals[0].providerId, 'github');
  assert.equal(result.writeProposals[0].writeKind, 'pr');
  assert.equal(result.writeProposals[0].requestedBy.workerProfileId, result.workerProfileId);
});

test('runTaskViaProvider omits writeProposals entirely when the specialist recommended none', async () => {
  const task = { role: 'engineer', reason: 'implement the change', handoffContract: null };
  const run = { request: { summary: 'refactor the auth module' } };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'plain answer, no writes' }] }) });

  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test' }, fetchImpl });

  assert.equal('writeProposals' in result, false, 'no writeProposals key when the specialist proposed nothing');
});

test('executeRun (provider backend) threads writeProposals onto every persisted task that recommended one', async () => {
  const cwd = tempDir('cx-write-proposal-run-', test);
  const specialistText = '```write-proposal\n{"providerId": "jira", "writeKind": "comment", "payload": {"issueKey": "OPS-1", "body": "status"}}\n```';
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: specialistText }] }) });

  const planned = await planRun(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  assert.ok(planned.tasks.length >= 1);

  const executed = await executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'provider', fetchImpl });
  assert.equal(executed.status, 'completed');

  for (const task of executed.tasks) {
    assert.equal(task.writeProposals?.length, 1, `task for role ${task.role} should carry the recommended write`);
    assert.equal(task.writeProposals[0].providerId, 'jira');
    assert.equal(task.writeProposals[0].requestedBy.workerProfileId, task.workerProfileId);
  }
});
