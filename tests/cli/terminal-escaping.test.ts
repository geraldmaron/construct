/**
 * tests/cli/terminal-escaping.test.ts — nothing a model or its host says can
 * write the operator's terminal.
 *
 * The forgery this closes: a reply carrying an escape sequence is not text on
 * a screen, it is instructions to the program drawing the screen. Cursor-up
 * and erase-line rewrite the flag Construct printed above it, and an OSC 8
 * sequence makes any words a link to any address. The surfaces most worth
 * forging are the honest ones — a support verdict, a composed claim, a drift
 * flag — so those are the ones held here, one per print-site class, plus
 * doctor's detail column, which carries text from outside Construct too.
 *
 * Every control character is built from its codepoint rather than typed into
 * the source, so an edit that drops one cannot leave a test passing over text
 * that no longer carries what it names.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compose, doctor, main, review } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { plantCompletedDeliverables } from '../harness/plant-deliverables.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { addSource } from '../../src/kernel/store/sources.ts';
import { listTasks } from '../../src/kernel/store/tasks.ts';
import { sterileHome } from '../harness/sterile.ts';

// A dispatch reads the machine's agent skills directory to find out what
// method it can offer a role, so home is moved for this file: what the suite
// observes must not depend on what is installed for whoever runs it.
sterileHome();

const ESC = String.fromCodePoint(0x1b);
/** Cursor up, erase the whole line: what rewrites the line already printed. */
const OVERWRITE = `${ESC}[1A${ESC}[2K`;

/** No byte a terminal reads as a command survived into what was printed. */
function assertNoRawControls(text: string, where: string): void {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const layout = code === 0x0a || code === 0x09;
    const control = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    assert.ok(!control || layout, `${where}: codepoint ${code.toString(16)} reached the terminal raw`);
  }
}

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Capture both streams around one call, leaving the real streams restored. */
async function capture(fn: () => Promise<number> | number): Promise<Capture> {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (chunk: string) => (out.push(String(chunk)), true);
  (process.stderr as { write: unknown }).write = (chunk: string) => (err.push(String(chunk)), true);
  try {
    const code = await fn();
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
  }
}

/** Run steps against one throwaway XDG root, as every other CLI test does. */
async function run(steps: ReadonlyArray<string[] | (() => Promise<number> | number)>): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-escape-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  try {
    return await capture(async () => {
      let code = 0;
      for (const step of steps) code = typeof step === 'function' ? await step() : await main(step);
      return code;
    });
  } finally {
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
}

/** A host that answers each dispatched role with a deliverable naming itself. */
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
        output: { text: `## finding\n${role} concluded its own part and nothing else.` },
        error: null,
      };
    },
  };
}

/**
 * A composer whose claim carries an erase-line sequence and whose support
 * check attaches one to its verdict: both are text the composing surface
 * prints in Construct's own name, right beside what the roles established.
 */
