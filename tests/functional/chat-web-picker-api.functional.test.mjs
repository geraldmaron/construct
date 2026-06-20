/**
 * tests/functional/chat-web-picker-api.functional.test.mjs — GET /api/chat/models in tmpdir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tmpProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-web-picker-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  return cwd;
}

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
    server.on('error', reject);
  });
}

test('handleChatModels returns curated picker items in an isolated project', async () => {
  const cwd = tmpProject();
  const { handleChatModels } = await import('../../lib/server/chat-loop.mjs');
  const { handleWebChatCommand } = await import('../../lib/chat/web-commands.mjs');

  const server = await listen((req, res) => {
    void handleChatModels(req, res, { rootDir: cwd });
  });

  try {
    const res = await fetch(`${server.url}/api/chat/models`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.length > 0, 'picker should list at least the free-router row');
    assert.ok(body.items.some((item) => item.id === '__free_router__'));

    const cmd = await handleWebChatCommand('/model', { cwd });
    assert.equal(cmd.picker, 'model');
  } finally {
    await server.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('handleChatModelSelect persists a pinned model in an isolated project', async () => {
  const cwd = tmpProject();
  const { handleChatModelSelect } = await import('../../lib/server/chat-loop.mjs');
  const { loadChatConfig } = await import('../../lib/chat/config.mjs');
  const { loadModelPickerItems } = await import('../../lib/chat/model-picker.mjs');

  // Inject a deterministic provider catalog so the test does not depend on live
  // provider polling — the same seam the server handler uses.
  const pollProviders = async () => ([
    { id: 'anthropic', label: 'Anthropic', live: true, models: [
      { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', free: false, pricing: { input: 3, output: 15 }, context: 200000, reasoning: true, tools: true, vision: true, source: 'live' },
    ] },
  ]);

  const items = await loadModelPickerItems(null, { env: {}, cwd, pollProviders });
  const target = items.find((item) => !item.disabled);
  assert.ok(target, 'expected a selectable model in picker items');

  const server = await listen((req, res) => {
    void handleChatModelSelect(req, res, { rootDir: cwd, pollProviders });
  });

  try {
    const res = await fetch(`${server.url}/api/chat/models/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: target.id }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.model, target.id);
    assert.equal(loadChatConfig({ cwd }).config.model, target.id);
  } finally {
    await server.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
