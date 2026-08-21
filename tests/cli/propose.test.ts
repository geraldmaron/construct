/**
 * tests/cli/propose.test.ts — a run's findings becoming write proposals
 * through the real surface.
 *
 * The properties held here are the ones a person acting on the queue depends
 * on: the rows land only against a source the workspace actually declared,
 * every row carries the citation of the finding behind it, the tier follows
 * the action, a second extraction files nothing twice, and no decision is
 * recorded by proposing — the queue comes back pending, which is what makes
 * the apply path somebody else's step.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, work } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { listTasks } from '../../src/kernel/store/tasks.ts';
import { addSource, decisionOf, pendingProposals } from '../../src/kernel/store/sources.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(steps: ReadonlyArray<string[] | (() => Promise<number> | number)>): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-propose-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  let code = 0;
  try {
    for (const step of steps) code = typeof step === 'function' ? await step() : await main(step);
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
}

/** A host answering each dispatched role with a document that has findings in it. */
function workHost(): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      const { role } = request as { role: string };
      return {
        id: role,
        status: 'ok',
        output: {
          text: [
            '## Issues',
            '',
            `1. The PRD promises SSO at launch while the strategy defers identity work, per ${role}.`,
            '2. Update the roadmap entry so it names the deferred quarter rather than "later".',
            '',
            '## What follows',
            '',
            '- File a ticket for the identity gap before the launch review.',
          ].join('\n'),
        },
        error: null,
      };
    },
  };
}

/** The run the last `outcome` queued, read from the store rather than scraped. */
function latestRun(): string {
  const store = openStore(storePath(resolvePaths()));
  try {
    const runs = listTasks(store).map((task) => task.run);
    return runs[runs.length - 1] ?? '';
  } finally {
    store.close();
  }
}

function declareSource(id = 'src-1'): () => number {
  return () => {
    const store = openStore(storePath(resolvePaths()));
    try {
      addSource(store, {
        id,
        workspace: 'default',
        kind: 'jira',
        locator: 'PROJ',
        addedAt: new Date().toISOString(),
      });
    } finally {
      store.close();
    }
    return 0;
  };
}

const OUTCOME = 'Report what the launch documents disagree about';

test('a finished run becomes cited, risk-tiered proposals that nothing has acted on', async () => {
  let pending: ReturnType<typeof pendingProposals> = [];
  let decided = 0;
  const { code, out } = await run([
    ['outcome', '--domains=strategy-alignment', OUTCOME],
    declareSource(),
    () => work([], workHost()),
    () => main(['propose', `--run=${latestRun()}`, '--source=src-1']),
    () => {
      const store = openStore(storePath(resolvePaths()));
      try {
        pending = pendingProposals(store, 'default');
        decided = pending.filter((p) => decisionOf(store, p.id) !== null).length;
      } finally {
        store.close();
      }
      return 0;
    },
  ]);

  assert.equal(code, 0);
  assert.equal(pending.length, 3, 'two numbered issues and one what-follows item');
  assert.equal(decided, 0, 'proposing decides nothing');

  for (const proposal of pending) {
    assert.match(proposal.justification, /^deliverable:[^#]+#L\d+ /, 'every row cites its finding');
    assert.match(proposal.change, /PROJ/, 'the change names the source the way a person knows it');
    assert.equal(proposal.source, 'src-1');
  }
  // A report is recorded as a comment; an instruction to change something is
  // the high tier no standing consent covers.
  assert.deepEqual(
    pending.map((p) => p.risk).sort(),
    ['high', 'high', 'low'],
  );
  assert.match(out, /\[low, comment\]/);
  assert.match(out, /\[high, update\]/);
  assert.match(out, /\[high, create\]/);
  assert.match(out, /filed 3 proposal\(s\) against jira PROJ \(1 low, 2 high\)/);
  assert.match(out, /Nothing was written anywhere outside this system/);
});

test('proposing twice files nothing twice and says which rows already stood', async () => {
  let count = 0;
  const { out } = await run([
    ['outcome', '--domains=strategy-alignment', OUTCOME],
    declareSource(),
    () => work([], workHost()),
    () => main(['propose', `--run=${latestRun()}`, '--source=src-1']),
    () => main(['propose', `--run=${latestRun()}`, '--source=src-1']),
    () => {
      const store = openStore(storePath(resolvePaths()));
      try {
        count = pendingProposals(store, 'default').length;
      } finally {
        store.close();
      }
      return 0;
    },
  ]);
  assert.equal(count, 3);
  assert.match(out, /already proposed; the earlier row stands/);
  assert.match(out, /filed 0 proposal\(s\).*3 already proposed/s);
});

test('--dry-run shows the rows and files none', async () => {
  let count = -1;
  const { out } = await run([
    ['outcome', '--domains=strategy-alignment', OUTCOME],
    declareSource(),
    () => work([], workHost()),
    () => main(['propose', `--run=${latestRun()}`, '--source=src-1', '--dry-run']),
    () => {
      const store = openStore(storePath(resolvePaths()));
      try {
        count = pendingProposals(store, 'default').length;
      } finally {
        store.close();
      }
      return 0;
    },
  ]);
  assert.equal(count, 0);
  assert.match(out, /nothing was filed: --dry-run/);
});

test('a source the workspace never declared is refused, with the ones it did declare named', async () => {
  const { code, err } = await run([
    ['outcome', '--domains=strategy-alignment', OUTCOME],
    declareSource(),
    () => work([], workHost()),
    () => main(['propose', `--run=${latestRun()}`, '--source=src-nowhere']),
  ]);
  assert.equal(code, 1);
  assert.match(err, /declares no source src-nowhere/);
});

test('extraction without a named source refuses and lists what a change could be made against', async () => {
  const { code, err } = await run([
    ['outcome', '--domains=strategy-alignment', OUTCOME],
    declareSource(),
    () => work([], workHost()),
    () => main(['propose', `--run=${latestRun()}`]),
  ]);
  assert.equal(code, 2);
  assert.match(err, /name the source these changes would be made against/);
  assert.match(err, /--source=src-1 {2}\(jira PROJ\)/);
});

test('the waiting queue lists what it has, and says nothing has been carried out', async () => {
  const { code, out } = await run([
    ['outcome', '--domains=strategy-alignment', OUTCOME],
    declareSource(),
    () => work([], workHost()),
    () => main(['propose', `--run=${latestRun()}`, '--source=src-1']),
    () => main(['propose', 'list']),
  ]);
  assert.equal(code, 0);
  assert.match(out, /proposals waiting in workspace default \(3\)/);
  assert.match(out, /A proposal moves only through a recorded decision/);
});

test('a run with no finished deliverable proposes nothing and says where to look', async () => {
  const { code, err } = await run([
    ['outcome', '--domains=strategy-alignment', OUTCOME],
    declareSource(),
    () => main(['propose', `--run=${latestRun()}`, '--source=src-1']),
  ]);
  assert.equal(code, 1);
  assert.match(err, /has no finished deliverable to read/);
});
