/**
 * tests/sources/repo-cache-git-behaviors.test.mjs — real-git contract tests
 * for lib/sources/repo-cache.mjs's syncCorpusTarget(), the generic `git`
 * source-target provider's actual sync implementation (construct-4uxq0.13.3,
 * Phase 9 audit checklist: shallow clones, rewritten history / force pushes,
 * deleted branches).
 *
 * Calls syncCorpusTarget() directly against real local bare repos built with
 * the real `git` binary (no bin/construct spawn, no fake wire boundary) —
 * git fixture setup is an unavoidable real subprocess, but the module under
 * test is exercised in-process through its actual exported function, not
 * through the CLI. CONSTRUCT_HOME_OVERRIDE isolates the state root per test so the
 * corpus cache never touches the real machine's ~/.construct.
 *
 * Typed error classification (construct-h48jh): sync failures surface as the
 * shared provider error hierarchy (lib/providers/contract/errors.mjs) — a
 * deleted upstream branch and a nonexistent remote are reproduced against
 * real git and asserted as NotFoundError; auth and rate-limit stderr
 * vocabularies (unreachable without a live credentialed server) are driven
 * through classifyGitFailure() with error objects shaped exactly like
 * execFileSync failures (string .stderr, pipe stdio), the same object the
 * real path passes it.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const dirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * A bare origin plus a working `src` checkout wired as its `origin` remote —
 * unlike a one-shot `git clone --bare` snapshot, this lets a test push new
 * history (including a force push) to the same bare repo syncCorpusTarget
 * reads from.
 */
function makeLiveRepoPair() {
  const bare = freshDir('cx-repocache-bare-');
  git(bare, ['init', '-q', '--bare', '-b', 'main']);
  const src = freshDir('cx-repocache-src-');
  git(src, ['init', '-q', '-b', 'main']);
  git(src, ['config', 'user.email', 'test@construct.dev']);
  git(src, ['config', 'user.name', 'Construct Test']);
  fs.writeFileSync(path.join(src, 'README.md'), '# v1\n');
  git(src, ['add', '-A']);
  git(src, ['commit', '-qm', 'init']);
  git(src, ['remote', 'add', 'origin', bare]);
  git(src, ['push', '-q', 'origin', 'main']);
  return { bareUrl: `file://${bare}`, src };
}

/**
 * Runs `fn` with CONSTRUCT_HOME_OVERRIDE pointed at a fresh tmpdir, so
 * resolveStateRoot's corpus cache lands under an isolated fake home rather
 * than the real machine's ~/.construct, then restores the prior value.
 */
function withIsolatedHome(fn) {
  const home = freshDir('cx-repocache-home-');
  const previous = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = home;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = previous;
  }
}

test('syncCorpusTarget: first sync produces a real shallow clone (.git/shallow present)', async () => {
  const { syncCorpusTarget, corpusCacheDir } = await import('../../lib/sources/repo-cache.mjs');
  const { bareUrl } = makeLiveRepoPair();
  const projectRoot = freshDir('cx-repocache-proj-');

  withIsolatedHome(() => {
    const target = { id: 'shallow-check', provider: 'git', selector: { remote: bareUrl, content: { mode: 'corpus', ref: 'main' } } };
    const result = syncCorpusTarget(target, { projectRoot });
    assert.equal(result.mode, 'clone');
    const cacheDir = corpusCacheDir(target, { projectRoot });
    assert.ok(fs.existsSync(path.join(cacheDir, '.git', 'shallow')), 'a --depth 1 clone must produce a real .git/shallow marker');
  });
});

