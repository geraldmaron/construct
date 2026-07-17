/**
 * tests/functional/source-links.functional.test.mjs
 *
 * construct-wjap9.2: `construct sources link/unlink` writes the durable
 * `sources:` frontmatter block onto an artifact; lib/graph/build-source-links.mjs
 * turns it into `doc:<path> --derived_from--> source:<targetId>` graph edges
 * on the next `construct graph build`. Exercises both halves against the
 * real `bin/construct` binary in a mkdtemp project — no network.
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

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function makeBareRepo() {
  const src = freshDir('cx-links-src-');
  git(src, ['init', '-q', '-b', 'main']);
  git(src, ['config', 'user.email', 'test@construct.dev']);
  git(src, ['config', 'user.name', 'Construct Test']);
  fs.writeFileSync(path.join(src, 'README.md'), '# Docs\n');
  git(src, ['add', '-A']);
  git(src, ['commit', '-qm', 'init']);
  const bare = freshDir('cx-links-bare-');
  execFileSync('git', ['clone', '-q', '--bare', src, bare], { stdio: ['ignore', 'ignore', 'ignore'] });
  return `file://${bare}`;
}

function runCx(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd, GITHUB_TOKEN: '', GH_TOKEN: '' },
  });
}

function projectWithTarget() {
  const cwd = freshDir('cx-links-proj-');
  const bareUrl = makeBareRepo();
  const add = runCx(cwd, ['sources', 'add', 'git', 'platform-docs', JSON.stringify({ remote: bareUrl, content: { mode: 'corpus', ref: 'main' } })]);
  assert.equal(add.status, 0, `source add failed: ${add.stderr}`);
  return { cwd, bareUrl };
}

test('sources link: rejects an artifact that does not exist', () => {
  const { cwd } = projectWithTarget();
  const res = runCx(cwd, ['sources', 'link', 'docs/specs/prd/does-not-exist.md', 'platform-docs']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /No such file/);
});

test('sources link: rejects an unknown target id', () => {
  const { cwd } = projectWithTarget();
  fs.mkdirSync(path.join(cwd, 'docs', 'specs', 'prd'), { recursive: true });
  const artifact = path.join(cwd, 'docs', 'specs', 'prd', 'checkout.md');
  fs.writeFileSync(artifact, '# Checkout PRD\n');
  const res = runCx(cwd, ['sources', 'link', 'docs/specs/prd/checkout.md', 'nope']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /No such source target/);
});

test('sources link: adds a sources: frontmatter block to a file with no prior frontmatter', () => {
  const { cwd } = projectWithTarget();
  fs.mkdirSync(path.join(cwd, 'docs', 'specs', 'prd'), { recursive: true });
  const relPath = path.join('docs', 'specs', 'prd', 'checkout.md');
  const artifact = path.join(cwd, relPath);
  fs.writeFileSync(artifact, '# Checkout PRD\n\nBody content.\n');

  const link = runCx(cwd, ['sources', 'link', relPath, 'platform-docs']);
  assert.equal(link.status, 0, `link failed: ${link.stderr}`);

  const raw = fs.readFileSync(artifact, 'utf8');
  assert.match(raw, /^---\n/);
  assert.match(raw, /sources:/);
  assert.match(raw, /target: platform-docs/);
  assert.match(raw, /# Checkout PRD\n\nBody content\.\n$/, 'body is preserved byte-for-byte after the frontmatter');
});

test('sources link: preserves existing unrelated frontmatter fields', () => {
  const { cwd } = projectWithTarget();
  fs.mkdirSync(path.join(cwd, 'docs', 'specs', 'prd'), { recursive: true });
  const relPath = path.join('docs', 'specs', 'prd', 'checkout.md');
  const artifact = path.join(cwd, relPath);
  fs.writeFileSync(artifact, '---\ntitle: Checkout PRD\nstatus: draft\n---\n# Checkout PRD\n');

  const link = runCx(cwd, ['sources', 'link', relPath, 'platform-docs']);
  assert.equal(link.status, 0, `link failed: ${link.stderr}`);

  const raw = fs.readFileSync(artifact, 'utf8');
  assert.match(raw, /title: Checkout PRD/);
  assert.match(raw, /status: draft/);
  assert.match(raw, /target: platform-docs/);
  assert.match(raw, /# Checkout PRD\n$/);
});

test('sources link then unlink: round-trips back to no sources: block', () => {
  const { cwd } = projectWithTarget();
  fs.mkdirSync(path.join(cwd, 'docs', 'specs', 'prd'), { recursive: true });
  const relPath = path.join('docs', 'specs', 'prd', 'checkout.md');
  const artifact = path.join(cwd, relPath);
  fs.writeFileSync(artifact, '# Checkout PRD\n');

  const link = runCx(cwd, ['sources', 'link', relPath, 'platform-docs']);
  assert.equal(link.status, 0, `link failed: ${link.stderr}`);
  assert.match(fs.readFileSync(artifact, 'utf8'), /sources:/);

  const unlink = runCx(cwd, ['sources', 'unlink', relPath, 'platform-docs']);
  assert.equal(unlink.status, 0, `unlink failed: ${unlink.stderr}`);
  const raw = fs.readFileSync(artifact, 'utf8');
  assert.doesNotMatch(raw, /sources:/, 'the sources: block is removed once empty');
  assert.match(raw, /^# Checkout PRD\n$/, 'no dangling frontmatter fence left behind');
});

test('sources unlink: errors when the artifact has no link to that target', () => {
  const { cwd } = projectWithTarget();
  fs.mkdirSync(path.join(cwd, 'docs', 'specs', 'prd'), { recursive: true });
  const relPath = path.join('docs', 'specs', 'prd', 'checkout.md');
  fs.writeFileSync(path.join(cwd, relPath), '# Checkout PRD\n');

  const res = runCx(cwd, ['sources', 'unlink', relPath, 'platform-docs']);
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /has no link to/);
});

test('construct graph build: a linked PRD produces a derived_from edge to the source node', () => {
  const { cwd } = projectWithTarget();
  fs.mkdirSync(path.join(cwd, 'docs', 'specs', 'prd'), { recursive: true });
  const relPath = path.join('docs', 'specs', 'prd', 'checkout.md');
  fs.writeFileSync(path.join(cwd, relPath), '# Checkout PRD\n');

  const link = runCx(cwd, ['sources', 'link', relPath, 'platform-docs', '--pinned', 'abc1234']);
  assert.equal(link.status, 0, `link failed: ${link.stderr}`);

  const build = runCx(cwd, ['graph', 'build']);
  assert.equal(build.status, 0, `graph build failed: ${build.stderr}`);

  const edgesPath = path.join(cwd, '.construct', 'graph', 'edges.jsonl');
  const edges = fs.readFileSync(edgesPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const edge = edges.find((e) => e.rel === 'derived_from' && e.to === 'source:platform-docs');
  assert.ok(edge, 'expected a derived_from edge to source:platform-docs');
  assert.equal(edge.from, `doc:${relPath}`);
  assert.deepEqual(edge.sources, ['source-link']);
  assert.equal(edge.attrs?.pinned, 'abc1234');

  const nodesPath = path.join(cwd, '.construct', 'graph', 'nodes.jsonl');
  const nodes = fs.readFileSync(nodesPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(nodes.some((n) => n.id === 'source:platform-docs' && n.type === 'source'));
});
