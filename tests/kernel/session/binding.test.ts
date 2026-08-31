/**
 * tests/kernel/session/binding.test.ts — structural serve session binding.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSessionBinding,
  sessionOwner,
} from '../../../src/kernel/session/binding.ts';

test('serve argv binds client and project; missing client stays interactive unknown', () => {
  const bound = parseSessionBinding(
    ['--client=cursor', '--project=/repo'],
    '/elsewhere',
  );
  assert.equal(bound.interactive, true);
  assert.equal(bound.client, 'cursor');
  assert.equal(bound.projectRoot, '/repo');
  assert.equal(bound.clientSource, 'flag');
  assert.equal(bound.projectSource, 'flag');
  assert.equal(sessionOwner(bound), 'session:cursor');

  const unknown = parseSessionBinding([], '/cwd');
  assert.equal(unknown.interactive, true);
  assert.equal(unknown.client, 'unknown');
  assert.equal(unknown.projectRoot, '/cwd');
  assert.equal(unknown.projectSource, 'cwd');
});

test('claude alias maps to claude-code client id', () => {
  const bound = parseSessionBinding(['--client=claude', '--project=/r']);
  assert.equal(bound.client, 'claude-code');
});
