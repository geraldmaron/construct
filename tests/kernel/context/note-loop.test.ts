/**
 * tests/kernel/context/note-loop.test.ts — the whole pass over one note,
 * driven from the sterile harness with the three model calls supplied as
 * arguments and both streams captured.
 *
 * The pass is the part that used to be reachable only by running the CLI, so
 * what is held here is what a reader of that output relies on: a delta the
 * challenger refutes never reaches memory and says why, a proposal aimed at an
 * undeclared source is dropped rather than filed, a failure at either model
 * call ends the pass without costing the note its row, and the observations
 * come back for the caller to print rather than being printed from inside.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { noteCitation, recordNote } from '../../../src/kernel/store/notes.ts';
import { addSource, pendingProposals } from '../../../src/kernel/store/sources.ts';
import { lessonsFor } from '../../../src/kernel/store/lessons.ts';
import { runNoteLoop } from '../../../src/kernel/context/note-loop.ts';
import type { NoteLoopCalls } from '../../../src/kernel/context/note-loop.ts';
import type { Report } from '../../../src/kernel/render/report.ts';

const AT = '2026-08-11T00:00:00.000Z';
const BODY = 'they want the pilot in Q4\npricing stays flat\nupdate PROJ-14 with the new date';

const DENSIFIED = {
  outcome: 'move the pilot to Q4',
  constraints: [],
  decisions: [],
  parked: [],
  underspecified: '',
};

/**
 * Awaited before the close: a `finally` that closes around a function still
 * running its host calls closes the database out from under the pass, which is
 * the same defect the CLI's own async store helper exists to avoid.
 */
async function withStore<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return await fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

function seed(store: Store): void {
  recordNote(store, {
    id: 'n-1',
    workspace: 'acme',
    run: 'run-1',
    door: 'file-drop',
    body: BODY,
    recordedAt: AT,
  });
  addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: 'PROJ', addedAt: AT });
}

interface Captured {
  readonly report: Report;
  readonly said: string[];
  readonly warned: string[];
}

function capture(): Captured {
  const said: string[] = [];
  const warned: string[] = [];
  return { report: { say: (t) => said.push(t), warn: (t) => warned.push(t) }, said, warned };
}

function calls(overrides: Partial<NoteLoopCalls> = {}): NoteLoopCalls {
  return {
    densify: async () => DENSIFIED,
    produce: async () => ({}),
    challenge: async () => ({ upheld: true, detail: 'the note says it in as many words' }),
    ...overrides,
  };
}

function input(report: Report) {
  return {
    noteId: 'n-1',
    body: BODY,
    workspace: 'acme',
    run: 'run-1',
    at: AT,
    sources: [
      {
        id: 'src-1',
        workspace: 'acme',
        kind: 'jira' as const,
        locator: 'PROJ',
        addedAt: AT,
        retiredAt: null,
      },
    ],
    producerSources: [{ id: 'src-1', kind: 'jira', locator: 'PROJ', documents: [] }],
    surveyed: new Map<string, ReadonlySet<string>>(),
    words: () => null,
    report,
  };
}

test('an upheld delta is recorded and a refuted one is named and dropped', async () => {
  await withStore(async (store) => {
    seed(store);
    const seen = capture();
    const upheld = { upheld: true, detail: 'the note says it in as many words' };
    const outcome = await runNoteLoop(
      store,
      calls({
        produce: async () => ({
          deltas: [
            {
              kind: 'domain',
              domain: 'product-scoping',
              body: 'they want the pilot in Q4',
              citation: noteCitation('n-1', 1),
              external: false,
            },
            {
              kind: 'domain',
              domain: 'product-scoping',
              body: 'pricing stays flat',
              citation: noteCitation('n-1', 2),
              external: false,
            },
          ],
        }),
        challenge: async (delta) =>
          delta.body === 'pricing stays flat'
            ? { upheld: false, detail: 'the note states it as a fact, not a preference' }
            : upheld,
      }),
      input(seen.report),
    );

    assert.equal(outcome.ran, true);
    const recorded = lessonsFor(store, 'acme');
    assert.deepEqual(
      recorded.map((l) => l.body),
      ['they want the pilot in Q4'],
      'only the delta that survived its challenge reaches memory',
    );
    assert.ok(
      seen.said.join('').includes('refuted: delta "pricing stays flat"'),
      'the refutation is said out loud rather than silently dropped',
    );
  });
});

test('a proposal against an undeclared source is dropped with its reason', async () => {
  await withStore(async (store) => {
    seed(store);
    const seen = capture();
    const outcome = await runNoteLoop(
      store,
      calls({
        produce: async () => ({
          proposals: [
            {
              source: 'src-nobody-declared',
              change: 'move PROJ-14 to Q4',
              justification: noteCitation('n-1', 3),
              risk: 'low',
            },
          ],
        }),
      }),
      input(seen.report),
    );

    assert.equal(outcome.ran, true);
    assert.equal(pendingProposals(store, 'acme').length, 0, 'nothing was filed');
    assert.ok(
      seen.said.join('').includes('which is not a declared source'),
      'the drop states which source it named',
    );
  });
});

test('a densifier that cannot answer ends the pass, and the note keeps its row', async () => {
  await withStore(async (store) => {
    seed(store);
    const seen = capture();
    const outcome = await runNoteLoop(
      store,
      calls({
        densify: () => Promise.reject(new Error('the host returned no text')),
      }),
      input(seen.report),
    );

    assert.equal(outcome.ran, false);
    assert.equal(seen.said.length, 0, 'a pass that never started reports nothing as done');
    assert.ok(seen.warned.join('').includes('It is recorded as n-1'));
    assert.equal(lessonsFor(store, 'acme').length, 0);
  });
});

test('the observations come back screened for the caller to print', async () => {
  await withStore(async (store) => {
    seed(store);
    const seen = capture();
    const outcome = await runNoteLoop(
      store,
      calls({
        produce: async () => ({
          observations: [
            {
              claim: 'the roadmap and the contract disagree about the pilot date',
              citations: [{ source: 'src-1', document: 'PROJ-14' }],
            },
          ],
        }),
      }),
      input(seen.report),
    );

    assert.equal(outcome.ran, true);
    assert.ok(outcome.ran && outcome.drift.discarded.length + outcome.drift.flags.length > 0);
    assert.ok(
      !seen.said.join('').includes('cross-source drift'),
      'the pass hands the screen back rather than printing it',
    );
  });
});
