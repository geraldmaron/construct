/**
 * tests/kernel/schedule-units.test.ts — the text of a platform timer, checked
 * as text.
 *
 * Everything here is the pure generator: no file is written and no launchctl
 * or systemctl is anywhere near it. What the tests hold are the properties the
 * residency decision turned on — calendar firings rather than intervals, so a
 * sleeping laptop coalesces instead of missing; a oneshot that leaves nothing
 * resident; no environment entries, so no unit file can carry a secret; and a
 * cadence a reader can get back out of the entry it was written into.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALWAYS_ON_LABEL,
  ALWAYS_ON_UNIT,
  SCHEDULE_LABEL,
  ScheduleCadenceError,
  alwaysOnPlan,
  alwaysOnUnitPaths,
  cadenceMinutesFromUnitText,
  firingTimes,
  schedulePlan,
  scheduleUnitPaths,
} from '../../src/kernel/schedule/units.ts';

const BIN = { nodePath: '/opt/node/bin/node', cliPath: '/opt/construct/bin/construct.mjs' };

function darwin(everyMinutes: number, at: { hour: number; minute: number } | null = null) {
  return schedulePlan({
    platform: 'darwin',
    dir: '/home/somebody/Library/LaunchAgents',
    everyMinutes,
    anchor: at,
    uid: 501,
    ...BIN,
  });
}

function linux(everyMinutes: number, at: { hour: number; minute: number } | null = null) {
  return schedulePlan({
    platform: 'linux',
    dir: '/home/somebody/.config/systemd/user',
    everyMinutes,
    anchor: at,
    uid: 1000,
    ...BIN,
  });
}

test('a six-hour cadence lands on the four hours that divide the day', () => {
  assert.deepStrictEqual(firingTimes(360, null), { hours: [0, 6, 12, 18], minute: 0 });
});

test('a daily cadence with no time named lands at the default hour', () => {
  assert.deepStrictEqual(firingTimes(1440, null), { hours: [9], minute: 0 });
});

test('a named time moves both the hour and the minute of a sub-daily cadence', () => {
  assert.deepStrictEqual(firingTimes(360, { hour: 2, minute: 30 }), {
    hours: [2, 8, 14, 20],
    minute: 30,
  });
});

test('a cadence no calendar entry states exactly is refused, not approximated', () => {
  for (const minutes of [30, 300, 2880]) {
    assert.throws(() => firingTimes(minutes, null), ScheduleCadenceError, `${String(minutes)}m`);
  }
});

test('the launchd entry fires on the calendar and leaves nothing resident', () => {
  const plan = darwin(360);
  const [unit] = plan.units;
  assert.match(unit.path, /com\.construct\.schedule\.plist$/);
  assert.match(unit.text, /<key>StartCalendarInterval<\/key>/);
  assert.doesNotMatch(unit.text, /StartInterval/, 'an interval firing is missed during sleep');
  assert.match(unit.text, /<key>KeepAlive<\/key>\s*<false\/>/);
  assert.match(unit.text, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.match(unit.text, /<key>ProcessType<\/key>\s*<string>Background<\/string>/);
  assert.match(unit.text, /<key>LowPriorityBackgroundIO<\/key>\s*<true\/>/);
  const hours = [...unit.text.matchAll(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/g)].map((m) =>
    Number(m[1]),
  );
  assert.deepStrictEqual(hours, [0, 6, 12, 18]);
});

test('the launchd entry runs both due lines from the absolute paths it was given', () => {
  const [unit] = darwin(1440).units;
  assert.match(unit.text, /standing --due/);
  assert.match(unit.text, /watch --due/);
  assert.ok(unit.text.includes(BIN.nodePath), 'the interpreter is named absolutely');
  assert.ok(unit.text.includes(BIN.cliPath), 'the entry point is named absolutely');
  assert.doesNotMatch(unit.text, /&&(?!amp;)/, 'the shell chain is escaped for XML');
});

test('launchctl is asked to load and forget the job by label', () => {
  const plan = darwin(1440);
  assert.deepStrictEqual(plan.load, [
    ['launchctl', 'bootstrap', 'gui/501', plan.units[0].path],
  ]);
  assert.deepStrictEqual(plan.unload, [['launchctl', 'bootout', `gui/501/${SCHEDULE_LABEL}`]]);
});

test('the systemd timer catches up after sleep and spreads its firings', () => {
  const plan = linux(360);
  const timer = plan.units.find((unit) => unit.path.endsWith('.timer'));
  assert.ok(timer);
  assert.match(timer.text, /^OnCalendar=\*-\*-\* 00\/6:00:00$/m);
  assert.match(timer.text, /^Persistent=true$/m);
  assert.match(timer.text, /^RandomizedDelaySec=300$/m);
  assert.match(timer.text, /^WantedBy=timers\.target$/m);
});

test('the systemd service is a oneshot that runs both due lines', () => {
  const service = linux(1440).units.find((unit) => unit.path.endsWith('.service'));
  assert.ok(service);
  assert.match(service.text, /^Type=oneshot$/m);
  const execs = [...service.text.matchAll(/^ExecStart=(.*)$/gm)].map((m) => m[1]);
  assert.strictEqual(execs.length, 2);
  assert.match(execs[0], /standing --due$/);
  assert.match(execs[1], /watch --due$/);
});

test('no generated unit carries an environment entry', () => {
  for (const plan of [darwin(360), linux(360), darwin(1440), linux(1440)]) {
    for (const unit of plan.units) {
      assert.doesNotMatch(unit.text, /^Environment=/m, unit.path);
      assert.doesNotMatch(unit.text, /EnvironmentVariables/, unit.path);
    }
  }
});

test('systemctl enables the timer and reloads around it', () => {
  const plan = linux(1440);
  assert.deepStrictEqual(plan.load, [
    ['systemctl', '--user', 'daemon-reload'],
    ['systemctl', '--user', 'enable', '--now', 'construct-schedule.timer'],
  ]);
  assert.deepStrictEqual(plan.unload, [
    ['systemctl', '--user', 'disable', '--now', 'construct-schedule.timer'],
    ['systemctl', '--user', 'daemon-reload'],
  ]);
});

test('an uninstall removes exactly the files an install wrote', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    const plan = schedulePlan({
      platform,
      dir: '/d',
      everyMinutes: 360,
      anchor: null,
      uid: 501,
      ...BIN,
    });
    assert.deepStrictEqual(
      [...scheduleUnitPaths(platform, '/d')].sort(),
      plan.units.map((unit) => unit.path).sort(),
      platform,
    );
  }
});

test('a cadence reads back out of the entry it was written into', () => {
  for (const minutes of [60, 240, 360, 720, 1440]) {
    assert.strictEqual(
      cadenceMinutesFromUnitText('darwin', darwin(minutes).units[0].text),
      minutes,
      `darwin ${String(minutes)}`,
    );
    const timer = linux(minutes).units[0];
    assert.strictEqual(cadenceMinutesFromUnitText('linux', timer.text), minutes, `linux ${String(minutes)}`);
  }
});

test('text this module did not write reads back as unknown, never as a guess', () => {
  assert.strictEqual(cadenceMinutesFromUnitText('darwin', '<plist><dict/></plist>'), null);
  assert.strictEqual(cadenceMinutesFromUnitText('linux', '[Timer]\nOnBootSec=5min\n'), null);
});

function alwaysOnDarwin() {
  return alwaysOnPlan({
    platform: 'darwin',
    dir: '/home/somebody/Library/LaunchAgents',
    uid: 501,
    ...BIN,
  });
}

function alwaysOnLinux() {
  return alwaysOnPlan({
    platform: 'linux',
    dir: '/home/somebody/.config/systemd/user',
    uid: 1000,
    ...BIN,
  });
}

test('the always-on launchd job runs the daemon in foreground and restarts only on crash', () => {
  const plan = alwaysOnDarwin();
  const [unit] = plan.units;
  assert.match(unit.path, /com\.construct\.daemon\.plist$/);
  assert.match(unit.text, /<string>daemon<\/string>/);
  assert.match(unit.text, /<string>run<\/string>/);
  assert.match(unit.text, /<string>--foreground<\/string>/);
  assert.ok(unit.text.includes(BIN.nodePath));
  assert.ok(unit.text.includes(BIN.cliPath));
  // KeepAlive is a dict (restart on crash, stay stopped on clean exit), never
  // the bare `true` launchd also accepts, which restarts even a clean exit.
  assert.match(unit.text, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>\s*<\/dict>/);
  assert.doesNotMatch(unit.text, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(unit.text, /<key>ThrottleInterval<\/key>\s*<integer>30<\/integer>/);
  assert.match(unit.text, /<key>ProcessType<\/key>\s*<string>Background<\/string>/);
  assert.match(unit.text, /<key>LowPriorityBackgroundIO<\/key>\s*<true\/>/);
  assert.match(unit.text, /<key>Nice<\/key>\s*<integer>10<\/integer>/);
  // The one place RunAtLoad is licensed: an always-on service the user
  // explicitly installed should be there after login.
  assert.match(unit.text, /<key>RunAtLoad<\/key>\s*<true\/>/);
});

test('the always-on systemd unit is a restarted long-running process, not a oneshot', () => {
  const [unit] = alwaysOnLinux().units;
  assert.match(unit.path, /construct-daemon\.service$/);
  assert.match(unit.text, /^Type=exec$/m);
  assert.match(unit.text, /^ExecStart=.*"daemon" "run" "--foreground"$/m);
  assert.match(unit.text, /^Restart=on-failure$/m);
  assert.match(unit.text, /^RestartSec=5$/m);
  assert.match(unit.text, /^MemoryHigh=192M$/m);
  assert.match(unit.text, /^MemoryMax=256M$/m);
  assert.match(unit.text, /^TasksMax=32$/m);
  assert.match(unit.text, /^NoNewPrivileges=yes$/m);
  assert.match(unit.text, /^RestrictAddressFamilies=AF_UNIX$/m);
  assert.match(unit.text, /^WantedBy=default\.target$/m);
  assert.doesNotMatch(unit.text, /^\[Timer\]/m, 'always-on has no timer: the unit itself stays up');
});

test('no always-on unit carries an environment entry either', () => {
  for (const plan of [alwaysOnDarwin(), alwaysOnLinux()]) {
    for (const unit of plan.units) {
      assert.doesNotMatch(unit.text, /^Environment=/m, unit.path);
      assert.doesNotMatch(unit.text, /EnvironmentVariables/, unit.path);
    }
  }
});

test('launchctl and systemctl load and forget the always-on job by its own distinct label', () => {
  const darwinPlan = alwaysOnDarwin();
  assert.deepStrictEqual(darwinPlan.load, [
    ['launchctl', 'bootstrap', 'gui/501', darwinPlan.units[0].path],
  ]);
  assert.deepStrictEqual(darwinPlan.unload, [['launchctl', 'bootout', `gui/501/${ALWAYS_ON_LABEL}`]]);

  const linuxPlan = alwaysOnLinux();
  assert.deepStrictEqual(linuxPlan.load, [
    ['systemctl', '--user', 'daemon-reload'],
    ['systemctl', '--user', 'enable', '--now', `${ALWAYS_ON_UNIT}.service`],
  ]);
  assert.deepStrictEqual(linuxPlan.unload, [
    ['systemctl', '--user', 'disable', '--now', `${ALWAYS_ON_UNIT}.service`],
    ['systemctl', '--user', 'daemon-reload'],
  ]);
});

test('the calendar and always-on tiers never name the same file', () => {
  const dir = '/home/somebody/state';
  for (const platform of ['darwin', 'linux'] as const) {
    const calendar = new Set(scheduleUnitPaths(platform, dir));
    const always = new Set(alwaysOnUnitPaths(platform, dir));
    for (const path of always) assert.ok(!calendar.has(path), `${platform}: ${path}`);
  }
});

test('a path with a space survives both spellings intact', () => {
  const spaced = { nodePath: '/opt/my node/bin/node', cliPath: '/opt/my apps/construct.mjs' };
  const mac = schedulePlan({
    platform: 'darwin',
    dir: '/d',
    everyMinutes: 1440,
    anchor: null,
    uid: 501,
    ...spaced,
  });
  assert.match(mac.units[0].text, /'\/opt\/my node\/bin\/node' '\/opt\/my apps\/construct\.mjs'/);
  const unit = schedulePlan({
    platform: 'linux',
    dir: '/d',
    everyMinutes: 1440,
    anchor: null,
    uid: 1000,
    ...spaced,
  }).units.find((u) => u.path.endsWith('.service'));
  assert.ok(unit);
  assert.match(unit.text, /"\/opt\/my node\/bin\/node" "\/opt\/my apps\/construct\.mjs"/);
});
