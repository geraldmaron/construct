/**
 * tests/kernel/store/store.test.ts — the storage substrate's guarantees.
 *
 * The properties under test are the ones the three consumers depend on and that
 * a comment alone cannot hold: the work log cannot be rewritten, the audit copy
 * of a projection survives re-import, a decision cannot be filed with one side,
 * and a store from a future schema is refused rather than silently used.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { sterile } from '../../harness/sterile.ts';
import {
  SCHEMA_VERSION,
  StoreUnavailableError,
  openStore,
  storePath,
  storeWriteProblem,
  transact,
} from '../../../src/kernel/store/open.ts';
import {
  countProjections,
  getProjection,
  listProjections,
  putProjection,
} from '../../../src/kernel/store/projections.ts';
import { appendWorkLog, readWorkLog } from '../../../src/kernel/store/worklog.ts';
import { appendFeedback, readFeedback } from '../../../src/kernel/store/feedback.ts';
import {
  getDecision,
  openDecisions,
  raiseDecision,
  resolveDecision,
} from '../../../src/kernel/store/decisions.ts';
import { buildProjection } from '../../../src/kernel/tracker/projection.ts';
import { setSourceDeclaration, sourceDeclaration } from '../../../src/kernel/store/sources.ts';
import { declareSourceEdge, sourceEdgesFor } from '../../../src/kernel/store/source-edges.ts';
import {
  estimativeJudgmentsFor,
  recordEstimativeJudgment,
  resolveEstimativeJudgment,
} from '../../../src/kernel/store/estimative.ts';
import { assessRisk } from '../../../src/kernel/run/estimative.ts';
import { DatabaseSync } from 'node:sqlite';

const AT = '2026-08-03T00:00:00.000Z';

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

test('storePath derives from injected Paths and openStore creates missing dirs', () => {
  const fixture = sterile();
  try {
    const path = storePath(fixture.paths);
    assert.ok(path.startsWith(fixture.root), 'store must stay inside the sterile root');
    const store = openStore(path);
    assert.equal(store.path, path);
    store.close();
    // Reopening an existing store is not an error and does not reset it.
    const again = openStore(path);
    again.close();
  } finally {
    fixture.cleanup();
  }
});

test('the store and its directory are private, even under a permissive umask', () => {
  // A process umask of 0 would otherwise let the store be created world-
  // readable. The containment is set explicitly, so it holds regardless.
  const previous = process.umask(0o000);
  const fixture = sterile();
  try {
    const path = storePath(fixture.paths);
    const store = openStore(path);
    store.close();
    assert.equal(statSync(path).mode & 0o077, 0, 'the database file is readable only by its owner');
    assert.equal(
      statSync(dirname(path)).mode & 0o077,
      0,
      'the directory holding the store, its -wal and -shm is owner-only',
    );
  } finally {
    fixture.cleanup();
    process.umask(previous);
  }
});

test('a store written by a newer schema is refused, not silently used', () => {
  const fixture = sterile();
  try {
    const path = join(fixture.root, 'data', 'construct.db');
    const store = openStore(path);
    store.db
      .prepare('UPDATE meta SET value = ? WHERE key = ?')
      .run(String(SCHEMA_VERSION + 1), 'schema_version');
    store.close();
    assert.throws(() => openStore(path), /newer than this build understands/);
    // Refusing is half of it: the CLI can only turn this into one line if the
    // refusal is the class it catches, carrying the path it could not open.
    assert.throws(() => openStore(path), (error: unknown) => {
      assert.ok(error instanceof StoreUnavailableError);
      assert.equal(error.path, path);
      return true;
    });
  } finally {
    fixture.cleanup();
  }
});

/**
 * The refusal above can only mean something if the recorded version follows what
 * the store actually carries, and for ten bumps it did not: a version was
 * inserted when absent and never updated, so a store created at 4 still claimed
 * 4 and every build after it opened the store without a word. The guard existed
 * and had never been able to fire.
 */
