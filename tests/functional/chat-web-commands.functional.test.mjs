/**
 * tests/functional/chat-web-commands.functional.test.mjs — web slash-command handler.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleWebChatCommand } from '../../lib/chat/web-commands.mjs';
import { createSessionUsage } from '../../lib/chat/tui/usage.mjs';

test('handleWebChatCommand /help returns command list', async () => {
  const result = await handleWebChatCommand('/help', { cwd: process.cwd() });
  assert.equal(result.ok, true);
  assert.match(result.output, /\/model/);
  assert.match(result.output, /\/clear/);
});

test('handleWebChatCommand /clear sets clear flag', async () => {
  const result = await handleWebChatCommand('/clear', { cwd: process.cwd() });
  assert.equal(result.clear, true);
});

test('handleWebChatCommand /model without arg opens picker', async () => {
  const result = await handleWebChatCommand('/model', {
    cwd: process.cwd(),
    runtime: { session: { model: 'test/model', modelMode: 'pinned' }, layers: {} },
  });
  assert.equal(result.picker, 'model');
});

test('handleWebChatCommand /usage formats session usage', async () => {
  const usage = createSessionUsage();
  usage.tokens.total = 1200;
  const result = await handleWebChatCommand('/usage', {
    cwd: process.cwd(),
    runtime: { session: { usage }, layers: {} },
  });
  assert.match(result.output, /total/);
});

test('handleWebChatCommand /set thinking off updates layers', async () => {
  const layers = { thinking: true, path: true, specialists: true, tools: true, observability: true };
  const session = { model: null, modelMode: 'pinned', permissionMode: 'allow_once', sandbox: 'workspace-write' };
  const result = await handleWebChatCommand('/set thinking off', {
    cwd: process.cwd(),
    runtime: { session, layers },
  });
  assert.equal(result.ok, true);
  assert.equal(layers.thinking, false);
});
