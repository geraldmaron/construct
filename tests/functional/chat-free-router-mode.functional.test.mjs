/**
 * tests/functional/chat-free-router-mode.functional.test.mjs — modelMode persistence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  commitPickerModel,
  pickerSelectedId,
  formatModelHeader,
  FREE_ROUTER_ITEM_ID,
} from '../../lib/chat/model-picker.mjs';
import { loadChatConfig } from '../../lib/chat/config.mjs';

function withTmpProject(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-router-'));
  const cwd = path.join(home, 'proj');
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  const original = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn(cwd);
  } finally {
    process.env.HOME = original;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('commitPickerModel persists free-router mode separately from pinned slug', () => {
  withTmpProject((cwd) => {
    const session = { layers: {}, permissionMode: 'allow_once', sandbox: 'workspace-write', ui: {} };
    commitPickerModel(session, { mode: 'free-router', modelId: 'openrouter/qwen/qwen3-coder:free' }, { cwd });
    assert.equal(session.modelMode, 'free-router');
    assert.equal(session.model, 'openrouter/qwen/qwen3-coder:free');
    assert.equal(session.savedModel, null);
    const { config } = loadChatConfig({ cwd });
    assert.equal(config.modelMode, 'free-router');
    assert.equal(config.model, null);
  });
});

test('commitPickerModel persists pinned model with modelMode pinned', () => {
  withTmpProject((cwd) => {
    const session = { layers: {}, permissionMode: 'allow_once', sandbox: 'workspace-write', ui: {} };
    commitPickerModel(session, { mode: 'pinned', modelId: 'openrouter/anthropic/claude-sonnet-4-6' }, { cwd });
    assert.equal(session.modelMode, 'pinned');
    assert.equal(session.savedModel, 'openrouter/anthropic/claude-sonnet-4-6');
    const { config } = loadChatConfig({ cwd });
    assert.equal(config.modelMode, 'pinned');
    assert.equal(config.model, 'openrouter/anthropic/claude-sonnet-4-6');
  });
});

test('pickerSelectedId and formatModelHeader reflect router mode', () => {
  const session = {
    modelMode: 'free-router',
    model: 'openrouter/google/gemma-4-26b-a4b-it:free',
  };
  assert.equal(pickerSelectedId(session), FREE_ROUTER_ITEM_ID);
  assert.match(formatModelHeader(session).label, /free router/);
});
