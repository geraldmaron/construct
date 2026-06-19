/**
 * tests/functional/chat-overhaul-devils-advocate.functional.test.mjs — encodes
 * pre-merge devil's-advocate pass criteria from the coordinated chat/models plan.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isChatModelAvailable,
  resolveValidatedChatModel,
  getProviderModelCatalog,
} from '../../lib/model-router.mjs';
import {
  applyModelVisibilityFilter,
  readLiveCatalogCache,
} from '../../lib/models/catalog.mjs';
import { readOracleDockState } from '../../lib/intake/session-prelude.mjs';

test('CRITICAL: pinned model outside visibility still resolves when explicitly requested', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-da-'));
  fs.writeFileSync(path.join(root, 'construct.config.json'), JSON.stringify({
    version: 1,
    models: { visibility: { mode: 'explicit', include: ['anthropic/claude-sonnet-4-6'], exclude: [], providers: {} } },
  }));
  try {
    const env = { OPENROUTER_API_KEY: 'sk-or', ANTHROPIC_API_KEY: 'sk-a' };
    const pinned = 'openrouter/openrouter/free';
    const check = isChatModelAvailable(pinned, { env });
    assert.equal(check.ok, true, 'catch-all openrouter family must validate live slugs');
    const filtered = getProviderModelCatalog({ env, cwd: root, activeModelId: pinned });
    const ids = filtered.tierOptions.standard;
    assert.ok(ids.includes(pinned), 'active pin must remain visible under explicit mode');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CRITICAL: stale cache does not block catalog — empty cache falls back to static hints', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-da-cache-'));
  try {
    const cached = readLiveCatalogCache({ homeDir: home, maxAgeMs: 0 });
    assert.equal(cached, null);
    const catalog = getProviderModelCatalog({ env: { ANTHROPIC_API_KEY: 'sk' }, cwd: process.cwd() });
    assert.ok(catalog.providers.length > 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('HIGH: resolveValidatedChatModel surfaces notice when pin rejected', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-da-pin-'));
  const prior = process.env.HOME;
  process.env.HOME = home;
  try {
    const env = { ANTHROPIC_API_KEY: 'sk', CX_MODEL_STANDARD: 'github-copilot/gpt-5.4' };
    const result = resolveValidatedChatModel({ env });
    assert.ok(result.notice, 'must not silently substitute without notice');
    assert.equal(result.id, 'anthropic/claude-sonnet-4-6');
  } finally {
    process.env.HOME = prior;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('HIGH: Oracle dock hidden when disabled — no chat noise', () => {
  const state = readOracleDockState({ cwd: process.cwd(), env: { CONSTRUCT_ORACLE: 'off' } });
  assert.equal(state.visible, false);
});

test('MEDIUM: explicit exclude removes model from filtered catalog', () => {
  const filtered = applyModelVisibilityFilter(
    {
      providers: [{
        id: 'anthropic',
        options: { reasoning: [], standard: ['anthropic/claude-sonnet-4-6', 'anthropic/claude-opus-4-6'], fast: [] },
        tiers: {},
      }],
    },
    { visibility: { mode: 'all_configured', include: [], exclude: ['anthropic/claude-opus-4-6'], providers: {} } },
  );
  assert.ok(filtered.tierOptions.standard.includes('anthropic/claude-sonnet-4-6'));
  assert.equal(filtered.tierOptions.standard.includes('anthropic/claude-opus-4-6'), false);
});
