/**
 * tests/publish/flag-parsing.test.mjs — proof.
 *
 * The publish CLI spec declared --recording=<name> and --figures, but the parser
 * had no case for either, so they were silently dropped as unknown `--` args. This
 * pins that every declared flag maps to a behavior and that a genuinely unknown flag
 * is surfaced (collected in `unknown`) rather than silently ignored.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePublishArgs } from '../../lib/publish.mjs';

test('[construct-xj96.11] --recording=<name> and --figures both change the parsed options', () => {
  const options = parsePublishArgs(['brief.md', '--recording=demo1', '--figures']);
  assert.deepEqual(options.recordings, ['demo1'], '--recording=<name> must populate recordings');
  assert.equal(options.figures, true, '--figures must set figures on');
  assert.equal(options.input, 'brief.md');
  assert.deepEqual(options.unknown, [], 'no declared flag should land in unknown');
});

test('[construct-xj96.11] --recording is repeatable and accepts the space form', () => {
  const options = parsePublishArgs(['--recording', 'demoA', '--recording=demoB']);
  assert.deepEqual(options.recordings, ['demoA', 'demoB']);
});

test('[construct-xj96.11] --no-figures still disables figures', () => {
  const options = parsePublishArgs(['brief.md', '--no-figures']);
  assert.equal(options.figures, false);
});

test('[construct-xj96.11] an unknown --flag is collected, not silently dropped', () => {
  const options = parsePublishArgs(['brief.md', '--bogus-flag']);
  assert.deepEqual(options.unknown, ['--bogus-flag'], 'unknown flags must be surfaced for a warning');
});
