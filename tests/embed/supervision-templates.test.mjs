/**
 * tests/embed/supervision-templates.test.mjs — Unit tests for the
 * generalized platform-supervisor template generators in
 * lib/embed/supervision.mjs.
 *
 * lib/embed/supervision.mjs's launchd/systemd/Task-Scheduler generators were
 * parameterized by a service descriptor (SERVICES.embed / SERVICES.oracle)
 * so a second daemon (Oracle) can be OS-supervised without duplicating the
 * three per-platform generator functions. These tests exercise only the
 * pure template generators — no spawnSync, no real LaunchAgents/systemd
 * units/scheduled tasks are touched.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { SERVICES, launchdPlist, systemdUnit, windowsTaskCommand } from '../../lib/embed/supervision.mjs';

const BIN = '/fake/bin/construct';
const LOG = '/fake/log/daemon.log';

test('SERVICES registers distinct identities for embed and oracle', () => {
  assert.equal(SERVICES.embed.launchdLabel, 'com.construct.embed');
  assert.equal(SERVICES.oracle.launchdLabel, 'com.construct.oracle');
  assert.notEqual(SERVICES.embed.launchdLabel, SERVICES.oracle.launchdLabel);

  assert.equal(SERVICES.embed.systemdUnit, 'construct-embed.service');
  assert.equal(SERVICES.oracle.systemdUnit, 'construct-oracle.service');
  assert.notEqual(SERVICES.embed.systemdUnit, SERVICES.oracle.systemdUnit);

  assert.equal(SERVICES.embed.winTask, 'Construct.Embed');
  assert.equal(SERVICES.oracle.winTask, 'Construct.Oracle');
  assert.notEqual(SERVICES.embed.winTask, SERVICES.oracle.winTask);

  assert.deepEqual(SERVICES.embed.args, ['embed', 'start', '--foreground']);
  assert.deepEqual(SERVICES.oracle.args, ['oracle', 'start', '--foreground']);
});

test('launchdPlist produces a correct, distinct config for oracle vs embed', () => {
  const embedPlist = launchdPlist(SERVICES.embed, BIN, LOG);
  const oraclePlist = launchdPlist(SERVICES.oracle, BIN, LOG);

  assert.match(embedPlist, /<string>com\.construct\.embed<\/string>/);
  assert.match(embedPlist, /<string>embed<\/string>/);
  assert.match(embedPlist, /<string>start<\/string>/);
  assert.match(embedPlist, /<string>--foreground<\/string>/);

  assert.match(oraclePlist, /<string>com\.construct\.oracle<\/string>/);
  assert.match(oraclePlist, /<string>oracle<\/string>/);
  assert.doesNotMatch(oraclePlist, /<string>com\.construct\.embed<\/string>/);
  assert.doesNotMatch(oraclePlist, /<string>embed<\/string>/);

  assert.notEqual(embedPlist, oraclePlist);

  // KeepAlive/Crashed + ThrottleInterval are shared restart semantics —
  // generalization must not drop them for either service.
  for (const plist of [embedPlist, oraclePlist]) {
    assert.match(plist, /<key>Crashed<\/key>/);
    assert.match(plist, /<key>ThrottleInterval<\/key>/);
    assert.match(plist, new RegExp(`<string>${LOG}</string>`));
  }
});

test('systemdUnit produces a correct, distinct config for oracle vs embed', () => {
  const embedUnit = systemdUnit(SERVICES.embed, BIN, LOG);
  const oracleUnit = systemdUnit(SERVICES.oracle, BIN, LOG);

  assert.match(embedUnit, /Description=Construct embed daemon/);
  assert.match(embedUnit, new RegExp(`ExecStart=.*${BIN} embed start --foreground`));

  assert.match(oracleUnit, /Description=Construct oracle daemon/);
  assert.match(oracleUnit, new RegExp(`ExecStart=.*${BIN} oracle start --foreground`));

  assert.notEqual(embedUnit, oracleUnit);

  for (const unit of [embedUnit, oracleUnit]) {
    assert.match(unit, /Restart=on-failure/);
    assert.match(unit, /RestartSec=10/);
    assert.match(unit, new RegExp(`StandardOutput=append:${LOG}`));
  }
});

test('windowsTaskCommand produces a correct, distinct config for oracle vs embed', () => {
  const embedCmd = windowsTaskCommand(SERVICES.embed, BIN, LOG);
  const oracleCmd = windowsTaskCommand(SERVICES.oracle, BIN, LOG);

  assert.match(embedCmd, /\/TN Construct\.Embed/);
  assert.match(embedCmd, /embed start --foreground/);

  assert.match(oracleCmd, /\/TN Construct\.Oracle/);
  assert.match(oracleCmd, /oracle start --foreground/);

  assert.notEqual(embedCmd, oracleCmd);

  for (const cmd of [embedCmd, oracleCmd]) {
    assert.match(cmd, /\/SC ONLOGON/);
    assert.match(cmd, /\/RL HIGHEST/);
  }
});
