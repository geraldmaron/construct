/**
 * tests/kernel/store/lessons.test.ts — the lesson store's scope rules.
 *
 * The properties tested here are the confidentiality design, not conveniences:
 * a workspace-scoped read must be unable to return another workspace's lesson,
 * promotion must refuse the kinds that carry client facts and strip the words
 * of the ones it allows, and a workspace with no recorded consent must consume
 * nothing global. Each is held as a property of the store — triggers and write
 * paths — rather than of callers behaving.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import {
  getLesson,
  lessonsFor,
  promoteLesson,
  recordLesson,
  setWorkspaceConsent,
  stripForPromotion,
  workspaceConsumesGlobal,
} from '../../../src/kernel/store/lessons.ts';

const AT = '2026-08-05T00:00:00.000Z';
const LATER = '2026-08-05T01:00:00.000Z';

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

function clientLesson(id: string, workspace: string, overrides: Partial<Parameters<typeof recordLesson>[1]> = {}) {
  return {
    id,
    workspace,
    kind: 'domain' as const,
    body: 'Their notice period is "three months per the 2024 addendum" [cite:addendum.pdf p.3]',
    citation: 'addendum.pdf',
    external: false,
    createdAt: AT,
    ...overrides,
  };
}

test('a read scoped to workspace A never returns a workspace-B lesson', () => {
  withStore((store) => {
    recordLesson(store, clientLesson('l-a', 'client-a'));
    recordLesson(store, clientLesson('l-b', 'client-b'));

    const forA = lessonsFor(store, 'client-a');
    assert.deepEqual(forA.map((l) => l.id), ['l-a']);
    assert.ok(forA.every((l) => l.workspace === 'client-a'));
  });
});

test('a lesson records its provenance, including that its source was ingested from outside', () => {
  withStore((store) => {
    recordLesson(store, clientLesson('l-ext', 'client-a', { external: true }));
    const found = getLesson(store, 'l-ext');
    assert.ok(found);
    assert.equal(found.external, true);
    assert.equal(found.citation, 'addendum.pdf');
    assert.equal(found.workspace, 'client-a');
  });
});

test('a lesson with no workspace cannot be stored', () => {
  withStore((store) => {
    assert.throws(() => recordLesson(store, clientLesson('l-none', '')), /no workspace/);
    assert.equal(getLesson(store, 'l-none'), null);
  });
});

test('lessons are immutable strata: the database refuses UPDATE and DELETE', () => {
  withStore((store) => {
    recordLesson(store, clientLesson('l-fixed', 'client-a'));
    assert.throws(() => store.db.prepare("UPDATE lessons SET body = 'edited' WHERE id = ?").run('l-fixed'));
    assert.throws(() => store.db.prepare('DELETE FROM lessons WHERE id = ?').run('l-fixed'));
  });
});

test('promotion refuses a domain lesson: only technique and process may leave their workspace', () => {
  withStore((store) => {
    recordLesson(store, clientLesson('l-dom', 'client-a'));
    assert.throws(() => promoteLesson(store, 'l-dom', 'l-dom-g', LATER), /only technique and process/);
  });
});

test('promotion appends a stripped global row and never touches the original', () => {
  withStore((store) => {
    recordLesson(store, clientLesson('l-tech', 'client-a', {
      kind: 'technique',
      body: 'Ask for the addendum first: "three months per the 2024 addendum" [cite:addendum.pdf p.3]',
    }));

    const promoted = promoteLesson(store, 'l-tech', 'l-tech-g', LATER);
    assert.equal(promoted.scope, 'global');
    assert.equal(promoted.promotedFrom, 'l-tech');
    assert.ok(!promoted.body.includes('three months'), 'quoted client facts must not travel');
    assert.ok(!promoted.body.includes('addendum.pdf'), 'source citations must not travel');
    assert.equal(promoted.citation, 'lesson:l-tech');

    const original = getLesson(store, 'l-tech');
    assert.ok(original);
    assert.equal(original.scope, 'workspace');
    assert.ok(original.body.includes('three months'), 'the original keeps its words');
  });
});

test('a promoted row cannot be promoted again', () => {
  withStore((store) => {
    recordLesson(store, clientLesson('l-t2', 'client-a', { kind: 'process', body: 'plain process' }));
    promoteLesson(store, 'l-t2', 'l-t2-g', LATER);
    assert.throws(() => promoteLesson(store, 'l-t2-g', 'l-t2-gg', LATER), /already global/);
  });
});

test('a workspace with no recorded consent consumes no global lessons', () => {
  withStore((store) => {
    recordLesson(store, clientLesson('l-t3', 'client-a', { kind: 'technique', body: 'plain technique' }));
    promoteLesson(store, 'l-t3', 'l-t3-g', LATER);

    assert.equal(workspaceConsumesGlobal(store, 'client-b'), false);
    assert.deepEqual(lessonsFor(store, 'client-b'), []);

    setWorkspaceConsent(store, 'client-b', true, LATER);
    assert.deepEqual(lessonsFor(store, 'client-b').map((l) => l.id), ['l-t3-g']);

    setWorkspaceConsent(store, 'client-b', false, LATER);
    assert.deepEqual(lessonsFor(store, 'client-b'), []);
  });
});

test('a superseded lesson leaves prompt assembly but never the store', () => {
  withStore((store) => {
    recordLesson(store, clientLesson('l-old', 'client-a'));
    recordLesson(store, clientLesson('l-new', 'client-a', { supersedes: 'l-old', createdAt: LATER }));

    assert.deepEqual(lessonsFor(store, 'client-a').map((l) => l.id), ['l-new']);
    assert.ok(getLesson(store, 'l-old'), 'provenance survives supersession');
  });
});

test('one workspace cannot supersede another workspace\'s lesson', () => {
  withStore((store) => {
    recordLesson(store, clientLesson('l-a1', 'client-a'));
    assert.throws(
      () => recordLesson(store, clientLesson('l-b1', 'client-b', { supersedes: 'l-a1' })),
      /may not supersede/,
    );
    assert.deepEqual(lessonsFor(store, 'client-a').map((l) => l.id), ['l-a1']);
  });
});

test('stripForPromotion removes quoted spans and citation bodies, curly quotes included', () => {
  const stripped = stripForPromotion('Rule: “per the 2024 addendum”, cite it [cite:addendum.pdf p.3]');
  assert.ok(!stripped.includes('2024 addendum'));
  assert.ok(!stripped.includes('addendum.pdf'));
});