test('syncCorpusTarget: a force-pushed, rewritten upstream history is picked up on resync, not blocked', async () => {
  const { syncCorpusTarget, corpusCacheDir } = await import('../../lib/sources/repo-cache.mjs');
  const { bareUrl, src } = makeLiveRepoPair();
  const projectRoot = freshDir('cx-repocache-proj-');

  withIsolatedHome(() => {
    const target = { id: 'rewrite-check', provider: 'git', selector: { remote: bareUrl, content: { mode: 'corpus', ref: 'main' } } };
    const first = syncCorpusTarget(target, { projectRoot });
    assert.equal(first.mode, 'clone');

    // Rewrite history in place (amend, not a new commit on top) and force-push —
    // a non-fast-forward update the plain `fetch` path cannot follow without
    // `checkout -f` discarding the stale local ref.
    fs.writeFileSync(path.join(src, 'README.md'), '# v2 rewritten\n');
    git(src, ['add', '-A']);
    git(src, ['commit', '--amend', '-qm', 'init (rewritten)']);
    git(src, ['push', '-q', '--force', 'origin', 'main']);

    const second = syncCorpusTarget(target, { projectRoot });
    assert.equal(second.mode, 'fetch');
    assert.notEqual(second.head, first.head, 'resync must land on the rewritten commit, not the stale one');

    const cacheDir = corpusCacheDir(target, { projectRoot });
    assert.equal(fs.readFileSync(path.join(cacheDir, 'README.md'), 'utf8'), '# v2 rewritten\n', 'checkout -f must reflect the rewritten content, not fail or leave the old tree');
  });
});

test('syncCorpusTarget: resync throws a typed NotFoundError once the tracked branch is deleted upstream', async () => {
  const { syncCorpusTarget } = await import('../../lib/sources/repo-cache.mjs');
  const { NotFoundError } = await import('../../lib/providers/contract/errors.mjs');
  const { bareUrl, src } = makeLiveRepoPair();
  const projectRoot = freshDir('cx-repocache-proj-');

  withIsolatedHome(() => {
    git(src, ['checkout', '-qb', 'feature']);
    fs.writeFileSync(path.join(src, 'feature.txt'), 'x');
    git(src, ['add', '-A']);
    git(src, ['commit', '-qm', 'feature commit']);
    git(src, ['push', '-q', 'origin', 'feature']);
    git(src, ['checkout', '-q', 'main']);

    const target = { id: 'deleted-branch-check', provider: 'git', selector: { remote: bareUrl, content: { mode: 'corpus', ref: 'feature' } } };
    const first = syncCorpusTarget(target, { projectRoot });
    assert.equal(first.mode, 'clone');

    git(src, ['push', '-q', 'origin', '--delete', 'feature']);

    assert.throws(
      () => syncCorpusTarget(target, { projectRoot }),
      (err) => {
        assert.ok(err instanceof NotFoundError, `expected NotFoundError, got ${err.name}: ${err.message}`);
        assert.equal(err.code, 'NOT_FOUND');
        assert.equal(err.provider, 'git');
        assert.match(err.message, /deleted-branch-check/);
        assert.ok(err.cause, 'the original execFileSync failure must ride along as cause');
        return true;
      },
    );
  });
});

test('syncCorpusTarget: cloning a branch that never existed throws a typed NotFoundError (real git, clone path)', async () => {
  const { syncCorpusTarget } = await import('../../lib/sources/repo-cache.mjs');
  const { NotFoundError } = await import('../../lib/providers/contract/errors.mjs');
  const { bareUrl } = makeLiveRepoPair();
  const projectRoot = freshDir('cx-repocache-proj-');

  withIsolatedHome(() => {
    const target = { id: 'missing-ref-check', provider: 'git', selector: { remote: bareUrl, content: { mode: 'corpus', ref: 'no-such-branch' } } };
    assert.throws(
      () => syncCorpusTarget(target, { projectRoot }),
      (err) => err instanceof NotFoundError && err.code === 'NOT_FOUND',
    );
  });
});

test('syncCorpusTarget: a nonexistent remote throws a typed NotFoundError (real git, bad remote)', async () => {
  const { syncCorpusTarget } = await import('../../lib/sources/repo-cache.mjs');
  const { NotFoundError } = await import('../../lib/providers/contract/errors.mjs');
  const projectRoot = freshDir('cx-repocache-proj-');
  const missing = path.join(freshDir('cx-repocache-missing-'), 'no-such-repo');

  withIsolatedHome(() => {
    const target = { id: 'bad-remote-check', provider: 'git', selector: { remote: `file://${missing}`, content: { mode: 'corpus', ref: 'main' } } };
    assert.throws(
      () => syncCorpusTarget(target, { projectRoot }),
      (err) => {
        assert.ok(err instanceof NotFoundError, `expected NotFoundError, got ${err.name}: ${err.message}`);
        assert.equal(err.provider, 'git');
        return true;
      },
    );
  });
});

