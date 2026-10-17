/**
 * tests/hosts/timer.test.ts — the platform timer adapter. Units are written
 * only into the directory given, the real scheduler control admits only the
 * account's own scheduler directory, and nothing but the two explicit
 * commands can reach install or removal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installTimer, listTimers, platformScheduler, timerPathFor, uninstallTimer, type Ran, type SchedulerControl } from '../../src/hosts/timer.ts';
import { resolveAccountScheduleDir, resolveScheduleDir } from '../../src/kernel/paths.ts';
import { launchdUnit } from '../../src/kernel/workflow/timer-unit.ts';
import { sterile } from '../harness/sterile.ts';

const quiet: SchedulerControl = { admit: () => undefined, load: () => undefined, unload: () => undefined, loaded: () => null, firing: () => null };

test('the timer directory comes from the env it is given, and the account directory from the account itself', () => {
  assert.equal(resolveScheduleDir('darwin', { HOME: '/sandbox' }), '/sandbox/Library/LaunchAgents');
  assert.equal(resolveScheduleDir('linux', { HOME: '/sandbox' }), '/sandbox/.config/systemd/user');
  assert.equal(resolveScheduleDir('linux', { HOME: '/sandbox', XDG_CONFIG_HOME: '/xdg' }), '/xdg/systemd/user');
  assert.equal(resolveScheduleDir('win32', { HOME: '/sandbox' }), null);
  assert.notEqual(resolveAccountScheduleDir('darwin'), '/sandbox/Library/LaunchAgents');
});

test('the real scheduler admits only the account’s own directory, so a redirected HOME cannot load a unit', () => {
  const control = platformScheduler('/Users/me/Library/LaunchAgents', 501);
  assert.throws(() => control.admit({ platform: 'launchd', dir: '/tmp/construct-test-x/Library/LaunchAgents' }), /this account's scheduler reads \/Users\/me\/Library\/LaunchAgents/);
  assert.doesNotThrow(() => control.admit({ platform: 'launchd', dir: '/Users/me/Library/LaunchAgents' }));
  assert.throws(() => platformScheduler(null, 501).admit({ platform: 'launchd', dir: '/x' }), /no per-user scheduler/);
});

test('installing writes the unit under the given directory, lists it, and removal leaves nothing', () => {
  const fx = sterile();
  try {
    const target = { platform: 'launchd' as const, dir: join(fx.root, 'LaunchAgents') };
    const facts = { projectId: 'proj-abc12345', node: '/n/node', launcher: '/c/construct.mjs', path: '/n:/usr/bin', logDir: join(fx.paths.stateDir, 'timers'), systemTimezone: 'UTC' };
    const files = launchdUnit({ triggerId: 'weekly', expression: '0 9 * * 1', timezone: 'UTC', executor: 'codex', projectRoot: fx.root, facts });
    const first = installTimer(target, 'construct.proj-abc12345.weekly', files, quiet, facts.logDir);
    assert.deepEqual(first.files.map((f) => relative(fx.root, f)), ['LaunchAgents/construct.proj-abc12345.weekly.plist']);
    assert.throws(() => installTimer(target, 'construct.proj-abc12345.other', files, quiet, facts.logDir), /must be construct\.proj-abc12345\.other\.plist/);
    writeFileSync(join(target.dir, 'com.example.agent.plist'), '<plist/>', 'utf8');
    assert.deepEqual(listTimers(target).map((t) => [t.label, t.projectRoot, t.executor]), [['construct.proj-abc12345.weekly', fx.root, 'codex']]);
    assert.deepEqual(uninstallTimer(target, 'construct.proj-abc12345.weekly', quiet).removed, first.files);
    assert.deepEqual(readdirSync(target.dir), ['com.example.agent.plist'], 'another program’s agent is untouched');
    assert.deepEqual(uninstallTimer(target, 'construct.proj-abc12345.weekly', quiet).removed, []);
  } finally {
    fx.cleanup();
  }
});

test('a unit’s PATH names Node and the executor, never the rest of the shell’s PATH', () => {
  assert.equal(timerPathFor('/opt/node/bin/node', '/opt/codex/bin/codex'), '/opt/node/bin:/opt/codex/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  assert.equal(timerPathFor('/usr/bin/node', null), '/usr/bin:/usr/local/bin:/bin:/usr/sbin:/sbin');
});

test('only the explicit timer commands reach install and removal, and every caller names its env', () => {
  const src = fileURLToPath(new URL('../../src', import.meta.url));
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
  const reaching: string[] = [];
  for (const file of walk(src)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(src, file);
    if (/\b(installTimer|uninstallTimer)\(/.test(text) && rel !== join('hosts', 'timer.ts')) reaching.push(rel);
    for (const m of text.matchAll(/resolveScheduleDir\(([^)]*)\)/g)) {
      if (rel === 'kernel/paths.ts') continue;
      assert.ok(m[1]!.split(',').length >= 2, `${rel} calls resolveScheduleDir without naming an env: ${m[0]}`);
    }
  }
  assert.deepEqual(reaching, [join('cli', 'workflow.ts')]);
});

test('removal unloads first, keeps the files when the scheduler refuses, and unloads a job whose files are gone', () => {
  const fx = sterile();
  try {
    const target = { platform: 'launchd' as const, dir: join(fx.root, 'LaunchAgents') };
    const facts = { projectId: 'proj-abc12345', node: '/n/node', launcher: '/c/construct.mjs', path: '/n:/usr/bin', logDir: join(fx.paths.stateDir, 'timers'), systemTimezone: 'UTC' };
    const files = launchdUnit({ triggerId: 'weekly', expression: '0 9 * * 1', timezone: 'UTC', executor: 'codex', projectRoot: fx.root, facts });
    const label = 'construct.proj-abc12345.weekly';
    installTimer(target, label, files, quiet, facts.logDir);
    const stuck: SchedulerControl = { ...quiet, unload: () => { throw new Error('the scheduler still has it loaded'); } };
    assert.throws(() => uninstallTimer(target, label, stuck), /still has it loaded/);
    assert.deepEqual(readdirSync(target.dir), [`${label}.plist`], 'a refused unload keeps the files');
    const calls: string[] = [];
    const recording: SchedulerControl = { ...quiet, unload: (_t, l) => { calls.push(l); } };
    uninstallTimer(target, label, recording);
    assert.deepEqual(uninstallTimer(target, label, recording).removed, [], 'nothing left on disk');
    assert.deepEqual(calls, [label, label], 'a job whose files are gone is still unloaded');
    assert.equal(readFileSync(join(facts.logDir, `${label}.log`), 'utf8'), '', 'each install starts the log empty');
  } finally {
    fx.cleanup();
  }
});

test('the real scheduler control never reads a failed query as absence', () => {
  const fx = sterile();
  try {
    const dir = join(fx.root, 'LaunchAgents');
    const target = { platform: 'launchd' as const, dir };
    const facts = { projectId: 'proj-abc12345', node: '/n/node', launcher: '/c/construct.mjs', path: '/n:/usr/bin', logDir: join(fx.paths.stateDir, 'timers'), systemTimezone: 'UTC' };
    const label = 'construct.proj-abc12345.weekly';
    installTimer(target, label, launchdUnit({ triggerId: 'weekly', expression: '0 9 * * 1', timezone: 'UTC', executor: 'codex', projectRoot: fx.root, facts }), quiet, facts.logDir);
    const answers = (print: Ran) => {
      const calls: string[] = [];
      const control = platformScheduler(dir, 501, (binary, args) => {
        calls.push(`${binary} ${args[0]!}`);
        return args[0] === 'print' ? print : { ok: true, status: 0, stdout: '', output: '' };
      }, 500);
      return { control, calls };
    };
    const timedOut = answers({ ok: false, status: null, stdout: '', output: 'spawnSync launchctl ETIMEDOUT' });
    assert.throws(() => uninstallTimer(target, label, timedOut.control), /launchctl print did not finish.*nothing was changed/);
    assert.deepEqual(readdirSync(dir), [`${label}.plist`], 'an unanswered query keeps the files');
    assert.ok(!timedOut.calls.includes('launchctl bootout'));
    const stuck = answers({ ok: true, status: 0, stdout: 'state = running', output: '' });
    assert.throws(() => uninstallTimer(target, label, stuck.control), /still has .* loaded 0.5s after unloading it/);
    assert.deepEqual(readdirSync(dir), [`${label}.plist`]);
    let prints = 0;
    const draining = platformScheduler(dir, 501, (_b, args) => (args[0] === 'print' && ++prints <= 3 ? { ok: true, status: 0, stdout: 'state = running', output: '' } : args[0] === 'print' ? { ok: false, status: 113, stdout: '', output: 'Could not find service' } : { ok: true, status: 0, stdout: '', output: '' }));
    draining.unload(target, label);
    assert.ok(prints >= 4, 'a job launchd is still stopping is waited for, not reported stuck');
    const absent = answers({ ok: false, status: 113, stdout: '', output: 'Could not find service' });
    assert.equal(absent.control.loaded(target, label), false);
    assert.deepEqual(uninstallTimer(target, label, absent.control).removed, [join(dir, `${label}.plist`)]);
    const partial = platformScheduler(dir, 501, () => ({ ok: false, status: null, stdout: 'inactive', output: 'ETIMEDOUT' }));
    assert.throws(() => partial.loaded({ platform: 'systemd', dir }, label), /did not finish/, 'partial output from an unfinished query is not an answer');
    const bus = platformScheduler(dir, 501, (_b, args) => args[1] === 'is-active' ? { ok: false, status: 3, stdout: 'inactive', output: 'inactive' } : { ok: false, status: 1, stdout: '', output: 'Failed to connect to bus: No such file or directory' });
    assert.throws(() => bus.loaded({ platform: 'systemd', dir }, label), /could not say whether the unit is loaded/, 'a bus failure is not absence');
    const gone = platformScheduler(dir, 501, (_b, args) => args[1] === 'is-active' ? { ok: false, status: 3, stdout: 'inactive', output: 'inactive' } : { ok: false, status: 1, stdout: '', output: `Failed to get unit file state for ${label}.timer: No such file or directory` });
    assert.equal(gone.loaded({ platform: 'systemd', dir }, label), false);
    const slow = platformScheduler(dir, 501, (_b, args) => {
      if (args[0] === 'print') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
      return args[0] === 'print' ? { ok: true, status: 0, stdout: 'state = running', output: '' } : { ok: true, status: 0, stdout: '', output: '' };
    }, 200);
    const started = Date.now();
    assert.throws(() => slow.unload(target, label), /still has/);
    assert.ok(Date.now() - started < 450, `the unload deadline counts query time too (${String(Date.now() - started)}ms)`);
    const systemd = platformScheduler(dir, 501, (_b, args) => args[1] === 'is-active' ? { ok: false, status: 3, stdout: 'inactive', output: 'inactive' } : { ok: true, status: 0, stdout: 'enabled', output: 'enabled' });
    assert.equal(systemd.loaded({ platform: 'systemd', dir }, label), true, 'enabled but inactive is still there to remove');
    assert.equal(systemd.firing({ platform: 'systemd', dir }, label), false, 'enabled but inactive never fires');
  } finally {
    fx.cleanup();
  }
});
