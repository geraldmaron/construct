/**
 * tests/cli/schedule.test.ts — the verb's planning and its refusals.
 *
 * Only the read-only surfaces run here: `--dry-run`, `status`, and the
 * resolution that decides whether an entry may be written at all. Nothing in
 * this file writes a unit file or asks a platform to load one — an install
 * that a test could reach is exactly the door the predecessor's leak came
 * through, so the tests cover what the command would do and never let it do
 * it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schedule, resolveScheduleContext, scheduleStatusLine } from '../../src/cli/schedule.ts';
import type { ScheduleContext, ScheduleRefusal } from '../../src/cli/schedule.ts';
import { alwaysOnPlan, schedulePlan } from '../../src/kernel/schedule/units.ts';
import { sterile, sterileHome } from '../harness/sterile.ts';

sterileHome();

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function capture(argv: string[], context?: ScheduleContext | ScheduleRefusal): Capture {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  (process.stderr as { write: unknown }).write = (chunk: string) => {
    err.push(String(chunk));
    return true;
  };
  try {
    const code = schedule(argv, context);
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
  }
}

function context(platform: 'darwin' | 'linux', dir: string): ScheduleContext {
  return {
    platform,
    dir,
    nodePath: '/opt/node/bin/node',
    cliPath: '/opt/construct/bin/construct.mjs',
    uid: 501,
  };
}

test('a dry-run install prints the entry and its target path, and writes nothing', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const dir = join(fixture.root, 'LaunchAgents');
  const result = capture(
    ['install', '--every=6h', '--dry-run'],
    context('darwin', dir),
  );
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /every 6h \(at 00:00, 06:00, 12:00, 18:00\)/);
  assert.match(result.out, /com\.construct\.schedule\.plist/);
  assert.match(result.out, /StartCalendarInterval/);
  assert.match(result.out, /launchctl bootstrap gui\/501/);
  assert.match(result.out, /Nothing was written/);
  assert.strictEqual(
    scheduleStatusLine({ platform: 'darwin', dir }),
    'no schedule installed — install one with: construct schedule install --every=6h',
    'the dry run left the machine as it found it',
  );
});

test('a dry-run install on linux prints both units and the systemctl lines', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const result = capture(
    ['install', '--every=1d', '--at=07:15', '--dry-run'],
    context('linux', join(fixture.root, 'systemd')),
  );
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /every 1d \(at 07:15\)/);
  assert.match(result.out, /construct-schedule\.timer/);
  assert.match(result.out, /construct-schedule\.service/);
  assert.match(result.out, /OnCalendar=\*-\*-\* 07:15:00/);
  assert.match(result.out, /systemctl --user enable --now construct-schedule\.timer/);
});

test('a cadence the platform cannot state exactly is refused before anything is written', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  for (const every of ['30m', '5h', '3d']) {
    const result = capture(
      ['install', `--every=${every}`, '--dry-run'],
      context('linux', join(fixture.root, 'systemd')),
    );
    assert.strictEqual(result.code, 2, every);
    assert.match(result.err, /^schedule: /);
  }
});

test('a malformed --at is refused with the shape it wanted', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const result = capture(
    ['install', '--every=1d', '--at=25:00', '--dry-run'],
    context('darwin', join(fixture.root, 'LaunchAgents')),
  );
  assert.strictEqual(result.code, 2);
  assert.match(result.err, /HH:MM/);
});

test('status reports an absent schedule plainly and exits 0', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const result = capture(['status'], context('darwin', join(fixture.root, 'LaunchAgents')));
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /no schedule installed/);
});

test('status reads the cadence back out of an installed entry', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const dir = join(fixture.root, 'LaunchAgents');
  mkdirSync(dir, { recursive: true });
  const plan = schedulePlan({
    platform: 'darwin',
    dir,
    everyMinutes: 240,
    anchor: null,
    nodePath: '/opt/node/bin/node',
    cliPath: '/opt/construct/bin/construct.mjs',
    uid: 501,
  });
  writeFileSync(plan.units[0].path, plan.units[0].text);

  const result = capture(['status'], context('darwin', dir));
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /every 4h/);
  assert.match(result.out, /com\.construct\.schedule\.plist/);
});

test('a hand-edited entry reports as unreadable rather than as a cadence nobody wrote', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const dir = join(fixture.root, 'LaunchAgents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'com.construct.schedule.plist'), '<plist><dict/></plist>\n');
  assert.match(scheduleStatusLine({ platform: 'darwin', dir }), /cadence unreadable/);
});

test('uninstall with nothing installed says so and removes nothing', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const result = capture(['uninstall'], context('linux', join(fixture.root, 'systemd')));
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /nothing to remove/);
});

test('a dry-run uninstall names exactly the files that are there', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const dir = join(fixture.root, 'systemd');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'construct-schedule.timer'), '[Timer]\nOnCalendar=*-*-* 09:00:00\n');
  const result = capture(['uninstall', '--dry-run'], context('linux', dir));
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /construct-schedule\.timer/);
  assert.doesNotMatch(result.out, /construct-schedule\.service/, 'a file that is not there is not removed');
  assert.match(result.out, /Nothing was removed/);
});

test('a dry-run always-on install prints the daemon unit and writes nothing', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const dir = join(fixture.root, 'LaunchAgents');
  const result = capture(['install', '--always-on', '--dry-run'], context('darwin', dir));
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /always-on daemon/);
  assert.match(result.out, /com\.construct\.daemon\.plist/);
  assert.match(result.out, /launchctl bootstrap gui\/501/);
  assert.match(result.out, /Nothing was written/);
  assert.strictEqual(
    scheduleStatusLine({ platform: 'darwin', dir }),
    'no schedule installed — install one with: construct schedule install --every=6h',
    'the dry run left the machine as it found it',
  );
});

test('a dry-run always-on install on linux prints the hardened service and the systemctl lines', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const result = capture(
    ['install', '--always-on', '--dry-run'],
    context('linux', join(fixture.root, 'systemd')),
  );
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /construct-daemon\.service/);
  assert.match(result.out, /Type=exec/);
  assert.match(result.out, /Restart=on-failure/);
  assert.match(result.out, /MemoryMax=256M/);
  assert.match(result.out, /systemctl --user enable --now construct-daemon\.service/);
});

test('installing --always-on refuses when the calendar schedule is already installed', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const dir = join(fixture.root, 'LaunchAgents');
  mkdirSync(dir, { recursive: true });
  const calendarPlan = schedulePlan({
    platform: 'darwin',
    dir,
    everyMinutes: 360,
    anchor: null,
    nodePath: '/opt/node/bin/node',
    cliPath: '/opt/construct/bin/construct.mjs',
    uid: 501,
  });
  writeFileSync(calendarPlan.units[0].path, calendarPlan.units[0].text);

  const result = capture(['install', '--always-on', '--dry-run'], context('darwin', dir));
  assert.strictEqual(result.code, 1);
  assert.match(result.err, /calendar schedule is installed/);
  assert.match(result.err, /construct schedule uninstall/);
});

test('installing the calendar tier refuses when the always-on daemon is already installed', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const dir = join(fixture.root, 'systemd');
  mkdirSync(dir, { recursive: true });
  const daemonPlan = alwaysOnPlan({
    platform: 'linux',
    dir,
    nodePath: '/opt/node/bin/node',
    cliPath: '/opt/construct/bin/construct.mjs',
    uid: 1000,
  });
  writeFileSync(daemonPlan.units[0].path, daemonPlan.units[0].text);

  const result = capture(['install', '--every=6h', '--dry-run'], context('linux', dir));
  assert.strictEqual(result.code, 1);
  assert.match(result.err, /always-on daemon is installed/);
  assert.match(result.err, /construct schedule uninstall/);
});

test('status reports the always-on daemon distinctly from a calendar cadence', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const dir = join(fixture.root, 'LaunchAgents');
  mkdirSync(dir, { recursive: true });
  const daemonPlan = alwaysOnPlan({
    platform: 'darwin',
    dir,
    nodePath: '/opt/node/bin/node',
    cliPath: '/opt/construct/bin/construct.mjs',
    uid: 501,
  });
  writeFileSync(daemonPlan.units[0].path, daemonPlan.units[0].text);

  const result = capture(['status'], context('darwin', dir));
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /always-on daemon/);
  assert.match(result.out, /com\.construct\.daemon\.plist/);
});

test('uninstall removes an installed always-on daemon and reports its own unload commands', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const dir = join(fixture.root, 'systemd');
  mkdirSync(dir, { recursive: true });
  const daemonPlan = alwaysOnPlan({
    platform: 'linux',
    dir,
    nodePath: '/opt/node/bin/node',
    cliPath: '/opt/construct/bin/construct.mjs',
    uid: 1000,
  });
  writeFileSync(daemonPlan.units[0].path, daemonPlan.units[0].text);

  const dryRun = capture(['uninstall', '--dry-run'], context('linux', dir));
  assert.strictEqual(dryRun.code, 0);
  assert.match(dryRun.out, /construct-daemon\.service/);
  assert.match(dryRun.out, /systemctl --user disable --now construct-daemon\.service/);
  assert.match(
    scheduleStatusLine({ platform: 'linux', dir }),
    /always-on daemon/,
    'the dry run left the daemon entry in place',
  );
});

test('an unknown subcommand prints usage rather than acting', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const result = capture(['enable'], context('darwin', join(fixture.root, 'LaunchAgents')));
  assert.strictEqual(result.code, 2);
  assert.match(result.err, /usage: construct schedule/);
});

test('a platform with no user scheduler refuses to install and still answers status', () => {
  const refusal = resolveScheduleContext('win32', {}, '/opt/construct/bin/construct.mjs');
  assert.ok('problem' in refusal);
  const install = capture(['install', '--every=1d'], refusal);
  assert.strictEqual(install.code, 1);
  assert.match(install.err, /no user-level scheduler/);
  const status = capture(['status'], refusal);
  assert.strictEqual(status.code, 0);
  assert.match(status.out, /no user-level scheduler/);
});

test('an entry point inside a temporary directory is refused, because it will be gone', (t) => {
  const fixture = sterile();
  t.after(() => {
    fixture.cleanup();
  });
  const entry = join(fixture.root, 'construct.mjs');
  writeFileSync(entry, '');
  const resolved = resolveScheduleContext('linux', { HOME: fixture.root }, entry);
  assert.ok('problem' in resolved, 'a tmpdir entry point is not schedulable');
  assert.match((resolved as { problem: string }).problem, /temporary directory/);
});

test('an entry point that does not exist is refused rather than written', () => {
  const resolved = resolveScheduleContext('linux', { HOME: '/home/nobody' }, '/no/such/construct.mjs');
  assert.ok('problem' in resolved);
  assert.match((resolved as { problem: string }).problem, /does not exist/);
});

test('the always-on flag passes the CLI unknown-flag gate, not only the injected surface', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'construct-sched-flag-'));
  const run = promisify(execFile);
  const { stdout } = await run(
    process.execPath,
    ['bin/construct.mjs', 'schedule', 'install', '--always-on', '--dry-run'],
    { env: { PATH: process.env.PATH ?? '', HOME: home }, cwd: process.cwd() },
  );
  assert.match(stdout, /always-on daemon/);
});
