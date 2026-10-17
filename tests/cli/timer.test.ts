/**
 * tests/cli/timer.test.ts — the explicit timer commands from the command
 * line. Every unit lands under the sandbox's own HOME, a recorder stands in
 * for launchctl, and the real scheduler control is shown refusing a
 * redirected HOME before it writes or loads anything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { run } from '../../src/cli/index.ts';
import type { CliContext } from '../../src/cli/context.ts';
import type { SchedulerControl, TimerTarget } from '../../src/hosts/timer.ts';
import { capture, inProject } from './support.ts';

function recorder(): SchedulerControl & { readonly calls: string[] } {
  const calls: string[] = [];
  const loaded = new Set<string>();
  return {
    calls,
    admit: () => undefined,
    load: (_t: TimerTarget, label: string) => { calls.push(`load ${label}`); loaded.add(label); },
    unload: (_t: TimerTarget, label: string) => { calls.push(`unload ${label}`); loaded.delete(label); },
    loaded: (_t: TimerTarget, label: string) => loaded.has(label),
  };
}

async function weekly(ctx: CliContext, cwd: string, timezone = 'Europe/Berlin'): Promise<void> {
  mkdirSync(join(cwd, 'docs'), { recursive: true });
  writeFileSync(join(cwd, 'docs', 'a.md'), 'a', 'utf8');
  const defined = await capture(() => run(['workflow', 'schedule', 'design-conformance', '--cron=0 9 * * 1', `--timezone=${timezone}`, '--max-tier=project_write', '--input=target=docs', '--trigger-id=weekly'], ctx));
  assert.equal(defined.code, 0, defined.err);
  assert.match(defined.out, /workflow install-timer weekly --executor=<id>/);
}

test('install-timer writes one launchd unit under the injected home, replaces it on reinstall, and remove-timer takes it away', async () => {
  await inProject(async (base, box) => {
    const control = recorder();
    const ctx: CliContext = { ...base, env: { ...base.env, OPENAI_API_KEY: 'sk-planted-secret', ANTHROPIC_API_KEY: 'sk-ant-planted', CODEX_HOME: join(box.home, '.codex') }, timers: { platform: 'darwin', control, systemTimezone: 'Europe/Berlin' } };
    await weekly(ctx, box.cwd);

    const bare = await capture(() => run(['workflow', 'install-timer', 'weekly'], ctx));
    assert.equal(bare.code, 2);
    assert.match(bare.err, /install-timer needs --executor=<id>: without one a firing only records a tick/);
    const unsupported = await capture(() => run(['workflow', 'install-timer', 'weekly', '--executor=claude'], ctx));
    assert.equal(unsupported.code, 2);
    assert.match(unsupported.err, /no unattended adapter for claude/);
    assert.deepEqual(control.calls, [], 'a refused install touches nothing');

    const installed = await capture(() => run(['workflow', 'install-timer', 'weekly', '--executor=codex', '--json'], ctx));
    assert.equal(installed.code, 0, installed.err);
    const result = JSON.parse(installed.out) as { label: string; files: string[]; replaced: boolean };
    const agents = join(box.home, 'Library', 'LaunchAgents');
    assert.ok(result.label.startsWith('construct.proj-') && result.label.endsWith('.weekly'), result.label);
    assert.deepEqual(result.files, [join(agents, `${result.label}.plist`)]);
    assert.ok(!result.files[0]!.startsWith(join(userInfo().homedir, 'Library')), 'never the real home');
    assert.equal(result.replaced, false);
    assert.deepEqual(control.calls, [`load ${result.label}`]);

    const plist = readFileSync(result.files[0]!, 'utf8');
    assert.match(plist, /<key>StartCalendarInterval<\/key>\s*<array>\s*<dict><key>Minute<\/key><integer>0<\/integer><key>Hour<\/key><integer>9<\/integer><key>Weekday<\/key><integer>1<\/integer><\/dict>/);
    assert.doesNotMatch(plist, /StartInterval<|RunAtLoad|KeepAlive/);
    assert.doesNotMatch(plist, /sk-planted|sk-ant-planted|OPENAI_API_KEY|ANTHROPIC_API_KEY/, 'no secret rides into the unit');
    assert.match(plist, new RegExp(`<key>WorkingDirectory</key><string>${box.cwd}</string>`));
    assert.match(plist, new RegExp(`<string>${join(box.home, '.state', 'construct', 'timers')}/`), 'logs go under the injected state dir');
    const recipe = await capture(() => run(['workflow', 'recipe', 'weekly', '--clock=launchd', '--executor=codex'], ctx));
    assert.equal(recipe.out, `# ${result.label}.plist\n${plist}`, 'the recipe prints exactly the installed unit');

    const again = await capture(() => run(['workflow', 'install-timer', 'weekly', '--executor=codex', '--json'], ctx));
    assert.equal(JSON.parse(again.out).replaced, true);
    assert.deepEqual(readdirSync(agents), [`${result.label}.plist`], 'one unit per project and trigger');
    assert.deepEqual(control.calls.slice(1), [`unload ${result.label}`, `load ${result.label}`]);

    const listed = await capture(() => run(['workflow', 'timers'], ctx));
    assert.equal(listed.code, 0, listed.err);
    assert.match(listed.out, new RegExp(`^here  ${result.label.replace(/\./g, '\\.')} \\(trigger weekly, executor codex, loaded\\)$`, 'm'));
    const status = await capture(() => run(['status', '--json'], ctx));
    assert.deepEqual(JSON.parse(status.out).timers, [{ label: result.label, triggerId: 'weekly', executor: 'codex', loaded: true, problem: null }]);
    const healthy = await capture(() => run(['doctor', '--json'], ctx));
    const timerCheck = (out: string) => (JSON.parse(out) as { checks: { name: string; ok: boolean; detail: string }[] }).checks.find((c) => c.name === 'timers')!;
    assert.equal(timerCheck(healthy.out).ok, true, timerCheck(healthy.out).detail);

    await capture(() => run(['workflow', 'disable', 'weekly'], ctx));
    const flagged = await capture(() => run(['doctor', '--json'], ctx));
    assert.equal(timerCheck(flagged.out).ok, false);
    assert.match(timerCheck(flagged.out).detail, /trigger weekly is disabled/);
    const flaggedStatus = await capture(() => run(['status'], ctx));
    assert.match(flaggedStatus.out, /timers: weekly \(trigger weekly is disabled/);

    const removed = await capture(() => run(['workflow', 'remove-timer', 'weekly'], ctx));
    assert.equal(removed.code, 0, removed.err);
    assert.equal(existsSync(result.files[0]!), false);
    assert.equal(control.calls.at(-1), `unload ${result.label}`);
    const none = await capture(() => run(['workflow', 'timers'], ctx));
    assert.match(none.out, /no platform timers fire Construct triggers/);
  });
});

test('a unit whose project is gone is flagged by doctor and removed by its label', async () => {
  await inProject(async (base, box) => {
    const control = recorder();
    const ctx: CliContext = { ...base, timers: { platform: 'darwin', control, systemTimezone: 'Europe/Berlin' } };
    const agents = join(box.home, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    const orphan = 'construct.proj-00000000.nightly';
    const program = `<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${process.execPath}</string><string>--execute=codex</string></array>`;
    writeFileSync(join(agents, `${orphan}.plist`), `<plist><dict>${program}<key>WorkingDirectory</key><string>${join(box.home, 'moved-away')}</string></dict></plist>`, 'utf8');
    const stale = 'construct.proj-00000000.stale';
    writeFileSync(join(agents, `${stale}.plist`), `<plist><dict><key>ProgramArguments</key><array><string>${process.execPath}</string><string>${join(box.home, 'gone', 'construct.mjs')}</string></array><key>WorkingDirectory</key><string>${box.cwd}</string></dict></plist>`, 'utf8');
    const doctor = await capture(() => run(['doctor', '--json'], ctx));
    const check = (JSON.parse(doctor.out) as { checks: { name: string; ok: boolean; detail: string }[] }).checks.find((c) => c.name === 'timers')!;
    assert.equal(check.ok, false);
    assert.match(check.detail, /0 here, 2 for other projects/);
    assert.match(check.detail, /gone\/construct\.mjs, no longer exists \(Node or Construct moved\)/);
    assert.match(check.detail, /moved-away no longer exists; `construct workflow remove-timer construct\.proj-00000000\.nightly` removes it/);
    const removed = await capture(() => run(['workflow', 'remove-timer', orphan], ctx));
    assert.equal(removed.code, 0, removed.err);
    assert.equal(existsSync(join(agents, `${orphan}.plist`)), false);
  });
});

test('launchd refuses a trigger in another timezone instead of shifting it', async () => {
  await inProject(async (base, box) => {
    const control = recorder();
    const ctx: CliContext = { ...base, timers: { platform: 'darwin', control, systemTimezone: 'Europe/Berlin' } };
    await weekly(ctx, box.cwd, 'UTC');
    const refused = await capture(() => run(['workflow', 'install-timer', 'weekly', '--executor=codex'], ctx));
    assert.equal(refused.code, 1);
    assert.match(refused.err, /launchd cannot express it exactly/);
    assert.equal(existsSync(join(box.home, 'Library', 'LaunchAgents')), false);
    assert.deepEqual(control.calls, []);
  });
});

test('the real scheduler refuses a redirected HOME before it writes or loads anything', { skip: process.platform !== 'darwin' && process.platform !== 'linux' }, async () => {
  await inProject(async (base, box) => {
    const ctx: CliContext = { ...base, timers: undefined };
    await weekly(ctx, box.cwd, 'UTC');
    const refused = await capture(() => run(['workflow', 'install-timer', 'weekly', '--executor=codex'], ctx));
    assert.notEqual(refused.code, 0);
    assert.match(refused.err, /this account's scheduler reads .*HOME or XDG_CONFIG_HOME is redirected\); nothing was installed or removed/);
    assert.equal(existsSync(join(box.home, 'Library', 'LaunchAgents')), false);
    assert.equal(existsSync(join(box.home, '.config', 'systemd')), false);
  });
});

test('an executor that cannot run leaves a blocked run that names the reason', async () => {
  await inProject(async (ctx, box) => {
    await weekly(ctx, box.cwd);
    const fired = await capture(() => run(['workflow', 'fire', 'weekly', '--execute=codex', '--json'], ctx));
    assert.equal(fired.code, 1);
    const result = JSON.parse(fired.out) as { runId: string; runState: string; reason: string };
    assert.equal(result.runState, 'blocked');
    assert.match(result.reason, /unprovisioned executor codex: no executable on PATH/);
    const shown = await capture(() => run(['run', 'show', result.runId, '--json'], ctx));
    assert.match(shown.out, /no executable on PATH/);
  });
});
