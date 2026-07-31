/**
 * Release metadata has one version source and no checked-in formula snapshot.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));

// The invariant is that the three mirrors agree, so package.json is the one
// source and the rest are checked against it. Restating the number here would
// make this a fourth copy — one that fails every release until it is chased,
// which says nothing about whether the mirrors that ship are consistent.

test('package, lockfile root, and launcher pin agree on the release version', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const launcherVersion = fs.readFileSync(path.join(ROOT, '.construct', 'launcher', 'version'), 'utf8').trim();

  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(launcherVersion, pkg.version);
});

test('the executable release workflow generates Homebrew metadata from the tag', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /VERSION="\$\{TAG#v\}"/);
  assert.match(workflow, /version "\$\{VERSION\}"/);
  assert.match(workflow, /gh release download "\$TAG"/);
  assert.match(workflow, /cp \/tmp\/construct\.rb \/tmp\/tap\/Formula\/construct\.rb/);
});

test('stale source-repository Homebrew formula snapshots are absent', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'Formula')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'templates', 'homebrew', 'construct.rb')), false);
});

test('npm publish allowlist has no redundant nested template entry', () => {
  const pkg = readJson('package.json');
  assert.ok(pkg.files.includes('templates/**'));
  assert.ok(!pkg.files.includes('templates/distribution/**'));
});
