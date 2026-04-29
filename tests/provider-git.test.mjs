/**
 * tests/provider-git.test.mjs — git provider tests.
 *
 * Uses the construct repo itself as the test fixture (it's a git repo).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runContractTests } from '../providers/lib/contract-tests.mjs';
import provider from '../providers/git/index.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

runContractTests(provider);

describe('git provider — functional', () => {
  before(async () => {
    await provider.init({ cwd: ROOT });
  });

  it('reads recent commits', async () => {
    const commits = await provider.read('commits:5');
    assert.ok(Array.isArray(commits));
    assert.ok(commits.length > 0);
    assert.ok(commits[0].hash?.length === 40 || commits[0].hash?.length === 64);
    assert.equal(commits[0].type, 'commit');
  });

  it('reads branches', async () => {
    const branches = await provider.read('branches');
    assert.ok(Array.isArray(branches));
    assert.ok(branches.length > 0);
    assert.equal(branches[0].type, 'branch');
  });

  it('reads working tree status', async () => {
    const status = await provider.read('status');
    assert.ok(Array.isArray(status));
    // status may be empty if working tree is clean
  });

  it('reads a known file', async () => {
    const items = await provider.read('file:package.json');
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'file');
    assert.ok(items[0].content.includes('"name"'));
  });

  it('throws NotFoundError for missing file', async () => {
    await assert.rejects(
      () => provider.read('file:does-not-exist-xyz.json'),
      (err) => err.code === 'NOT_FOUND',
    );
  });

  it('throws NotFoundError for unknown ref', async () => {
    await assert.rejects(
      () => provider.read('bananas'),
      (err) => err.code === 'NOT_FOUND',
    );
  });

  it('searches tracked files', async () => {
    const matches = await provider.search('orchestration');
    assert.ok(Array.isArray(matches));
    assert.ok(matches.length > 0);
    assert.equal(matches[0].type, 'grep-match');
    assert.ok(typeof matches[0].file === 'string');
    assert.ok(typeof matches[0].lineNumber === 'number');
  });

  it('returns empty array when search has no matches', async () => {
    const matches = await provider.search('zzz_unlikely_string_xyz_construct_test');
    assert.deepEqual(matches, []);
  });
});
