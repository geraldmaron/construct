/**
 * tests/deprecate.test.mjs — deprecation warning behaviour.
 *
 * Verifies:
 *   - Each unique key emits a warning exactly once per process.
 *   - Format is grep-stable: "[construct] deprecated: <name>..."
 *   - CONSTRUCT_DEPRECATIONS=error throws instead of warning.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { deprecate, _resetDeprecationsForTests } from '../lib/deprecate.mjs';

beforeEach(() => _resetDeprecationsForTests());

function captureStderr() {
  const captured = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { captured.push(String(chunk)); return true; };
  return {
    captured,
    restore: () => { process.stderr.write = original; },
  };
}

describe('deprecate', () => {
  it('emits a warning the first time and is silent on subsequent calls', () => {
    const cap = captureStderr();
    try {
      deprecate('oldThing()', { since: '1.2.0', removeIn: '2.0.0', use: 'newThing()' });
      deprecate('oldThing()', { since: '1.2.0', removeIn: '2.0.0', use: 'newThing()' });
      deprecate('oldThing()', { since: '1.2.0', removeIn: '2.0.0', use: 'newThing()' });
    } finally { cap.restore(); }
    assert.equal(cap.captured.length, 1);
    assert.match(cap.captured[0], /\[construct\] deprecated: oldThing\(\)/);
    assert.match(cap.captured[0], /v2\.0\.0/);
    assert.match(cap.captured[0], /newThing\(\)/);
  });

  it('treats different keys independently', () => {
    const cap = captureStderr();
    try {
      deprecate('foo', { removeIn: '2.0.0' });
      deprecate('bar', { removeIn: '2.0.0' });
    } finally { cap.restore(); }
    assert.equal(cap.captured.length, 2);
  });

  it('throws when CONSTRUCT_DEPRECATIONS=error', () => {
    assert.throws(
      () => deprecate('breakme', { env: { CONSTRUCT_DEPRECATIONS: 'error' } }),
      /deprecated: breakme/
    );
  });
});
