/**
 * tests/certification/stale-impact.test.mjs — certification stale marking on ledger path changes.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyStaleImpact,
  capabilitiesForChangedPaths,
  pathMatchesChangePath,
  certificationStatusPath,
  staleCapabilitiesFromChange,
} from '../../lib/certification/stale-impact.mjs';
import { computeImpact } from '../../lib/graph/impact.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function projectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-impact-'));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, '.cx', 'certification'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'capabilities'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, 'tests', 'capabilities', 'ledger.json'),
    path.join(root, 'tests', 'capabilities', 'ledger.json'),
  );
  return root;
}

test('pathMatchesChangePath supports exact and glob ledger paths', () => {
  assert.equal(pathMatchesChangePath('lib/artifact-release-gate.mjs', 'lib/artifact-release-gate.mjs'), true);
  assert.equal(pathMatchesChangePath('templates/demos/tapes/foo.tape', 'templates/demos/tapes/**'), true);
  assert.equal(pathMatchesChangePath('README.md', 'lib/artifact-release-gate.mjs'), false);
});

test('mapped ledger changePaths mark certification evidence stale', () => {
  const root = projectRoot();
  const result = applyStaleImpact({
    rootDir: root,
    changedFiles: ['lib/artifact-release-gate.mjs'],
    now: () => '2026-06-22T00:00:00.000Z',
  });
  assert.ok(result.markedCapabilities.includes('artifact.release-gate'));
  const status = JSON.parse(fs.readFileSync(certificationStatusPath(root), 'utf8'));
  assert.equal(status.capabilities['artifact.release-gate'].status, 'stale');
  assert.match(status.capabilities['artifact.release-gate'].staleReason, /artifact-release-gate/);
});

test('unrelated file changes do not mark capabilities stale', () => {
  const root = projectRoot();
  const result = applyStaleImpact({
    rootDir: root,
    changedFiles: ['README.md'],
    now: () => '2026-06-22T00:00:00.000Z',
  });
  assert.deepEqual(result.markedCapabilities, []);
  const matched = capabilitiesForChangedPaths(['README.md'], { rootDir: root });
  assert.equal(matched.size, 0);
});

test('computeImpact rolls up stale capabilities from ledger changePaths', () => {
  const stale = staleCapabilitiesFromChange({
    rootDir: REPO,
    changedFiles: ['lib/artifact-manifest.mjs'],
  });
  assert.ok(stale.includes('artifact.release-gate'));

  const impact = computeImpact({
    rootDir: REPO,
    changedFiles: ['lib/artifact-manifest.mjs'],
  });
  assert.ok(impact.staleCapabilities.includes('artifact.release-gate'));
});
