/**
 * tests/functional/chat-model-picker-terminal.functional.test.mjs — linear /model picker.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAIN_COLORS, createCollectWriter } from '../../lib/chat/commands.mjs';

test('promptModelPickerTerminal lists curated models and commits selection', async () => {
  const session = { model: null, modelMode: 'pinned', layers: {} };
  const out = createCollectWriter();
  const { loadModelPickerItems, promptModelPickerTerminal } = await import('../../lib/chat/model-picker.mjs');
  const pollProviders = async () => ([
    {
      id: 'openrouter',
      label: 'OpenRouter',
      live: true,
      models: [
        {
          id: 'openrouter/anthropic/claude-3.5-sonnet',
          label: 'Claude 3.5 Sonnet',
          provider: 'openrouter',
          free: false,
          pricing: { input: 3, output: 15 },
          reasoning: true,
          tools: true,
          toolsKnown: true,
          vision: true,
          source: 'live',
        },
      ],
    },
  ]);
  const items = await loadModelPickerItems(null, { env: {}, pollProviders });
  const enabledIdx = items.findIndex((item) => !item.disabled);
  assert.ok(enabledIdx >= 0, 'expected at least one selectable model');
  const selection = await promptModelPickerTerminal({
    output: out.stream,
    colors: PLAIN_COLORS,
    session,
    askFn: async () => String(enabledIdx + 1),
    env: {},
    cwd: process.cwd(),
    pollProviders,
  });
  assert.ok(selection);
  assert.match(out.text(), /select a model/);
  assert.ok(out.text().includes('OpenRouter free router'));
  assert.match(out.text(), /model set:/);
});

test('/models and /model without id share picker in linear commands', async () => {
  const { createCommands } = await import('../../lib/chat/commands.mjs');
  const out = createCollectWriter();
  const session = { model: null, modelMode: 'pinned', layers: {}, permissionMode: 'allow_once', sandbox: 'workspace-write', ui: {} };
  const commands = createCommands({ driver: {}, host: 'construct', cwd: process.cwd(), env: {} });
  await commands.handle('/models', {
    output: out.stream,
    colors: PLAIN_COLORS,
    layers: session.layers,
    session,
    env: {},
    askFn: async () => '',
  });
  assert.match(out.text(), /select a model/);
});
