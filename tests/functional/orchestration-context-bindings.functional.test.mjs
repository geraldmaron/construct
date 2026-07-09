/**
 * tests/functional/orchestration-context-bindings.functional.test.mjs —
 * structured context-target bindings for orchestration runs (bead construct-760c.4).
 *
 * @capability orchestration.context-bindings
 *
 * Drives the real `bin/construct orchestrate run` binary in a mkdtemp project
 * with a registered directory source target:
 *
 *   AC1/R2  `--context=<id>` resolves the binding onto the run, and the persisted
 *           run record (re-read via `orchestrate status`) still carries it.
 *   AC2/R4  a bogus id is rejected at plan time with a message naming the id and
 *           the known targets, exiting non-zero — no run is created.
 *   AC3     omission plans a run whose contextBindings is empty (byte-identical
 *           to a pre-B4 record shape).
 *   AC4     a bound directory target resolves a `contentRoot`, so the run's
 *           retrieval path can reach the docs.
 *
 * `--no-execute` keeps the run at plan stage — LLM-free, no provider key.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const dirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function runCx(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd, GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_REPOS: '' },
  });
}

function projectWithTarget() {
  const cwd = freshDir('cx-ctxbind-proj-');
  const docs = path.join(cwd, 'app-docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'README.md'), '# App\n\nApp docs corpus.\n');
  const add = runCx(cwd, ['sources', 'add', 'directory', 'proj-app', JSON.stringify({ path: docs })]);
  assert.equal(add.status, 0, `sources add failed: ${add.stderr}`);
  return { cwd, docs };
}

test('AC1/AC4/R2: --context binds a directory target with contentRoot and persists on the run', () => {
  const { cwd, docs } = projectWithTarget();
  const res = runCx(cwd, ['orchestrate', 'run', 'analyze the app', '--no-execute', '--context=proj-app:reference', '--json']);
  assert.equal(res.status, 0, `orchestrate run failed: ${res.stderr}`);
  const run = JSON.parse(res.stdout);
  assert.ok(Array.isArray(run.contextBindings) && run.contextBindings.length === 1, 'one binding resolved');
  const b = run.contextBindings[0];
  assert.equal(b.id, 'proj-app');
  assert.equal(b.provider, 'directory');
  assert.equal(b.role, 'reference', 'free-form role threaded through (R3)');
  assert.equal(b.contentRoot, docs, 'directory target resolves a reachable contentRoot (AC4)');

  const status = runCx(cwd, ['orchestrate', 'status', run.runId, '--json']);
  assert.equal(status.status, 0, `status failed: ${status.stderr}`);
  const persisted = JSON.parse(status.stdout);
  assert.equal(persisted.contextBindings?.[0]?.id, 'proj-app', 'binding persisted on the run record (R2)');
});

test('AC2/R4: a bogus context id is rejected at plan time naming the known targets', () => {
  const { cwd } = projectWithTarget();
  const res = runCx(cwd, ['orchestrate', 'run', 'analyze', '--no-execute', '--context=proj-nope']);
  assert.notEqual(res.status, 0, 'unknown context id must fail, not plan a partial run');
  assert.match(`${res.stdout}${res.stderr}`, /unknown context target "proj-nope"/, 'message must name the bad id');
  assert.match(`${res.stdout}${res.stderr}`, /proj-app/, 'message must list the known target');
});

test('AC3: omitting --context plans a run with an empty contextBindings', () => {
  const { cwd } = projectWithTarget();
  const res = runCx(cwd, ['orchestrate', 'run', 'analyze', '--no-execute', '--json']);
  assert.equal(res.status, 0, `orchestrate run failed: ${res.stderr}`);
  const run = JSON.parse(res.stdout);
  assert.deepEqual(run.contextBindings, [], 'no bindings when --context is omitted');
});
