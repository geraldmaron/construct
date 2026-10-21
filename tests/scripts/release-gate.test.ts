/** Public release boundary regressions; synthetic fixtures never establish native qualification. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRelease, repositoryFile } from '../../scripts/release-gate.mjs';

test('evidence paths cannot escape the repository through traversal or symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-gate-')),
    outside = mkdtempSync(join(tmpdir(), 'release-out-'));
  try {
    writeFileSync(join(root, 'good'), 'ok');
    writeFileSync(join(outside, 'secret'), 'outside');
    symlinkSync(join(outside, 'secret'), join(root, 'link'));
    assert.equal(repositoryFile(root, 'good').toString(), 'ok');
    for (const p of ['../secret', '/secret', 'a/../../secret', 'link']) assert.throws(() => repositoryFile(root, p));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
test('release CI retains code gates and requires exact-package delivery evidence', () => {
  const y = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  for (const cmd of [
    'npm ci',
    'npm run lint',
    'npm run typecheck',
    'npm test',
    'npm run smoke',
    'npm run release:check -- --manifest=delivery/bundle/manifest.json --tarball=',
    'npm publish "${{ steps.candidate.outputs.path }}" --provenance --tag alpha',
  ])
    assert.ok(y.includes(cmd), cmd);
  assert.ok(y.indexOf('release:check') < y.indexOf('npm publish'));
});

test('retired experimental and qualified tiers cannot consume historical records', async () => {
  for (const tier of ['experimental-alpha', 'qualified']) {
    const result = await checkRelease({ tier, root: '/does-not-exist' });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(), /retired; use delivery with --manifest and --tarball/);
  }
  assert.equal((await checkRelease({ tier: 'unknown' })).ok, false);
});
