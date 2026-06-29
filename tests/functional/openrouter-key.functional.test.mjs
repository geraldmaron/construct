/**
 * tests/functional/openrouter-key.functional.test.mjs — OpenRouter credential discovery.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  pickOpenRouterOpItem,
  openRouterOpRefFromItem,
  ensureConstructCredentials,
  __resetCredentialBootstrapCache,
} from '../../lib/providers/credential-bootstrap.mjs';
import {
  readRawFromOpenCodeProvider,
  readRawFromCredsStore,
  discoverAlternateRawForCredential,
} from '../../lib/providers/credential-sources.mjs';
import { API_KEY_CREDENTIALS } from '../../lib/providers/credential-catalog.mjs';
import { hasSecret, __clearSecretCache } from '../../lib/providers/secret-resolver.mjs';
import { isModelAvailable, listAvailableModels } from '../../lib/model-router.mjs';
import { configDir } from '../../lib/config/xdg.mjs';

function withTmpHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-or-'));
  const original = process.env.HOME;
  process.env.HOME = home;
  __clearSecretCache();
  try {
    return fn(home);
  } finally {
    process.env.HOME = original;
    __clearSecretCache();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('readOpenRouterRawFromOpenCode reads apiKey and ignores placeholders', () => {
  withTmpHome((home) => {
    const dir = path.join(home, '.config', 'opencode');
    fs.mkdirSync(dir, { recursive: true });
    const cfg = path.join(dir, 'opencode.json');
    const fixtureKey = 'fixture-openrouter-key-canary';
    fs.writeFileSync(cfg, JSON.stringify({
      provider: { openrouter: { apiKey: fixtureKey } },
    }));
    assert.equal(readRawFromOpenCodeProvider('openrouter', cfg), fixtureKey);
    fs.writeFileSync(cfg, JSON.stringify({
      provider: { openrouter: { apiKey: '__OPENROUTER_API_KEY__' } },
    }));
    assert.equal(readRawFromOpenCodeProvider('openrouter', cfg), null);
  });
});

test('discoverAlternateRawForCredential finds creds rotation store key', () => {
  withTmpHome((home) => {
    const constructDir = configDir(home);
    fs.mkdirSync(constructDir, { recursive: true });
    fs.writeFileSync(path.join(constructDir, 'config.env'), [
      '# CONSTRUCT_CREDS_OPENROUTER',
      'CONSTRUCT_CREDS_OPENROUTER_KEY=fixture-creds-openrouter-canary',
      '# END_CONSTRUCT_CREDS_OPENROUTER',
    ].join('\n'));
    const entry = API_KEY_CREDENTIALS.find((e) => e.id === 'openrouter');
    assert.equal(readRawFromCredsStore('openrouter'), 'fixture-creds-openrouter-canary');
    assert.equal(discoverAlternateRawForCredential(entry, { home }), 'fixture-creds-openrouter-canary');
    assert.equal(hasSecret('OPENROUTER_API_KEY', { env: {}, cwd: home }), true);
    const check = isModelAvailable('openrouter/google/gemma-3-27b-it:free', { env: {}, cwd: home });
    assert.equal(check.ok, true);
  });
});

test('pickOpenRouterOpItem prefers exact title and development vault', () => {
  const picked = pickOpenRouterOpItem([
    { id: 'a', title: 'openrouter prod', vault: { name: 'prod' } },
    { id: 'b', title: 'openrouter', vault: { name: 'team-production' } },
    { id: 'c', title: 'openrouter', vault: { name: 'team-development' } },
  ]);
  assert.equal(picked.id, 'c');
  assert.equal(openRouterOpRefFromItem(picked), 'op://team-development/c/credential');
});

test('ensureConstructCredentials links 1Password items into config.env', () => {
  withTmpHome((home) => {
    __resetCredentialBootstrapCache();
    const opRun = () => ({
      status: 0,
      stdout: JSON.stringify([
        { id: 'item-1', title: 'openrouter', vault: { name: 'dev-vault' } },
        { id: 'item-2', title: 'anthropic', vault: { name: 'dev-vault' } },
      ]),
    });
    const result = ensureConstructCredentials({ env: {}, cwd: home, home, opRun, force: true, autoLink: true });
    assert.equal(result.linked.length, 2);
    assert.ok(hasSecret('OPENROUTER_API_KEY', { env: {}, cwd: home }));
    assert.ok(hasSecret('ANTHROPIC_API_KEY', { env: {}, cwd: home }));
  });
});

test('ensureConstructCredentials skips providers that already have keys', () => {
  withTmpHome((home) => {
    const constructDir = configDir(home);
    fs.mkdirSync(constructDir, { recursive: true });
    fs.writeFileSync(path.join(constructDir, 'config.env'), 'OPENROUTER_API_KEY=fixture-plain-openrouter\n');
    __resetCredentialBootstrapCache();
    let opCalls = 0;
    const opRun = () => { opCalls += 1; return { status: 0, stdout: '[]' }; };
    const result = ensureConstructCredentials({ env: {}, cwd: home, home, opRun, force: true, autoLink: true });
    assert.ok(!result.linked.some((entry) => entry.id === 'openrouter'));
    assert.ok(opCalls > 0);
  });
});

test('ensureConstructCredentials does not call 1Password when autoLink is false', () => {
  withTmpHome((home) => {
    __resetCredentialBootstrapCache();
    let opCalls = 0;
    const opRun = () => { opCalls += 1; return { status: 0, stdout: '[]' }; };
    ensureConstructCredentials({ env: {}, cwd: home, home, opRun, force: true, autoLink: false });
    assert.equal(opCalls, 0);
  });
});

test('ensureConstructCredentials does not call 1Password when all keys are present', () => {
  withTmpHome((home) => {
    const constructDir = configDir(home);
    fs.mkdirSync(constructDir, { recursive: true });
    fs.writeFileSync(path.join(constructDir, 'config.env'), [
      'OPENROUTER_API_KEY=fixture-plain-openrouter',
      'ANTHROPIC_API_KEY=fixture-plain-anthropic',
      'OPENAI_API_KEY=fixture-plain-openai',
      'GITHUB_TOKEN=fixture-plain-github',
    ].join('\n'));
    __resetCredentialBootstrapCache();
    let opCalls = 0;
    const opRun = () => { opCalls += 1; return { status: 0, stdout: '[]' }; };
    ensureConstructCredentials({ env: {}, cwd: home, home, opRun, force: true, autoLink: true });
    assert.equal(opCalls, 0);
  });
});

test('listAvailableModels exposes configured OpenRouter candidates', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-picker-'));
  const original = process.env.HOME;
  process.env.HOME = home;
  try {
    const items = listAvailableModels({ env: { OPENROUTER_API_KEY: 'fixture-key' }, cwd: home });
    assert.ok(items.some((item) => item.provider === 'openrouter'));
  } finally {
    process.env.HOME = original;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
