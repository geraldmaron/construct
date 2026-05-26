/**
 * tests/functional/w1-boundary-handshake.functional.test.mjs — Boundary handshake.
 *
 * Drives lib/boundary.mjs through every gate: HMAC signature verification,
 * parent reachability, fresh registration, conflict rejection, override
 * rotation with archive. Uses a fake `probe` injection to avoid live HTTP.
 * The handshake persists ~/.construct/boundary.json under a tmpdir HOME so
 * tests don't touch operator state.
 */
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  registerBoundary,
  boundaryConfigPath,
  signBoundaryRequest,
} from '../../lib/boundary.mjs';

const reachable = async () => ({ ok: true });
const unreachable = async () => ({ ok: false, error: 'connect refused' });

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'construct-boundary-'));
  return {
    home,
    cleanup() { try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

test('rejects when parentInstance or parentUrl are missing', async () => {
  const { home, cleanup } = freshHome();
  try {
    const r = await registerBoundary({ parentInstance: '', parentUrl: '', childInstanceId: 'c1', home, probe: reachable });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  } finally { cleanup(); }
});

test('rejects when shared secret is configured but no signature is sent', async () => {
  const { home, cleanup } = freshHome();
  try {
    const r = await registerBoundary({
      parentInstance: 'parent-1',
      parentUrl: 'http://parent.example',
      childInstanceId: 'c1',
      sharedSecret: 'topsecret',
      home,
      probe: reachable,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.match(r.error, /nonce and signature/);
  } finally { cleanup(); }
});

test('rejects when signature is wrong', async () => {
  const { home, cleanup } = freshHome();
  try {
    const r = await registerBoundary({
      parentInstance: 'parent-1',
      parentUrl: 'http://parent.example',
      childInstanceId: 'c1',
      sharedSecret: 'topsecret',
      nonce: 'abc123',
      signature: 'deadbeef',
      home,
      probe: reachable,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.match(r.error, /signature/);
  } finally { cleanup(); }
});

test('accepts a correctly signed request, persists ~/.construct/boundary.json', async () => {
  const { home, cleanup } = freshHome();
  try {
    const sig = signBoundaryRequest({ childInstanceId: 'c1', nonce: 'abc123', sharedSecret: 'topsecret' });
    const r = await registerBoundary({
      parentInstance: 'parent-1',
      parentUrl: 'http://parent.example',
      childInstanceId: 'c1',
      sharedSecret: 'topsecret',
      nonce: 'abc123',
      signature: sig,
      home,
      probe: reachable,
    });
    assert.equal(r.ok, true);
    assert.equal(r.config.parentInstance, 'parent-1');
    assert.equal(r.config.childInstanceId, 'c1');
    assert.equal(r.config.boundaryVersion, '1.0');
    assert.ok(existsSync(boundaryConfigPath(home)));
    const persisted = JSON.parse(readFileSync(boundaryConfigPath(home), 'utf8'));
    assert.equal(persisted.parentInstance, 'parent-1');
    assert.equal(persisted.rotatedFrom, null);
  } finally { cleanup(); }
});

test('rejects with 502 when parent is unreachable', async () => {
  const { home, cleanup } = freshHome();
  try {
    const r = await registerBoundary({
      parentInstance: 'parent-1',
      parentUrl: 'http://parent.example',
      childInstanceId: 'c1',
      home,
      probe: unreachable,
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 502);
    assert.match(r.error, /unreachable/);
  } finally { cleanup(); }
});

test('rejects 409 when a different parent registers without override', async () => {
  const { home, cleanup } = freshHome();
  try {
    const first = await registerBoundary({
      parentInstance: 'parent-1',
      parentUrl: 'http://parent.example',
      childInstanceId: 'c1',
      home,
      probe: reachable,
    });
    assert.equal(first.ok, true);

    const second = await registerBoundary({
      parentInstance: 'parent-2',
      parentUrl: 'http://other.example',
      childInstanceId: 'c1',
      home,
      probe: reachable,
      allowOverride: false,
    });
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
    assert.match(second.error, /already bound/);
  } finally { cleanup(); }
});

test('rotates when override is allowed and archives the prior config', async () => {
  const { home, cleanup } = freshHome();
  try {
    await registerBoundary({
      parentInstance: 'parent-1',
      parentUrl: 'http://parent.example',
      childInstanceId: 'c1',
      home,
      probe: reachable,
    });
    const second = await registerBoundary({
      parentInstance: 'parent-2',
      parentUrl: 'http://other.example',
      childInstanceId: 'c1',
      home,
      probe: reachable,
      allowOverride: true,
    });
    assert.equal(second.ok, true);
    assert.equal(second.config.parentInstance, 'parent-2');
    assert.equal(second.config.rotatedFrom, 'parent-1');
    const archives = readdirSync(join(home, '.construct')).filter((n) => n.startsWith('boundary.') && n !== 'boundary.json');
    assert.equal(archives.length, 1);
    const archived = JSON.parse(readFileSync(join(home, '.construct', archives[0]), 'utf8'));
    assert.equal(archived.parentInstance, 'parent-1');
  } finally { cleanup(); }
});

test('the same parent re-registering is not a conflict', async () => {
  const { home, cleanup } = freshHome();
  try {
    await registerBoundary({
      parentInstance: 'parent-1',
      parentUrl: 'http://parent.example',
      childInstanceId: 'c1',
      home,
      probe: reachable,
    });
    const second = await registerBoundary({
      parentInstance: 'parent-1',
      parentUrl: 'http://parent.example',
      childInstanceId: 'c1',
      home,
      probe: reachable,
    });
    assert.equal(second.ok, true);
    assert.equal(second.config.parentInstance, 'parent-1');
  } finally { cleanup(); }
});

test('persisted boundary.json is mode 0600 (operator-only readable)', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX-only permission check');
  const { home, cleanup } = freshHome();
  try {
    await registerBoundary({
      parentInstance: 'parent-1',
      parentUrl: 'http://parent.example',
      childInstanceId: 'c1',
      home,
      probe: reachable,
    });
    const { statSync } = await import('node:fs');
    const stat = statSync(boundaryConfigPath(home));
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600);
  } finally { cleanup(); }
});
