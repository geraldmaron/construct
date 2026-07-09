/**
 * tests/functional/doctor-source-targets.functional.test.mjs —
 * source-target health in `construct doctor` (bead construct-760c.8, epic closer).
 *
 * @capability sources.doctor-health
 *
 * Drives the real binary (pattern: doctor-probe-providers.functional.test.mjs)
 * under a fetch-spy that records every outbound request. Asserts:
 *   AC1  a directory target whose path was deleted is flagged with an actionable
 *        message, and a corpus cache aged past its TTL is flagged with
 *        `construct sources sync <id>`.
 *   AC2  a project with healthy targets reports them healthy; a project with zero
 *        targets emits no source-target line (no noise).
 *   AC3  a default doctor run with targets configured makes zero network calls.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

const PRELOAD = path.join(os.tmpdir(), `cx-doctor-st-spy-${process.pid}.mjs`);
fs.writeFileSync(PRELOAD, `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url) => {
  try { appendFileSync(process.env.FETCH_SPY_OUT, String(url) + '\\n'); } catch {}
  return { status: 200, ok: true, json: async () => ({}), text: async () => '' };
};
`);
test.after(() => { try { fs.rmSync(PRELOAD, { force: true }); } catch {} });

function git(cwd, args) { execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] }); }

function makeBareRepo() {
  const src = freshDir('cx-st-src-');
  git(src, ['init', '-q', '-b', 'main']);
  git(src, ['config', 'user.email', 't@c.dev']);
  git(src, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(src, 'README.md'), '# Corpus\n');
  git(src, ['add', '-A']);
  git(src, ['commit', '-qm', 'init']);
  const bare = freshDir('cx-st-bare-');
  execFileSync('git', ['clone', '-q', '--bare', src, bare], { stdio: ['ignore', 'ignore', 'ignore'] });
  return `file://${bare}`;
}

function runCx(cwd, args) {
  const spyOut = path.join(cwd, `fc-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(spyOut, '');
  const res = spawnSync(process.execPath, ['--import', PRELOAD, BIN, ...args], {
    cwd, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd, FETCH_SPY_OUT: spyOut, GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_REPOS: '' },
  });
  const calls = fs.readFileSync(spyOut, 'utf8').split('\n').filter(Boolean);
  return { ...res, calls };
}

test('AC2/AC3: healthy targets report healthy with zero network', () => {
  const cwd = freshDir('cx-st-proj-');
  const docs = path.join(cwd, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'a.md'), '# A\n');
  runCx(cwd, ['sources', 'add', 'directory', 'proj-app', JSON.stringify({ path: docs })]);

  const doc = runCx(cwd, ['doctor']);
  assert.match(doc.stdout, /Source targets healthy \(1 configured\)/);
  assert.deepEqual(doc.calls, [], 'doctor makes no network calls with targets configured');
});

test('AC2: a project with zero targets emits no source-target line', () => {
  const cwd = freshDir('cx-st-empty-');
  const doc = runCx(cwd, ['doctor']);
  assert.doesNotMatch(doc.stdout, /Source target/i, 'no source-target noise when none are registered');
});

test('AC1: a deleted directory-target path is flagged with an actionable message', () => {
  const cwd = freshDir('cx-st-broken-');
  const docs = path.join(cwd, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'a.md'), '# A\n');
  runCx(cwd, ['sources', 'add', 'directory', 'proj-app', JSON.stringify({ path: docs })]);
  fs.rmSync(docs, { recursive: true, force: true });

  const doc = runCx(cwd, ['doctor']);
  assert.match(doc.stdout, /Source target proj-app \(directory\) path missing/);
  assert.match(doc.stdout, /construct sources remove proj-app/, 'actionable recovery hint');
  assert.deepEqual(doc.calls, [], 'still zero network');
});

test('AC1: a corpus cache aged past TTL is flagged with a sync hint', () => {
  const cwd = freshDir('cx-st-corpus-');
  const remote = makeBareRepo();
  runCx(cwd, ['sources', 'add', 'github', 'proj-sdk', JSON.stringify({ repo: 'acme/sdk', content: { mode: 'corpus', ref: 'main', remote } })]);
  const sync = runCx(cwd, ['sources', 'sync', 'proj-sdk']);
  assert.equal(sync.status, 0, `sync failed: ${sync.stderr}`);

  const stateProjects = path.join(cwd, '.construct', 'projects');
  const key = fs.readdirSync(stateProjects)[0];
  const metaPath = path.join(stateProjects, key, 'context-repos', 'proj-sdk.meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.lastFetch = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  const doc = runCx(cwd, ['doctor']);
  assert.match(doc.stdout, /Source target proj-sdk \(corpus\) cache is stale/);
  assert.match(doc.stdout, /construct sources sync proj-sdk/, 'actionable sync hint');
  assert.deepEqual(doc.calls, [], 'stale-cache check makes no network calls');
});