// Auth and rate-limit failures need a live credentialed/throttling server to
// reproduce for real; the classifier is instead driven with error objects
// carrying git's verbatim stderr vocabulary in the exact shape execFileSync
// produces (string .stderr under encoding:'utf8', pipe stdio) — the same
// object syncCorpusTarget's wrapper hands to classifyGitFailure.

test('classifyGitFailure: real git auth-failure stderr vocabularies map to AuthError', async () => {
  const { classifyGitFailure } = await import('../../lib/sources/repo-cache.mjs');
  const { AuthError } = await import('../../lib/providers/contract/errors.mjs');

  const stderrs = [
    "fatal: Authentication failed for 'https://github.com/acme/private.git/'",
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
    'remote: Support for password authentication was removed on August 13, 2021.',
    'remote: Invalid username or token. Password authentication is not supported for Git operations.',
  ];
  for (const stderr of stderrs) {
    const raw = Object.assign(new Error('Command failed: git fetch'), { stderr, status: 128 });
    const classified = classifyGitFailure(raw, { targetId: 't1', provider: 'git', remote: 'https://github.com/acme/private.git', ref: 'main' });
    assert.ok(classified instanceof AuthError, `expected AuthError for stderr: ${stderr}`);
    assert.equal(classified.code, 'AUTH_ERROR');
    assert.equal(classified.cause, raw);
  }
});

test('classifyGitFailure: throttled-remote stderr maps to RateLimitError', async () => {
  const { classifyGitFailure } = await import('../../lib/sources/repo-cache.mjs');
  const { RateLimitError } = await import('../../lib/providers/contract/errors.mjs');

  const raw = Object.assign(new Error('Command failed: git clone'), {
    stderr: "error: RPC failed; HTTP 429 curl 22 The requested URL returned error: 429 Too Many Requests",
    status: 128,
  });
  const classified = classifyGitFailure(raw, { targetId: 't2', provider: 'git', remote: 'https://example.com/x.git', ref: 'main' });
  assert.ok(classified instanceof RateLimitError);
  assert.equal(classified.code, 'RATE_LIMIT');
});

test('classifyGitFailure: an unrecognized failure returns the original error unchanged, not a mistyped wrapper', async () => {
  const { classifyGitFailure } = await import('../../lib/sources/repo-cache.mjs');

  const raw = Object.assign(new Error('Command failed: git fetch'), { stderr: 'fatal: the remote end hung up unexpectedly', status: 128 });
  const classified = classifyGitFailure(raw, { targetId: 't3', provider: 'git', remote: 'https://example.com/x.git', ref: 'main' });
  assert.equal(classified, raw);
});

test('syncCorpusTarget: a second sync on an unchanged remote is a no-op fetch, cache dir is reused', async () => {
  const { syncCorpusTarget, corpusCacheDir } = await import('../../lib/sources/repo-cache.mjs');
  const { bareUrl } = makeLiveRepoPair();
  const projectRoot = freshDir('cx-repocache-proj-');

  withIsolatedHome(() => {
    const target = { id: 'idempotent-check', provider: 'git', selector: { remote: bareUrl, content: { mode: 'corpus', ref: 'main' } } };
    const first = syncCorpusTarget(target, { projectRoot });
    const cacheDir = corpusCacheDir(target, { projectRoot });
    const gitDirBirth = fs.statSync(path.join(cacheDir, '.git')).birthtimeMs;

    const second = syncCorpusTarget(target, { projectRoot });
    assert.equal(second.mode, 'fetch');
    assert.equal(second.head, first.head, 'head is unchanged when upstream has not moved');
    assert.equal(fs.statSync(path.join(cacheDir, '.git')).birthtimeMs, gitDirBirth, 'the existing .git dir is reused, not recreated');
  });
});
