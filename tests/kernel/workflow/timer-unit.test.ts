/**
 * tests/kernel/workflow/timer-unit.test.ts — the platform timer text: a
 * launchd calendar or systemd OnCalendar that means exactly what the cron
 * expression means, or a refusal; one name per project and trigger; and no
 * environment beyond PATH and the executor's home.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchdCalendar, launchdUnit, readTimerUnit, systemdCalendar, systemdPath, systemdQuoted, systemdUnit, timerLabel, type TimerUnitInput } from '../../../src/kernel/workflow/timer-unit.ts';

const facts = { projectId: 'proj-abc12345', node: '/opt/node/bin/node', launcher: '/opt/construct/bin/construct.mjs', path: '/opt/node/bin:/usr/bin:/bin', logDir: '/tmp/state/timers', systemTimezone: 'Europe/Berlin' };
const input = (over: Partial<TimerUnitInput> = {}): TimerUnitInput => ({ triggerId: 'weekly', expression: '0 9 * * 1', timezone: 'Europe/Berlin', executor: 'codex', projectRoot: '/work/demo & co', facts, ...over });

test('a launchd calendar spells out exactly what cron means, and leaves open what cron leaves open', () => {
  assert.deepEqual(launchdCalendar('0 9 * * 1', 'UTC', 'UTC'), [{ Minute: 0, Hour: 9, Weekday: 1 }]);
  assert.deepEqual(launchdCalendar('*/20 * * * *', 'UTC', 'UTC'), [{ Minute: 0 }, { Minute: 20 }, { Minute: 40 }]);
  assert.deepEqual(launchdCalendar('30 8 1,15 * *', 'UTC', 'UTC'), [{ Minute: 30, Hour: 8, Day: 1 }, { Minute: 30, Hour: 8, Day: 15 }]);
  // cron fires when either a restricted day or a restricted weekday matches: two sets, one per field.
  assert.deepEqual(launchdCalendar('0 9 1 * 1', 'UTC', 'UTC'), [{ Minute: 0, Hour: 9, Day: 1 }, { Minute: 0, Hour: 9, Weekday: 1 }]);
  // A restricted field that covers its whole range is no restriction, and under cron's either-or it opens every day.
  assert.deepEqual(launchdCalendar('0 9 1-31 * 1', 'UTC', 'UTC'), [{ Minute: 0, Hour: 9 }]);
  assert.deepEqual(launchdCalendar('0 9 * * 0-6', 'UTC', 'UTC'), [{ Minute: 0, Hour: 9 }]);
  assert.deepEqual(launchdCalendar('0 9 * * 7', 'UTC', 'UTC'), [{ Minute: 0, Hour: 9, Weekday: 0 }]);
});

test('a schedule launchd cannot express exactly is refused, not approximated', () => {
  assert.throws(() => launchdCalendar('0 9 * * 1', 'America/New_York', 'Europe/Berlin'), /launchd cannot express it exactly.*--timezone=Europe\/Berlin/);
  assert.throws(() => launchdCalendar('*/2 */2 */2 * *', 'UTC', 'UTC'), /needs 5760 launchd calendar entries.*cannot express it as a calendar/);
  assert.throws(() => launchdCalendar('0 9 * *', 'UTC', 'UTC'), /five fields/);
});

test('a launchd agent fires on StartCalendarInterval only and carries no secret', () => {
  const [file] = launchdUnit(input({ facts: { ...facts, env: { CODEX_HOME: '/home/me/.codex' } } }));
  assert.equal(file!.name, 'construct.proj-abc12345.weekly.plist');
  const text = file!.content;
  assert.match(text, /<key>StartCalendarInterval<\/key>/);
  assert.doesNotMatch(text, /StartInterval<|RunAtLoad|KeepAlive/);
  assert.match(text, /<string>workflow<\/string>\s*<string>fire<\/string>\s*<string>weekly<\/string>\s*<string>--execute=codex<\/string>/);
  assert.doesNotMatch(text, /--key/, 'the firing names its own slot');
  assert.match(text, /<key>WorkingDirectory<\/key><string>\/work\/demo &amp; co<\/string>/);
  const env = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(text)![1]!;
  assert.deepEqual([...env.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]), ['PATH', 'CODEX_HOME']);
  assert.throws(() => launchdUnit(input({ facts: { ...facts, env: { OPENAI_API_KEY: 'sk-planted' } } })), /OPENAI_API_KEY stays out of the unit/);
});

