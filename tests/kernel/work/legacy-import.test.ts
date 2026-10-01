/**
 * tests/kernel/work/legacy-import.test.ts — frozen tracker JSONL imports
 * idempotently, preserves ids and history, and reports malformed rows.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshStore } from '../state/support.ts';
import { importLegacySnapshot } from '../../../src/kernel/work/legacy-import.ts';
import { getWork, listWorkDependencies, queryWork } from '../../../src/kernel/work/service.ts';

const AT = '2026-09-20T12:00:00.000Z';

test('legacy JSONL import is idempotent and maps closed items as historical', () => {
  const fx = freshStore();
  try {
    let n = 0;
    const jsonl = [
      JSON.stringify({
        _type: 'issue',
        id: 'legacy-open',
        title: 'Open item',
        description: 'do it',
        status: 'open',
        issue_type: 'task',
        created_at: AT,
        dependencies: [],
      }),
      JSON.stringify({
        _type: 'issue',
        id: 'legacy-closed',
        title: 'Closed item',
        description: 'done',
        status: 'closed',
        issue_type: 'bug',
        created_at: AT,
        closed_at: AT,
        close_reason: 'shipped',
        dependencies: [{ depends_on_id: 'legacy-open', type: 'blocks' }],
      }),
      'not-json',
    ].join('\n');
    const first = importLegacySnapshot(fx.store, { jsonl, at: AT, dryRun: false, nextId: (p) => `${p}-${String(++n)}` });
    assert.equal(first.imported, 2);
    assert.equal(first.malformed.length, 1);
    assert.equal(getWork(fx.store, 'legacy-open')?.status, 'open');
    assert.equal(getWork(fx.store, 'legacy-closed')?.status, 'historical');
    assert.equal(getWork(fx.store, 'legacy-closed')?.kind, 'defect');
    assert.equal(listWorkDependencies(fx.store).length, 1);
    const second = importLegacySnapshot(fx.store, { jsonl, at: AT, dryRun: false, nextId: (p) => `${p}-${String(++n)}` });
    assert.equal(second.imported, 0);
    assert.equal(second.skipped, 2);
    assert.equal(second.malformed.length, 1, 'already-present dependencies are not malformed on rerun');
    assert.equal(queryWork(fx.store).total, 2);
  } finally {
    fx.cleanup();
  }
});

test('a dry run reports mapping without writing', () => {
  const fx = freshStore();
  try {
    const jsonl = JSON.stringify({ _type: 'issue', id: 'x', title: 'X', status: 'open', issue_type: 'task' });
    const report = importLegacySnapshot(fx.store, { jsonl, at: AT, dryRun: true, nextId: () => 'n' });
    assert.equal(report.dryRun, true);
    assert.equal(report.imported, 1);
    assert.equal(getWork(fx.store, 'x'), null);
  } finally {
    fx.cleanup();
  }
});
