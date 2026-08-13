/**
 * tests/cli/notes.test.ts — the notes command through its real surface.
 *
 * The wiring under test: a dropped file is recorded verbatim before any model
 * is consulted, the free path records and stops with the cost stated, and the
 * host path runs the whole loop — densify, produce, challenge, apply — with
 * every drop shown: a refuted delta, an undeclared source, an uncited
 * observation. The admitted delta and the pending proposal are checked in the
 * store, not just in the transcript.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main, notes } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { addSource, pendingProposals } from '../../src/kernel/store/sources.ts';
import { addRecord, currentFields } from '../../src/kernel/store/records.ts';
import { notesFor } from '../../src/kernel/store/notes.ts';
import { operationalLessonsFor } from '../../src/kernel/lessons/admission.ts';

const NOTE = 'they want the pilot in Q4\npricing stays flat\nupdate PROJ-14 with the new date';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Run steps against one throwaway data dir with a note file beside it. */
async function run(
  steps: (file: string) => ReadonlyArray<string[] | (() => Promise<number> | number)>,
): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-notes-'));
  const previous = process.env.XDG_DATA_HOME;
  const previousCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  // The loop surveys declared ground and extracts what it cannot read; an
  // extraction written into the real home is the leak the harness prevents.
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const file = join(root, 'after-call.txt');
  writeFileSync(file, NOTE);
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  (process.stderr as { write: unknown }).write = (chunk: string) => {
    err.push(String(chunk));
    return true;
  };
  let code = 0;
  try {
    for (const step of steps(file)) {
      code = typeof step === 'function' ? await step() : await main(step);
    }
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCache;
    rmSync(root, { recursive: true, force: true });
  }
}

function withStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const store = openStore(storePath(resolvePaths()));
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

/**
 * A host that answers each loop role in kind. The producer reads the note id
 * out of its own prompt, exactly as a model must, so its citations name the
 * note the CLI actually recorded.
 */
function loopHost(): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      const { role, task } = request as { role: string; task: string };
      let text = '';
      if (role === 'intake-densifier') {
        text = JSON.stringify({
          outcome: 'move the pilot to Q4',
          constraints: [],
          decisions: ['pricing stays flat'],
          parked: [],
        });
      } else if (role === 'context-producer') {
        const noteId = /note id (\S+)\)/.exec(task)?.[1] ?? 'unknown';
        text = JSON.stringify({
          deltas: [
            {
              kind: 'process',
              domain: 'product-scoping',
              body: 'this client decides scope by quarter',
              citation: `note:${noteId}#L1`,
              external: false,
            },
            {
              kind: 'process',
              domain: 'product-scoping',
              body: 'refute me',
              citation: `note:${noteId}#L2`,
              external: false,
            },
          ],
          proposals: [
            {
              source: 'src-1',
              change: 'move PROJ-14 target date to Q4',
              justification: `note:${noteId}#L3`,
              risk: 'low',
            },
            {
              source: 'src-ghost',
              change: 'change an undeclared tracker',
              justification: `note:${noteId}#L3`,
              risk: 'low',
            },
          ],
          records: [
            {
              record: 'rec-acme',
              field: 'renewal',
              value: 'Q4',
              citation: `note:${noteId}#L1`,
            },
            {
              record: 'rec-ghost',
              field: 'renewal',
              value: 'Q4',
              citation: `note:${noteId}#L1`,
            },
          ],
          observations: [
            {
              claim: 'the PRD promises SSO at launch but the strategy defers identity work',
              citations: [
                { source: 'src-1', document: 'docs/prd.md' },
                { source: 'src-1', document: 'docs/strategy.md' },
              ],
            },
            { claim: 'the roadmap feels ambitious', citations: [] },
          ],
        });
      } else if (role === 'context-challenger') {
        const refuted = task.includes('refute me');
        text = JSON.stringify({
          refuted,
          reason: refuted ? 'it generalizes one remark into a standing fact' : 'the cited line supports it',
        });
      }
      return { id: role, status: 'ok', output: { text }, error: null };
    },
  };
}

test('without a host the note is recorded verbatim and the loop is priced, not guessed', async () => {
  const { code, out } = await run((file) => [['notes', file]]);
  assert.equal(code, 0);
  assert.match(out, /3 lines recorded verbatim/);
  assert.match(out, /model work, at cost/);
});

test('the host path runs the whole loop, and every drop is shown with its reason', async () => {
  const { code, out } = await run((file) => [
    () =>
      withStore((store) => {
        addSource(store, {
          id: 'src-1',
          workspace: 'default',
          kind: 'jira',
          locator: 'PROJ',
          addedAt: '2026-08-05T00:00:00.000Z',
        });
        return 0;
      }),
    () => notes([file], loopHost()),
    () =>
      withStore((store) => {
        // The store, not the transcript, is the record: one delta survived
        // the challenge and the gate; one proposal waits undecided.
        assert.equal(operationalLessonsFor(store, 'default').length, 1);
        assert.equal(pendingProposals(store, 'default').length, 1);
        assert.equal(notesFor(store, 'default').length, 1);
        return 0;
      }),
  ]);
  assert.equal(code, 0);
  assert.match(out, /confirm this reading first/);
  assert.match(out, /Outcome: move the pilot to Q4/);
  assert.match(out, /admitted: .*-d1/);
  assert.match(out, /refuted: delta "refute me" — it generalizes/);
  assert.match(out, /filed 1 propagation proposal/);
  assert.match(out, /nothing was written outward/);
  assert.match(out, /targets src-ghost, which is not a declared source/);
  assert.match(out, /cross-source drift:/);
  assert.match(out, /the PRD promises SSO at launch/);
  assert.match(out, /discarded observation: the roadmap feels ambitious.*no citation/);
});

