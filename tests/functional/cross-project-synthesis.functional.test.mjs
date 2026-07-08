/**
 * tests/functional/cross-project-synthesis.functional.test.mjs —
 * cross-project synthesis map-reduce with a deterministic dry-run (bead construct-760c.3).
 *
 * @capability research.cross-project-synthesis
 *
 * Drives the real `bin/construct synthesize` binary in a mkdtemp project with two
 * registered directory targets carrying distinct marker strategies. Exercises the
 * `--dry-run` context assembly (LLM-free, CI-safe):
 *
 *   AC1  output has one attributed section per project citing origins, plus a
 *        convergence section (in the reduce prompt).
 *   AC2  the request succeeds both with and without `--template`.
 *   AC3  `--dry-run` output is deterministic across runs and contains zero LLM
 *        output (no answer, just assembled context + the reduce prompt).
 *   R3   an unknown project id is a hard error before any model call.
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

function twoStrategyProjects() {
  const cwd = freshDir('cx-synth-proj-');
  const app = path.join(cwd, 'app-docs');
  const sdk = path.join(cwd, 'sdk-docs');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(sdk, { recursive: true });
  fs.writeFileSync(path.join(app, 'strategy.md'), '# App strategy\n\nThe app strategy centers on quorvexgrowth: land-and-expand adoption.\n');
  fs.writeFileSync(path.join(sdk, 'strategy.md'), '# SDK strategy\n\nThe sdk strategy centers on plizanticapi: developer-first API surface.\n');
  runCx(cwd, ['sources', 'add', 'directory', 'proj-app', JSON.stringify({ path: app })]);
  runCx(cwd, ['sources', 'add', 'directory', 'proj-sdk', JSON.stringify({ path: sdk })]);
  return { cwd };
}

test('AC1/AC3: dry-run assembles attributed per-project sections + convergence prompt, no LLM output', () => {
  const { cwd } = twoStrategyProjects();
  const res = runCx(cwd, ['synthesize', '--ask=compare the strategies', '--projects=all', '--dry-run']);
  assert.equal(res.status, 0, `synthesize failed: ${res.stderr}`);
  const out = res.stdout;
  assert.match(out, /## Project: proj-app/, 'section for proj-app');
  assert.match(out, /## Project: proj-sdk/, 'section for proj-sdk');
  assert.match(out, /quorvexgrowth/, 'app marker content present');
  assert.match(out, /plizanticapi/, 'sdk marker content present');
  assert.match(out, /`proj-app:strategy\.md`/, 'app citation carries origin project:path');
  assert.match(out, /`proj-sdk:strategy\.md`/, 'sdk citation carries origin project:path');
  assert.match(out, /## Citations/, 'citation table present');
  assert.match(out, /## Convergence/, 'convergence section in the reduce prompt');
  assert.match(out, /Reduce prompt \(not sent in --dry-run\)/, 'reduce prompt shown but not sent');
});

test('AC3: dry-run is deterministic across runs', () => {
  const { cwd } = twoStrategyProjects();
  const a = runCx(cwd, ['synthesize', '--ask=compare the strategies', '--projects=all', '--dry-run']);
  const b = runCx(cwd, ['synthesize', '--ask=compare the strategies', '--projects=all', '--dry-run']);
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  assert.equal(a.stdout, b.stdout, 'identical assembled context across runs');
});

test('AC2: succeeds with and without --template (template shapes convergence headings)', () => {
  const { cwd } = twoStrategyProjects();
  const withT = runCx(cwd, ['synthesize', '--ask=compare', '--projects=all', '--template=strategy-comparison', '--dry-run']);
  assert.equal(withT.status, 0, `templated synthesize failed: ${withT.stderr}`);
  assert.match(withT.stdout, /## Divergence/, 'template contributes its Divergence heading to the reduce prompt');
  assert.match(withT.stdout, /## Recommendation/, 'template Recommendation heading');

  const withoutT = runCx(cwd, ['synthesize', '--ask=compare', '--projects=all', '--dry-run']);
  assert.equal(withoutT.status, 0, 'untemplated synthesize also succeeds');
});

test('R3: an unknown project id is a hard error before any model call', () => {
  const { cwd } = twoStrategyProjects();
  const res = runCx(cwd, ['synthesize', '--ask=compare', '--projects=proj-nope', '--dry-run']);
  assert.notEqual(res.status, 0, 'unknown project must fail');
  assert.match(`${res.stdout}${res.stderr}`, /unknown project "proj-nope"/, 'message names the bad id');
});

test('--projects filter narrows the synthesis to the named project', () => {
  const { cwd } = twoStrategyProjects();
  const res = runCx(cwd, ['synthesize', '--ask=compare', '--projects=proj-app', '--dry-run']);
  assert.equal(res.status, 0, `scoped synthesize failed: ${res.stderr}`);
  assert.match(res.stdout, /## Project: proj-app/, 'named project present');
  assert.doesNotMatch(res.stdout, /## Project: proj-sdk/, 'other project excluded');
});
