/**
 * tests/functional/chat-config-commands.functional.test.mjs — settings, usage, and
 * in-session commands for `construct chat`.
 *
 * Exercises the real config module against an isolated project tmpdir (load/save
 * round-trip, validation), the truthful usage accumulator and formatters, and the
 * slash-command handler driving a fake driver + session: /set toggles and persists
 * layers, /model sets and persists the model, and /usage renders the panel. No host
 * process, network, or credentials are involved.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadChatConfig, saveChatConfig, validateSetting } from '../../lib/chat/config.mjs';
import { createSessionUsage, addUsage, formatTokens, formatUsageFooter } from '../../lib/chat/tui/usage.mjs';
import { createCommands } from '../../lib/chat/commands.mjs';

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-chat-'));
  fs.mkdirSync(path.join(dir, '.cx'), { recursive: true });
  return dir;
}

function collector() {
  let out = '';
  const stream = new Writable({ write(chunk, _enc, cb) { out += chunk.toString(); cb(); } });
  return { stream, get text() { return out; } };
}

const PLAIN = new Proxy({}, { get: () => '' });

test('config round-trips through the project file and merges defaults', () => {
  const cwd = tmpProject();
  try {
    const before = loadChatConfig({ cwd });
    assert.equal(before.config.permissionMode, 'allow_once');
    assert.equal(before.config.layers.thinking, true);

    saveChatConfig({ ...before.config, model: 'openrouter/foo', layers: { ...before.config.layers, tools: false } }, { cwd });
    const after = loadChatConfig({ cwd });
    assert.equal(after.config.model, 'openrouter/foo');
    assert.equal(after.config.layers.tools, false);
    assert.equal(after.config.layers.thinking, true, 'unset layers keep defaults');
    assert.ok(fs.existsSync(path.join(cwd, '.cx', 'chat-config.json')));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validateSetting coerces and rejects values', () => {
  assert.deepEqual(validateSetting('thinking', 'off'), { ok: true, value: false });
  assert.equal(validateSetting('tools', 'on').key, 'layers.tools');
  assert.equal(validateSetting('permission', 'reject').key, 'permissionMode');
  assert.equal(validateSetting('permission', 'bogus').ok, false);
  assert.equal(validateSetting('sandbox', 'read-only').ok, true);
  assert.deepEqual(validateSetting('inspector', 'auto'), { ok: true, key: 'ui.inspector', value: 'auto' });
  assert.equal(validateSetting('nope', 'x').ok, false);
});

test('usage accumulates only reported fields and formats tokens', () => {
  const u = createSessionUsage();
  addUsage(u, { type: 'usage', tokens: { input: 1200, output: 300, total: 1500 }, cost: { amount: 0.004, currency: 'USD' } });
  addUsage(u, { type: 'usage', tokens: { input: 800, output: 200, total: 1000 }, cost: { amount: 0.002, currency: 'USD' } });
  assert.equal(u.turns, 2);
  assert.equal(u.tokens.input, 2000);
  assert.equal(u.tokens.total, 2500);
  assert.ok(Math.abs(u.cost.amount - 0.006) < 1e-9);
  assert.equal(formatTokens(1200), '1.2k');
  assert.equal(formatTokens(950), '950');

  const footer = formatUsageFooter({ tokens: { input: 1200, output: 300, total: 1500 }, cost: { amount: 0.004 } }, PLAIN);
  assert.ok(footer.includes('prompt 1.2k'));
  assert.ok(footer.includes('output 300'));
  assert.ok(footer.includes('~$0.004'));
});

function fakeDriver() {
  return {
    listModels: async () => ([
      { id: 'openrouter/a', provider: 'openrouter', modelID: 'a', label: 'A', isProviderDefault: true },
      { id: 'ollama/b', provider: 'ollama', modelID: 'b', label: 'B', isProviderDefault: false },
    ]),
  };
}

function makeSession() {
  return { model: null, layers: { thinking: true, path: true, specialists: true, tools: true, observability: true }, thinking: true, permissionMode: 'allow_once', sandbox: null, usage: createSessionUsage() };
}

test('/set toggles a layer and persists to the project config', async () => {
  const cwd = tmpProject();
  try {
    const commands = createCommands({ driver: fakeDriver(), host: 'construct', hostId: 'construct', cwd });
    const session = makeSession();
    const out = collector();
    const keep = await commands.handle('/set tools off', { output: out.stream, colors: PLAIN, layers: session.layers, session, rl: null });
    assert.equal(keep, true);
    assert.equal(session.layers.tools, false);
    const saved = loadChatConfig({ cwd });
    assert.equal(saved.config.layers.tools, false);
    assert.equal(saved.config.host, 'construct', 'persists the owned-loop host id');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('/model <id> sets and persists the model', async () => {
  const cwd = tmpProject();
  try {
    const commands = createCommands({ driver: fakeDriver(), host: 'construct', hostId: 'construct', cwd });
    const session = makeSession();
    const out = collector();
    await commands.handle('/model ollama/b', { output: out.stream, colors: PLAIN, layers: session.layers, session, rl: null });
    assert.equal(session.model, 'ollama/b');
    assert.equal(loadChatConfig({ cwd }).config.model, 'ollama/b');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('/models opens the curated picker and /usage renders the panel', async () => {
  const commands = createCommands({ driver: fakeDriver(), host: 'construct', hostId: 'construct', cwd: tmpProject() });
  const session = makeSession();
  addUsage(session.usage, { type: 'usage', tokens: { input: 100, output: 50, total: 150 }, cost: { amount: 0.001 } });

  const models = collector();
  await commands.handle('/models', { output: models.stream, colors: PLAIN, layers: session.layers, session, rl: null, askFn: async () => '' });
  assert.ok(models.text.includes('select a model'));
  assert.ok(models.text.includes('OpenRouter free router'));

  const usage = collector();
  await commands.handle('/usage', { output: usage.stream, colors: PLAIN, layers: session.layers, session, rl: null });
  assert.ok(usage.text.includes('session usage'));
  assert.ok(usage.text.includes('prompt 100'));

  const exit = await commands.handle('/exit', { output: collector().stream, colors: PLAIN, layers: session.layers, session, rl: null });
  assert.equal(exit, false);
});
