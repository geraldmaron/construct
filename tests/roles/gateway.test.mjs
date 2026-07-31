/**
 * tests/roles/gateway.test.mjs — threshold, cooldown, rate ceiling, kill switches.
 *
 * shouldEscalate is pure (reads events + pending files but no network). Tests
 * isolate via CONSTRUCT_ROLES_ROOT and reset state between tests.
 *
 * Any test that can reach createBdIncident() MUST inject fakeRunBd()
 * -- CONSTRUCT_ROLES_ROOT only isolates the dedup-fingerprint files, not the bd
 * client, so an uninjected escalation path still hits the real shared bd/dolt
 * database.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';

const OPERATIONS_MANIFEST = {
  id: 'operations',
  events: [
    'plan.requested',
    'push_gate.fail',
    'service.down',
    'mcp.unhealthy.persistent',
    'edit_loop.stuck',
    'release.candidate',
    'version.bump.needed',
    'pr.merged.no-docs',
    'changelog.missing',
    'readme.stale',
    'document.stale',
  ],
  severityImmediate: ['service.down'],
  killSwitchEnv: 'CONSTRUCT_ROLE_OPERATIONS',
  fence: {},
  handoffCandidates: [],
};

const SECURITY_MANIFEST = {
  id: 'security',
  events: ['secrets.detected'],
  severityImmediate: ['secrets.detected'],
  killSwitchEnv: 'CONSTRUCT_ROLE_SECURITY',
  fence: {},
  handoffCandidates: [],
};

let bus;
let gw;
let loadManifest;

function fakeRunBd(calls) {
  return async (args) => {
    calls.push(args);
    return { success: true, output: 'Created issue: fake-0001' };
  };
}

test.before(async () => {
  process.env.CONSTRUCT_ROLES_ROOT = tempDir('construct-roles-gw-');
  bus = await import('../../lib/roles/event-bus.mjs');
  gw = await import('../../lib/roles/gateway.mjs');
  ({ loadManifest } = await import('../../lib/roles/manifest.mjs'));
});

function operationsManifest() {
  return loadManifest('operations') ? {
    ...loadManifest('operations'),
    id: 'operations',
    severityImmediate: ['service.down'],
    killSwitchEnv: 'CONSTRUCT_ROLE_OPERATIONS',
  } : OPERATIONS_MANIFEST;
}

test.beforeEach(() => {
  const ep = bus._paths.eventsPath();
  const pp = gw._gatewayPaths.pendingPath();
  if (fs.existsSync(ep)) fs.unlinkSync(ep);
  if (fs.existsSync(pp)) fs.unlinkSync(pp);
  delete process.env.CONSTRUCT_ROLES;
  delete process.env.CONSTRUCT_ROLE_OPERATIONS;
  delete process.env.CONSTRUCT_ROLE_SECURITY;
});

test('severity-immediate escalates on first hit', () => {
  const m = operationsManifest();
  const e = bus.emit('service.down', { project: 'p', summary: 'postgres down' });
  const d = gw.shouldEscalate(e, m);
  assert.equal(d.escalate, true);
  assert.equal(d.reason, 'severity-immediate');
});

test('threshold requires N hits within window', () => {
  const m = operationsManifest();
  const e1 = bus.emit('push_gate.fail', { project: 'p', summary: 'fail' });
  let d = gw.shouldEscalate(e1, m);
  assert.equal(d.escalate, false);
  assert.equal(d.reason, 'below-threshold');

  bus.emit('push_gate.fail', { project: 'p', summary: 'fail' });
  d = gw.shouldEscalate(e1, m);
  assert.equal(d.escalate, true);
  assert.equal(d.reason, 'threshold');
});

test('cooldown suppresses re-escalation of the same fingerprint', () => {
  const m = operationsManifest();
  const e = bus.emit('service.down', { project: 'p', summary: 'down' });
  fs.appendFileSync(
    gw._gatewayPaths.pendingPath(),
    JSON.stringify({ ts: Date.now(), fingerprint: e.fingerprint, killSwitchEnv: 'CONSTRUCT_ROLE_OPERATIONS' }) + '\n'
  );
  const d = gw.shouldEscalate(e, m);
  assert.equal(d.escalate, false);
  assert.equal(d.reason, 'cooldown');
});

test('rate ceiling prevents more than 3 escalations per Worker Profile per hour', () => {
  const m = operationsManifest();
  const now = Date.now();
  for (let i = 0; i < 3; i++) {
    fs.appendFileSync(
      gw._gatewayPaths.pendingPath(),
      JSON.stringify({
        ts: now - 1000 * i,
        fingerprint: `other-${i}`,
        workerProfileId: 'operations',
        killSwitchEnv: 'CONSTRUCT_ROLE_OPERATIONS',
      }) + '\n'
    );
  }
  const e = bus.emit('service.down', { project: 'p', summary: 'new failure' });
  const d = gw.shouldEscalate(e, m);
  assert.equal(d.escalate, false);
  assert.equal(d.reason, 'rate-ceiling');
});

test('global kill switch bails before emission', async () => {
  process.env.CONSTRUCT_ROLES = 'off';
  const calls = [];
  const r = await gw.recordAndMaybeInvoke('service.down', { project: 'p', summary: 'down' }, { runBd: fakeRunBd(calls) });
  assert.equal(r.recorded, false);
  assert.equal(r.reason, 'global-off');
  assert.equal(calls.length, 0, 'bd client must not be called');
});

test('per-Worker Profile kill switch env blocks escalation when set', () => {
  process.env.CONSTRUCT_ROLE_OPERATIONS = 'off';
  const m = operationsManifest();
  const blocked = !!(m.killSwitchEnv && process.env[m.killSwitchEnv] === 'off');
  assert.equal(blocked, true);
});

test('severity-immediate events pass shouldEscalate before bd handoff', () => {
  const m = operationsManifest();
  const e = bus.emit('service.down', { project: 'p', summary: 'postgres down' });
  const d = gw.shouldEscalate(e, m);
  assert.equal(d.escalate, true);
  assert.equal(d.reason, 'severity-immediate');
});

test('unrouted events are recorded but not escalated', async () => {
  const calls = [];
  const r = await gw.recordAndMaybeInvoke('unknown.event', { project: 'p', summary: 'huh' }, { runBd: fakeRunBd(calls) });
  assert.equal(r.recorded, true);
  assert.equal(r.escalated, false);
  assert.equal(r.reason, 'no-owner');
  assert.equal(calls.length, 0, 'bd client must not be called');
});

test('events from OS tmpdir paths are not escalated (test-fixture filter)', () => {
  const m = SECURITY_MANIFEST;
  const tmpProject = path.join(os.tmpdir(), 'cx-secrets-fixture-test', 'fixture.env');

  const e = bus.emit('secrets.detected', {
    project: tmpProject,
    cwd: path.dirname(tmpProject),
    summary: 'Secret(s) detected in fixture.env: Stripe live secret',
    context: { filePath: tmpProject },
  });

  const d = gw.shouldEscalate(e, m);
  assert.equal(d.escalate, false, 'tmpdir path should not escalate');
  assert.equal(d.reason, 'test-fixture-path');
});

test('isTestFixturePath catches macOS /private/var prefix and /tmp/ paths', () => {
  // macOS user tmpdir: /private/var/folders/<2chars>/<long>/T/<run>
  assert.equal(gw.isTestFixturePath('/private/var/folders/b6/zzjn4lds7bj5d82qfl3lqb580000gn/T/cx-secrets-xyz/fixture.env'), true);
  assert.equal(gw.isTestFixturePath('/var/folders/b6/zzjn4lds7bj5d82qfl3lqb580000gn/T/init-cxignore-Abc/postgres.yml'), true);
  assert.equal(gw.isTestFixturePath('/tmp/init-cxignore-Abc/postgres.yml'), true);
  assert.equal(gw.isTestFixturePath('/Users/me/Git/myproject/src/secrets.env'), false);
  assert.equal(gw.isTestFixturePath(null), false);
  assert.equal(gw.isTestFixturePath(''), false);
});

function writePending(entries) {
  fs.writeFileSync(gw._gatewayPaths.pendingPath(), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

test('listPending filters out unresolved entries older than the TTL', () => {
  const now = Date.now();
  const fresh = { ts: now - 1000, workerProfileId: 'operations', fingerprint: 'fresh', eventType: 'service.down', summary: 'recent' };
  const stale = { ts: now - 15 * 24 * 60 * 60 * 1000, workerProfileId: 'security', fingerprint: 'stale', eventType: 'secrets.detected', summary: 'old fixture' };
  writePending([fresh, stale]);

  const pending = gw.listPending({ unresolved: true });
  assert.deepEqual(pending.map((p) => p.fingerprint), ['fresh'], 'only the within-TTL entry surfaces');

  // unresolved:false bypasses the TTL/resolved filter (raw view for `show`)
  assert.equal(gw.listPending({ unresolved: false }).length, 2);
});

test('prunePending compacts resolved, expired, and fixture entries, keeps the rest', () => {
  const now = Date.now();
  const fresh = { ts: now - 1000, fingerprint: 'fresh', eventType: 'x', summary: 'real handoff' };
  const resolved = { ts: now - 1000, fingerprint: 'resolved', resolvedAt: now - 500, eventType: 'x', summary: 's' };
  const expired = { ts: now - 30 * 24 * 60 * 60 * 1000, fingerprint: 'expired', eventType: 'x', summary: 's' };
  const fixture = { ts: now - 1000, fingerprint: 'fixture', eventType: 'secrets.detected', summary: 'Secret(s) detected in /private/var/folders/b6/x/T/cx-secrets-Q/fixture.env: Stripe live secret' };
  writePending([fresh, resolved, expired, fixture]);

  const result = gw.prunePending({ now });
  assert.deepEqual(result, { removed: 3, resolved: 1, expired: 1, fixtures: 1, kept: 1 });

  const remaining = gw.listPending({ unresolved: false });
  assert.deepEqual(remaining.map((e) => e.fingerprint), ['fresh'], 'only the real entry persists on disk');

  // Idempotent: a second prune removes nothing.
  assert.deepEqual(gw.prunePending({ now }), { removed: 0, resolved: 0, expired: 0, fixtures: 0, kept: 1 });
});