test('a store recorded older than the build advances to what it now carries', () => {
  const fixture = sterile();
  try {
    const path = join(fixture.root, 'data', 'construct.db');
    const store = openStore(path);
    store.db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('4', 'schema_version');
    store.close();

    const reopened = openStore(path);
    const recorded = reopened.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string };
    assert.equal(Number(recorded.value), SCHEMA_VERSION);
    reopened.close();

    // Repeatable: opening again is a no-op rather than a second write, and the
    // store stays openable.
    const third = openStore(path);
    const still = third.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string };
    assert.equal(Number(still.value), SCHEMA_VERSION);
    third.close();
  } finally {
    fixture.cleanup();
  }
});

/**
 * The declarations table is additive, which is a claim about a store that
 * already exists rather than about the statement that creates it. So the
 * fixture is a store built without it — the sources table, its retire-only and
 * no-delete triggers, one row — opened by this build, which must add the new
 * table beside them and leave every one of them exactly as it was.
 */
test('a store written before sources carried declarations keeps its rows and its triggers', () => {
  const fixture = sterile();
  try {
    const path = join(fixture.root, 'data', 'construct.db');
    mkdirSync(join(fixture.root, 'data'), { recursive: true });
    const before = new DatabaseSync(path);
    before.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE sources (
        id         TEXT PRIMARY KEY,
        workspace  TEXT NOT NULL,
        kind       TEXT NOT NULL CHECK (kind IN ('directory', 'git', 'github', 'jira', 'docs')),
        locator    TEXT NOT NULL,
        added_at   TEXT NOT NULL,
        retired_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX sources_active
        ON sources (workspace, kind, locator) WHERE retired_at IS NULL;
      CREATE TRIGGER sources_retire_only
      BEFORE UPDATE ON sources
      WHEN NEW.id != OLD.id OR NEW.workspace != OLD.workspace OR NEW.kind != OLD.kind
        OR NEW.locator != OLD.locator OR NEW.added_at != OLD.added_at
        OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
      BEGIN SELECT RAISE(ABORT, 'a source is retired, never edited'); END;
      CREATE TRIGGER sources_no_delete
      BEFORE DELETE ON sources
      BEGIN SELECT RAISE(ABORT, 'a source is retired, never deleted'); END;
    `);
    before.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', '17');
    before
      .prepare('INSERT INTO sources (id, workspace, kind, locator, added_at) VALUES (?, ?, ?, ?, ?)')
      .run('src-old', 'acme', 'jira', 'PROJ', AT);
    before.close();

    const store = openStore(path);
    try {
      const row = store.db.prepare('SELECT * FROM sources WHERE id = ?').get('src-old') as {
        workspace: string;
        locator: string;
        added_at: string;
        retired_at: string | null;
      };
      assert.equal(row.workspace, 'acme');
      assert.equal(row.locator, 'PROJ');
      assert.equal(row.added_at, AT);
      assert.equal(row.retired_at, null);

      assert.throws(
        () => store.db.prepare("UPDATE sources SET locator = 'OTHER' WHERE id = ?").run('src-old'),
        /retired, never edited/,
        'the retire-only trigger is untouched',
      );
      assert.throws(
        () => store.db.prepare('DELETE FROM sources WHERE id = ?').run('src-old'),
        /retired, never deleted/,
      );

      // Additive: the new table is there, empty, and the pre-existing row can
      // be described through it without the source row moving.
      const described = store.db
        .prepare('SELECT COUNT(*) AS n FROM source_declarations')
        .get() as { n: number };
      assert.equal(described.n, 0);
      setSourceDeclaration(
        store,
        'src-old',
        { authority: 'archive', relevance: 'last year', sensitive: false },
        AT,
      );
      assert.equal(sourceDeclaration(store, 'src-old')?.authority, 'archive');
      const after = store.db.prepare('SELECT * FROM sources WHERE id = ?').get('src-old') as {
        locator: string;
        retired_at: string | null;
      };
      assert.equal(after.locator, 'PROJ');
      assert.equal(after.retired_at, null);
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});

/**
 * Relationships between sources are additive in the same sense, and the claim
 * is again about a store that already exists. The fixture is one written before
 * the relationships table: the sources table with its two triggers, the
 * declarations table beside it, and two described sources. Opening it must add
 * the relationships table and change nothing else — the descriptions still read
 * back, the source triggers still refuse, and the two existing sources can be
 * related to each other through a table that was not there when they were
 * declared.
 */
test('a store written before sources could be related keeps its rows, and gains the table', () => {
  const fixture = sterile();
  try {
    const path = join(fixture.root, 'data', 'construct.db');
    mkdirSync(join(fixture.root, 'data'), { recursive: true });
    const before = new DatabaseSync(path);
    before.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE sources (
        id         TEXT PRIMARY KEY,
        workspace  TEXT NOT NULL,
        kind       TEXT NOT NULL CHECK (kind IN ('directory', 'git', 'github', 'jira', 'docs')),
        locator    TEXT NOT NULL,
        added_at   TEXT NOT NULL,
        retired_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX sources_active
        ON sources (workspace, kind, locator) WHERE retired_at IS NULL;
      CREATE TRIGGER sources_retire_only
      BEFORE UPDATE ON sources
      WHEN NEW.id != OLD.id OR NEW.workspace != OLD.workspace OR NEW.kind != OLD.kind
        OR NEW.locator != OLD.locator OR NEW.added_at != OLD.added_at
        OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
      BEGIN SELECT RAISE(ABORT, 'a source is retired, never edited'); END;
      CREATE TRIGGER sources_no_delete
      BEFORE DELETE ON sources
      BEGIN SELECT RAISE(ABORT, 'a source is retired, never deleted'); END;
      CREATE TABLE source_declarations (
        source      TEXT PRIMARY KEY REFERENCES sources (id),
        authority   TEXT NOT NULL CHECK (authority IN ('source-of-truth', 'working', 'aspirational', 'archive')),
        relevance   TEXT NOT NULL,
        sensitive   INTEGER NOT NULL CHECK (sensitive IN (0, 1)),
        recorded_at TEXT NOT NULL
      ) STRICT;
    `);
    before.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', '18');
    const addOld = before.prepare(
      'INSERT INTO sources (id, workspace, kind, locator, added_at) VALUES (?, ?, ?, ?, ?)',
    );
    addOld.run('src-strategy', 'acme', 'directory', '/strategy', AT);
    addOld.run('src-repo', 'acme', 'git', '/repo', AT);
    before
      .prepare(
        `INSERT INTO source_declarations (source, authority, relevance, sensitive, recorded_at)
         VALUES (?, 'source-of-truth', 'the agreement', 0, ?)`,
      )
      .run('src-strategy', AT);
    before.close();

    const store = openStore(path);
    try {
      assert.equal(sourceDeclaration(store, 'src-strategy')?.authority, 'source-of-truth');
      assert.throws(
        () => store.db.prepare("UPDATE sources SET locator = 'OTHER' WHERE id = ?").run('src-repo'),
        /retired, never edited/,
        'the source triggers are untouched',
      );

      const existing = store.db.prepare('SELECT COUNT(*) AS n FROM source_edges').get() as { n: number };
      assert.equal(existing.n, 0, 'nothing invented a relationship on the way in');

      declareSourceEdge(store, {
        id: 'rel-old',
        workspace: 'acme',
        from: 'src-strategy',
        to: 'src-repo',
        relation: 'governs',
        note: 'declared after the fact',
        declaredAt: AT,
      });
      assert.deepEqual(
        sourceEdgesFor(store, 'acme').map((edge) => [edge.from, edge.relation, edge.to]),
        [['src-strategy', 'governs', 'src-repo']],
      );
      assert.throws(
        () => store.db.prepare('DELETE FROM source_edges WHERE id = ?').run('rel-old'),
        /retired, never deleted/,
        'the new table arrives with its own discipline, not without one',
      );
      const untouched = store.db.prepare('SELECT * FROM sources WHERE id = ?').get('src-repo') as {
        locator: string;
        retired_at: string | null;
      };
      assert.equal(untouched.locator, '/repo');
      assert.equal(untouched.retired_at, null);
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('advancing an old store does not weaken the refusal of a newer one', () => {
  const fixture = sterile();
  try {
    const path = join(fixture.root, 'data', 'construct.db');
    const store = openStore(path);
    store.db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('2', 'schema_version');
    store.close();
    openStore(path).close();

    // Now push it past this build: the direction that must still refuse.
    const advanced = openStore(path);
    advanced.db
      .prepare('UPDATE meta SET value = ? WHERE key = ?')
      .run(String(SCHEMA_VERSION + 1), 'schema_version');
    advanced.close();
    assert.throws(() => openStore(path), /newer than this build understands/);
  } finally {
    fixture.cleanup();
  }
});

/**
 * chmod is not enforced against a superuser, so these two would pass vacuously
 * as root. Skipping honestly beats a green check that proved nothing.
 */
const chmodBinds = typeof process.getuid === 'function' && process.getuid() !== 0;

test('a directory that does not exist yet is not a problem — openStore creates it', () => {
  const fixture = sterile();
  try {
    // Nothing under the sterile root exists at this point.
    assert.equal(storeWriteProblem(storePath(fixture.paths)), null);
  } finally {
    fixture.cleanup();
  }
});

test('an unwritable directory is named as a problem before anything opens it', { skip: !chmodBinds }, () => {
  const fixture = sterile();
  try {
    const closed = join(fixture.root, 'closed');
    mkdirSync(closed, { recursive: true });
    chmodSync(closed, 0o500);
    try {
      const path = join(closed, 'construct', 'construct.db');
      const problem = storeWriteProblem(path);
      assert.ok(problem, 'a directory that cannot be written must be reported');
      assert.match(problem, /permission denied/);
      assert.match(problem, new RegExp(closed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      // And the probe agrees with reality: opening it really does fail.
      assert.throws(() => openStore(path), StoreUnavailableError);
    } finally {
      chmodSync(closed, 0o700);
    }
  } finally {
    fixture.cleanup();
  }
});

test('an unopenable store fails with a reason, not an errno the user must decode', { skip: !chmodBinds }, () => {
  const fixture = sterile();
  try {
    const closed = join(fixture.root, 'closed');
    mkdirSync(closed, { recursive: true });
    chmodSync(closed, 0o500);
    try {
      const path = join(closed, 'construct', 'construct.db');
      assert.throws(() => openStore(path), (error: unknown) => {
        assert.ok(error instanceof StoreUnavailableError);
        assert.equal(error.reason, 'permission denied');
        assert.match(error.message, /cannot open the store at/);
        assert.ok(!/EACCES/.test(error.message), 'the message is for a person, not a syscall');
        return true;
      });
    } finally {
      chmodSync(closed, 0o700);
    }
  } finally {
    fixture.cleanup();
  }
});

test('a file that is not a database is refused as unavailable, not as a crash', () => {
  const fixture = sterile();
  try {
    const path = join(fixture.root, 'data', 'construct.db');
    mkdirSync(join(fixture.root, 'data'), { recursive: true });
    writeFileSync(path, 'this is not a sqlite file, it is a note\n');
    // The probe passes — the bits are fine — and the open still has to explain
    // itself rather than throwing a raw sqlite error at the user.
    assert.equal(storeWriteProblem(path), null);
    assert.throws(() => openStore(path), StoreUnavailableError);
  } finally {
    fixture.cleanup();
  }
});

test('work_log is append-only at the storage layer, not by convention', () => {
  withStore((store) => {
    appendWorkLog(store, {
      run: 'run-1',
      task: 'task-1',
      role: 'issue-spotter',
      action: 'flagged',
      detail: { note: 'needs a licensed human' },
      at: AT,
    });

    // Reaching past the module must still fail: the guarantee is the database's.
    assert.throws(
      () => store.db.prepare('UPDATE work_log SET action = ? WHERE seq = 1').run('cleared'),
      /append-only/,
    );
    assert.throws(() => store.db.prepare('DELETE FROM work_log WHERE seq = 1').run(), /append-only/);

    const entries = readWorkLog(store, 'run-1');
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].detail, { note: 'needs a licensed human' });
  });
});

test('work log order is append order, not timestamp order', () => {
  withStore((store) => {
    // A skewed or repeated host clock must not reorder the record.
    appendWorkLog(store, { run: 'r', role: 'a', action: 'first', at: '2026-08-03T10:00:00.000Z' });
    appendWorkLog(store, { run: 'r', role: 'b', action: 'second', at: '2026-08-03T09:00:00.000Z' });
    assert.deepEqual(
      readWorkLog(store, 'r').map((e) => e.action),
      ['first', 'second'],
    );
  });
});

test('re-import updates fields but never rewrites the raw_record audit copy', () => {
  withStore((store) => {
    const original = { id: 'construct-1', title: 'Original', status: 'open', quirk: 'unknown' };
    const projection = buildProjection(original, { importedAt: AT });
    putProjection(store, projection);

    const changed = buildProjection(
      { id: 'construct-1', title: 'Changed', status: 'closed', quirk: 'unknown' },
      { importedAt: '2026-08-04T00:00:00.000Z' },
    );
    putProjection(store, changed);

    assert.equal(countProjections(store), 1, 're-import must update, not duplicate');
    const stored = getProjection(store, projection.id);
    assert.ok(stored);
    assert.equal(stored.fields.title, 'Changed');
    assert.deepEqual(stored.raw_record, original, 'audit copy must survive verbatim');
    assert.equal(stored.importedAt, AT, 'original import time must survive');
  });
});

test('projections round-trip zero-loss through storage, unknown fields included', () => {
  withStore((store) => {
    const issue = {
      id: 'construct-2',
      title: 'T',
      dependencies: [{ issue_id: 'construct-2', depends_on_id: 'construct-1' }],
      a_field_this_model_has_never_heard_of: { nested: [1, 2, { deep: true }] },
    };
    putProjection(store, buildProjection(issue, { importedAt: AT }));
    const stored = listProjections(store)[0];
    assert.deepEqual(stored.raw_record, issue);
    assert.deepEqual(stored.fields.a_field_this_model_has_never_heard_of, {
      nested: [1, 2, { deep: true }],
    });
  });
});

test('a decision needs at least two cited positions', () => {
  withStore((store) => {
    assert.throws(
      () =>
        raiseDecision(store, {
          id: 'd1',
          run: 'r',
          question: 'ship or wait?',
          positions: [{ role: 'issue-spotter', stance: 'wait', citation: 'GDPR Art. 6' }],
          raisedAt: AT,
        }),
      /at least two cited positions/,
    );
    assert.equal(openDecisions(store).length, 0);
  });
});

test('the inbox holds open decisions and resolution comes from outside', () => {
  withStore((store) => {
    raiseDecision(store, {
      id: 'd1',
      run: 'r',
      question: 'ship the beta before the DPA is signed?',
      positions: [
        { role: 'issue-spotter', stance: 'wait', citation: 'GDPR Art. 28' },
        { role: 'program', stance: 'ship', citation: 'launch commitment 2026-09-01' },
      ],
      raisedAt: AT,
    });

    const inbox = openDecisions(store, 'r');
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].positions.length, 2, 'both sides survive with their citations');
    assert.equal(inbox[0].resolution, null, 'nothing auto-arbitrates');

    resolveDecision(store, 'd1', 'wait for the DPA', '2026-08-04T00:00:00.000Z', 'cli:user');
    assert.equal(openDecisions(store, 'r').length, 0);
    const resolved = getDecision(store, 'd1');
    assert.equal(resolved?.state, 'resolved');
    assert.equal(resolved?.resolution, 'wait for the DPA');
    assert.equal(resolved?.resolvedBy, 'cli:user', 'the resolver provenance is recorded');

    assert.throws(() => resolveDecision(store, 'd1', 'again', AT, 'cli:user'), /no open decision/);
  });
});

test('transact rolls back a failed multi-write', () => {
  withStore((store) => {
    assert.throws(() => {
      transact(store, () => {
        putProjection(store, buildProjection({ id: 'construct-3' }, { importedAt: AT }));
        throw new Error('boom');
      });
    }, /boom/);
    assert.equal(countProjections(store), 0);
  });
});

test('implication_feedback is append-only at the storage layer, not by convention', () => {
  withStore((store) => {
    appendFeedback(store, {
      run: 'run-1',
      outcome: 'ship the EU beta',
      verdicts: { privacy: 'confirmed', security: 'dismissed' },
      source: 'gerald',
      recordedAt: AT,
    });

    assert.throws(
      () =>
        store.db
          .prepare("UPDATE implication_feedback SET source = 'someone-else' WHERE seq = 1")
          .run(),
      /append-only/,
    );
    assert.throws(
      () => store.db.prepare('DELETE FROM implication_feedback WHERE seq = 1').run(),
      /append-only/,
    );

    const entries = readFeedback(store, 'run-1');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].source, 'gerald');
  });
});

