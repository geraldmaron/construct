/**
 * tests/flows-engine.test.mjs — router dispatch, join combinators, budget exhaustion.
 *
 * Pins single-next and terminal router dispatch, or-reconvergence (a step
 * reached from either of two predecessors runs exactly once), and-join (a
 * step withheld from the frontier until every declared predecessor has
 * completed and routed into it), and that an exhausted effort budget yields
 * a typed `budget-exhausted` result instead of letting the step run again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow } from '../lib/flows/define.mjs';
import { runFlow } from '../lib/flows/engine.mjs';
import { andJoin } from '../lib/flows/joins.mjs';
import { TERMINAL, RUN_STATUS, STEP_STATUS } from '../lib/flows/constants.mjs';

const stateSchema = { type: 'object', properties: { count: { type: 'integer' }, from: { type: 'array' } } };

test('a router that returns a single next-step name advances the flow', async () => {
  const flow = defineFlow({
    stateSchema,
    startStep: 'a',
    steps: {
      a: { workerBackend: 'inline', run: () => ({ state: { count: 1 } }), router: () => 'b' },
      b: { workerBackend: 'inline', run: () => ({ state: { count: 2 } }), router: () => TERMINAL },
    },
  });
  const run = await runFlow(flow, { count: 0 });
  assert.equal(run.status, RUN_STATUS.COMPLETED);
  assert.deepEqual(run.history.map((h) => h.step), ['a', 'b']);
  assert.equal(run.state.count, 2);
});

test('a router that returns TERMINAL ends the flow at the first step', async () => {
  const flow = defineFlow({
    stateSchema,
    startStep: 'a',
    steps: { a: { workerBackend: 'inline', run: () => ({ state: { count: 1 } }), router: () => TERMINAL } },
  });
  const run = await runFlow(flow, { count: 0 });
  assert.equal(run.status, RUN_STATUS.COMPLETED);
  assert.equal(run.history.length, 1);
});

test('or-reconvergence: a step targeted by two predecessors runs exactly once', async () => {
  const flow = defineFlow({
    stateSchema,
    startStep: 'start',
    steps: {
      start: { workerBackend: 'inline', run: () => ({ state: {} }), router: () => ['b1', 'b2'] },
      b1: { workerBackend: 'inline', run: () => ({ state: { from: ['b1'] } }), router: () => 'c' },
      b2: { workerBackend: 'inline', run: () => ({ state: { from: ['b2'] } }), router: () => 'c' },
      c: { workerBackend: 'inline', run: () => ({ state: { count: 1 } }), router: () => TERMINAL },
    },
  });
  const run = await runFlow(flow, { count: 0 });
  assert.equal(run.status, RUN_STATUS.COMPLETED);
  assert.deepEqual(run.history.map((h) => h.step), ['start', 'b1', 'b2', 'c']);
  assert.equal(run.history.filter((h) => h.step === 'c').length, 1, 'c ran exactly once despite two incoming paths');
});

test('and-join withholds the join step until every declared predecessor completes', async () => {
  const flow = defineFlow({
    stateSchema,
    startStep: 'start',
    steps: {
      start: { workerBackend: 'inline', readOnly: true, fanOut: true, synthesis: 'join', run: () => ({ state: {} }), router: () => ['b1', 'b2'] },
      b1: { workerBackend: 'inline', run: () => ({ state: {} }), router: () => 'join' },
      b2: { workerBackend: 'inline', run: () => ({ state: {} }), router: () => 'join' },
      join: { workerBackend: 'inline', run: () => ({ state: { count: 1 } }), router: () => TERMINAL, waitFor: andJoin(['b1', 'b2']) },
    },
  });
  const run = await runFlow(flow, { count: 0 });
  assert.equal(run.status, RUN_STATUS.COMPLETED);
  assert.deepEqual(run.history.map((h) => h.step), ['start', 'b1', 'b2', 'join']);
});

test('budget exhaustion produces a typed budget-exhausted result instead of re-running the step', async () => {
  const flow = defineFlow({
    stateSchema,
    startStep: 'loop',
    steps: {
      loop: {
        workerBackend: 'inline',
        budget: 1,
        run: (input, ctx) => ({ state: { count: (ctx.state.count || 0) + 1 }, usage: { consumed: 1 } }),
        router: (state) => (state.count < 5 ? 'loop' : TERMINAL),
      },
    },
  });
  const run = await runFlow(flow, { count: 0 });
  assert.equal(run.status, RUN_STATUS.BUDGET_EXHAUSTED);
  assert.equal(run.history.length, 2);
  assert.equal(run.history[0].status, STEP_STATUS.DONE);
  assert.equal(run.history[1].status, STEP_STATUS.BUDGET_EXHAUSTED);
  assert.deepEqual(run.history[1].usage, { consumed: 0, total: 1, budget: 1 });
});

test('an invalid state transition halts the run with a structured error, not a thrown exception', async () => {
  const flow = defineFlow({
    stateSchema,
    startStep: 'a',
    steps: { a: { workerBackend: 'inline', run: () => ({ state: { count: 'not-a-number' } }), router: () => TERMINAL } },
  });
  const run = await runFlow(flow, { count: 0 });
  assert.equal(run.status, RUN_STATUS.ERROR);
  assert.equal(run.history[0].status, STEP_STATUS.INVALID_STATE);
  assert.ok(run.error.errors.length > 0);
});
