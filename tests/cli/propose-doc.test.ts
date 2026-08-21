/**
 * tests/cli/propose-doc.test.ts — a change to a document proposed, listed and
 * decided through the surfaces that already exist.
 *
 * The properties held here are the ones that make a redline something a person
 * can act on. The row carries which document, the words on each side of the
 * change, and what grounds it, so approving it needs nothing else open. It
 * lists and decides through the same queue every other outward change uses.
 * Both document tiers come out high, so no standing consent carries one out.
 * And every way a change could arrive too vague to act on — no document, no
 * words it replaces, no place to go, no citation — is a refusal with the
 * reason said out loud rather than a row filed on a guess.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, work } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { listTasks } from '../../src/kernel/store/tasks.ts';
import {
  addSource,
  decisionOf,
  docEditFor,
  markApplied,
  pendingProposals,
  retireSource,
  setWriteConsent,
} from '../../src/kernel/store/sources.ts';
import type { DocEdit, ProposalDecision, WriteProposal } from '../../src/kernel/store/sources.ts';

type Step = string[] | ((root: string) => Promise<number> | number);

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(steps: readonly Step[]): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-propose-doc-'));
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
    for (const step of steps) code = typeof step === 'function' ? await step(root) : await main(step);
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

function inStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const store = openStore(storePath(resolvePaths()));
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

/** Declare the documents source a change is proposed against. */
function declareDocs(id = 'docs-1', locator = 'confluence:space:DOCS'): () => number {
  return () => {
    inStore((store) => {
      addSource(store, {
        id,
        workspace: 'default',
        kind: 'docs',
        locator,
        addedAt: new Date().toISOString(),
      });
    });
    return 0;
  };
}

function waiting(): WriteProposal[] {
  // A store that cannot open holds nothing waiting; asserting emptiness must
  // not itself require the store a shape refusal never opened.
  try {
    return inStore((store) => pendingProposals(store, 'default'));
  } catch {
    return [];
  }
}

const DOCUMENT = 'docs/adr/0007-storage.md';
const WAS = 'The store is opened read-only by every consumer.';
const NOW = 'The store is opened for writing by the coordinator alone.';
const CITATION = 'note:n-4#L12';

/** The flags a well-formed redline arrives with. */
function redline(extra: readonly string[] = []): string[] {
  return [
    'propose',
    'doc',
    '--source=docs-1',
    `--document=${DOCUMENT}`,
    '--kind=redline',
    `--was=${WAS}`,
    `--now=${NOW}`,
    `--because=${CITATION}`,
    ...extra,
  ];
}

