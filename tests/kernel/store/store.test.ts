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
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { SCHEMA_VERSION, openStore, storePath, transact } from '../../../src/kernel/store/open.ts';
import {
  countProjections,
  getProjection,
  listProjections,
  putProjection,
} from '../../../src/kernel/store/projections.ts';
import { appendWorkLog, readWorkLog } from '../../../src/kernel/store/worklog.ts';
import {
  getDecision,
  openDecisions,
  raiseDecision,
  resolveDecision,
} from '../../../src/kernel/store/decisions.ts';
import { buildProjection } from '../../../src/kernel/tracker/projection.ts';

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

    resolveDecision(store, 'd1', 'wait for the DPA', '2026-08-04T00:00:00.000Z');
    assert.equal(openDecisions(store, 'r').length, 0);
    const resolved = getDecision(store, 'd1');
    assert.equal(resolved?.state, 'resolved');
    assert.equal(resolved?.resolution, 'wait for the DPA');

    assert.throws(() => resolveDecision(store, 'd1', 'again', AT), /no open decision/);
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
