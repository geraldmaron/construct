/**
 * tests/workplace-loop/github-source.test.mjs — unit coverage for
 * lib/workplace-loop/sources/github-source.mjs (construct-b0nny.25).
 *
 * fetchGithubOpenIssues is exercised against an injected fake provider
 * (never a real network call) so the suite stays hermetic; the real
 * provider factory (lib/providers/github/index.mjs) is exercised for real
 * against this repo's own live GitHub source separately, captured as this
 * bead's real-source evidence run (the bead's completion-evidence report,
 * not this automated suite) — a live external API is a poor dependency for
 * an automated regression suite's determinism.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { fetchGithubOpenIssues, parseOwnerRepoFromRemote, resolveDefaultGithubRepo } from '../../lib/workplace-loop/sources/github-source.mjs';

test('fetchGithubOpenIssues throws without a repo — no fabricated default', async () => {
  await assert.rejects(() => fetchGithubOpenIssues({ repo: undefined }), /repo/);
});

test('fetchGithubOpenIssues normalizes a raw GitHub search response into the loop signal-input shape', async () => {
  const fakeProvider = () => ({
    search: async () => ([
      {
        number: 42, title: 'Flaky CI on macOS runners', body: 'happens ~1 in 5 runs',
        state: 'open', labels: [{ name: 'ci' }, 'flaky'], assignee: null,
        updated_at: '2026-06-01T00:00:00Z', created_at: '2026-05-01T00:00:00Z',
        html_url: 'https://github.com/o/r/issues/42',
      },
      { number: 43, title: 'a pull request', pull_request: { url: 'x' } },
    ]),
  });

  const result = await fetchGithubOpenIssues({ repo: 'o/r', providerFactory: fakeProvider });
  assert.equal(result.repo, 'o/r');
  assert.equal(result.issues.length, 1, 'a search hit carrying pull_request must be filtered out');
  const [issue] = result.issues;
  assert.equal(issue.id, 'GH-42');
  assert.equal(issue.title, 'Flaky CI on macOS runners');
  assert.deepEqual(issue.labels, ['ci', 'flaky'], 'both string and {name} label shapes must normalize');
  assert.equal(issue.assignee, null);
  assert.equal(issue.source.repo, 'o/r');
  assert.equal(issue.source.ref, '#42');
});

test('fetchGithubOpenIssues handles a real-shaped, incomplete record without throwing', async () => {
  const fakeProvider = () => ({ search: async () => ([{ number: 7, title: 'no body field, no labels field, no assignee field' }]) });
  const result = await fetchGithubOpenIssues({ repo: 'o/r', providerFactory: fakeProvider });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].body, '');
  assert.deepEqual(result.issues[0].labels, []);
});

test('parseOwnerRepoFromRemote parses https and scp-like GitHub remotes', () => {
  assert.equal(parseOwnerRepoFromRemote('https://github.com/geraldmaron/construct.git'), 'geraldmaron/construct');
  assert.equal(parseOwnerRepoFromRemote('git@github.com:geraldmaron/construct.git'), 'geraldmaron/construct');
  assert.equal(parseOwnerRepoFromRemote('https://github.com/geraldmaron/construct'), 'geraldmaron/construct');
});

test('parseOwnerRepoFromRemote returns null for a non-matching or absent url', () => {
  assert.equal(parseOwnerRepoFromRemote(null), null);
  assert.equal(parseOwnerRepoFromRemote('not a url'), null);
});

test('resolveDefaultGithubRepo derives owner/repo from a real local git origin remote', () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-workplace-github-source-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repoDir });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/demo-repo.git'], { cwd: repoDir });
    assert.equal(resolveDefaultGithubRepo(repoDir), 'example/demo-repo');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test('resolveDefaultGithubRepo returns null (never a fabricated repo) with no origin remote', () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-workplace-github-source-noremote-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repoDir });
    assert.equal(resolveDefaultGithubRepo(repoDir), null);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
