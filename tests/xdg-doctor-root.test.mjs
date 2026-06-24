/**
 * tests/xdg-doctor-root.test.mjs — global doctor/telemetry/runtime root contract.
 *
 * Pins the clean break for the formerly ~/.cx-rooted axis: doctorRoot() defaults
 * to the XDG state dir, never a legacy ~/.cx path. CONSTRUCT_DOCTOR_ROOT wins
 * only when set to a non-empty value; an empty or whitespace override is ignored.
 * XDG_STATE_HOME flows through stateDir() so the override and the spec layout
 * stay in agreement.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { doctorRoot, stateDir } from '../lib/config/xdg.mjs';

const HOME = '/home/tester';

test('doctorRoot defaults to the XDG state dir with no override', () => {
  assert.equal(doctorRoot(HOME, {}), stateDir(HOME, {}));
  assert.equal(doctorRoot(HOME, {}), path.join(HOME, '.local', 'state', 'construct'));
});

test('doctorRoot never returns a legacy ~/.cx path', () => {
  assert.ok(!doctorRoot(HOME, {}).includes(path.join(HOME, '.cx')), 'must not resolve under ~/.cx');
});

test('an absolute CONSTRUCT_DOCTOR_ROOT override is honored verbatim', () => {
  assert.equal(doctorRoot(HOME, { CONSTRUCT_DOCTOR_ROOT: '/abs/x' }), '/abs/x');
});

test('an empty CONSTRUCT_DOCTOR_ROOT override falls back to the state dir', () => {
  assert.equal(doctorRoot(HOME, { CONSTRUCT_DOCTOR_ROOT: '' }), stateDir(HOME, {}));
});

test('a whitespace-only CONSTRUCT_DOCTOR_ROOT override is ignored', () => {
  assert.equal(doctorRoot(HOME, { CONSTRUCT_DOCTOR_ROOT: '   ' }), stateDir(HOME, {}));
});

test('doctorRoot honors XDG_STATE_HOME through stateDir', () => {
  const env = { XDG_STATE_HOME: '/var/state' };
  assert.equal(doctorRoot(HOME, env), stateDir(HOME, env));
  assert.equal(doctorRoot(HOME, env), path.join('/var/state', 'construct'));
});
