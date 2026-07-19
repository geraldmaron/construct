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

import {
  enrichMetadataWithPrompt,
  resolvePromptEntry,
  resolvePromptMetadata,
  resolveWorkerProfilePromptPath,
} from '../lib/prompt-metadata.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('resolvePromptMetadata fingerprints the canonical worker profile', () => {
  const metadata = resolvePromptMetadata('engineer', { rootDir: root });

  assert.equal(metadata.workerProfileId, 'engineer');
  assert.equal(metadata.workerProfileSource, 'registry');
  assert.equal(metadata.workerProfilePromptPath, 'registry/worker-profiles/prompts/engineer.md');
  assert.equal(metadata.workerProfileHash.length, 64);
  assert.equal(metadata.workerProfileVersion, metadata.workerProfileHash.slice(0, 12));
});

test('enrichMetadataWithPrompt preserves caller metadata over derived prompt identity', () => {
  const metadata = enrichMetadataWithPrompt('engineer', {
    promptVersion: 'staging-123',
    teamId: 'delivery',
  }, { rootDir: root });

  assert.equal(metadata.workerProfileId, 'engineer');
  assert.equal(metadata.promptVersion, 'staging-123');
  assert.equal(metadata.teamId, 'delivery');
  assert.equal('promptText' in metadata, false);
});

test('resolvePromptEntry returns the canonical worker-profile entry', () => {
  const entry = resolvePromptEntry('engineer', { rootDir: root });
  assert.equal(entry.id, 'engineer');
  assert.equal(entry.runtime, 'host-agent');
});

test('Worker Profile prompt lookup is strict and does not normalize retired ids', () => {
  assert.equal(resolvePromptEntry('cx-engineer', { rootDir: root }), null);
  assert.equal(resolvePromptEntry('opencode.engineer', { rootDir: root }), null);
  assert.equal(resolveWorkerProfilePromptPath('engineer', { rootDir: root }), 'registry/worker-profiles/prompts/engineer.md');
});
