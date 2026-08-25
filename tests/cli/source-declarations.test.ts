/**
 * tests/cli/source-declarations.test.ts — what a user says a source is, from
 * the command they type to the label a reader sees.
 *
 * The claim under test is end to end on purpose. A tier that survives the
 * store and never reaches the deliverable protects nobody: the failure it
 * exists to stop is a memo resting on a wish list and reading like the record,
 * and that failure happens in the rendered output. So one run declares a
 * source, describes it, grounds a dispatch in it, and the deliverable's
 * citation is read back for the word the user typed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, show, source, work } from '../../src/cli/index.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { sterileHome } from '../harness/sterile.ts';

sterileHome();

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

type Step = () => number | Promise<number>;

async function runAll(sequence: readonly Step[]): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-declared-cli-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  let code = 0;
  try {
    for (const step of sequence) code = await step();
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

function inStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

function ground(): string {
  const dir = mkdtempSync(join(tmpdir(), 'construct-declared-ground-'));
  writeFileSync(join(dir, 'roadmap.md'), '# roadmap\n\nTwo regions in Q3.\n');
  return dir;
}

/** A host that answers with one cited claim, so the citation is the thing under test. */
function citingHost(document: string): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => ({
      id: (request as { role: string }).role,
      status: 'ok',
      output: {
        text: `## finding\n\n- Two regions ship in Q3 [cite:${document}].`,
        usage: { cost: 0.01 },
      },
      error: null,
    }),
  };
}

test('a source is declared with what it is, and construct source list reads it back', async () => {
  const dir = ground();
  try {
    const { code, out } = await runAll([
      () =>
        source([
          'add',
          '--kind=directory',
          `--locator=${dir}`,
          '--workspace=acme',
          '--authority=aspirational',
          '--relevance=the 2027 wish list, not the plan we funded',
        ]),
      () => source(['list', '--workspace=acme']),
    ]);
    assert.equal(code, 0);
    assert.match(out, /\[aspirational\] {2}the 2027 wish list, not the plan we funded/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('describing an already-declared source restates it without re-tiering it by accident', async () => {
  const dir = ground();
  try {
    const { out } = await runAll([
      () => source(['add', '--kind=directory', `--locator=${dir}`, '--workspace=acme']),
      () => {
        const id = inStore((store) =>
          (store.db.prepare('SELECT id FROM sources LIMIT 1').get() as { id: string }).id,
        );
        return source(['describe', `--id=${id}`, '--authority=archive', '--sensitive']);
      },
      () => {
        const id = inStore((store) =>
          (store.db.prepare('SELECT id FROM sources LIMIT 1').get() as { id: string }).id,
        );
        // Only the relevance line moves; the tier and the sensitivity stand.
        return source(['describe', `--id=${id}`, '--relevance=last year, kept for history']);
      },
      () => source(['list', '--workspace=acme']),
    ]);
    assert.match(out, /\[archive, sensitive\] {2}last year, kept for history/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('describe refuses a relevance line with no standing behind it, and an unknown tier', async () => {
  const dir = ground();
  try {
    const { code, err } = await runAll([
      () => source(['add', '--kind=directory', `--locator=${dir}`, '--workspace=acme']),
      () => {
        const id = inStore((store) =>
          (store.db.prepare('SELECT id FROM sources LIMIT 1').get() as { id: string }).id,
        );
        return source(['describe', `--id=${id}`, '--relevance=it matters']);
      },
      () => {
        const id = inStore((store) =>
          (store.db.prepare('SELECT id FROM sources LIMIT 1').get() as { id: string }).id,
        );
        return source(['describe', `--id=${id}`, '--authority=mostly-true']);
      },
    ]);
    assert.equal(code, 2);
    assert.match(err, /say what this source is before saying why it matters/);
    assert.match(err, /unknown authority "mostly-true"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a deliverable citing an aspirational source shows that label where it cites it', async () => {
  const dir = ground();
  const document = join(dir, 'roadmap.md');
  try {
    const { out } = await runAll([
      () => source(['add', '--kind=directory', `--locator=${dir}`]),
      () => {
        const id = inStore((store) =>
          (store.db.prepare('SELECT id FROM sources LIMIT 1').get() as { id: string }).id,
        );
        return source([
          'describe',
          `--id=${id}`,
          '--authority=aspirational',
          '--relevance=the 2027 wish list',
        ]);
      },
      () => main(['outcome', '--domains=strategy-alignment', 'decide what ships next']),
      () => work(['--all', `--dir=${dir}`], citingHost(document)),
      () => {
        const run = inStore(
          (store) => (store.db.prepare('SELECT run FROM tasks LIMIT 1').get() as { run: string }).run,
        );
        return show(['--run', run]);
      },
    ]);
    assert.match(
      out,
      /Two regions ship in Q3 \(.*roadmap\.md — aspirational\)/,
      'the tier the user declared travels with the citation a reader sees',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Deliberate, not incidental: the label is what the source is now. A reader is
 * deciding today, so a plan since promoted to the record — or since demoted to
 * a wish — must read that way the next time they open the deliverable, and a
 * rendering frozen at dispatch would go on vouching for a standing nobody
 * holds any more. What the role was told at the time stays in the work log.
 */
test('re-describing a source changes what show renders for a deliverable already written', async () => {
  const dir = ground();
  const document = join(dir, 'roadmap.md');
  const sourceId = () =>
    inStore((store) => (store.db.prepare('SELECT id FROM sources LIMIT 1').get() as { id: string }).id);
  const runId = () =>
    inStore((store) => (store.db.prepare('SELECT run FROM tasks LIMIT 1').get() as { run: string }).run);
  try {
    const { out } = await runAll([
      () => source(['add', '--kind=directory', `--locator=${dir}`]),
      () => source(['describe', `--id=${sourceId()}`, '--authority=aspirational']),
      () => main(['outcome', '--domains=strategy-alignment', 'decide what ships next']),
      () => work(['--all', `--dir=${dir}`], citingHost(document)),
      () => {
        const before = show(['--run', runId()]);
        // Splits the capture into the two renderings, so each is asserted on
        // its own rather than on whether the whole run mentions a word.
        process.stdout.write('MARK\n');
        return before;
      },
      // The deliverable is untouched from here on; only the description moves.
      () => source(['describe', `--id=${sourceId()}`, '--authority=source-of-truth']),
      () => show(['--run', runId()]),
      () => {
        // The record of what the role was actually told is not what moved.
        const dispatched = inStore(
          (store) =>
            (
              store.db
                .prepare("SELECT detail FROM work_log WHERE action = 'role-dispatched' LIMIT 1")
                .get() as { detail: string }
            ).detail,
        );
        assert.match(
          dispatched,
          /"authority":"aspirational"/,
          'the tier the dispatch was given stays on the log',
        );
        return 0;
      },
    ]);

    const [first, second] = out.split('MARK');
    assert.match(first, /roadmap\.md — aspirational\)/);
    assert.match(second, /roadmap\.md — source of truth\)/, 'the reader is told what the source is now');
    assert.doesNotMatch(second, /roadmap\.md — aspirational\)/);

  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
