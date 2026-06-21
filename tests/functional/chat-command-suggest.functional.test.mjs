/**
 * tests/functional/chat-command-suggest.functional.test.mjs — slash command autocomplete.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slashCommandMatches,
  slashCommandGhost,
  completeSlashCommand,
  applyTabCompletion,
  setKeyMatches,
  completeSetKey,
} from '../../lib/chat/command-suggest.mjs';

test('slashCommandMatches filters by typed prefix', () => {
  assert.deepEqual(slashCommandMatches('/mod'), ['/model']);
  assert.ok(slashCommandMatches('/').length >= 10);
});

test('slashCommandGhost returns remaining characters', () => {
  assert.equal(slashCommandGhost('/mod'), 'el');
  assert.equal(slashCommandGhost('/model'), '');
});

test('applyTabCompletion completes command and set keys', () => {
  assert.equal(completeSlashCommand('/mod'), '/model ');
  assert.equal(applyTabCompletion('/set th'), '/set thinking ');
});

test('setKeyMatches suggests setting keys after /set', () => {
  assert.ok(setKeyMatches('/set ins').includes('inspector'));
});
