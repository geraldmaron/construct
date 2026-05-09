/**
 * tests/engine-tokens.test.mjs — token counter wrapper tests.
 *
 * Verifies:
 *   - `estimateChars` returns chars/4 ceiling for any input.
 *   - `countTokens` returns either a tiktoken-mode count or an estimate-mode
 *     count depending on whether the optional `tiktoken` package is
 *     installed in the test environment. The mode is reported honestly so
 *     callers can decide whether to trust the number.
 *   - Both helpers handle null/undefined/non-string inputs gracefully.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countTokens, estimateChars, _resetEncoderForTests } from '../lib/engine/tokens.mjs';

describe('estimateChars', () => {
  it('returns ceil(length/4) for short strings', () => {
    assert.equal(estimateChars(''), 0);
    assert.equal(estimateChars('hi'), 1);
    assert.equal(estimateChars('hello'), 2);
    assert.equal(estimateChars('hello world!'), 3);
  });

  it('handles null/undefined/non-string by treating them as empty', () => {
    assert.equal(estimateChars(null), 0);
    assert.equal(estimateChars(undefined), 0);
    assert.equal(estimateChars(12345), 2);
  });
});

describe('countTokens', () => {
  it('returns a non-negative count and a mode tag', async () => {
    _resetEncoderForTests();
    const { tokens, mode } = await countTokens('hello world');
    assert.ok(Number.isInteger(tokens) && tokens >= 0, `expected integer tokens, got ${tokens}`);
    assert.ok(mode === 'tiktoken' || mode === 'estimate', `expected mode tiktoken|estimate, got ${mode}`);
  });

  it('estimate mode agrees with estimateChars when tiktoken is absent', async () => {
    _resetEncoderForTests();
    const { tokens, mode } = await countTokens('a fairly normal sentence');
    if (mode === 'estimate') {
      assert.equal(tokens, estimateChars('a fairly normal sentence'));
    }
  });

  it('returns 0 tokens for empty input regardless of mode', async () => {
    _resetEncoderForTests();
    const { tokens } = await countTokens('');
    assert.equal(tokens, 0);
  });
});