test('a systemd timer uses OnCalendar with Persistent=true in the trigger’s own timezone', () => {
  const [service, timer] = systemdUnit(input({ expression: '15 6 1 * 1-5', timezone: 'America/New_York' }));
  assert.equal(service!.name, 'construct.proj-abc12345.weekly.service');
  assert.equal(timer!.name, 'construct.proj-abc12345.weekly.timer');
  assert.match(timer!.content, /^OnCalendar=\*-\*-01 06:15:00 America\/New_York$/m);
  assert.match(timer!.content, /^OnCalendar=Mon,Tue,Wed,Thu,Fri \*-\*-\* 06:15:00 America\/New_York$/m);
  assert.match(timer!.content, /^Persistent=true$/m);
  assert.match(service!.content, /^Type=oneshot$/m);
  assert.match(service!.content, /^WorkingDirectory=\/work\/demo & co$/m);
  assert.match(service!.content, /^ExecStart="\/opt\/node\/bin\/node" "\/opt\/construct\/bin\/construct.mjs" "workflow" "fire" "weekly" "--execute=codex"$/m);
  assert.deepEqual(systemdCalendar('*/30 9-17 * * *', 'UTC'), ['*-*-* 09,10,11,12,13,14,15,16,17:00,30:00 UTC']);
});

test('one name per project and trigger, read back from the unit itself', () => {
  assert.equal(timerLabel('proj-abc12345', 'weekly'), 'construct.proj-abc12345.weekly');
  assert.throws(() => timerLabel('proj-abc12345', 'has space'), /cannot name a platform timer/);
  const [plist] = launchdUnit(input());
  assert.deepEqual(readTimerUnit('launchd', plist!.name, plist!.content), { label: 'construct.proj-abc12345.weekly', projectId: 'proj-abc12345', triggerId: 'weekly', projectRoot: '/work/demo & co', executor: 'codex', program: ['/opt/node/bin/node', '/opt/construct/bin/construct.mjs'] });
  const [service] = systemdUnit(input());
  assert.deepEqual(readTimerUnit('systemd', service!.name, service!.content)?.projectRoot, '/work/demo & co');
  assert.deepEqual(readTimerUnit('systemd', service!.name, service!.content)?.program, ['/opt/node/bin/node', '/opt/construct/bin/construct.mjs']);
  assert.equal(readTimerUnit('launchd', 'com.apple.something.plist', ''), null);
});

test('systemd directives escape what each context expands, refuse what no escape holds, and read back to the same values', () => {
  assert.equal(systemdPath('/srv/100% done'), '/srv/100%% done');
  assert.equal(systemdQuoted('/srv/100% done', true), '"/srv/100%% done"');
  assert.equal(systemdQuoted('/srv/a"b\\c', true), '"/srv/a\\"b\\\\c"');
  assert.equal(systemdQuoted('PATH=/a/$b%', false), '"PATH=/a/$b%%"', 'Environment does not substitute $');
  assert.throws(() => systemdQuoted('/opt/no$de/node', true), /holds a \$/);
  assert.throws(() => systemdPath('relative/dir'), /absolute directory/);
  assert.throws(() => systemdPath('/srv/end\\'), /ends in a backslash or whitespace/);
  assert.throws(() => systemdPath('/srv/end '), /ends in a backslash or whitespace/);
  assert.throws(() => systemdQuoted('a\nExecStartPost=/bin/sh', true), /control character/);
  const root = '/srv/100% $done "q"';
  const [service] = systemdUnit(input({ projectRoot: root, facts: { ...facts, launcher: '/opt/con%truct/100%.mjs' } }));
  const read = readTimerUnit('systemd', service!.name, service!.content)!;
  assert.equal(read.projectRoot, root);
  assert.deepEqual(read.program, ['/opt/node/bin/node', '/opt/con%truct/100%.mjs']);
  assert.throws(() => systemdUnit(input({ facts: { ...facts, node: '/opt/no$de/node' } })), /holds a \$/);
});