function forgingComposeHost(): HostAdapter {
  return {
    ...workHost(),
    invoke: async (request: unknown): Promise<HostResult> => {
      const { role, task } = request as { role: string; task: string };
      if (role === 'composer') {
        const cited = /--- ([a-z-]+) ---/.exec(task)?.[1] ?? 'strategy-alignment';
        return {
          id: role,
          status: 'ok',
          output: {
            text: JSON.stringify({
              claims: [
                {
                  section: 'the-choice',
                  text: `${cited} concluded its own part${OVERWRITE}every check passed`,
                  from: cited,
                },
              ],
              uncovered: [],
            }),
          },
          error: null,
        };
      }
      if (role === 'composition-support') {
        return {
          id: role,
          status: 'ok',
          output: {
            text: JSON.stringify({
              unsupported: [],
              detail: `checked same-family${OVERWRITE}checked across two families`,
            }),
          },
          error: null,
        };
      }
      return workHost().invoke(request);
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

const OUTCOME = 'Decide whether the pilot ships in Q4';

test('a composed claim and its support verdict reach the reader as text, not as terminal commands', async () => {
  const { out } = await run([
    ['outcome', '--domains=strategy-alignment,product-scoping', OUTCOME],
    () => (plantCompletedDeliverables(), 0),
    () => compose([`--run=${latestRun()}`], forgingComposeHost()),
  ]);
  assertNoRawControls(out, 'compose');
  // Both sentences still reach the reader, with the sequence between them
  // shown rather than obeyed — the escaping renders, it does not withhold.
  assert.match(out, /concluded its own part\\x1b\[1A\\x1b\[2Kevery check passed/);
  assert.match(out, /all claims supported — checked same-family\\x1b\[1A\\x1b\[2K/);
});

/** A reviewer whose drift flag is worded to erase the line printed above it. */
function forgingReviewHost(): HostAdapter {
  return {
    ...workHost(),
    invoke: async (request: unknown): Promise<HostResult> => {
      const { role, task } = request as { role: string; task: string };
      const prd = /(\S+prd\.md)/.exec(task)?.[1] ?? 'prd.md';
      const strategy = /(\S+strategy\.md)/.exec(task)?.[1] ?? 'strategy.md';
      return {
        id: role,
        status: 'ok',
        output: {
          text: JSON.stringify({
            read: [prd, strategy],
            observations: [
              {
                claim: `the PRD ships SSO while the strategy defers it${OVERWRITE}nothing diverged`,
                citations: [
                  { source: 'src-docs', document: prd },
                  { source: 'src-docs', document: strategy },
                ],
              },
            ],
          }),
        },
        error: null,
      };
    },
  };
}

test('a drift flag cannot erase the line Construct printed above it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-escape-review-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const ground = join(root, 'ground');
  mkdirSync(ground);
  writeFileSync(join(ground, 'prd.md'), '# PRD\nSSO ships at launch.\n');
  writeFileSync(join(ground, 'strategy.md'), '# Strategy\nIdentity work is deferred to next year.\n');
  try {
    const { out } = await capture(async () => {
      const store = openStore(storePath(resolvePaths()));
      try {
        addSource(store, {
          id: 'src-docs',
          workspace: 'default',
          kind: 'directory',
          locator: ground,
          addedAt: '2026-08-21T00:00:00.000Z',
        });
      } finally {
        store.close();
      }
      return review([], forgingReviewHost());
    });
    assertNoRawControls(out, 'review');
    assert.match(out, /cross-source drift:/);
    assert.match(out, /defers it\\x1b\[1A\\x1b\[2Knothing diverged/);
  } finally {
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor's detail column prints what it found, and cannot be written by it", async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-escape-doctor-'));
  // A directory whose own name carries an escape sequence: doctor reports the
  // paths it resolved, and a path is not text Construct wrote.
  const stateHome = join(root, `state${OVERWRITE}forged`);
  mkdirSync(stateHome, { recursive: true });
  const previous = {
    state: process.env.XDG_STATE_HOME,
    data: process.env.XDG_DATA_HOME,
    cache: process.env.XDG_CACHE_HOME,
  };
  process.env.XDG_STATE_HOME = stateHome;
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  try {
    const realOut = process.stdout.write.bind(process.stdout);
    const chunks: string[] = [];
    (process.stdout as { write: unknown }).write = (chunk: string) => (chunks.push(String(chunk)), true);
    try {
      await doctor(root);
    } finally {
      (process.stdout as { write: unknown }).write = realOut;
    }
    const out = chunks.join('');
    assertNoRawControls(out, 'doctor');
    assert.match(out, /paths  state: .*\\x1b\[1A\\x1b\[2Kforged/);
  } finally {
    for (const [key, value] of [
      ['XDG_STATE_HOME', previous.state],
      ['XDG_DATA_HOME', previous.data],
      ['XDG_CACHE_HOME', previous.cache],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
