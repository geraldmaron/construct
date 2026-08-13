/**
 * tests/cli/compose.test.ts — composing a run's deliverables through the real
 * surface.
 *
 * The properties held here: a claim the cited deliverable does not support is
 * removed by the second pass and not merely flagged, an attribution to a role
 * that produced nothing never reaches that pass at all, the gap section is
 * always printed even when nothing is missing, and a composition that could
 * not be checked is refused rather than promoted unverified.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compose, main, work } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { listTasks } from '../../src/kernel/store/tasks.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(steps: ReadonlyArray<string[] | (() => Promise<number> | number)>): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-compose-'));
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
 * A composer that writes one supported claim, one claim its cited deliverable
 * does not carry, and one attributed to a role that never ran — plus a support
 * pass that catches exactly the middle one.
 */
function composeHost(): HostAdapter {
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
                { section: 'the-choice', text: `${cited} concluded its own part`, from: cited },
                { section: 'what-happens-first', text: 'and therefore we should ship in Q4', from: cited },
                { section: 'what-happens-first', text: 'a claim from nobody', from: 'never-dispatched' },
              ],
              uncovered: ['nobody costed the migration'],
            }),
          },
          error: null,
        };
      }
      if (role === 'composition-support') {
        // Index 1 is the invented one; the deliverable says nothing of Q4.
        const invented = /^1\. /m.test(task) ? [1] : [];
        return {
          id: role,
          status: 'ok',
          output: {
            text: JSON.stringify({
              unsupported: invented,
              detail: 'the deliverable states a conclusion but never mentions a date',
            }),
          },
          error: null,
        };
      }
      return workHost().invoke(request);
    },
  };
}

const OUTCOME = 'Decide whether the pilot ships in Q4';

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

test('a run with several deliverables composes, and what no deliverable supports is removed', async () => {
  let composed = 0;
  const { out } = await run([
    ['outcome', '--domains=strategy-alignment,product-scoping', OUTCOME],
    () => work([], workHost()),
    async () => ((composed = await compose([`--run=${latestRun()}`], composeHost())), composed),
  ]);
  assert.equal(composed, 0);
  // "Decide whether the pilot ships in Q4" is a decision ask, so the document
  // comes back in the decision shape rather than the review one. The chooser
  // reading a fixture written long before shapes existed is the point.
  assert.match(out, /## the-choice/);
  assert.match(out, /concluded its own part \[/, 'a supported claim keeps its attribution');
  assert.doesNotMatch(out, /therefore we should ship in Q4/, 'the unsupported claim is removed, not flagged');
  assert.match(out, /a claim from nobody.*produced no deliverable/s);
  assert.match(out, /## what nobody answered/);
  assert.match(out, /nobody costed the migration/);
  assert.match(out, /Nothing here was added by the composing/);
  // Most of the shape got no claims. Dropped from the document, reported
  // anyway: a composition that never stated a price must not read like one that
  // had nothing more to add, and once the shape follows the ask an empty
  // section also tells the reader what these deliverables do not carry.
  assert.match(out, /the decision shape asks for .*where-things-stand.*what-it-costs/);
  assert.match(out, /not about the roles who wrote them/);
  assert.match(out, /Shaped as a decision/);
});

test('a composition whose claims could not be checked is refused, not promoted unverified', async () => {
  let composed = 0;
  const unchecking: HostAdapter = {
    ...composeHost(),
    invoke: async (request: unknown): Promise<HostResult> => {
      const { role } = request as { role: string };
      if (role === 'composition-support') {
        return { id: role, status: 'error', output: null, error: 'the checker died' };
      }
      return composeHost().invoke(request);
    },
  };
  const { err } = await run([
    ['outcome', '--domains=strategy-alignment,product-scoping', OUTCOME],
    () => work([], workHost()),
    async () => ((composed = await compose([`--run=${latestRun()}`], unchecking)), composed),
  ]);
  assert.equal(composed, 1);
  assert.match(err, /could not be checked/);
  assert.match(err, /an unverified composition is not promoted/);
});

test('one deliverable composes nothing, and points at reading it instead', async () => {
  let composed = 0;
  const { err } = await run([
    ['outcome', '--domains=strategy-alignment', OUTCOME],
    () => work([], workHost()),
    async () => ((composed = await compose([`--run=${latestRun()}`], composeHost())), composed),
  ]);
  assert.equal(composed, 1);
  assert.match(err, /only strategy-alignment produced a deliverable/);
  assert.match(err, /read it directly rather than paying for a paraphrase/);
});

test('without a host it prices the work instead of guessing at it', async () => {
  let composed = 0;
  const { out } = await run([
    ['outcome', '--domains=strategy-alignment,product-scoping', OUTCOME],
    () => work([], workHost()),
    async () => ((composed = await compose([`--run=${latestRun()}`])), composed),
  ]);
  assert.equal(composed, 0);
  assert.match(out, /2 deliverables are ready to compose/);
  assert.match(out, /one per role to check/);
});

test('a run nobody planned is refused before anything is read', async () => {
  let composed = 0;
  const { err } = await run([
    async () => ((composed = await compose(['--run=run-nobody'], composeHost())), composed),
  ]);
  assert.equal(composed, 1);
  assert.match(err, /no plan recorded for run-nobody/);
});
