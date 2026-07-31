/**
 * tests/engine-contradiction-judge.test.mjs — optional LLM judge factory (follow-up).
 *
 * Pins the offline-first contract: no local model means no judge (null), so
 * consolidation falls back to the heuristic; when a model is present the factory
 * returns a judge that maps a YES/NO completion to a contradiction verdict and
 * degrades to "no contradiction" on a failed or unparseable run.
 */
import test from 'node:test';
import assert from 'node:assert';
import { createContradictionJudge, __testing } from '../lib/engine/contradiction-judge.mjs';

test('returns null when Ollama is not running', () => {
  assert.equal(createContradictionJudge({ statusFn: () => ({ running: false }) }), null);
});

test('returns null when no model is available', () => {
  assert.equal(createContradictionJudge({ statusFn: () => ({ running: true, models: [] }) }), null);
});

test('a YES completion is a contradiction, NO is not', () => {
  const status = () => ({ running: true, models: [{ name: 'judge-model' }] });
  const yes = createContradictionJudge({ statusFn: status, runFn: () => ({ success: true, response: 'YES — different algorithms' }) });
  const no = createContradictionJudge({ statusFn: status, runFn: () => ({ success: true, response: 'No, B just adds detail.' }) });
  assert.equal(yes.judge({ summary: 'auth uses RS256' }, { summary: 'auth uses HS256' }).contradicts, true);
  assert.equal(no.judge({ summary: 'auth uses RS256' }, { summary: 'auth uses RS256 (confirmed)' }).contradicts, false);
});

test('a failed run degrades to no contradiction', () => {
  const judge = createContradictionJudge({
    statusFn: () => ({ running: true, models: [{ name: 'm' }] }),
    runFn: () => ({ success: false, error: 'timeout' }),
  });
  assert.equal(judge.judge({ summary: 'x' }, { summary: 'y' }).contradicts, false);
});

test('the chosen model is passed to the runner', () => {
  let seen = null;
  const judge = createContradictionJudge({
    statusFn: () => ({ running: true, models: [{ name: 'first-model' }] }),
    runFn: (model) => { seen = model; return { success: true, response: 'no' }; },
  });
  judge.judge({ summary: 'a' }, { summary: 'b' });
  assert.equal(seen, 'first-model');
});

test('the prompt frames a same-subject contradiction decision', () => {
  const prompt = __testing.buildPrompt({ summary: 'auth uses RS256' }, { summary: 'auth uses HS256' });
  assert.match(prompt, /contradict/i);
  assert.match(prompt, /RS256/);
  assert.match(prompt, /HS256/);
});
