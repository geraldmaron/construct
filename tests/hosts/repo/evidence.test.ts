/**
 * tests/hosts/repo/evidence.test.ts — the gatherer, asked its questions of a
 * real repository built for the occasion.
 *
 * Never this checkout. The judgements live in kernel/tracker/session-drift and
 * are tested against hand-built data there; what is left to prove here is that
 * git is being asked the right question and its answer read correctly, and that
 * is only provable against a repository whose whole history the test wrote.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherDivergence, recordedHistory } from '../../../src/hosts/repo/evidence.ts';
import { describeDivergence, lostRecords } from '../../../src/kernel/tracker/session-drift.ts';
import { fixtureRepo } from './fixture-repo.ts';

test('a close recorded in an earlier revision of the export is found again', () => {
  const repo = fixtureRepo();
  try {
    repo.export(
      [
        { id: 'construct-a', status: 'open', title: 'a' },
        { id: 'construct-b', status: 'open', title: 'b' },
      ],
      'file two beads',
    );
    repo.export(
      [
        { id: 'construct-a', status: 'closed', title: 'a' },
        { id: 'construct-b', status: 'open', title: 'b' },
        { id: 'construct-c', status: 'open', title: 'c' },
      ],
      'close one, file another',
    );
    // The regression: a session starts from a database state that predates both
    // the close and the filing, and exports it over the top.
    repo.export(
      [
        { id: 'construct-a', status: 'open', title: 'a' },
        { id: 'construct-b', status: 'open', title: 'b' },
      ],
      'a stale database overwrites the export',
    );

    const history = recordedHistory(repo.root);
    assert.ok(history, 'the export has a history and it must be readable');
    assert.equal(history.commitsScanned, 3);
    assert.equal(history.truncated, false);
    assert.deepEqual(history.everClosed, ['construct-a']);
    assert.deepEqual(history.everFiled, ['construct-a', 'construct-b', 'construct-c']);

    const current = [
      { id: 'construct-a', status: 'open', title: 'a' },
      { id: 'construct-b', status: 'open', title: 'b' },
    ];
    const report = lostRecords(current, history);
    assert.deepEqual(report.lostCloses, ['construct-a']);
    assert.deepEqual(report.missingRecords, ['construct-c']);
    assert.equal(report.clean, false);
  } finally {
    repo.cleanup();
  }
});

test('the sweep reads every local ref, not only the branch checked out', () => {
  // The closes that went missing were recorded on a branch. A sweep that read
  // only the current branch would report the agreement that hid them.
  const repo = fixtureRepo();
  try {
    repo.export([{ id: 'construct-a', status: 'open', title: 'a' }], 'file it');
    repo.git('checkout', '-b', 'side');
    repo.export([{ id: 'construct-a', status: 'closed', title: 'a' }], 'close it on a branch');
    repo.git('checkout', 'main');

    const history = recordedHistory(repo.root);
    assert.deepEqual(history?.everClosed, ['construct-a']);
  } finally {
    repo.cleanup();
  }
});

test('a repository whose export agrees with its own history reports nothing', () => {
  const repo = fixtureRepo();
  try {
    const records = [{ id: 'construct-a', status: 'closed', title: 'a' }];
    repo.export(records, 'file and close');
    const report = lostRecords(records, recordedHistory(repo.root) ?? undefined);
    assert.equal(report.clean, true);
  } finally {
    repo.cleanup();
  }
});

test('the walk stops at its cap and says that it did', () => {
  const repo = fixtureRepo();
  try {
    for (let i = 0; i < 4; i += 1) {
      repo.export([{ id: `construct-${String(i)}`, status: 'open', title: 'x' }], `revision ${String(i)}`);
    }
    const history = recordedHistory(repo.root, 2);
    assert.equal(history?.commitsScanned, 2);
    assert.equal(history?.truncated, true);
    // The two newest revisions, so the older ids were genuinely not read.
    assert.deepEqual(history?.everFiled, ['construct-2', 'construct-3']);
  } finally {
    repo.cleanup();
  }
});

test('a directory with no export and no history is not a finding', () => {
  const repo = fixtureRepo();
  try {
    const history = recordedHistory(repo.root);
    assert.deepEqual(history, {
      everFiled: [],
      everClosed: [],
      commitsScanned: 0,
      truncated: false,
    });
  } finally {
    repo.cleanup();
  }
});

test('a branch behind main learns which beads main already carries', () => {
  const repo = fixtureRepo();
  try {
    repo.export(
      [
        { id: 'construct-a', status: 'open', title: 'a' },
        { id: 'construct-b', status: 'open', title: 'b' },
      ],
      'file two beads',
    );
    repo.git('checkout', '-b', 'side');
    repo.commit('work the side branch does (construct-b)');
    repo.git('checkout', 'main');
    repo.commit('the same work, done first (construct-a)');
    repo.commit('a commit naming nothing');
    repo.git('checkout', 'side');

    const divergence = gatherDivergence({ root: repo.root });
    assert.ok(divergence);
    assert.equal(divergence.head, 'side');
    assert.equal(divergence.aheadOfMain, 1);
    assert.equal(divergence.behindMain, 2);
    assert.equal(divergence.upstream, null);
    // Only main's side of the divergence. The branch's own commits are visible
    // to the session already; the point is what it cannot see.
    assert.deepEqual(divergence.beadsOnlyOnMain, ['construct-a']);

    const report = describeDivergence(divergence);
    assert.equal(report.diverged, true);
    assert.match(report.lines.join('\n'), /construct-a/);
  } finally {
    repo.cleanup();
  }
});

test('a checkout sitting on main reports no divergence', () => {
  const repo = fixtureRepo();
  try {
    repo.export([{ id: 'construct-a', status: 'open', title: 'a' }], 'file one bead');
    repo.commit('more work (construct-a)');

    const divergence = gatherDivergence({ root: repo.root });
    assert.equal(divergence?.behindMain, 0);
    assert.equal(divergence?.aheadOfMain, 0);
    assert.deepEqual(divergence?.beadsOnlyOnMain, []);
    assert.equal(describeDivergence(divergence ?? undefined).diverged, false);
  } finally {
    repo.cleanup();
  }
});

test('a repository without the main branch is refused rather than guessed at', () => {
  const repo = fixtureRepo('trunk');
  try {
    repo.export([{ id: 'construct-a', status: 'open', title: 'a' }], 'file one bead');
    assert.equal(gatherDivergence({ root: repo.root }), null);
    assert.equal(gatherDivergence({ root: repo.root, mainBranch: 'trunk' })?.head, 'trunk');
  } finally {
    repo.cleanup();
  }
});
