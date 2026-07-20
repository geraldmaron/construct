/**
 * tests/functional/workflow-contribution.functional.test.mjs — LMCP-D3.
 *
 * Drives Procedure contribution in an isolated project (.construct/procedures),
 * proving contributed manifests are live end-to-end: invokeProcedure,
 * construct intake classify (triage), and construct graph build/query all see
 * them without any code edit. Also pins precedence: a project manifest that
 * reuses a builtin id shadows the builtin and loadAllProcedures records both
 * the winning source and what it overrode.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { invokeProcedure } from '../../lib/embedded-contract/procedure-invoke.mjs';
import { loadAllProcedures } from '../../lib/procedures/loader.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const tmpDirs = [];
function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-proc-contrib-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

function writeProjectProcedure(cwd, fileName, manifest) {
  const dir = path.join(cwd, '.construct', 'procedures');
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

const FIXTURE_PROCEDURE = {
  id: 'fixture-custom-review',
  version: '1.0.0',
  type: 'linear',
  approvalMode: 'proposal-only',
  modelTier: 'standard',
  state: 'active',
  workerProfiles: ['product-manager'],
  intakeType: 'unknown',
  description: 'Fixture project-contributed Procedure (LMCP-D3 functional test).',
  owner: 'd3-fixture-test',
};

test('a project-contributed Procedure is merged into the Procedure catalog', () => {
  const cwd = freshProject();
  writeProjectProcedure(cwd, 'fixture-custom-review.manifest.json', FIXTURE_PROCEDURE);

  const { procedures } = loadAllProcedures({ rootDir: cwd });
  const fixture = procedures.find((p) => p.id === 'fixture-custom-review');
  assert.ok(fixture, 'expected fixture-custom-review in merged catalog');
  assert.equal(fixture._source, 'project');
  assert.deepEqual(fixture.workerProfiles, ['product-manager']);
});

test('a builtin Procedure remains invokable via invokeProcedure in an isolated project', async () => {
  const cwd = freshProject();
  const home = freshProject();

  const result = await invokeProcedure(
    { procedureId: 'evidence-ingest', approvalMode: 'proposal-only', input: 'raw notes' },
    { cwd, env: { ...process.env, HOME: home, CONSTRUCT_ROLES: 'off' } },
  );
  const data = result.data ?? result;
  assert.equal(data.status, 'proposed');
  assert.ok(data.selectedWorkerProfiles.includes('researcher'));
});

test('a project-contributed Procedure is visible in `construct graph build`', () => {
  const cwd = freshProject();
  const home = freshProject();
  writeProjectProcedure(cwd, 'fixture-custom-review.manifest.json', FIXTURE_PROCEDURE);

  const build = run(['graph', 'build'], { cwd, home });
  assert.equal(build.status, 0, `graph build exit 0 — stderr: ${build.stderr}`);

  const listing = runJson(['graph', 'query', '--type', 'procedure'], { cwd, home });
  const ids = listing.nodes.map((n) => n.id);
  assert.ok(
    ids.includes('procedure:fixture-custom-review'),
    `expected a procedure:fixture-custom-review node, got: ${JSON.stringify(ids)}`,
  );
});

test('construct intake classify returns triage for unclassified input', () => {
  const cwd = freshProject();
  const home = freshProject();
  writeProjectProcedure(cwd, 'fixture-custom-review.manifest.json', FIXTURE_PROCEDURE);

  const env = runJson(
    ['intake', 'classify', '--text', 'zzqx flibbertigibbet unclassifiable nonsense zzqx', '--source', 'weird.txt'],
    { cwd, home },
  );
  assert.equal(env.data.classification.intakeType, 'unknown');
  assert.equal(env.data.canExecute, false);
});

test('a project manifest that reuses a builtin id shadows it and records provenance', () => {
  const cwd = freshProject();
  writeProjectProcedure(cwd, 'evidence-ingest.manifest.json', {
    id: 'evidence-ingest',
    version: '2.0.0',
    type: 'linear',
    approvalMode: 'requires-human-approval',
    modelTier: 'strong',
    state: 'active',
    workerProfiles: ['security'],
    description: 'Project override of evidence-ingest (LMCP-D3 functional test).',
    owner: 'd3-fixture-test',
  });

  const { procedures } = loadAllProcedures({ rootDir: cwd });
  const winner = procedures.find((p) => p.id === 'evidence-ingest');
  assert.ok(winner, 'expected evidence-ingest in merged Procedure catalog');
  assert.equal(winner._source, 'project');
  assert.deepEqual(winner.workerProfiles, ['security'], 'project override workerProfiles should win');
  assert.match(winner._filePath, /evidence-ingest\.manifest\.json$/);
  assert.ok(winner._shadowedBy?.length >= 1, 'expected the shadowed builtin entry to be recorded');
  assert.equal(winner._shadowedBy[0].source, 'builtin');
  assert.match(winner._shadowedBy[0].filePath, /registry[/\\]procedures[/\\]evidence-ingest\.json$/);
});
