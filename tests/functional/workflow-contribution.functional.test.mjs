/**
 * tests/functional/workflow-contribution.functional.test.mjs — LMCP-D3.
 *
 * Drives the real `construct` binary against an isolated project (.cx) that
 * contributes its own workflow manifest, proving the contribution is live
 * end-to-end: `construct workflow invoke`, `construct intake classify`
 * (triage), and `construct graph build`/`explain` all see it without any
 * code edit. Also pins the precedence-conflict requirement: a project
 * manifest that reuses a builtin id shadows the builtin and `graph explain`
 * names both the winning source and what it overrode.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const tmpDirs = [];
function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-wf-contrib-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

function writeProjectWorkflow(cwd, fileName, manifest) {
  const dir = path.join(cwd, '.cx', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(manifest, null, 2), 'utf8');
}

function run(args, { cwd, home }) {
  return spawnSync('node', [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home, CONSTRUCT_ROLES: 'off' },
  });
}

function runJson(args, opts) {
  const res = run([...args, '--json'], opts);
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

const FIXTURE_WORKFLOW = {
  id: 'fixture-custom-review',
  version: '1.0.0',
  type: 'linear',
  defaultApprovalMode: 'proposal-only',
  tier: 'standard',
  roleChain: ['product-manager'],
  intakeType: 'unknown',
  description: 'Fixture project-contributed workflow (LMCP-D3 functional test).',
  owner: 'd3-fixture-test',
  compatVersion: 1,
};

test('a project-contributed workflow is invokable via `construct workflow invoke`', () => {
  const cwd = freshProject();
  const home = freshProject();
  writeProjectWorkflow(cwd, 'fixture-custom-review.manifest.json', FIXTURE_WORKFLOW);

  const env = runJson(
    ['workflow', 'invoke', '--workflow-type', 'fixture-custom-review', '--approval-mode', 'proposal-only', '--text', 'raw notes'],
    { cwd, home },
  );
  assert.equal(env.data.status, 'proposed');
  assert.deepEqual(env.data.selectedRoles, ['product-manager']);
});

test('a project-contributed workflow is visible in `construct graph build`', () => {
  const cwd = freshProject();
  const home = freshProject();
  writeProjectWorkflow(cwd, 'fixture-custom-review.manifest.json', FIXTURE_WORKFLOW);

  const build = run(['graph', 'build'], { cwd, home });
  assert.equal(build.status, 0, `graph build exit 0 — stderr: ${build.stderr}`);

  const listing = runJson(['graph', 'query', '--type', 'workflow'], { cwd, home });
  const ids = listing.nodes.map((n) => n.id);
  assert.ok(
    ids.includes('workflow:fixture-custom-review'),
    `expected a workflow:fixture-custom-review node, got: ${JSON.stringify(ids)}`,
  );
});

test('a project-contributed intakeType is picked up by triage (construct intake classify)', () => {
  const cwd = freshProject();
  const home = freshProject();
  writeProjectWorkflow(cwd, 'fixture-custom-review.manifest.json', FIXTURE_WORKFLOW);

  const env = runJson(
    ['intake', 'classify', '--text', 'zzqx flibbertigibbet unclassifiable nonsense zzqx', '--source', 'weird.txt'],
    { cwd, home },
  );
  assert.equal(env.data.classification.intakeType, 'unknown');
  assert.equal(
    env.data.suggestedWorkflowType,
    'fixture-custom-review',
    `expected the project's intakeType contribution to override the builtin unknown->structure-notes mapping, got: ${JSON.stringify(env.data)}`,
  );
});

test('a project manifest that reuses a builtin id shadows it, and graph explain names the winning source', () => {
  const cwd = freshProject();
  const home = freshProject();
  writeProjectWorkflow(cwd, 'evidence-ingest.manifest.json', {
    id: 'evidence-ingest',
    version: '2.0.0',
    type: 'linear',
    defaultApprovalMode: 'requires-human-approval',
    tier: 'reasoning',
    roleChain: ['security'],
    description: 'Project override of evidence-ingest (LMCP-D3 functional test).',
    owner: 'd3-fixture-test',
    compatVersion: 1,
  });

  const build = run(['graph', 'build'], { cwd, home });
  assert.equal(build.status, 0, `graph build exit 0 — stderr: ${build.stderr}`);

  const explain = runJson(['graph', 'explain', 'evidence-ingest'], { cwd, home });
  const roleChainSection = explain.sections.find((s) => s.rel === 'roleChain');
  assert.ok(roleChainSection, 'expected a roleChain section');
  assert.deepEqual(roleChainSection.links, ['security'], 'project override roleChain should win');
  assert.equal(roleChainSection.provenance.source, 'project');
  assert.match(roleChainSection.provenance.filePath, /evidence-ingest\.manifest\.json$/);
  assert.ok(roleChainSection.provenance.shadows.length >= 1, 'expected the shadowed builtin entry to be recorded');
  assert.equal(roleChainSection.provenance.shadows[0].source, 'builtin');
  assert.match(roleChainSection.provenance.shadows[0].filePath, /lib[/\\]embedded-contract[/\\]workflows[/\\]evidence-ingest\.manifest\.json$/);
});
