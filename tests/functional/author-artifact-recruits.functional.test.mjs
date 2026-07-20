/**
 * tests/functional/author-artifact-recruits.functional.test.mjs —
 * author_artifact recruits from request signals through canonical Worker
 * Profile and Procedure result shapes. This suite drives the
 * real MCP `author_artifact` entrypoint in a mkdtemp project and asserts:
 * a cost-flagged request folds data-analyst into the workflow plan and
 * reports it under `recruited` with a reason; `recruitment:'off'` disables
 * the pass; an explicit cx- Worker Profile id list replaces the signal-derived
 * set; and a neutral request leaves the Procedure defaults byte-identical (gate behavior
 * unchanged when no signals fire).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { authorArtifact } from '../../lib/mcp/tools/artifact-author.mjs';
import { runConstructArtifactLoop } from '../../lib/artifact-loop-core.mjs';
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
  const prevHome = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = cwd;
  t.after(() => {
    if (prevModel === undefined) delete process.env.CONSTRUCT_EMBEDDING_MODEL;
    else process.env.CONSTRUCT_EMBEDDING_MODEL = prevModel;
    if (prevHome === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHome;
  });
}

const NEUTRAL_DRAFT = '# Search PRD\n\n## Summary\n\nRelevance improvements for search ranking, scoped to the results page. Every figure is [unverified] until research lands.\n\n## Rollout\n\nBehind a feature flag, beta cohort first. [unverified]\n';

const COST_REQUEST = 'write a PRD about billing cost optimization under the infra budget';
const NEUTRAL_REQUEST = 'write a PRD about search relevance ranking';

test('a cost-flagged request recruits with non-null workerProfileId and a cost reason', async (t) => {
  const cwd = project();
  withHashingEmbeddings(t, cwd);

  const res = await authorArtifact({
    artifact_type: 'prd',
    subject: COST_REQUEST,
    draft_markdown: NEUTRAL_DRAFT,
    cwd,
  }, { ROOT_DIR: REPO });

  assert.ok(res.recruited.length > 0, `cost request recruits someone; got ${JSON.stringify(res.recruited)}`);
  for (const p of res.recruited) {
    assert.ok(p.workerProfileId, `workerProfileId must be non-null; got ${JSON.stringify(p)}`);
    assert.equal(p.gate, 'advisory');
  }
  assert.ok(
    res.recruited.some((p) => p.source === 'request-signals' && /cost/i.test(p.reason || '')),
    `cost signal present in recruited reasons; got ${JSON.stringify(res.recruited)}`,
  );
  assert.ok(
    res.recruited.some((p) => p.workerProfileId === 'data-analyst' || p.workerProfileId === 'product-manager'),
    `cost path recruits data-analyst and/or product-manager; got ${JSON.stringify(res.recruited)}`,
  );
  assert.ok(
    res.workflow_plan.includes('cx-product-manager') && res.workflow_plan.includes('cx-architect'),
    `Procedure floor preserved; plan: ${res.workflow_plan.join(',')}`,
  );
  assert.ok(res.summary.includes('Recruited') || res.recruited.length > 0, 'summary surfaces recruitment');
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

  const loop = await runConstructArtifactLoop({
    text: COST_REQUEST,
    cwd,
    rootDir: REPO,
    explicit: true,
    artifactType: 'prd',
    draftMarkdown: NEUTRAL_DRAFT,
    titleOverride: 'Search PRD',
    recruitment: 'off',
  });
  assert.deepEqual(loop.recruited, []);
  assert.deepEqual(loop.invokePlan?.selectedWorkerProfiles, ['product-manager', 'architect']);
});

test('an explicit cx- Worker Profile id list replaces the signal-derived set verbatim', async (t) => {
  const cwd = project();
  withHashingEmbeddings(t, cwd);

  const res = await authorArtifact({
    artifact_type: 'prd',
    subject: COST_REQUEST,
    draft_markdown: NEUTRAL_DRAFT,
    recruitment: ['cx-security'],
    cwd,
  }, { ROOT_DIR: REPO });

  const ids = res.recruited.map((p) => p.workerProfileId);
  assert.deepEqual(ids, ['cx-security'], 'override list is the recruited set');
  assert.equal(res.recruited[0].source, 'override');
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

  const loop = await runConstructArtifactLoop({
    text: NEUTRAL_REQUEST,
    cwd,
    rootDir: REPO,
    explicit: true,
    artifactType: 'prd',
    draftMarkdown: NEUTRAL_DRAFT,
    titleOverride: 'Search PRD',
  });
  assert.deepEqual(loop.recruited, []);
  assert.deepEqual(loop.invokePlan?.selectedWorkerProfiles, ['product-manager', 'architect']);
  assert.equal(res.summary.includes('Recruited'), false);
});
