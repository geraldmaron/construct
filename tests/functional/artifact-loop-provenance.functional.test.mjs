/**
 * tests/functional/artifact-loop-provenance.functional.test.mjs —
 * author_artifact durable provenance (construct-ifwhw.2).
 *
 * Drives the real artifact loop (runConstructArtifactLoop) against a fresh
 * mkdtemp project and asserts, by reading `.construct/observations/*.json`
 * back off disk, that a provenance record exists in both branches:
 *
 *   - no host draft supplied (template scaffold materialized)
 *   - a full draft supplied (artifact FILE written from caller content)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runConstructArtifactLoop } from '../../lib/artifact-loop-core.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

const dirs = [];
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-artifact-provenance-'));
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

function readObservations(cwd) {
  const dir = path.join(cwd, '.construct', 'observations');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name !== 'index.json')
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

function assignedWorkerProfiles(extras, invokePlan) {
  return invokePlan?.selectedWorkerProfiles
    ?? extras.selectedWorkerProfiles
    ?? extras.selectedRoles
    ?? [];
}

test('proposal-only: scaffold draft materializes and a provenance record exists', async (t) => {
  const cwd = project();
  withHashingEmbeddings(t, cwd);

  const res = await runConstructArtifactLoop({
    text: 'provenance no-draft case',
    cwd,
    rootDir: REPO,
    explicit: true,
    artifactType: 'prd',
    titleOverride: 'Provenance no-draft case',
  });

  assert.notEqual(res.draftMissing, true, 'proposal-only with allowScaffold writes a template scaffold rather than stopping at draftMissing');
  assert.ok(res.path, 'artifact loop materializes a scaffold draft from the template');
  assert.equal(fs.existsSync(res.path), true, 'scaffold artifact file exists on disk');
  assert.ok(fs.statSync(res.path).size > 0, 'scaffold artifact file is non-empty');

  assert.ok(res.provenance, 'artifact loop result carries a provenance summary');
  assert.equal(res.provenance.ok, true, `provenance write failed: ${res.provenance.error}`);
  assert.ok(res.provenance.id, 'provenance write returns an observation id');

  const observations = readObservations(cwd).filter((o) => o.tags?.includes('artifact-loop'));
  assert.equal(observations.length, 1, 'exactly one provenance observation was written to disk');

  const [obs] = observations;
  assert.ok(obs.extras.traceId, 'provenance record carries a traceId');
  assert.equal(obs.extras.artifactType, 'prd');
  assert.equal(obs.extras.workflowType, 'prd-draft');
  const profiles = assignedWorkerProfiles(obs.extras, res.invokePlan);
  assert.deepEqual(profiles, ['product-manager', 'architect'], 'provenance record carries the Procedure Worker Profile set');
});

const FULL_DRAFT = [
  '# Provenance full-execute case',
  '',
  'This document exercises the full author_artifact path where a draft is supplied end to end, so the release gate has real prose to evaluate and the provenance write is checked alongside a materialized artifact file.',
  '',
  '## Problem',
  '',
  'Nothing durable proved an author_artifact call happened before construct-ifwhw.2; this paragraph and the next give the release gate two full prose paragraphs to satisfy its content floor.',
  '',
  '## Goals and non-goals',
  '',
  '- Goal: a provenance record exists on disk after every author_artifact call.',
  '- Non-goal: changing whether the artifact file itself is written in the no-draft case.',
  '',
  '[unverified]',
  '',
].join('\n');

test('full-execute: a supplied draft writes both the artifact file and a provenance record', async (t) => {
  const cwd = project();
  withHashingEmbeddings(t, cwd);

  const res = await runConstructArtifactLoop({
    text: 'provenance full-execute case',
    cwd,
    rootDir: REPO,
    explicit: true,
    artifactType: 'prd',
    draftMarkdown: FULL_DRAFT,
    titleOverride: 'Provenance full-execute case',
  });

  assert.ok(res.path, 'a supplied draft materializes the artifact file');
  assert.equal(fs.existsSync(res.path), true, 'artifact file exists on disk');

  assert.ok(res.provenance, 'artifact loop result carries a provenance summary');
  assert.equal(res.provenance.ok, true, `provenance write failed: ${res.provenance.error}`);

  const observations = readObservations(cwd).filter((o) => o.tags?.includes('artifact-loop'));
  assert.equal(observations.length, 1, 'exactly one provenance observation was written to disk');

  const [obs] = observations;
  assert.ok(obs.extras.traceId, 'provenance record carries a traceId');
  assert.equal(obs.extras.artifactType, 'prd');
  assert.equal(obs.extras.relPath, res.relPath, 'provenance record links to the materialized artifact path');
  const profiles = assignedWorkerProfiles(obs.extras, res.invokePlan);
  assert.ok(profiles.length > 0, 'provenance record carries the assigned Worker Profile set');
});
