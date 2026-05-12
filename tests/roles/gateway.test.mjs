/**
 * tests/roles/gateway.test.mjs — threshold, cooldown, rate ceiling, kill switches.
 *
 * shouldEscalate is pure (reads events + pending files but no network). Tests
 * isolate via CONSTRUCT_ROLES_ROOT and reset state between tests.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';

let bus;
let gw;
let loadManifest;

test.before(async () => {
  process.env.CONSTRUCT_ROLES_ROOT = tempDir('construct-roles-gw-');
  bus = await import('../../lib/roles/event-bus.mjs');
  gw = await import('../../lib/roles/gateway.mjs');
  ({ loadManifest } = await import('../../lib/roles/manifest.mjs'));
});

test.beforeEach(() => {
  const ep = bus._paths.eventsPath();
  const pp = gw._gatewayPaths.pendingPath();
  if (fs.existsSync(ep)) fs.unlinkSync(ep);
  if (fs.existsSync(pp)) fs.unlinkSync(pp);
  delete process.env.CONSTRUCT_ROLES;
  delete process.env.CONSTRUCT_ROLE_SRE;
  delete process.env.CONSTRUCT_ROLE_SECURITY;
});

test('severity-immediate escalates on first hit', () => {
  const m = loadManifest('sre');
  const e = bus.emit('service.down', { project: 'p', summary: 'postgres down' });
  const d = gw.shouldEscalate(e, m);
  assert.equal(d.escalate, true);
  assert.equal(d.reason, 'severity-immediate');
});

test('threshold requires N hits within window', () => {
  const m = loadManifest('sre');
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
  const m = loadManifest('sre');
  const e = bus.emit('service.down', { project: 'p', summary: 'down' });
  fs.appendFileSync(
    gw._gatewayPaths.pendingPath(),
    JSON.stringify({ ts: Date.now(), fingerprint: e.fingerprint, killSwitchEnv: 'CONSTRUCT_ROLE_SRE' }) + '\n'
  );
  const d = gw.shouldEscalate(e, m);
  assert.equal(d.escalate, false);
  assert.equal(d.reason, 'cooldown');
});

test('rate ceiling prevents more than 3 escalations per persona per hour', () => {
  const m = loadManifest('sre');
  const now = Date.now();
  for (let i = 0; i < 3; i++) {
    fs.appendFileSync(
      gw._gatewayPaths.pendingPath(),
      JSON.stringify({ ts: now - 1000 * i, fingerprint: `other-${i}`, killSwitchEnv: 'CONSTRUCT_ROLE_SRE' }) + '\n'
    );
  }
  const e = bus.emit('service.down', { project: 'p', summary: 'new failure' });
  const d = gw.shouldEscalate(e, m);
  assert.equal(d.escalate, false);
  assert.equal(d.reason, 'rate-ceiling');
});

test('global kill switch bails before emission', async () => {
  process.env.CONSTRUCT_ROLES = 'off';
  const r = await gw.recordAndMaybeInvoke('service.down', { project: 'p', summary: 'down' });
  assert.equal(r.recorded, false);
  assert.equal(r.reason, 'global-off');
});

test('per-persona kill switch bails after emission, before bd', async () => {
  process.env.CONSTRUCT_ROLE_SRE = 'off';
  const r = await gw.recordAndMaybeInvoke('service.down', { project: 'p', summary: 'down' });
  assert.equal(r.recorded, true);
  assert.equal(r.escalated, false);
  assert.equal(r.reason, 'persona-off');
});

test('unrouted events are recorded but not escalated', async () => {
  const r = await gw.recordAndMaybeInvoke('unknown.event', { project: 'p', summary: 'huh' });
  assert.equal(r.recorded, true);
  assert.equal(r.escalated, false);
  assert.equal(r.reason, 'no-owner');
});
