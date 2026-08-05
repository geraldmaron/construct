/**
 * tests/hosts/contextloop.test.ts — the context-loop model seams.
 *
 * The properties held here: the producer prompt shows the note with the line
 * numbers its citations must name (a model cannot cite lines it was never
 * shown) and the exact declared-source ids; the challenger is asked to refute
 * and its verdict must carry a boolean and a reason or it is a failure, not a
 * pass; both adapters surface host failures as throws for the caller to
 * state.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  challengerPrompt,
  createHostChallenger,
  createHostProducer,
  extractJson,
  producerPrompt,
} from '../../src/hosts/contextloop.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';

const DELTA = {
  kind: 'process',
  domain: 'product-scoping',
  body: 'this client decides scope by quarter',
  citation: 'note:n-1#L2',
  external: false,
} as const;

function replyingHost(text: string): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (): Promise<HostResult> => ({
      id: 'x',
      status: 'ok',
      output: { text },
      error: null,
    }),
  };
}

test('the producer prompt numbers every note line and names the citation form', () => {
  const prompt = producerPrompt({
    noteBody: 'first thing\nsecond thing',
    noteId: 'n-9',
    lessons: ['clients decide by quarter'],
    sources: [{ id: 'src-1', kind: 'jira', locator: 'PROJ' }],
  });
  assert.match(prompt, /L1: first thing/);
  assert.match(prompt, /L2: second thing/);
  assert.match(prompt, /"note:n-9#L<n>"/);
  assert.match(prompt, /src-1 \(jira: PROJ\)/);
  assert.match(prompt, /clients decide by quarter/);
});

test('with nothing declared, the prompt says so instead of leaving blanks to fill', () => {
  const prompt = producerPrompt({ noteBody: 'x', noteId: 'n-1', lessons: [], sources: [] });
  assert.match(prompt, /remembers nothing yet/);
  assert.match(prompt, /No sources are declared/);
});

test('the challenger is asked to refute, and sees the cited line beside the claim', () => {
  const prompt = challengerPrompt(DELTA, 'they want quarterly planning');
  assert.match(prompt, /refute it/i);
  assert.match(prompt, /this client decides scope by quarter/);
  assert.match(prompt, /they want quarterly planning/);
});

test('a fenced reply parses; prose around the JSON is a habit, not a failure', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"deltas":[]}\n```'), { deltas: [] });
  assert.throws(() => extractJson('no json at all'), /no JSON/);
  assert.throws(() => extractJson('{"broken":}'), /malformed JSON/);
});

test('a challenger verdict without a boolean or without a reason is a failure, not a pass', async () => {
  await assert.rejects(
    createHostChallenger(replyingHost('{"refuted":"yes","reason":"r"}'))(DELTA, 'line'),
    /boolean "refuted"/,
  );
  await assert.rejects(
    createHostChallenger(replyingHost('{"refuted":false,"reason":"  "}'))(DELTA, 'line'),
    /without a reason/,
  );
  const upheld = await createHostChallenger(
    replyingHost('{"refuted":false,"reason":"the cited line supports it"}'),
  )(DELTA, 'line');
  assert.deepEqual(upheld, { upheld: true, detail: 'the cited line supports it' });
});

test('a host failure surfaces as a throw for the caller to state', async () => {
  const failing: HostAdapter = {
    ...replyingHost('unused'),
    invoke: async (): Promise<HostResult> => ({
      id: 'x',
      status: 'error',
      output: null,
      error: 'boom',
    }),
  };
  await assert.rejects(createHostProducer(failing)({ noteBody: 'x', noteId: 'n', lessons: [], sources: [] }), /status error/);
  await assert.rejects(createHostChallenger(failing)(DELTA, 'line'), /status error/);
});