test('an unreadable file fails before anything is recorded', async () => {
  const { code, err } = await run(() => [['notes', '/nonexistent/notes.txt']]);
  assert.equal(code, 1);
  assert.match(err, /cannot read/);
});

test('host flags without a host are refused as lies waiting to happen', async () => {
  const { code, err } = await run((file) => [['notes', file, '--model=gpt']]);
  assert.equal(code, 2);
  assert.match(err, /--model only applies when a host is named/);
});

test('a directory ingests every document as its own note, and one refusal does not end the batch', async () => {
  const { code, out, err } = await run((file) => [
    () => {
      // Beside the readable notes: a document no rung on any machine can put
      // into words, so the refusal is the same everywhere the suite runs.
      const dir = dirname(file);
      writeFileSync(join(dir, 'second-call.txt'), 'they want SSO\nbudget is approved');
      writeFileSync(join(dir, 'recording.mp4'), Buffer.from([0, 1, 2]));
      return 0;
    },
    () => main(['notes', dirname(file)]),
  ]);
  assert.equal(code, 0, 'documents that could be read are evidence whatever happened to the rest');
  assert.match(out, /ingesting 3 documents/);
  assert.match(err, /ASR/);
  assert.match(out, /1 document could not be read and is not recorded; 2 landed/);
  assert.equal((out.match(/recorded verbatim/g) ?? []).length, 2);
});

test('every note in a batch gets its own row and its own loop', async () => {
  const { code, out } = await run((file) => [
    () => {
      writeFileSync(join(dirname(file), 'second-call.txt'), 'they want SSO\nbudget is approved');
      return 0;
    },
    () => notes([dirname(file)], loopHost()),
    () =>
      withStore((store) => {
        assert.equal(notesFor(store, 'default').length, 2, 'two documents, two notes');
        return 0;
      }),
  ]);
  assert.equal(code, 0);
  assert.equal((out.match(/confirm this reading first/g) ?? []).length, 2, 'each note is reasoned over');
});

test('a directory holding nothing readable says so rather than recording an empty pass', async () => {
  const { code, err } = await run((file) => [
    () => {
      mkdirSync(join(dirname(file), 'empty'));
      return 0;
    },
    () => main(['notes', join(dirname(file), 'empty')]),
  ]);
  assert.equal(code, 1);
  assert.match(err, /holds no documents this install can read/);
});

test('a fact about a named subject lands on its record, and one about no subject is dropped', async () => {
  const { code, out } = await run((file) => [
    () =>
      withStore((store) => {
        addSource(store, {
          id: 'src-1',
          workspace: 'default',
          kind: 'jira',
          locator: 'PROJ',
          addedAt: '2026-08-05T00:00:00.000Z',
        });
        addRecord(store, {
          id: 'rec-acme',
          workspace: 'default',
          kind: 'customer',
          name: 'Acme',
          createdAt: '2026-08-05T00:00:00.000Z',
        });
        return 0;
      }),
    () => notes([file], loopHost()),
    () =>
      withStore((store) => {
        const fields = currentFields(store, 'rec-acme');
        assert.equal(fields.length, 1, 'the fact about Acme is on Acme, not in workspace memory');
        assert.equal(fields[0]?.field, 'renewal');
        assert.equal(fields[0]?.value, 'Q4');
        assert.match(fields[0]?.citation ?? '', /^note:.+#L1$/, 'and it cites the line that taught it');
        return 0;
      }),
  ]);
  assert.equal(code, 0);
  assert.match(out, /records updated \(1\)/);
  assert.match(out, /rec-acme renewal/);
  assert.match(out, /rec-ghost\.renewal names a record this workspace does not keep/);
});

test('a batch states what it is about to spend, and stops at the note limit rather than after it', async () => {
  const { code, out } = await run((file) => [
    () => {
      writeFileSync(join(dirname(file), 'second-call.txt'), 'they want SSO\nbudget is approved');
      writeFileSync(join(dirname(file), 'third-call.txt'), 'they want audit logs');
      return 0;
    },
    () => notes([dirname(file), '--max-notes=2'], loopHost()),
    () =>
      withStore((store) => {
        assert.equal(notesFor(store, 'default').length, 3, 'every document is still recorded evidence');
        return 0;
      }),
  ]);
  assert.equal(code, 0);
  assert.match(out, /reasoning over 2 notes: at least 6 model calls/);
  assert.match(out, /1 more note is recorded and left unreasoned \(--max-notes=2\)/);
  assert.match(out, /--max-notes=3/, 'and the command that takes the rest');
  assert.equal(
    (out.match(/confirm this reading first/g) ?? []).length,
    2,
    'the limit binds before the dispatch, not after it',
  );
});

test('a note limit that would list nothing is refused as a lie waiting to happen', async () => {
  const { code, err } = await run((file) => [['notes', file, '--max-notes=0']]);
  assert.equal(code, 2);
  assert.match(err, /--max-notes must be a positive whole number/);
});
