/**
 * tests/functional/author-artifact-recruits.functional.test.mjs —
 * author_artifact recruits from request signals (construct-pteo2.8).
 *
 * Before this bead the artifact-loop path never consulted request signals:
 * invokeWorkflow always received the bare def.chain. This suite drives the
 * real MCP `author_artifact` entrypoint in a mkdtemp project and asserts:
 * a cost-flagged request folds cx-data-analyst into the workflow plan and
 * reports it under `recruited` with a reason; `recruitment:'off'` disables
 * the pass; an explicit cx- id list replaces the signal-derived set; and a
 * neutral request leaves the default chain byte-identical (gate behavior
 * unchanged when no signals fire).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { authorArtifact } from '../../lib/mcp/tools/artifact-author.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

const dirs = [];
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-author-recruits-'));
  dirs.push(cwd);
  return cwd;
}

function withHashingEmbeddings(t, cwd) {
  const prevModel = process.env.CONSTRUCT_EMBEDDING_MODEL;
  process.env.CONSTRUCT_EMBEDDING_MODEL = 'hashing';
  const prevHome = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = cwd;
  t.after(() => {
    if (prevModel === undefined) delete process.env.CONSTRUCT_EMBEDDING_MODEL;
    else process.env.CONSTRUCT_EMBEDDING_MODEL = prevModel;
    if (prevHome === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prevHome;
  });
}

const NEUTRAL_DRAFT = '# Search PRD\n\n## Summary\n\nRelevance improvements for search ranking, scoped to the results page. Every figure is [unverified] until research lands.\n\n## Rollout\n\nBehind a feature flag, beta cohort first. [unverified]\n';

const COST_REQUEST = 'write a PRD about billing cost optimization under the infra budget';
const NEUTRAL_REQUEST = 'write a PRD about search relevance ranking';

test('a cost-flagged request recruits cx-data-analyst into the workflow plan with a reason', async (t) => {
  const cwd = project();
  withHashingEmbeddings(t, cwd);

  const res = await authorArtifact({
    artifact_type: 'prd',
    subject: COST_REQUEST,
    draft_markdown: NEUTRAL_DRAFT,
    cwd,
  }, { ROOT_DIR: REPO });

  const recruited = res.recruited.find((p) => p.specialist === 'cx-data-analyst');
  assert.ok(recruited, `cost request recruits cx-data-analyst; got ${JSON.stringify(res.recruited)}`);
  assert.equal(recruited.role, 'reviewer');
  assert.equal(recruited.gate, 'advisory');
  assert.equal(recruited.source, 'request-signals');
  assert.ok(recruited.reason, 'recruit carries a reason');

  assert.ok(
    res.workflow_plan.includes('cx-data-analyst'),
    `recruit folded into invokePlan.selectedRoles; plan: ${res.workflow_plan.join(',')}`,
  );
  assert.ok(res.workflow_plan.includes('cx-product-manager'), 'def.chain stays the floor');
  assert.ok(res.workflow_plan.includes('cx-architect'), 'def.chain stays the floor');
  assert.ok(res.summary.includes('Recruited'), 'summary names the recruitment');
  assert.ok(res.summary.includes('override'), 'summary names the override affordance');
});

test("recruitment:'off' disables the pass for an otherwise cost-flagged request", async (t) => {
  const cwd = project();
  withHashingEmbeddings(t, cwd);

  const res = await authorArtifact({
    artifact_type: 'prd',
    subject: COST_REQUEST,
    draft_markdown: NEUTRAL_DRAFT,
    recruitment: 'off',
    cwd,
  }, { ROOT_DIR: REPO });

  assert.deepEqual(res.recruited, [], 'no recruitment when overridden off');
  assert.deepEqual(res.workflow_plan, ['cx-product-manager', 'cx-architect'], 'default chain untouched');
});

test('an explicit cx- id list replaces the signal-derived set verbatim', async (t) => {
  const cwd = project();
  withHashingEmbeddings(t, cwd);

  const res = await authorArtifact({
    artifact_type: 'prd',
    subject: COST_REQUEST,
    draft_markdown: NEUTRAL_DRAFT,
    recruitment: ['cx-security'],
    cwd,
  }, { ROOT_DIR: REPO });

  const ids = res.recruited.map((p) => p.specialist);
  assert.deepEqual(ids, ['cx-security'], 'override list is the recruited set');
  assert.equal(res.recruited[0].source, 'override');
  assert.ok(res.workflow_plan.includes('cx-security'), 'override folded into the plan');
  assert.ok(!res.workflow_plan.includes('cx-data-analyst'), 'signal-derived recruit replaced');
});

test('a neutral request recruits nobody and leaves the default chain identical', async (t) => {
  const cwd = project();
  withHashingEmbeddings(t, cwd);

  const res = await authorArtifact({
    artifact_type: 'prd',
    subject: NEUTRAL_REQUEST,
    draft_markdown: NEUTRAL_DRAFT,
    cwd,
  }, { ROOT_DIR: REPO });

  assert.deepEqual(res.recruited, [], 'no signals, no recruits');
  assert.deepEqual(res.workflow_plan, ['cx-product-manager', 'cx-architect'], 'plan is the untouched def.chain');
  assert.equal(res.summary.includes('Recruited'), false);
});
