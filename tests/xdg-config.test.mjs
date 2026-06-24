/**
 * tests/xdg-config.test.mjs — XDG base-directory resolver contract.
 *
 * Pins the config/state/cache split: each resolver returns <base>/construct,
 * honors its XDG_* env var only when the value is absolute, and falls back to
 * the spec default for relative or empty overrides. Also pins the clean break —
 * no resolver ever returns a legacy ~/.construct path.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { configDir, stateDir, cacheDir } from '../lib/config/xdg.mjs';

const HOME = '/home/tester';

test('defaults follow the XDG spec layout under home', () => {
  assert.equal(configDir(HOME, {}), path.join(HOME, '.config', 'construct'));
  assert.equal(stateDir(HOME, {}), path.join(HOME, '.local', 'state', 'construct'));
  assert.equal(cacheDir(HOME, {}), path.join(HOME, '.cache', 'construct'));
});

test('absolute XDG_* overrides are honored', () => {
  assert.equal(configDir(HOME, { XDG_CONFIG_HOME: '/etc/xdg' }), path.join('/etc/xdg', 'construct'));
  assert.equal(stateDir(HOME, { XDG_STATE_HOME: '/var/state' }), path.join('/var/state', 'construct'));
  assert.equal(cacheDir(HOME, { XDG_CACHE_HOME: '/var/cache' }), path.join('/var/cache', 'construct'));
});

test('relative XDG_* overrides are ignored in favor of the default', () => {
  assert.equal(configDir(HOME, { XDG_CONFIG_HOME: 'relative/cfg' }), path.join(HOME, '.config', 'construct'));
  assert.equal(stateDir(HOME, { XDG_STATE_HOME: '../st' }), path.join(HOME, '.local', 'state', 'construct'));
  assert.equal(cacheDir(HOME, { XDG_CACHE_HOME: 'cache' }), path.join(HOME, '.cache', 'construct'));
});

test('empty XDG_* overrides are ignored in favor of the default', () => {
  assert.equal(configDir(HOME, { XDG_CONFIG_HOME: '' }), path.join(HOME, '.config', 'construct'));
  assert.equal(stateDir(HOME, { XDG_STATE_HOME: '' }), path.join(HOME, '.local', 'state', 'construct'));
  assert.equal(cacheDir(HOME, { XDG_CACHE_HOME: '' }), path.join(HOME, '.cache', 'construct'));
});

test('no resolver returns a legacy ~/.construct path', () => {
  for (const dir of [configDir(HOME, {}), stateDir(HOME, {}), cacheDir(HOME, {})]) {
    assert.ok(!dir.includes(path.join(HOME, '.construct')), `${dir} must not be the legacy ~/.construct path`);
  }
});

test('the construct app segment is always the leaf', () => {
  assert.equal(path.basename(configDir(HOME, {})), 'construct');
  assert.equal(path.basename(stateDir(HOME, {})), 'construct');
  assert.equal(path.basename(cacheDir(HOME, {})), 'construct');
});
