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

/** A call, in the shape the position pass asks for. */
function call(approach: string, restsOn: string): string {
  return JSON.stringify({
    approach,
    because: [{ text: 'the pilot has one blocker left', restsOn: [restsOn] }],
    resolved: [],
    costs: [],
    first: [],
    strongestObjection: 'The migration may be the real blocker and it is not costed.',
    preMortem: 'The pilot ships, nobody uses it, and the migration was the reason.',
    undecided: [],
  });
}

const FIRST_CALL = 'Ship the pilot in Q4 and treat the migration as settled.';
const REPAIRED_CALL = 'Ship the pilot in Q4; whether the migration is cut is still open.';

/**
 * A host whose specialist objects that the call states its work as settled when
 * its deliverable left it open — the objection the first live run of the
 * position pass produced — and whose second attempt is whatever the test says.
 */
function objectingHost(second: string, stillObjects = ''): HostAdapter {
  return {
    ...composeHost(),
    invoke: async (request: unknown): Promise<HostResult> => {
      const { role, task } = request as { role: string; task: string };
      if (role === 'construct-position') {
        const repairing = task.includes('the call you made, in full');
        return {
          id: role,
          status: 'ok',
          output: { text: repairing ? second : call(FIRST_CALL, 'strategy-alignment') },
          error: null,
        };
      }
      // The claims screen and the position's veto are separate calls now, and
      // the prompts are told apart the way a role would tell them apart: only
      // one of them carries the claims.
      if (role === 'composition-support' && task.includes('claims attributed to it')) {
        return {
          id: role,
          status: 'ok',
          output: {
            text: JSON.stringify({
              unsupported: /^1\. /m.test(task) ? [1] : [],
              detail: 'the deliverable states a conclusion but never mentions a date',
            }),
          },
          error: null,
        };
      }
      if (role === 'composition-support') {
        const repairing = task.includes('You raised an objection');
        return {
          id: role,
          status: 'ok',
          output: { text: JSON.stringify({ misreadsMe: repairing ? stillObjects : FIRST_CALL }) },
          error: null,
        };
      }
      return composeHost().invoke(request);
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
  // Headings reach the reader as sentences. The slug is the identifier the
  // shape matches on, and a reader is not reading identifiers — the record form
  // is still one flag away, which the next test holds.
  assert.match(out, /## The choice/);
  assert.doesNotMatch(out, /## the-choice/);
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

/**
 * A role's objection is specific enough to fix — it quotes the sentence — so
 * the call goes back with it rather than being printed beside a correction the
 * reader is left to apply.
 */
test('a call a specialist says misreads it goes back once, and the repair is what the reader gets', async () => {
  let composed = 0;
  const { out } = await run([
    ['outcome', '--domains=strategy-alignment,product-scoping', OUTCOME],
    () => work([], workHost()),
    async () => (
      (composed = await compose(
        [`--run=${latestRun()}`],
        objectingHost(call(REPAIRED_CALL, 'strategy-alignment')),
      )),
      composed
    ),
  ]);

  assert.equal(composed, 0);
  assert.match(out, /whether the migration is cut is still open/);
  assert.doesNotMatch(out, /treat the migration as settled/, 'the objected-to call is replaced, not printed');
  assert.match(out, /This call is a second attempt/);
  assert.doesNotMatch(out, /states its work as something else/, 'nothing is left to report');
});

/**
 * The repair round's rule, and it is here because an instruction not to lose
 * ground is not a mechanism: a call that answers the objection by resting on a
 * role that never ran has traded a reported objection for a fabricated
 * attribution.
 */
test('a second call that answers the objection by losing an attribution is refused, and the first stands', async () => {
  let composed = 0;
  const { out } = await run([
    ['outcome', '--domains=strategy-alignment,product-scoping', OUTCOME],
    () => work([], workHost()),
    async () => (
      (composed = await compose(
        [`--run=${latestRun()}`],
        objectingHost(call(REPAIRED_CALL, 'never-dispatched')),
      )),
      composed
    ),
  ]);

  assert.equal(composed, 0);
  assert.match(out, /the repaired call was refused/);
  assert.match(out, /treat the migration as settled/, 'the call the run already had stands');
  assert.doesNotMatch(out, /This call is a second attempt/);
  assert.match(out, /states its work as something else/);
  // Both roles quoted the same sentence, so it is one line naming both rather
  // than the same objection printed twice.
  assert.match(
    out,
    /- (product-scoping, strategy-alignment|strategy-alignment, product-scoping): "Ship the pilot in Q4 and treat the migration as settled\."/,
  );
  assert.equal(out.match(/treat the migration as settled\."/g)?.length, 1, 'one line, not two');
});

/** One round. A call that keeps repairing itself never delivers. */
test('the call is sent back once and no further, however many objections survive', async () => {
  let positionCalls = 0;
  const counting = (second: string): HostAdapter => {
    const inner = objectingHost(second, FIRST_CALL);
    return {
      ...inner,
      invoke: async (request: unknown): Promise<HostResult> => {
        const { role } = request as { role: string };
        if (role === 'construct-position') positionCalls += 1;
        return inner.invoke(request);
      },
    };
  };
  const { out } = await run([
    ['outcome', '--domains=strategy-alignment,product-scoping', OUTCOME],
    () => work([], workHost()),
    async () =>
      compose([`--run=${latestRun()}`], counting(call(REPAIRED_CALL, 'strategy-alignment'))),
  ]);

  assert.equal(positionCalls, 2, 'the first call and one repair, never a third');
  assert.match(out, /states its work as something else/);
  assert.match(out, /did not answer this without costing something else/);
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

/**
 * The rendering is a view, not a migration. Anything downstream that needs to
 * check the text rather than read it asks for the record and gets exactly what
 * the roles wrote, markers and slugs intact — which is what the gates were run
 * against and what the store holds.
 */
test('--record hands back the stored form, markers and slugs intact', async () => {
  let composed = 0;
  const { out } = await run([
    ['outcome', '--domains=strategy-alignment,product-scoping', OUTCOME],
    () => work([], workHost()),
    async () => ((composed = await compose([`--run=${latestRun()}`, '--record'], composeHost())), composed),
  ]);

  assert.equal(composed, 0);
  assert.match(out, /## the-choice/);
  assert.doesNotMatch(out, /## The choice/);
});
