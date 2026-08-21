/**
 * tests/cli/review.test.ts — the drift review through its real surface.
 *
 * The wiring under test: a workspace with no declared ground refuses instead
 * of dispatching, the free path surveys and prices the read rather than
 * guessing at it, and the host path reads the surveyed documents and screens
 * every citation against them — a contradiction between two real documents
 * survives, one citing a document the survey never found does not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, review } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { addSource } from '../../src/kernel/store/sources.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/**
 * Run steps against one throwaway XDG root with a ground directory beside it.
 * The cache root moves too: the review extracts, and an extraction written
 * into the real home would be exactly the leak the sterile harness exists to
 * prevent.
 */
async function run(
  steps: (ground: string) => ReadonlyArray<string[] | (() => Promise<number> | number)>,
): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-review-'));
  const previousData = process.env.XDG_DATA_HOME;
  const previousCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');

  const ground = join(root, 'ground');
  mkdirSync(ground);
  writeFileSync(join(ground, 'prd.md'), '# PRD\nSSO ships at launch.\n');
  writeFileSync(join(ground, 'strategy.md'), '# Strategy\nIdentity work is deferred to next year.\n');

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
    for (const step of steps(ground)) {
      code = typeof step === 'function' ? await step() : await main(step);
    }
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCache;
    rmSync(root, { recursive: true, force: true });
  }
}

function declareGround(ground: string): () => number {
  return () => {
    const store = openStore(storePath(resolvePaths()));
    try {
      addSource(store, {
        id: 'src-docs',
        workspace: 'default',
        kind: 'directory',
        locator: ground,
        addedAt: '2026-08-13T00:00:00.000Z',
      });
      return 0;
    } finally {
      store.close();
    }
  };
}

/**
 * A reviewer that answers from the documents its own prompt listed — one real
 * contradiction, and one about a document that was never surveyed, which is
 * the failure mode the listing exists to catch. It accounts for opening both
 * documents, because a reply that accounts for no read is refused before its
 * findings are looked at.
 */
function reviewHost(): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      const { role, task } = request as { role: string; task: string };
      const prd = /(\S+prd\.md)/.exec(task)?.[1] ?? 'prd.md';
      const strategy = /(\S+strategy\.md)/.exec(task)?.[1] ?? 'strategy.md';
      const text = JSON.stringify({
        read: [prd, strategy],
        observations: [
          {
            claim: 'the PRD ships SSO at launch while the strategy defers identity work',
            citations: [
              { source: 'src-docs', document: prd },
              { source: 'src-docs', document: strategy },
            ],
          },
          {
            claim: 'the pricing memo contradicts the PRD',
            citations: [
              { source: 'src-docs', document: prd },
              { source: 'src-docs', document: 'docs/pricing-memo.md' },
            ],
          },
        ],
      });
      return { id: role, status: 'ok', output: { text }, error: null };
    },
  };
}

/**
 * A reviewer whose own file reads were refused by the host's permission gate:
 * it answers, the answer is well formed, and it saw no document. The reply is
 * byte-identical to the one a reviewer that read everything and found nothing
 * would send, which is why the reading account is asked for at all.
 */
function deniedReadsHost(): HostAdapter {
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
      output: { text: JSON.stringify({ observations: [] }) },
      error: null,
    }),
  };
}

/**
 * A reviewer that accounts for every document its own prompt listed and finds
 * no disagreement — the clean, uneventful pass the source-read delta tests
 * want, so drift-observation content never has to be reasoned about alongside
 * the read-record assertions.
 */
function cleanReadHost(): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => {
      const { role, task } = request as { role: string; task: string };
      const read = [...new Set(task.match(/\S+\.md/g) ?? [])];
      return { id: role, status: 'ok', output: { text: JSON.stringify({ read, observations: [] }) }, error: null };
    },
  };
}

test('a workspace with no declared ground is refused, not dispatched over nothing', async () => {
  const { code, err } = await run(() => [['review']]);
  assert.equal(code, 2);
  assert.match(err, /declared no sources/);
  assert.match(err, /construct source add/);
});

