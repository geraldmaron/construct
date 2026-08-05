/**
 * tests/hosts/environment.test.ts — the environment a host is spawned with
 *.
 *
 * The property under test is the one the bug violated: isolating CONSTRUCT's
 * state must not change which configuration the HOST reads. Everything here is
 * a pure function over an environment object, so it holds regardless of what
 * the machine running the suite happens to have set.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  droppedForHost,
  hostEnvironment,
  INHERIT_XDG_VAR,
  SHARED_XDG_VARS,
} from '../../src/hosts/environment.ts';

const ISOLATED = {
  HOME: '/home/real',
  PATH: '/usr/bin',
  XDG_CONFIG_HOME: '/tmp/scratch/cfg',
  XDG_STATE_HOME: '/tmp/scratch/state',
  XDG_DATA_HOME: '/tmp/scratch',
  XDG_CACHE_HOME: '/tmp/scratch/cache',
};

test('an isolated run hands the host no XDG override at all', () => {
  const env = hostEnvironment(ISOLATED);
  for (const variable of SHARED_XDG_VARS) {
    assert.equal(env[variable], undefined, `${variable} must not reach the host`);
  }
});

test('the host keeps everything that is not construct isolation', () => {
  const env = hostEnvironment(ISOLATED);
  assert.equal(env.HOME, '/home/real', 'HOME is how the host finds its own defaults');
  assert.equal(env.PATH, '/usr/bin');
});

test('credentials are the reason DATA is dropped too, not only CONFIG', () => {
  // OpenCode keeps provider auth under XDG_DATA_HOME. The original measurement
  // called DATA isolation harmless because it was taken on ollama, which needs
  // no auth — dropping only CONFIG would have left paid providers broken.
  const env = hostEnvironment(ISOLATED);
  assert.equal(env.XDG_DATA_HOME, undefined);
});

test('an un-isolated run is handed exactly what it always was', () => {
  const ambient = { HOME: '/home/real', PATH: '/usr/bin' };
  assert.deepEqual(hostEnvironment(ambient), ambient);
  assert.deepEqual(droppedForHost(ambient), [], 'nothing to report when nothing was isolated');
});

test('the escape hatch puts the host back under the isolation deliberately', () => {
  const env = hostEnvironment({ ...ISOLATED, [INHERIT_XDG_VAR]: '1' });
  assert.equal(env.XDG_CONFIG_HOME, '/tmp/scratch/cfg');
  assert.equal(env.XDG_DATA_HOME, '/tmp/scratch');
  assert.deepEqual(droppedForHost({ ...ISOLATED, [INHERIT_XDG_VAR]: '1' }), []);
});

test('the ways of saying "no" to the escape hatch all mean no', () => {
  for (const value of ['', '0', 'false', 'FALSE', '  ']) {
    const env = hostEnvironment({ ...ISOLATED, [INHERIT_XDG_VAR]: value });
    assert.equal(env.XDG_CONFIG_HOME, undefined, `"${value}" must not enable inheritance`);
  }
});

test('what was dropped is reportable, so an adjustment is not silent', () => {
  assert.deepEqual(droppedForHost(ISOLATED), [...SHARED_XDG_VARS]);
  assert.deepEqual(droppedForHost({ HOME: '/h', XDG_CONFIG_HOME: '/c' }), ['XDG_CONFIG_HOME']);
});

test('the ambient environment is never mutated by building a host one', () => {
  const ambient = { ...ISOLATED };
  hostEnvironment(ambient);
  assert.deepEqual(ambient, ISOLATED, 'the caller\'s own environment must survive intact');
});
