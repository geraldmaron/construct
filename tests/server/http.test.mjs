/**
 * tests/server/http.test.mjs — unit coverage for lib/server/http.mjs's pure
 * helpers (construct-b0nny.26, E7). The socket-bound behavior is proven in
 * tests/functional/workspace-server.functional.test.mjs against a real
 * Postgres; this file covers resolveBindTarget, whose Number(undefined)=NaN
 * edge once crashed the default `construct server start` (no port env) with
 * ERR_SOCKET_BAD_PORT.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveBindTarget, DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from '../../lib/server/http.mjs';

test('resolveBindTarget falls back to the default host/port when nothing is configured', () => {
  const target = resolveBindTarget({ env: {} });
  assert.equal(target.host, DEFAULT_SERVER_HOST);
  assert.equal(target.port, DEFAULT_SERVER_PORT);
  assert.equal(Number.isNaN(target.port), false);
});

test('resolveBindTarget does not resolve an unset CONSTRUCT_SERVER_PORT to NaN', () => {
  const target = resolveBindTarget({ env: { CONSTRUCT_SERVER_HOST: '0.0.0.0' } });
  assert.equal(target.host, '0.0.0.0');
  assert.equal(target.port, DEFAULT_SERVER_PORT);
});

test('resolveBindTarget honors an explicit env host and port', () => {
  const target = resolveBindTarget({ env: { CONSTRUCT_SERVER_HOST: '10.0.0.5', CONSTRUCT_SERVER_PORT: '5000' } });
  assert.deepEqual(target, { host: '10.0.0.5', port: 5000 });
});

test('resolveBindTarget preserves port 0 (OS-assigned) rather than treating it as unset', () => {
  const target = resolveBindTarget({ env: { CONSTRUCT_SERVER_PORT: '0' } });
  assert.equal(target.port, 0);
});

test('resolveBindTarget lets an explicit arg override the env', () => {
  const target = resolveBindTarget({ env: { CONSTRUCT_SERVER_HOST: '10.0.0.5', CONSTRUCT_SERVER_PORT: '5000' }, host: '127.0.0.1', port: 6000 });
  assert.deepEqual(target, { host: '127.0.0.1', port: 6000 });
});
