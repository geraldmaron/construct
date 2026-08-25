/**
 * tests/kernel/store/ratifications.test.ts — the record of which project
 * settings files a person has trusted, and the two properties the trust gate
 * rests on: trust is keyed on the repository AND the bytes together, so it never
 * transfers a byte-identical file between repositories; and the table is
 * additive, so a store written before it opens with its rows and triggers
 * untouched and the new table beside them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import {
  latestRatificationForRepo,
  ratifySettingsFile,
  revokeRatification,
  settingsFileRatified,
} from '../../../src/kernel/store/ratifications.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';

const AT = '2026-08-25T00:00:00.000Z';

function withStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

test('a ratification is remembered for exactly the repository and the bytes it was made in', () => {
  withStore((store) => {
    ratifySettingsFile(store, {
      repoIdentity: 'remote:git@example.com:acme/app.git',
      contentHash: 'hash-a',
      path: '/repo/.construct/settings.json',
      settings: { host: 'claude' },
      ratifiedAt: AT,
    });
    assert.equal(settingsFileRatified(store, 'remote:git@example.com:acme/app.git', 'hash-a'), true);
    // The same bytes in a different repository are not trusted: a byte-identical
    // trivial file must not carry a grant across the boundary.
    assert.equal(settingsFileRatified(store, 'remote:git@example.com:other/app.git', 'hash-a'), false);
    // The same repository with different bytes is not trusted either — a
    // whitespace-only edit is a different hash and a grant nobody made.
    assert.equal(settingsFileRatified(store, 'remote:git@example.com:acme/app.git', 'hash-b'), false);
  });
});

test('re-ratifying the same bytes upserts rather than duplicating, and refreshes the record', () => {
  withStore((store) => {
    ratifySettingsFile(store, {
      repoIdentity: 'path:/repo',
      contentHash: 'hash-a',
      path: '/repo/.construct/settings.json',
      settings: { host: 'claude' },
      ratifiedAt: AT,
    });
    ratifySettingsFile(store, {
      repoIdentity: 'path:/repo',
      contentHash: 'hash-a',
      path: '/repo/.construct/settings.json',
      settings: { host: 'claude' },
      ratifiedAt: '2026-08-26T00:00:00.000Z',
    });
    const count = store.db
      .prepare('SELECT COUNT(*) AS n FROM settings_ratifications WHERE repo_identity = ?')
      .get('path:/repo') as { n: number };
    assert.equal(count.n, 1);
    assert.equal(latestRatificationForRepo(store, 'path:/repo')?.ratifiedAt, '2026-08-26T00:00:00.000Z');
  });
});

test('the latest ratification for a repository carries its path and its stored values', () => {
  withStore((store) => {
    ratifySettingsFile(store, {
      repoIdentity: 'path:/repo',
      contentHash: 'hash-a',
      path: '/repo/.construct/settings.json',
      settings: { host: 'claude', groundHints: ['prefer the ADRs'] },
      ratifiedAt: AT,
    });
    ratifySettingsFile(store, {
      repoIdentity: 'path:/repo',
      contentHash: 'hash-b',
      path: '/repo/.construct/settings.json',
      settings: { host: 'cursor' },
      ratifiedAt: '2026-08-27T00:00:00.000Z',
    });
    const latest = latestRatificationForRepo(store, 'path:/repo');
    assert.equal(latest?.contentHash, 'hash-b');
    assert.deepEqual(latest?.settings, { host: 'cursor' });
    assert.equal(latestRatificationForRepo(store, 'path:/never'), null);
  });
});

test('trust in a specific set of bytes can be withdrawn, and only that set', () => {
  withStore((store) => {
    ratifySettingsFile(store, {
      repoIdentity: 'path:/repo',
      contentHash: 'hash-a',
      path: '/repo/.construct/settings.json',
      settings: { host: 'claude' },
      ratifiedAt: AT,
    });
    assert.equal(revokeRatification(store, 'path:/repo', 'hash-a'), true);
    assert.equal(settingsFileRatified(store, 'path:/repo', 'hash-a'), false);
    // Withdrawing what was never granted reports nothing was there to remove.
    assert.equal(revokeRatification(store, 'path:/repo', 'hash-a'), false);
  });
});

/**
 * The ratifications table is additive, which is a claim about a store that
 * already exists rather than about the statement that creates it. The fixture is
 * a store built before it — the work log with its append-only trigger and one
 * row, at the schema version just before this table — opened by this build,
 * which must add the new table beside it and leave the row and the trigger
 * exactly as they were.
 */
test('a store written before settings could be ratified keeps its rows and its triggers', () => {
  const fixture = sterile();
  try {
    const path = join(fixture.root, 'data', 'construct.db');
    mkdirSync(join(fixture.root, 'data'), { recursive: true });
    const before = new DatabaseSync(path);
    before.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE work_log (
        seq     INTEGER PRIMARY KEY AUTOINCREMENT,
        run     TEXT NOT NULL,
        task    TEXT,
        role    TEXT NOT NULL,
        action  TEXT NOT NULL,
        detail  TEXT NOT NULL,
        at      TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER work_log_no_update
      BEFORE UPDATE ON work_log
      BEGIN SELECT RAISE(ABORT, 'work_log is append-only'); END;
    `);
    before.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', '22');
    before
      .prepare('INSERT INTO work_log (run, role, action, detail, at) VALUES (?, ?, ?, ?, ?)')
      .run('run-old', 'security', 'flagged', '{}', AT);
    before.close();

    const store = openStore(path);
    try {
      // The pre-existing row and its trigger are untouched.
      const kept = readWorkLog(store, 'run-old');
      assert.equal(kept.length, 1);
      assert.equal(kept[0].action, 'flagged');
      assert.throws(
        () => store.db.prepare("UPDATE work_log SET action = 'x' WHERE seq = 1").run(),
        /append-only/,
      );

      // Additive: the new table is there, empty, and a ratification can be
      // recorded against a repository without the old row moving.
      const empty = store.db
        .prepare('SELECT COUNT(*) AS n FROM settings_ratifications')
        .get() as { n: number };
      assert.equal(empty.n, 0);
      ratifySettingsFile(store, {
        repoIdentity: 'path:/repo',
        contentHash: 'hash-a',
        path: '/repo/.construct/settings.json',
        settings: { host: 'claude' },
        ratifiedAt: AT,
      });
      assert.equal(settingsFileRatified(store, 'path:/repo', 'hash-a'), true);
      assert.equal(readWorkLog(store, 'run-old').length, 1);
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});
