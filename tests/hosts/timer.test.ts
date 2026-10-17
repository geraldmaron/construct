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
import { installTimer, listTimers, platformScheduler, timerPathFor, uninstallTimer, type SchedulerControl } from '../../src/hosts/timer.ts';
import { resolveAccountScheduleDir, resolveScheduleDir } from '../../src/kernel/paths.ts';
import { launchdUnit } from '../../src/kernel/workflow/timer-unit.ts';
import { sterile } from '../harness/sterile.ts';

const quiet: SchedulerControl = { admit: () => undefined, load: () => undefined, unload: () => undefined, loaded: () => null };

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
