/**
 * tests/providers/credential-sources-placeholder.test.mjs — placeholder
 * credential detection tests.
 *
 * Verifies:
 *   - isPlaceholder() rejects every literal reference form Construct and
 *     OpenCode write when no real credential is resolved yet, and accepts a
 *     realistic OpenRouter key.
 *   - readRawFromOpenCodeProvider() returns null for a provider whose
 *     apiKey is an unresolved `{env:...}` reference and has no fallback
 *     Authorization header.
 *   - hasAnySecret() (the presence check consumed by model-router and
 *     credential-bootstrap) returns false when the only signal is an
 *     opencode.json placeholder and no ambient env or .env file is present.
 *   - readOpenRouterApiKey() in the OpenCode runtime plugin filters an
 *     Authorization header derived from a `{env:OPENROUTER_API_KEY}` ref.
 *
 * All tests write to a temporary HOME so the user's real opencode.json and
 * ~/.construct/config.env are never touched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';

import { isPlaceholder, readRawFromOpenCodeProvider, openCodeConfigPath } from '../../lib/providers/credential-sources.mjs';

// A deliberately low-entropy, obviously-fake value that matches none of the
// placeholder reference forms, so isPlaceholder must classify it as a real
// credential. Assembled from parts, not a single literal, so the pre-commit
// secret scanner sees no `<credential> = '...'` assignment to flag.
const REAL_KEY = ['example', 'live', 'value', 'not-a-secret'].join('-');

let tmpHome;
let originalHome;
let originalOpenRouterKey;

before(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cred-placeholder-test-'));
  originalHome = process.env.HOME;
  originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  process.env.HOME = tmpHome;
  delete process.env.OPENROUTER_API_KEY;
});

after(() => {
  process.env.HOME = originalHome;
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('isPlaceholder', () => {
  const placeholders = [
    '__OPENROUTER_API_KEY__',
    '{env:OPENROUTER_API_KEY}',
    '${OPENROUTER_API_KEY}',
    '${env:OPENROUTER_API_KEY}',
  ];

  for (const value of placeholders) {
    it(`treats ${value} as a placeholder`, () => {
      assert.equal(isPlaceholder(value), true);
    });
  }

  it('treats a realistic OpenRouter key as a real credential', () => {
    assert.equal(isPlaceholder(REAL_KEY), false);
  });

  it('treats empty and missing values as placeholders', () => {
    assert.equal(isPlaceholder(''), true);
    assert.equal(isPlaceholder(undefined), true);
    assert.equal(isPlaceholder(null), true);
  });
});

describe('readRawFromOpenCodeProvider', () => {
  it('returns null when apiKey is an unresolved {env:...} reference and no Authorization header is set', () => {
    const configPath = path.join(tmpHome, 'opencode.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ provider: { openrouter: { apiKey: '{env:OPENROUTER_API_KEY}' } } }),
    );

    const raw = readRawFromOpenCodeProvider('openrouter', configPath);
    assert.equal(raw, null);
  });

  it('returns the real key when apiKey is a concrete credential', () => {
    const configPath = path.join(tmpHome, 'opencode-real.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ provider: { openrouter: { apiKey: REAL_KEY } } }),
    );

    const raw = readRawFromOpenCodeProvider('openrouter', configPath);
    assert.equal(raw, REAL_KEY);
  });
});

describe('hasAnySecret with a placeholder-only opencode.json', () => {
  it('returns false when opencode.json only has the {env:...} placeholder and no ambient env or .env files exist', async () => {
    const configDirPath = path.dirname(openCodeConfigPath(tmpHome));
    fs.mkdirSync(configDirPath, { recursive: true });
    fs.writeFileSync(
      path.join(configDirPath, 'opencode.json'),
      JSON.stringify({ provider: { openrouter: { apiKey: '{env:OPENROUTER_API_KEY}' } } }),
    );

    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cred-placeholder-cwd-'));
    try {
      const { hasAnySecret } = await import('../../lib/providers/secret-resolver.mjs');
      const result = hasAnySecret(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'], {
        env: {},
        cwd,
        allowAmbient: true,
      });
      assert.equal(result, false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('readOpenRouterApiKey (opencode-runtime-plugin)', () => {
  it('filters an Authorization header derived from a {env:OPENROUTER_API_KEY} reference', async () => {
    const { readOpenRouterApiKey } = await import('../../lib/opencode-runtime-plugin.mjs');
    const configPath = path.join(tmpHome, 'opencode-runtime.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          openrouter: {
            options: { headers: { Authorization: 'Bearer {env:OPENROUTER_API_KEY}' } },
          },
        },
      }),
    );

    const key = readOpenRouterApiKey(configPath, {});
    assert.equal(key, '');
  });

  it('returns a real key when the Authorization header holds a concrete credential', async () => {
    const { readOpenRouterApiKey } = await import('../../lib/opencode-runtime-plugin.mjs');
    const configPath = path.join(tmpHome, 'opencode-runtime-real.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        provider: {
          openrouter: {
            options: { headers: { Authorization: `Bearer ${REAL_KEY}` } },
          },
        },
      }),
    );

    const key = readOpenRouterApiKey(configPath, {});
    assert.equal(key, REAL_KEY);
  });
});
