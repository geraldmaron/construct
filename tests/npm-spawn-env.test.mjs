/**
 * tests/npm-spawn-env.test.mjs — npm spawn env sanitization.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeNpmSpawnEnv } from '../lib/npm-spawn-env.mjs';

test('sanitizeNpmSpawnEnv removes npm_config_devdir and NPM_CONFIG_DEVDIR', () => {
  const out = sanitizeNpmSpawnEnv({
    npm_config_devdir: '/tmp/cursor-sandbox/node-gyp',
    NPM_CONFIG_DEVDIR: '/tmp/cursor-sandbox/node-gyp',
    PATH: '/usr/bin',
    HOME: '/Users/me',
  });
  assert.equal(out.npm_config_devdir, undefined);
  assert.equal(out.NPM_CONFIG_DEVDIR, undefined);
  assert.equal(out.PATH, '/usr/bin');
  assert.equal(out.HOME, '/Users/me');
});

test('sanitizeNpmSpawnEnv is case-insensitive for npm_config_devdir', () => {
  const out = sanitizeNpmSpawnEnv({ NPM_CONFIG_DEVDIR: '/x' });
  assert.equal(out.NPM_CONFIG_DEVDIR, undefined);
});
