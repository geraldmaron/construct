/**
 * tests/security/ssrf.test.mjs — SSRF / DNS-rebinding egress guard.
 *
 * @owasp LLM06
 *
 * Covers the bead's acceptance criteria against lib/net-guard.mjs:
 *   1. egress to 169.254.x / 10.x / 127.x (and peers) is blocked by default
 *      with a named reason;
 *   2. a rebinding simulation — the resolver flips to a private address
 *      mid-session — cannot move the connection off the pinned public address;
 *   3. the guard actually gates a live socket (blocked by default to loopback,
 *      permitted only under the audited allowPrivate opt-out).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  classifyAddress,
  resolveGuardedTarget,
  guardedFetch,
  SsrfBlockedError,
} from '../../lib/net-guard.mjs';
import { createJiraTransport } from '../../lib/providers/contract/adapters/jira/transport.mjs';

/** A DNS stub returning fixed addresses for any hostname. */
function fixedLookup(...addresses) {
  return async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

test('classifyAddress blocks private/loopback/link-local, allows public', () => {
  for (const [ip, reason] of [
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private-address'],
    ['172.16.5.4', 'private-address'],
    ['192.168.0.9', 'private-address'],
    ['169.254.169.254', 'link-local'],
    ['100.64.0.1', 'cgnat'],
    ['0.0.0.0', 'unspecified'],
    ['::1', 'loopback'],
    ['fd00::1', 'unique-local'],
    ['::ffff:127.0.0.1', 'loopback'],
  ]) {
    assert.equal(classifyAddress(ip), reason, `${ip} should classify as ${reason}`);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:2800:220:1::1']) {
    assert.equal(classifyAddress(ip), null, `${ip} should be public`);
  }
});

test('resolveGuardedTarget rejects non-http(s) schemes', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://x']) {
    await assert.rejects(
      () => resolveGuardedTarget(url, { lookup: fixedLookup('93.184.216.34') }),
      (e) => e instanceof SsrfBlockedError && e.reason === 'blocked-scheme',
    );
  }
});

test('egress to a hostname resolving into a blocked range is refused by default', async () => {
  await assert.rejects(
    () => resolveGuardedTarget('https://evil.example', { lookup: fixedLookup('169.254.169.254') }),
    (e) => e instanceof SsrfBlockedError && e.reason === 'link-local',
  );
  await assert.rejects(
    () => resolveGuardedTarget('https://evil.example', { lookup: fixedLookup('10.0.0.5') }),
    (e) => e instanceof SsrfBlockedError && e.reason === 'private-address',
  );
});

test('an IP-literal URL is classified without DNS (http://127.0.0.1 blocked)', async () => {
  await assert.rejects(
    () => resolveGuardedTarget('http://127.0.0.1:8080/admin'),
    (e) => e instanceof SsrfBlockedError && e.reason === 'loopback',
  );
});

test('a hostname mixing public and private addresses is refused whole', async () => {
  await assert.rejects(
    () => resolveGuardedTarget('https://mixed.example', { lookup: fixedLookup('93.184.216.34', '127.0.0.1') }),
    (e) => e instanceof SsrfBlockedError,
  );
});

test('allowPrivate is the explicit opt-out', async () => {
  const t = await resolveGuardedTarget('http://127.0.0.1:9/x', { allowPrivate: true });
  assert.equal(t.pinnedAddress, '127.0.0.1');
  assert.equal(t.port, 9);
});

test('rebinding: the pinned address is the one validated first, not the flipped one', async () => {
  // Resolver returns a public address on the first call, then a private one —
  // the guard resolves once and pins the public address; the private flip is
  // never reachable through the returned target.
  let calls = 0;
  const rebindingLookup = async () => {
    calls += 1;
    return calls === 1
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }];
  };
  const target = await resolveGuardedTarget('https://rebind.example', { lookup: rebindingLookup });
  assert.equal(target.pinnedAddress, '93.184.216.34');

  // A fresh guard call after the flip (the attacker's second resolution) is
  // itself refused, so no code path validates the private address.
  await assert.rejects(
    () => resolveGuardedTarget('https://rebind.example', { lookup: rebindingLookup }),
    (e) => e instanceof SsrfBlockedError && e.reason === 'loopback',
  );
});

test('a provider transport configured with a private baseUrl is blocked by default', async () => {
  const transport = createJiraTransport({ baseUrl: 'http://10.0.0.5', email: 'x@y.z', token: 't' });
  await assert.rejects(
    () => transport.searchIssues('project = X'),
    (e) => e instanceof SsrfBlockedError && e.reason === 'private-address',
  );
});

test('guardedFetch gates a live socket: blocked by default, permitted under allowPrivate', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await assert.rejects(
      () => guardedFetch(`http://127.0.0.1:${port}/data`),
      (e) => e instanceof SsrfBlockedError && e.reason === 'loopback',
    );

    const res = await guardedFetch(`http://127.0.0.1:${port}/data`, {}, { allowPrivate: true });
    assert.equal(res.status, 200);
    assert.equal(res.ok, true);
    const body = await res.json();
    assert.deepEqual(body, { ok: true, path: '/data' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
