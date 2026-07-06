/**
 * tests/flows-demo.test.mjs — end-to-end demo flow: fetch -> process -> done.
 *
 * Exercises the whole public surface together (defineFlow, runFlow, typed
 * state, structured step results) on a small realistic three-step flow, so a
 * reader has one file that shows the engine working as a system rather than
 * unit by unit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { defineFlow } from '../lib/flows/define.mjs';
import { runFlow } from '../lib/flows/engine.mjs';
import { TERMINAL, RUN_STATUS, STEP_STATUS } from '../lib/flows/constants.mjs';

const stateSchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string' },
    raw: { type: 'string' },
    wordCount: { type: 'integer' },
    finished: { type: 'boolean' },
  },
};

const demoFlow = defineFlow({
  id: 'fetch-process-done',
  stateSchema,
  startStep: 'fetch',
  steps: {
    fetch: {
      workerBackend: 'provider',
      inputs: ['url'],
      run: (input) => ({ state: { raw: `contents of ${input.url}` } }),
      router: () => 'process',
    },
    process: {
      workerBackend: 'inline',
      inputs: ['raw'],
      run: (input) => ({ state: { wordCount: input.raw.split(' ').length } }),
      router: () => 'done',
    },
    done: {
      workerBackend: 'inline',
      inputs: ['wordCount'],
      run: () => ({ state: { finished: true } }),
      router: () => TERMINAL,
    },
  },
});

test('the fetch -> process -> done demo flow runs to completion with the expected typed state', async () => {
  const run = await runFlow(demoFlow, { url: 'https://example.test/article' });

  assert.equal(run.status, RUN_STATUS.COMPLETED);
  assert.deepEqual(run.history.map((h) => h.step), ['fetch', 'process', 'done']);
  assert.ok(run.history.every((h) => h.status === STEP_STATUS.DONE));

  assert.equal(run.state.finished, true);
  assert.equal(run.state.wordCount, 3);
  assert.equal(run.state.raw, 'contents of https://example.test/article');

  const fetchResult = run.history[0];
  assert.equal(fetchResult.workerBackend, 'provider');
  assert.deepEqual(fetchResult.input, { url: 'https://example.test/article' });
  assert.ok(fetchResult.durationMs >= 0);
});
