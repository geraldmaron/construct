/**
 * ollama-tool-call-leak.test.mjs — streaming tool-call-leak detection (bead construct-xaiu).
 *
 * A local model that cannot emit native tool_calls leaks the call into the text
 * channel as `<function=…>`, `<tool_call>`, or a `<|tool…|>` sentinel. The buffered
 * coherence probe assembles only the final message and never sees this, so the
 * streaming probe scans assembled delta text for these markers. Pins the pure
 * detection so it flags the leak forms without false-positiving ordinary prose.
 */
import test from 'node:test';
import assert from 'node:assert';
import { detectToolCallLeak } from '../lib/ollama/provision-context.mjs';

test('detects the tool-call-as-text leak forms', () => {
  for (const t of [
    '<function=glob>{"pattern":"*.js"}</function>',
    'sure, <tool_call>{"name":"grep"}',
    '<|tool_calls_begin|>',
    'text then </function> closing',
  ]) {
    assert.equal(detectToolCallLeak(t).leaked, true, `should flag: ${t}`);
  }
});

test('does not false-positive ordinary prose mentioning functions/tools', () => {
  for (const t of [
    'The project is a Node.js CLI tool.',
    'Use the function to compute the value.',
    'Call the tool when ready.',
    '',
    null,
  ]) {
    assert.equal(detectToolCallLeak(t).leaked, false, `should not flag: ${JSON.stringify(t)}`);
  }
});

test('returns the matched marker for diagnostics', () => {
  const r = detectToolCallLeak('blah <function=glob> blah');
  assert.equal(r.leaked, true);
  assert.ok(/function/i.test(r.marker), 'marker names the leak token');
});
