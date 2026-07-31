/**
 * tests/functional/author-artifact-context-targets.functional.test.mjs —
 * author_artifact context_targets binding.
 *
 * @capability research.cross-project-synthesis
 *
 * The `sources add` step runs the real binary in a mkdtemp project (to write a
 * schema-valid config); the author_artifact tool is then driven in-process.
 * Asserts:
 *   AC4  a valid context_targets author pass produces an artifact that PASSES
 *        the normal release gate (context binding does not break authoring).
 *   R3   a bogus context id is a hard error before authoring, naming the known
 *        targets — no artifact is written.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { authorArtifact } from '../../lib/mcp/tools/artifact-author.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

const dirs = [];

// In-process authorArtifact reaches the machine-scoped state root through the
// real HOME (observation-store vectorClientFor), so the whole process gets a
// redirected CONSTRUCT_HOME_OVERRIDE or every tmp fixture registers a real
// ~/.construct/projects key.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-authorctx-home-'));
const originalHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;

test.after(() => {
  if (originalHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = originalHomeOverride;
  try { rmTmpDir(homeOverride); } catch {}
  for (const d of dirs) { try { rmTmpDir(d); } catch {} }
});

function projectWithTarget() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-authorctx-'));
  dirs.push(cwd);
  const docs = path.join(cwd, 'app-docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 's.md'), '# App\n\nApp strategy: land-and-expand growth.\n');
  const add = spawnSync(process.execPath, [BIN, 'sources', 'add', 'directory', 'proj-app', JSON.stringify({ path: docs })], {
    cwd, encoding: 'utf8', env: { ...process.env, HOME: cwd, USERPROFILE: cwd },
  });
  assert.equal(add.status, 0, `sources add failed: ${add.stderr}`);
  return { cwd };
}

const DRAFT = [
  '# Cross summary of app',
  '',
  'This document summarizes the app strategy across the bound project. The app pursues a land-and-expand growth motion per proj-app:s.md, stated here as a full paragraph of prose so the release gate\'s prose floor is satisfied.',
  '',
  '## Summary',
  '',
  'The app strategy is land-and-expand, drawn from proj-app:s.md and written here as a second narrative paragraph to comfortably clear the citation and prose minimums the adhoc gate enforces.',
  '',
  '[unverified]',
  '',
].join('\n');

test('AC4: a valid context_targets author pass passes the release gate', async () => {
  const { cwd } = projectWithTarget();
  const res = await authorArtifact({
    artifact_type: 'adhoc', title: 'Cross summary of app', instructions: 'summarize app strategy',
    draft_markdown: DRAFT, context_targets: ['proj-app'], cwd,
  }, { ROOT_DIR: REPO });
  assert.equal(res.ok, true, `author failed: ${JSON.stringify(res.errors)}`);
  assert.equal(res.gate, 'PASS', `gate did not pass: ${JSON.stringify(res.errors)}`);
  assert.ok(res.path, 'artifact written to a path');
  assert.ok(Array.isArray(res.recruited), 'result carries the recruited participants field (construct-pteo2.8)');
});

test('R3: a bogus context id is a hard error before authoring', async () => {
  const { cwd } = projectWithTarget();
  const res = await authorArtifact({
    artifact_type: 'adhoc', title: 'X', instructions: 'y',
    draft_markdown: DRAFT, context_targets: ['proj-nope'], cwd,
  }, { ROOT_DIR: REPO });
  assert.equal(res.ok, false, 'unknown context id must fail');
  assert.equal(res.status, 'invalid-context-target');
  assert.match(res.errors[0], /unknown context target "proj-nope"/);
  assert.match(res.errors[0], /proj-app/, 'names the known target');
});