test('without a host the ground is surveyed and the read is priced, not guessed', async () => {
  const { code, out } = await run((ground) => [declareGround(ground), ['review']]);
  assert.equal(code, 0);
  assert.match(out, /surveyed: 2 documents across 1 source/);
  assert.match(out, /model work, at cost/);
});

test('the host path reads the surveyed documents and screens every citation against them', async () => {
  const { code, out } = await run((ground) => [declareGround(ground), () => review([], reviewHost())]);
  assert.equal(code, 0);
  assert.match(out, /cross-source drift:/);
  assert.match(out, /the PRD ships SSO at launch while the strategy defers identity work/);
  assert.match(
    out,
    /discarded observation: the pricing memo contradicts the PRD.*survey of that source did not find/,
  );
  // What it considered to get there, on the record rather than inferred from
  // the length of the output.
  assert.match(
    out,
    /considered: 2 documents surveyed, 2 the reviewer accounts for opening, 2 observations returned, 1 screened out\./,
  );
});

test('an empty review that cannot account for opening one document is a failure, not a clean line', async () => {
  const { code, out, err } = await run((ground) => [
    declareGround(ground),
    () => review([], deniedReadsHost()),
  ]);
  assert.equal(code, 1);
  assert.match(err, /cannot show that it read the ground/);
  assert.match(err, /prd\.md/);
  assert.match(err, /strategy\.md/);
  assert.doesNotMatch(out, /no drift survived the screen/);
});

/**
 * The source-read delta: what a review's own survey says changed since the
 * ground was last read, over the append-only read record rather than a
 * second kind of state. Three states, one test each — first read, unchanged,
 * and changed — because a fourth read of the same ground should not need a
 * fourth kind of test to stay honest.
 */
test('a first review of a source states there is no baseline, not an invented delta', async () => {
  const { code, out } = await run((ground) => [declareGround(ground), () => review([], cleanReadHost())]);
  assert.equal(code, 0);
  assert.match(out, /read record:/);
  assert.match(out, /src-docs: no baseline — this is the first recorded read\./);
});

test('a second review of unchanged ground reports nothing changed, not the same delta again', async () => {
  const { out } = await run((ground) => [
    declareGround(ground),
    () => review([], cleanReadHost()),
    () => review([], cleanReadHost()),
  ]);
  const passes = out.split('read record:');
  assert.equal(passes.length, 3, 'one "read record:" section per review call');
  assert.match(passes[1] ?? '', /src-docs: no baseline/, 'the first pass still has nothing to compare against');
  assert.match(passes[2] ?? '', /src-docs: unchanged since/, 'the second pass compares against the first');
  assert.doesNotMatch(passes[2] ?? '', /no baseline/, 'a baseline exists by the second pass');
});

test('a second review names the documents added and removed since the last read', async () => {
  const { out } = await run((ground) => [
    declareGround(ground),
    () => review([], cleanReadHost()),
    () => {
      writeFileSync(join(ground, 'roadmap.md'), '# Roadmap\nShip in Q3.\n');
      rmSync(join(ground, 'strategy.md'));
      return 0;
    },
    () => review([], cleanReadHost()),
  ]);
  const passes = out.split('read record:');
  assert.equal(passes.length, 3);
  const second = passes[2] ?? '';
  assert.match(second, /src-docs: 1 document added, 1 document removed since/);
  assert.match(second, /added:\n\s+\S*roadmap\.md/);
  assert.match(second, /removed:\n\s+\S*strategy\.md/);
  assert.match(
    second,
    /no read row\n\s+records a document's content, so that is unverified here rather than claimed either way\./,
    'content within an unchanged path is named unverified, never guessed at',
  );
});

test('review takes no positional arguments, and says so rather than ignoring one', async () => {
  const { code, err } = await run(() => [['review', 'docs/']]);
  assert.equal(code, 2);
  assert.match(err, /takes no positional arguments/);
});

test('host flags without a host are refused here too', async () => {
  const { code, err } = await run(() => [['review', '--model=gpt']]);
  assert.equal(code, 2);
  assert.match(err, /--model only applies when a host is named/);
});