test('a redline is recorded with its document, both halves and its citation, and decides through the existing queue', async () => {
  let filed: WriteProposal[] = [];
  const seen: { edit: DocEdit | null; verdict: ProposalDecision | null } = { edit: null, verdict: null };
  
  const { code, out } = await run([
    declareDocs(),
    redline(),
    ['propose', 'list'],
    ['decide', '--pending'],
    () => {
      filed = waiting();
      return 0;
    },
    () => main(['decide', `--approve=${waiting()[0].id}`, 'the coordinator is the only writer']),
    () => {
      seen.edit = inStore((store) => docEditFor(store, filed[0].id));
      seen.verdict = inStore((store) => decisionOf(store, filed[0].id));
      return 0;
    },
  ]);

  assert.equal(code, 0);
  assert.equal(filed.length, 1, 'one change waits');

  // The record carries which document, precisely, and the words on each side.
  assert.equal(seen.edit?.kind, 'redline');
  assert.equal(seen.edit?.document, DOCUMENT);
  assert.equal(seen.edit?.anchor, WAS);
  assert.equal(seen.edit?.proposed, NOW);

  // The same change, in the words a person approves and a host would be handed.
  assert.match(filed[0].change, /^redline docs\/adr\/0007-storage\.md in confluence:space:DOCS$/m);
  assert.match(filed[0].change, /--- was\n.*read-only/);
  assert.match(filed[0].change, /--- now\n.*coordinator alone/);
  assert.equal(filed[0].justification, CITATION);
  assert.equal(filed[0].source, 'docs-1');

  // Listed and decided through the queue that was already there, not a second one.
  assert.match(out, /proposals waiting in workspace default \(1\)/);
  assert.match(out, /outward changes waiting in workspace default \(1\)/);
  assert.match(out, /--- was/);
  assert.match(out, /justified by note:n-4#L12/);
  assert.match(out, /high risk is never covered by it/);
  assert.equal(seen.verdict?.verdict, 'approved');
  assert.equal(seen.verdict?.basis, 'human-approval');
});

test('the recorded change is immutable, like the proposal it details', async () => {
  const { code } = await run([
    declareDocs(),
    redline(),
    () => {
      const id = waiting()[0].id;
      inStore((store) => {
        assert.throws(() =>
          store.db.prepare('UPDATE doc_edits SET proposed = ? WHERE proposal = ?').run('anything', id),
        );
        assert.throws(() => store.db.prepare('DELETE FROM doc_edits WHERE proposal = ?').run(id));
        assert.equal(docEditFor(store, id)?.proposed, NOW);
      });
      return 0;
    },
  ]);
  assert.equal(code, 0);
});

test('a redline is high risk, so standing consent does not carry it out', async () => {
  let refusal = '';
  const { code } = await run([
    declareDocs(),
    () => {
      inStore((store) => setWriteConsent(store, 'default', true, new Date().toISOString()));
      return 0;
    },
    redline(),
    () => {
      const id = waiting()[0].id;
      inStore((store) => {
        assert.equal(decisionOf(store, id), null, 'proposing decides nothing');
        try {
          markApplied(store, id, 'applied anyway', new Date().toISOString());
        } catch (error) {
          refusal = (error as Error).message;
        }
      });
      return 0;
    },
  ]);
  assert.equal(code, 0);
  assert.match(refusal, /has no authority to apply/);
  assert.match(refusal, /high-risk never applies on standing consent/);
});

test('authoring a document carries its body, files at high risk, and reads from a file', async () => {
  const body = ['# Storage', '', 'The coordinator is the only writer.', ''].join('\n');
  let filed: WriteProposal[] = [];
  const seen: { edit: DocEdit | null; verdict: ProposalDecision | null } = { edit: null, verdict: null };

  const { code, out } = await run([
    declareDocs(),
    (root) => {
      writeFileSync(join(root, 'body.md'), body, 'utf8');
      return 0;
    },
    (root) =>
      main([
        'propose',
        'doc',
        '--source=docs-1',
        '--document=docs/adr/0012-storage.md',
        '--kind=authored',
        `--now-file=${join(root, 'body.md')}`,
        '--because=note:n-9#L2',
      ]),
    () => {
      filed = waiting();
      seen.edit = inStore((store) => docEditFor(store, filed[0].id));
      return 0;
    },
  ]);

  assert.equal(code, 0);
  assert.equal(filed.length, 1);
  assert.equal(filed[0].risk, 'high', 'publishing into a documents source is not the annotation class');
  assert.equal(seen.edit?.kind, 'authored');
  assert.equal(seen.edit?.anchor, '', 'a new document displaces nothing');
  assert.equal(seen.edit?.proposed, body);
  assert.match(filed[0].change, /^author docs\/adr\/0012-storage\.md into confluence:space:DOCS$/m);
  assert.match(filed[0].change, /--- new document\n# Storage/);
  assert.match(out, /filed wp-doc-docs-adr-0012-storage-md-[0-9a-f]{12} at high risk/);
});

test('an insertion says where it goes and lands beside the words already there', async () => {
  const seen: { edit: DocEdit | null; verdict: ProposalDecision | null } = { edit: null, verdict: null };
  const { code } = await run([
    declareDocs(),
    [
      'propose',
      'doc',
      '--source=docs-1',
      `--document=${DOCUMENT}`,
      '--kind=insertion',
      '--at=after the sentence ending "through the kernel seam."',
      '--now=Writes go through the coordinator.',
      '--because=note:n-4#L12',
    ],
    () => {
      const row = waiting()[0];
      seen.edit = inStore((store) => docEditFor(store, row.id));
      // Adding words changes what the document says, so it takes the same tier
      // a replacement does.
      assert.equal(row.risk, 'high');
      return 0;
    },
  ]);
  assert.equal(code, 0);
  assert.equal(seen.edit?.kind, 'insertion');
  assert.match(seen.edit?.anchor ?? '', /kernel seam/);
  assert.equal(seen.edit?.proposed, 'Writes go through the coordinator.');
});

test('the same change proposed twice files one row', async () => {
  const { code, out } = await run([
    declareDocs(),
    redline(),
    redline(),
    () => {
      assert.equal(waiting().length, 1);
      return 0;
    },
  ]);
  assert.equal(code, 0);
  assert.match(out, /already proposed; the earlier row stands/);
});

test('--dry-run shows the row it would file and files none', async () => {
  const { code, out } = await run([
    declareDocs(),
    redline(['--dry-run']),
    () => {
      assert.equal(waiting().length, 0);
      return 0;
    },
  ]);
  assert.equal(code, 0);
  assert.match(out, /--- was/);
  assert.match(out, /nothing was filed: --dry-run/);
});

test('a change too long for the queue says how much it did not show', async () => {
  const body = Array.from({ length: 40 }, (_, i) => `line ${String(i + 1)}`).join('\n');
  const { code, out } = await run([
    declareDocs(),
    (root) => {
      writeFileSync(join(root, 'long.md'), body, 'utf8');
      return 0;
    },
    (root) =>
      main([
        'propose',
        'doc',
        '--source=docs-1',
        '--document=docs/long.md',
        '--kind=authored',
        `--now-file=${join(root, 'long.md')}`,
        '--because=note:n-1#L1',
      ]),
    ['propose', 'list'],
  ]);
  assert.equal(code, 0);
  assert.match(out, /more line\(s\), not shown here/);
});

test('words that do not fit on a command line arrive through the file forms', async () => {
  // A flag value is one line, so a redline whose halves span several of them is
  // given as files. Passing such text inline is not silently half-read: the
  // flag is not seen at all, and the change is refused for the side it is now
  // missing.
  const was = ['The store is opened read-only.', 'Every consumer shares that handle.'].join('\n');
  const seen: { edit: DocEdit | null; verdict: ProposalDecision | null } = { edit: null, verdict: null };
  const { code } = await run([
    declareDocs(),
    (root) => {
      writeFileSync(join(root, 'was.txt'), was, 'utf8');
      return 0;
    },
    (root) =>
      main([
        'propose',
        'doc',
        '--source=docs-1',
        `--document=${DOCUMENT}`,
        '--kind=redline',
        `--was-file=${join(root, 'was.txt')}`,
        `--now=${NOW}`,
        `--because=${CITATION}`,
      ]),
    () => {
      seen.edit = inStore((store) => docEditFor(store, waiting()[0].id));
      return 0;
    },
  ]);
  assert.equal(code, 0);
  assert.equal(seen.edit?.anchor, was);

  const inline = await run([
    declareDocs(),
    [
      'propose',
      'doc',
      '--source=docs-1',
      `--document=${DOCUMENT}`,
      '--kind=redline',
      `--was=${was}`,
      `--now=${NOW}`,
      `--because=${CITATION}`,
    ],
  ]);
  assert.equal(inline.code, 1);
  assert.match(inline.err, /a redline says which words it replaces/);
});

test('a redline that does not say which words it replaces is refused', async () => {
  const { code, err } = await run([
    declareDocs(),
    [
      'propose',
      'doc',
      '--source=docs-1',
      `--document=${DOCUMENT}`,
      '--kind=redline',
      `--now=${NOW}`,
      '--because=note:n-4#L12',
    ],
  ]);
  assert.equal(code, 1);
  assert.match(err, /a redline says which words it replaces/);
  assert.equal(waiting().length, 0);
});

test('an insertion that does not say where it goes is refused', async () => {
  const { code, err } = await run([
    declareDocs(),
    [
      'propose',
      'doc',
      '--source=docs-1',
      `--document=${DOCUMENT}`,
      '--kind=insertion',
      '--now=Writes go through the coordinator.',
      '--because=note:n-4#L12',
    ],
  ]);
  assert.equal(code, 1);
  assert.match(err, /an insertion says where it goes/);
});

test('a new document that quotes words it replaces is refused as the redline it is', async () => {
  const { code, err } = await run([
    declareDocs(),
    [
      'propose',
      'doc',
      '--source=docs-1',
      '--document=docs/new.md',
      '--kind=authored',
      `--was=${WAS}`,
      `--now=${NOW}`,
      '--because=note:n-4#L12',
    ],
  ]);
  assert.equal(code, 1);
  assert.match(err, /a change that quotes what it replaces is a redline/);
});

test('a change naming no document, and one citing nothing, are both refused', async () => {
  const noDocument = await run([
    declareDocs(),
    ['propose', 'doc', '--source=docs-1', '--kind=redline', `--was=${WAS}`, `--now=${NOW}`, '--because=note:n-1#L1'],
  ]);
  assert.equal(noDocument.code, 1);
  assert.match(noDocument.err, /it names no document/);

  const noCitation = await run([
    declareDocs(),
    ['propose', 'doc', '--source=docs-1', `--document=${DOCUMENT}`, '--kind=redline', `--was=${WAS}`, `--now=${NOW}`],
  ]);
  assert.equal(noCitation.code, 1);
  assert.match(noCitation.err, /it cites nothing/);
});

test('a kind nobody defined, and the wrong word for an anchor, are usage errors', async () => {
  const badKind = await run([declareDocs(), ['propose', 'doc', '--source=docs-1', '--kind=suggestion']]);
  assert.equal(badKind.code, 2);
  assert.match(badKind.err, /--kind must be one of redline, insertion, authored, not "suggestion"/);

  const wrongAnchor = await run([
    declareDocs(),
    ['propose', 'doc', '--source=docs-1', `--document=${DOCUMENT}`, '--kind=redline', '--at=somewhere', '--now=x'],
  ]);
  assert.equal(wrongAnchor.code, 2);
  assert.match(wrongAnchor.err, /a redline names the words it replaces with --was, not --at/);

  const bothForms = await run([
    declareDocs(),
    ['propose', 'doc', '--source=docs-1', `--document=${DOCUMENT}`, '--kind=redline', `--was=${WAS}`, '--was-file=x.md'],
  ]);
  assert.equal(bothForms.code, 2);
  assert.match(bothForms.err, /--was and --was-file both name those words/);
});

test('a source the workspace never declared, and one it retired, are both refused', async () => {
  const undeclared = await run([declareDocs(), redline(['--source=docs-nowhere'])]);
  assert.equal(undeclared.code, 1);
  assert.match(undeclared.err, /declares no source docs-nowhere/);

  const retired = await run([
    declareDocs(),
    () => {
      inStore((store) => retireSource(store, 'docs-1', new Date().toISOString()));
      return 0;
    },
    redline(),
  ]);
  assert.equal(retired.code, 1);
  assert.match(retired.err, /it is not somewhere to send changes/);
});

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
            `1. The storage note says the store opens read-only, which the coordinator contradicts, per ${role}.`,
          ].join('\n'),
        },
        error: null,
      };
    },
  };
}