test('feedback round-trips deterministically at the store boundary', () => {
  withStore((store) => {
    appendFeedback(store, {
      run: 'run-1',
      outcome: 'ship the EU beta',
      verdicts: { privacy: 'confirmed', security: 'dismissed' },
      source: 'gerald',
      recordedAt: AT,
      category: 'privacy',
    });
    appendFeedback(store, {
      run: 'run-1',
      outcome: 'ship the EU beta',
      verdicts: { finance: 'missed' },
      source: 'gerald',
      recordedAt: '2026-08-04T00:00:00.000Z',
    });

    // Reading the same store twice yields byte-identical records, in append
    // order — the same discipline the work log holds, and for the same
    // reason: a harvested corpus must be reproducible from the store alone.
    const first = readFeedback(store, 'run-1');
    const second = readFeedback(store, 'run-1');
    assert.deepEqual(first, second);
    assert.deepEqual(
      first.map((entry) => entry.seq),
      [1, 2],
    );
    assert.deepEqual(first[0].verdicts, { privacy: 'confirmed', security: 'dismissed' });
    assert.equal(first[0].category, 'privacy');
    assert.equal(first[1].category, undefined, 'no category is not the string "null"');
  });
});

test('feedback survives process death: a reopened store reads back what a closed one wrote', () => {
  const fixture = sterile();
  try {
    const path = join(fixture.root, 'data', 'construct.db');
    const first = openStore(path);
    appendFeedback(first, {
      run: 'run-1',
      outcome: 'ship the EU beta',
      verdicts: { privacy: 'confirmed' },
      source: 'gerald',
      recordedAt: AT,
    });
    first.close(); // simulate the process exiting

    const reopened = openStore(path);
    try {
      const entries = readFeedback(reopened, 'run-1');
      assert.equal(entries.length, 1);
      assert.deepEqual(entries[0].verdicts, { privacy: 'confirmed' });
    } finally {
      reopened.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('the store module reads neither the clock nor the environment', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../../../src/kernel/store/', import.meta.url);
  // Comments are stripped first: these modules discuss the clock discipline in
  // prose, and a guard that fails on its own documentation checks nothing.
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const file of readdirSync(dir)) {
    const code = stripComments(readFileSync(new URL(file, dir), 'utf8'));
    assert.ok(!/new Date\(|Date\.now\(/.test(code), `${file} must not read the clock`);
    assert.ok(!/process\.env|homedir\(/.test(code), `${file} must not read the environment`);
  }
});

/**
 * The calibration log is additive, which is a claim about a store that already
 * exists rather than about the statement that creates it. So the fixture is a
 * store built without it — the work log, its append-only triggers, one row —
 * opened by this build, which must add the new table beside them and leave
 * every one of them exactly as it was.
 */
test('a store written before judgments were logged keeps its rows and its triggers', () => {
  const fixture = sterile();
  try {
    const path = join(fixture.root, 'data', 'construct.db');
    mkdirSync(join(fixture.root, 'data'), { recursive: true });
    const before = new DatabaseSync(path);
    before.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE work_log (
        seq         INTEGER PRIMARY KEY AUTOINCREMENT,
        run         TEXT NOT NULL,
        task        TEXT,
        role        TEXT NOT NULL,
        action      TEXT NOT NULL,
        detail      TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER work_log_no_update
      BEFORE UPDATE ON work_log
      BEGIN SELECT RAISE(ABORT, 'work_log is append-only'); END;
    `);
    before.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', '19');
    before
      .prepare('INSERT INTO work_log (run, role, action, detail, recorded_at) VALUES (?, ?, ?, ?, ?)')
      .run('run-old', 'privacy', 'dispatched', '{}', AT);
    before.close();

    const store = openStore(path);
    try {
      const kept = readWorkLog(store, 'run-old');
      assert.equal(kept.length, 1);
      assert.equal(kept[0].action, 'dispatched');
      assert.throws(
        () => store.db.prepare("UPDATE work_log SET action = 'x' WHERE seq = 1").run(),
        /append-only/,
        'the work log trigger is untouched',
      );

      // Additive: the new table is there, empty, and a judgment can be logged
      // against the pre-existing run without that run's log row moving.
      assert.deepEqual(estimativeJudgmentsFor(store, 'run-old'), []);
      recordEstimativeJudgment(
        store,
        {
          run: 'run-old',
          decision: 'run-old:stance',
          judgment: assessRisk({
            claim: 'the cutover loses rows',
            percent: 60,
            confidence: {
              level: 'moderate',
              basis: {
                informationBase: 'two prior migrations are logged',
                analyticalRigour: 'one pass, unchecked',
                complexityAndVolatility: 'the schema still moves weekly',
              },
            },
            resolution: 'the row counts on both sides of the first cutover',
            horizon: 'within 30 days',
            referenceClass: null,
          }),
        },
        AT,
      );
      const logged = estimativeJudgmentsFor(store, 'run-old');
      assert.equal(logged.length, 1);
      // The integer is what is kept: the band is a rendering of it, and a
      // calibration curve is drawn over the numbers.
      assert.ok(logged[0].seq >= 1);
      assert.equal(logged[0].percent, 60);
      assert.equal(logged[0].confidence, 'moderate');
      assert.equal(logged[0].horizon, 'within 30 days');
      assert.equal(logged[0].referenceClass, null);
      assert.equal(logged[0].recordedAt, AT);
      assert.equal(readWorkLog(store, 'run-old').length, 1);

      resolveEstimativeJudgment(store, logged[0].seq, 'did_not_happen', AT);
      assert.throws(
        () => resolveEstimativeJudgment(store, logged[0].seq, 'happened', AT),
        /already resolved/,
      );

      assert.throws(
        () => store.db.prepare('UPDATE estimative_judgments SET percent = 90').run(),
        /append-only/,
      );
      assert.throws(() => store.db.prepare('DELETE FROM estimative_judgments').run(), /append-only/);
      assert.throws(
        () => store.db.prepare('UPDATE estimative_resolutions SET outcome = ?').run('happened'),
        /append-only/,
      );
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('a likelihood that never resolves cannot be logged as one that could', () => {
  withStore((store) => {
    assert.throws(
      () =>
        store.db
          .prepare(
            `INSERT INTO estimative_judgments
               (run, claim, percent, confidence, resolution, horizon, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run('run-1', 'the cutover loses rows', 60, 'low', 'counts on both sides', '30 days', AT),
      /CHECK constraint failed/,
      'the ladder holds at the storage seam: a band needs moderate confidence or better',
    );
    assert.throws(
      () =>
        store.db
          .prepare(
            `INSERT INTO estimative_judgments
               (run, claim, percent, confidence, resolution, horizon, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run('run-1', 'the cutover loses rows', 100, 'high', 'counts on both sides', '30 days', AT),
      /CHECK constraint failed/,
      '100 is a statement of fact, not an estimate',
    );
  });
});
