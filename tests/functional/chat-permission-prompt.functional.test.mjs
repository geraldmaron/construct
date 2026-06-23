/**
 * tests/functional/chat-permission-prompt.functional.test.mjs — ask-mode decision parsing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePermissionDecision, parsePermissionKey, formatPermissionQuestion } from '../../lib/chat/permission-prompt.mjs';

test('parsePermissionDecision maps readline answers', () => {
  assert.equal(parsePermissionDecision('y'), 'allow');
  assert.equal(parsePermissionDecision('always'), 'allow_always');
  assert.equal(parsePermissionDecision('n'), 'reject');
  assert.equal(parsePermissionDecision('maybe'), null);
});

test('parsePermissionKey maps single keystrokes', () => {
  assert.equal(parsePermissionKey('a'), 'allow_always');
  assert.equal(parsePermissionKey('Y'), 'allow');
  assert.equal(parsePermissionKey('r'), 'reject');
});

test('formatPermissionQuestion names the tool', () => {
  assert.match(formatPermissionQuestion({ tool: 'shell' }), /shell/);
});