function latestRun(): string {
  return inStore((store) => {
    const runs = listTasks(store).map((task) => task.run);
    return runs[runs.length - 1] ?? '';
  });
}

test('a citation claiming a deliverable line must resolve to one before anything is filed', async () => {
  let cited = '';
  const { code, err } = await run([
    ['outcome', '--domains=strategy-alignment', 'Report what the storage documents disagree about'],
    declareDocs(),
    () => work([], workHost()),
    // The findings become proposals first, so the citation used below is one a
    // reader can actually follow rather than one invented for the test.
    () => main(['propose', `--run=${latestRun()}`, '--source=docs-1']),
    () => {
      cited = (waiting()[0].justification.split(' ')[0] ?? '').trim();
      return 0;
    },
    // Grounded in a finding of this run: filed.
    () => main([...redline(), `--because=${cited}`, `--run=${latestRun()}`]),
    () => {
      assert.equal(waiting().length, 2, 'the extracted finding and the redline that cites it');
      return 0;
    },
    // The same shape, pointing at a line the deliverable does not have.
    () =>
      main([
        'propose',
        'doc',
        '--source=docs-1',
        '--document=docs/other.md',
        '--kind=redline',
        '--was=something',
        '--now=something else',
        `--because=${cited.replace(/#L\d+$/, '#L9999')}`,
        `--run=${latestRun()}`,
      ]),
  ]);

  assert.match(cited, /^deliverable:.+#L\d+$/);
  assert.equal(code, 1);
  assert.match(err, /resolves to no line of any finished deliverable/);
});

test('a citation claiming a deliverable with no run named says so rather than filing on it', async () => {
  const { code, err } = await run([
    declareDocs(),
    () => main([...redline(), '--because=deliverable:t-1#L4']),
  ]);
  assert.equal(code, 1);
  assert.match(err, /cites a deliverable, so name the run it belongs to/);
});
