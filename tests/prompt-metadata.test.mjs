/**
 * tests/prompt-metadata.test.mjs — validates prompt fingerprints for traces.
 *
 * Prompt text stays in git-owned files; Phoenix receives stable identity fields
 * so experiments can compare prompt versions without storing full prompts.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { enrichMetadataWithPrompt, resolvePromptEntry, resolvePromptMetadata } from '../lib/prompt-metadata.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('resolvePromptMetadata maps cx-prefixed agent names to prompt file fingerprints', () => {
  const metadata = resolvePromptMetadata('cx-engineer', { rootDir: root });

  assert.equal(metadata.promptName, 'engineer');
  assert.equal(metadata.promptFile, 'agents/prompts/cx-engineer.md');
  assert.equal(metadata.promptSource, 'git');
  assert.equal(metadata.promptHash.length, 64);
  assert.equal(metadata.promptVersion, metadata.promptHash.slice(0, 12));
});

test('enrichMetadataWithPrompt preserves caller metadata over derived prompt identity', () => {
  const metadata = enrichMetadataWithPrompt('cx-engineer', {
    promptVersion: 'staging-123',
    teamId: 'delivery',
  }, { rootDir: root });

  assert.equal(metadata.promptName, 'engineer');
  assert.equal(metadata.promptVersion, 'staging-123');
  assert.equal(metadata.teamId, 'delivery');
  assert.equal('promptText' in metadata, false);
});

test('resolvePromptEntry returns registry entry for persona or agent', () => {
  const entry = resolvePromptEntry('cx-engineer', { rootDir: root });
  assert.equal(entry.name, 'engineer');
  assert.equal(entry.promptFile, 'agents/prompts/cx-engineer.md');
});
