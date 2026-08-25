import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePaths } from '../../src/kernel/paths.ts';

test('resolvePaths roots every dir under an injected HOME, never the real one', () => {
  const paths = resolvePaths({}, '/tmp/fixture-home');
  assert.equal(paths.configDir, '/tmp/fixture-home/.config/construct');
  assert.equal(paths.stateDir, '/tmp/fixture-home/.local/state/construct');
  assert.equal(paths.dataDir, '/tmp/fixture-home/.local/share/construct');
  assert.equal(paths.cacheDir, '/tmp/fixture-home/.cache/construct');
});

test('resolvePaths honors XDG overrides over HOME', () => {
  const paths = resolvePaths({ XDG_STATE_HOME: '/tmp/xdg-state' }, '/tmp/fixture-home');
  assert.equal(paths.stateDir, '/tmp/xdg-state/construct');
  assert.equal(paths.configDir, '/tmp/fixture-home/.config/construct');
});

test('an empty XDG value is unset, per the spec, never a relative base', () => {
  const paths = resolvePaths(
    { XDG_CONFIG_HOME: '', XDG_STATE_HOME: '', XDG_DATA_HOME: '', XDG_CACHE_HOME: '' },
    '/tmp/fixture-home',
  );
  assert.equal(paths.stateDir, '/tmp/fixture-home/.local/state/construct');
  assert.equal(paths.configDir, '/tmp/fixture-home/.config/construct');
  assert.equal(paths.dataDir, '/tmp/fixture-home/.local/share/construct');
  assert.equal(paths.cacheDir, '/tmp/fixture-home/.cache/construct');
});

test('an empty HOME falls back to the real home rather than a relative path', () => {
  const paths = resolvePaths({ HOME: '' });
  assert.ok(paths.stateDir.startsWith('/'), `expected absolute, got ${paths.stateDir}`);
});
