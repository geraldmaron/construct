/**
 * chat-system-prompt-tier.functional.test.mjs — tier-aware owned-loop prompts.
 */
import test from 'node:test';
import assert from 'node:assert';
import { buildSystemPrompt, CHAT_SYSTEM_BASE, CHAT_SYSTEM_SMALL } from '../../lib/chat/system-prompt.mjs';
import { resolveCapabilityTier } from '../../lib/model-router.mjs';

test('buildSystemPrompt uses small base for floor tier', () => {
  const prompt = buildSystemPrompt({ capabilityTier: 'floor' });
  assert.equal(prompt, CHAT_SYSTEM_SMALL);
});

test('buildSystemPrompt uses full base for full tier', () => {
  const prompt = buildSystemPrompt({ capabilityTier: 'full' });
  assert.equal(prompt, CHAT_SYSTEM_BASE);
});

test('resolveCapabilityTier treats local/ models as non-full', () => {
  const tier = resolveCapabilityTier({ model: 'local/custom-small' });
  assert.notEqual(tier, 'full');
});
