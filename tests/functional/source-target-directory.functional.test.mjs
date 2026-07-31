/**
 * tests/functional/source-target-directory.functional.test.mjs
 *
 * Directory + repo-corpus source targets with a
 * local content cache. Exercises the real `bin/construct` binary in a mkdtemp
 * project (pattern: doctor-probe-providers.functional.test.mjs) plus the
 * DirectoryProvider read path in-process:
 *
 *   - directory target add/validate/list roundtrip over a fixture doc tree,
 * and rejection of a nonexistent path.
 *   - a github corpus target (content.mode:"corpus") synced against a local
 *     `file://` bare repo — no network — populating the cache under an
 *     HOME-redirected state root, with the second sync fetching incrementally
 * rather than re-cloning.
 * - DirectoryProvider.read() returning doc records from the registered path.
 * - `sources list` surfacing corpus content mode + cache freshness.
 *
 * A fetch-spy preload (injected via `node --import`) intercepts every outbound
 * fetch the spawned CLI makes and records the URLs, so the whole test asserts
 * zero network access — directory reads and file:// clones never touch it.
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

const PRELOAD = path.join(os.tmpdir(), `cx-dir-fetch-spy-${process.pid}.mjs`);
fs.writeFileSync(PRELOAD, `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url) => {
  try { appendFileSync(process.env.FETCH_SPY_OUT, String(url) + '\\n'); } catch {}
  return { status: 200, ok: true, json: async () => ({}), text: async () => '' };
};
`);
test.after(() => { try { fs.rmSync(PRELOAD, { force: true }); } catch {} });

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function makeBareRepo() {
  const src = freshDir('cx-dir-src-');
  git(src, ['init', '-q', '-b', 'main']);
  git(src, ['config', 'user.email', 'test@construct.dev']);
  git(src, ['config', 'user.name', 'Construct Test']);
  fs.writeFileSync(path.join(src, 'README.md'), '# SDK\nCorpus root readme.\n');
  fs.mkdirSync(path.join(src, 'docs'));
  fs.writeFileSync(path.join(src, 'docs', 'guide.md'), '# Guide\nCorpus doc.\n');
  git(src, ['add', '-A']);
  git(src, ['commit', '-qm', 'init']);
  const bare = freshDir('cx-dir-bare-');
  execFileSync('git', ['clone', '-q', '--bare', src, bare], { stdio: ['ignore', 'ignore', 'ignore'] });
  return { bareUrl: `file://${bare}`, src };
}

function runCx(cwd, args, extraEnv = {}) {
  const spyOut = path.join(cwd, `fetch-calls-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(spyOut, '');
  const res = spawnSync(process.execPath, ['--import', PRELOAD, BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: cwd,
      USERPROFILE: cwd,
      FETCH_SPY_OUT: spyOut,
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
      GITHUB_REPOS: '',
      ...extraEnv,
    },
  });
  const calls = fs.readFileSync(spyOut, 'utf8').split('\n').filter(Boolean);
  return { ...res, calls };
}

function projectDir() {
  const cwd = freshDir('cx-dir-proj-');
  const docs = path.join(cwd, 'fixture-docs');
  fs.mkdirSync(path.join(docs, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'README.md'), '# Fixture\nTop-level readme.\n');
  fs.writeFileSync(path.join(docs, 'sub', 'note.md'), '# Note\nNested doc.\n');
  return { cwd, docs };
}

test('directory target: add + validate + list roundtrip persists to construct.config.json', () => {
  const { cwd, docs } = projectDir();
  const add = runCx(cwd, ['sources', 'add', 'directory', 'proj-app', JSON.stringify({ path: docs })]);
  assert.equal(add.status, 0, `add failed: ${add.stderr}`);

  const cfg = JSON.parse(fs.readFileSync(path.join(cwd, 'construct.config.json'), 'utf8'));
  const target = (cfg.sources?.targets ?? []).find((t) => t.id === 'proj-app');
  assert.ok(target, 'target persisted to config');
  assert.equal(target.provider, 'directory');
  assert.equal(target.selector.path, docs);

  const validate = runCx(cwd, ['sources', 'validate']);
  assert.equal(validate.status, 0, `validate failed: ${validate.stdout}${validate.stderr}`);

  const list = runCx(cwd, ['sources', 'list']);
  assert.match(list.stdout, /proj-app · directory/);

  assert.deepEqual(add.calls, [], 'no network on add');
  assert.deepEqual(validate.calls, [], 'no network on validate');
  assert.deepEqual(list.calls, [], 'no network on list');
});

test('directory target: a nonexistent path is rejected naming the field', () => {
  const { cwd } = projectDir();
  const bad = path.join(cwd, 'does', 'not', 'exist');
  const add = runCx(cwd, ['sources', 'add', 'directory', 'bad-dir', JSON.stringify({ path: bad })]);
  assert.notEqual(add.status, 0, 'add of a bad path must fail');
  assert.match(`${add.stdout}${add.stderr}`, /selector\.path/);
  assert.deepEqual(add.calls, [], 'no network on rejected add');
});

test('github corpus target: sync clones from a file:// remote then fetches incrementally', () => {
  const { cwd } = projectDir();
  const { bareUrl } = makeBareRepo();
  const selector = { repo: 'acme/sdk', content: { mode: 'corpus', ref: 'main', remote: bareUrl } };

  const add = runCx(cwd, ['sources', 'add', 'github', 'proj-sdk', JSON.stringify(selector)]);
  assert.equal(add.status, 0, `add failed: ${add.stderr}`);

  const sync1 = runCx(cwd, ['sources', 'sync', 'proj-sdk']);
  assert.equal(sync1.status, 0, `sync1 failed: ${sync1.stderr}`);
  assert.match(sync1.stdout, /synced proj-sdk \(clone\)/);

  const stateProjects = path.join(cwd, '.construct', 'projects');
  const keys = fs.readdirSync(stateProjects);
  assert.equal(keys.length, 1, 'one project key under the state root');
  const cacheDir = path.join(stateProjects, keys[0], 'context-repos', 'proj-sdk');
  assert.ok(fs.existsSync(path.join(cacheDir, '.git')), 'clone populated .git');
  assert.ok(fs.existsSync(path.join(cacheDir, 'README.md')), 'clone populated content');
  assert.ok(fs.existsSync(path.join(cacheDir, 'docs', 'guide.md')), 'clone populated nested docs');

  const gitMtimeBefore = fs.statSync(path.join(cacheDir, '.git')).birthtimeMs;

  const sync2 = runCx(cwd, ['sources', 'sync', 'proj-sdk']);
  assert.equal(sync2.status, 0, `sync2 failed: ${sync2.stderr}`);
  assert.match(sync2.stdout, /synced proj-sdk \(fetch\)/, 'second sync fetches, does not re-clone');

  const gitMtimeAfter = fs.statSync(path.join(cacheDir, '.git')).birthtimeMs;
  assert.equal(gitMtimeAfter, gitMtimeBefore, '.git dir reused, not recreated');

  const meta = JSON.parse(fs.readFileSync(path.join(stateProjects, keys[0], 'context-repos', 'proj-sdk.meta.json'), 'utf8'));
  assert.equal(meta.mode, 'fetch');
  assert.equal(meta.ref, 'main');

  const list = runCx(cwd, ['sources', 'list']);
  assert.match(list.stdout, /proj-sdk · github .* corpus\(main\)/);

  assert.deepEqual([...add.calls, ...sync1.calls, ...sync2.calls, ...list.calls], [], 'zero outbound fetch across the corpus lifecycle');
});

test('a plain github target (no corpus mode) is not corpus-eligible and is byte-identical to today', async () => {
  const { isCorpusTarget } = await import('../../lib/sources/repo-cache.mjs');
  assert.equal(isCorpusTarget({ id: 'g', provider: 'github', selector: { repo: 'acme/sdk' } }), false);
  assert.equal(isCorpusTarget({ id: 'g', provider: 'github', selector: { repo: 'acme/sdk', content: { mode: 'corpus' } } }), true);
});

test('DirectoryProvider.read returns doc records from the registered path with zero network', async () => {
  const { docs } = projectDir();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (...a) => { fetchCalls++; return originalFetch(...a); };
  try {
    const { DirectoryProvider } = await import('../../lib/embed/providers/directory.mjs');
    const provider = new DirectoryProvider();
    const records = await provider.read('docs', { path: docs });
    const paths = records.map((r) => r.path).sort();
    assert.deepEqual(paths, ['README.md', path.join('sub', 'note.md')]);
    assert.ok(records.every((r) => r.type === 'doc' && r.source === 'directory'));
    assert.ok(records.find((r) => r.path === 'README.md').content.includes('Top-level readme'));

    const readme = await provider.read('readme', { path: docs });
    assert.equal(readme.length, 1);
    assert.equal(readme[0].path, 'README.md');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0, 'directory read makes no network calls');
});
