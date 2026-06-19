/**
 * tests/functional/chat-session-context.functional.test.mjs — planTurn session context.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanContext } from '../../lib/chat/session-context.mjs';
import { planTurn } from '../../lib/chat/transparency.mjs';

test('buildPlanContext flags vague follow-ups after prior turns', () => {
  const session = { usage: { turns: 2 } };
  const turnBlocks = [{
    kind: 'turn',
    block: { overlay: { intent: 'implementation', workCategory: 'quick' } },
  }];
  const ctx = buildPlanContext({ session, turnBlocks, text: 'tell me more' });
  assert.equal(ctx.vagueFollowUp, true);
  assert.equal(ctx.priorIntent, 'implementation');
});

test('planTurn sets assumptionsBlocked for project questions', async () => {
  const overlay = await planTurn('what is this project', {
    context: { projectQuestion: true, turnIndex: 0 },
  });
  assert.equal(overlay.assumptionsBlocked, true);
});
