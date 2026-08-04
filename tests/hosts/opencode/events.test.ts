/**
 * tests/hosts/opencode/events.test.ts — the transcript parser, against real
 * transcripts.
 *
 * Every fixture here came out of a live OpenCode 1.15.4 via
 * scripts/capture-opencode-transcripts.mjs. That matters more than usual: the
 * first version of the parser was written against a transcript captured with
 * `2>&1`, which merged stderr into stdout and led to two wrong claims about the
 * host (that it interleaves notices into stdout, and that it exits 0 on a failed
 * run). Both were caught by capturing the streams separately. Hand-written
 * fixtures would have preserved both mistakes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  failedToolCalls,
  parseLine,
  reduceTranscript,
  stripAnsi,
} from '../../../src/hosts/opencode/events.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`fixtures/${name}.ndjson`, import.meta.url), 'utf8');
}

function fixtureExit(name: string): number {
  return Number(readFileSync(new URL(`fixtures/${name}.exit`, import.meta.url), 'utf8').trim());
}

test('a simple run yields its text as the deliverable', () => {
  const result = reduceTranscript(fixture('simple-text'));
  assert.equal(result.text, 'READY');
  assert.equal(result.errors.length, 0);
  assert.equal(result.toolCalls.length, 0);
  assert.match(result.sessionId ?? '', /^ses_/);
  assert.deepEqual(result.finishReasons, ['stop']);
});

test('a simple run reports usage the spend ceiling can read', () => {
  const { usage } = reduceTranscript(fixture('simple-text'));
  assert.equal(usage.steps, 1);
  assert.ok(usage.inputTokens > 0, 'input tokens');
  assert.ok(usage.outputTokens > 0, 'output tokens');
  assert.equal(usage.cost, 0, 'a local model costs nothing, and says so');
});

test('usage is summed across steps, not read off the last one', () => {
  const transcript = fixture('tool-use');
  const result = reduceTranscript(transcript);
  assert.ok(result.usage.steps > 1, 'fixture must be multi-step to prove anything');

  // Recompute independently from the raw events: if reduceTranscript were
  // reading the final step instead of summing, this would catch it.
  const perStep = transcript
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as { type: string; part?: { tokens?: { input?: number } } })
    .filter((event) => event.type === 'step_finish')
    .map((event) => event.part?.tokens?.input ?? 0);

  assert.ok(perStep.length > 1);
  assert.equal(result.usage.inputTokens, perStep.reduce((a, b) => a + b, 0));
  assert.notEqual(result.usage.inputTokens, perStep.at(-1), 'summed, not last-wins');
});

test('a failed tool call is not a failed run', () => {
  const result = reduceTranscript(fixture('tool-use'));
  const failed = failedToolCalls(result);

  assert.equal(fixtureExit('tool-use'), 0, 'the host exited clean');
  assert.equal(result.errors.length, 0, 'no run-level error');
  assert.ok(failed.length > 0, 'but a tool did fail');
  assert.equal(failed[0]?.tool, 'read');
  assert.match(failed[0]?.error ?? '', /rejected permission/i);
});

test('tool calls keep the host reported shape, successes included', () => {
  const result = reduceTranscript(fixture('tool-use'));
  const glob = result.toolCalls.find((call) => call.tool === 'glob');
  assert.ok(glob, 'the successful call survives too');
  assert.equal(glob.status, 'completed');
  assert.equal(glob.error, null);
  assert.ok(glob.callId.length > 0);
});

test('a failed run surfaces the host diagnosis, not just a code', () => {
  const result = reduceTranscript(fixture('model-not-found'));
  assert.equal(fixtureExit('model-not-found'), 1, 'the host also exits non-zero');
  assert.ok(result.errors.length > 0);
  assert.match(result.errors[0] ?? '', /Model not found/);
  assert.equal(result.text, '', 'and invents no deliverable');
});

test('stdout from the pinned host is clean NDJSON', () => {
  // Guards the notices-go-to-stderr expectation in pin.ts. If notices ever move
  // into stdout, the parser still copes — but the tolerance stops being
  // belt-and-braces, and this is where that change gets noticed.
  for (const name of ['simple-text', 'tool-use', 'model-not-found']) {
    assert.equal(reduceTranscript(fixture(name)).notices.length, 0, name);
  }
});

test('a merged stderr stream does not crash the parse, and is not dropped', () => {
  const merged = [
    '[93m[1m! [0mpermission requested: external_directory (/tmp/x); auto-rejecting',
    fixture('simple-text').trim(),
  ].join('\n');

  const result = reduceTranscript(merged);
  assert.equal(result.text, 'READY', 'the run still parses');
  assert.equal(result.notices.length, 1);
  assert.equal(
    result.notices[0],
    '! permission requested: external_directory (/tmp/x); auto-rejecting',
    'kept verbatim, ANSI stripped',
  );
});

test('parseLine separates events from noise without throwing', () => {
  assert.equal(parseLine('   ').event, null);
  assert.equal(parseLine('   ').notice, null);
  assert.equal(parseLine('not json at all').notice, 'not json at all');
  assert.equal(parseLine('{"type":"text"}').event?.type, 'text');
  assert.equal(parseLine('{"broken":').notice, '{"broken":', 'malformed JSON degrades to a notice');
  assert.equal(parseLine('[1,2,3]').notice, '[1,2,3]', 'a JSON array is not an event');
});

test('stripAnsi leaves ordinary text alone', () => {
  assert.equal(stripAnsi('plain text'), 'plain text');
  assert.equal(stripAnsi('[31mred[0m'), 'red');
});

test('an empty transcript reduces to an empty result rather than throwing', () => {
  const result = reduceTranscript('');
  assert.equal(result.text, '');
  assert.equal(result.sessionId, null);
  assert.equal(result.usage.steps, 0);
  assert.equal(result.errors.length, 0);
});

test('a malformed usage block degrades to zero instead of NaN', () => {
  // NaN would propagate into the spend ceiling and compare false against every
  // bound, disabling it silently.
  const result = reduceTranscript(
    '{"type":"step_finish","part":{"reason":"stop","tokens":{"input":"lots"},"cost":null}}',
  );
  assert.equal(result.usage.inputTokens, 0);
  assert.equal(result.usage.cost, 0);
  assert.equal(result.usage.steps, 1);
});
