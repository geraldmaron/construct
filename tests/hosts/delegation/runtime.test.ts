import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDelegationDriver } from '../../../src/hosts/delegation/runtime.ts';
import { repository, fakeExecutor } from './support.ts';

for (const executor of ['claude', 'codex', 'cursor'] as const) {
  test(`${executor} adapter exercises snapshot, actual subprocess, result, review and local integration using a sterile fake CLI`, async () => {
    const fixture = repository();
    try {
      const config = fakeExecutor(fixture, executor);
      const isolatedValidation = [[process.execPath, '-e', `if (!process.env.HOME.startsWith(${JSON.stringify(fixture.artifactsDir)}) || process.env.CODEX_HOME || process.env.CLAUDE_CONFIG_DIR) process.exit(1)`]];
      const driver = createDelegationDriver({ configDir: fixture.home, artifactsDir: fixture.artifactsDir, env: fixture.env, machine: 'fixture', config: { ...config, validation: isolatedValidation }, processAlive: () => false });
      const execution = { ...fixture.execution, assignment: { ...fixture.execution.assignment, executor, timeoutMs: 30_000 } };
      const snapshot = await driver.prepare(execution, null);
      const implementation = { ...execution, snapshot };
      let observedProcess = false;
      const result = await driver.launch(implementation, (_supervisor, group) => { if (group) observedProcess = true; });
      assert.equal(observedProcess, true);
      assert.equal(result.state, 'succeeded', result.summary);
      const artifact = await driver.collect(implementation);
      assert.equal((await driver.validate(implementation, 'worker'))[0]?.passed, true);
      const subject = { ...implementation, artifact };
      const review = { ...execution, id: `${executor}-review`, assignment: { ...execution.assignment, role: 'review' as const, subject: execution.id } };
      const reviewSnapshot = await driver.prepare(review, subject);
      assert.equal((await driver.launch({ ...review, snapshot: reviewSnapshot }, () => {})).state, 'succeeded');
      assert.deepEqual((await driver.collect({ ...review, snapshot: reviewSnapshot })).paths, []);
      await driver.integrate(subject);
      assert.equal(readFileSync(join(fixture.root, 'src/value.txt'), 'utf8'), 'worker\n');
      assert.equal((await driver.validate(subject, 'integrated'))[0]?.passed, true);
      assert.equal(fixture.git('rev-list', '--count', 'HEAD').trim(), '1');
    } finally { fixture.cleanup(); }
  });
}

test('malformed output, denied permissions, quota exhaustion and timeout preserve explicit outcomes', async () => {
  const fixture = repository();
  try {
    const driver = createDelegationDriver({ configDir: fixture.home, artifactsDir: fixture.artifactsDir, env: fixture.env, machine: 'fixture', config: fakeExecutor(fixture, 'codex'), processAlive: () => false });
    for (const [instructions, expected] of [['malformed', 'failed'], ['denied', 'blocked'], ['quota', 'blocked'], ['hang', 'timed_out']]) {
      const execution = { ...fixture.execution, id: instructions!, assignment: { ...fixture.execution.assignment, instructions: instructions!, timeoutMs: instructions === 'hang' ? 1000 : 30_000 } };
      const snapshot = await driver.prepare(execution, null);
      const result = await driver.launch({ ...execution, snapshot }, () => {});
      assert.equal(result.state, expected, result.summary);
    }
  } finally { fixture.cleanup(); }
});

test('explicit cancellation terminates a managed process before returning', async () => {
  const fixture = repository();
  try {
    const driver = createDelegationDriver({ configDir: fixture.home, artifactsDir: fixture.artifactsDir, env: fixture.env, machine: 'fixture', config: fakeExecutor(fixture, 'codex'), processAlive: () => false });
    const execution = { ...fixture.execution, assignment: { ...fixture.execution.assignment, instructions: 'hang', timeoutMs: 30_000 } };
    const snapshot = await driver.prepare(execution, null);
    let started!: () => void;
    const observed = new Promise<void>(resolve => { started = resolve; });
    const launched = driver.launch({ ...execution, snapshot }, (_pid, group) => { if (group) started(); });
    await observed;
    await driver.cancel(execution.id);
    assert.equal((await launched).state, 'cancelled');
  } finally { fixture.cleanup(); }
});

test('watchdog disconnect and normal root-process exit both terminate descendants', async () => {
  const fixture = repository();
  try {
    for (const disconnect of [false, true]) {
      const watchdog = fork(fileURLToPath(new URL('../../../src/hosts/delegation/watchdog.ts', import.meta.url)), [], { env: fixture.env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      const closed = once(watchdog, 'exit');
      let groupPid = 0;
      const spawned = new Promise<void>(resolve => watchdog.on('message', (message: { groupPid?: number }) => {
        if (message.groupPid) { groupPid = message.groupPid; resolve(); }
      }));
      watchdog.send({ command: process.execPath, args: ['-e', `const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'inherit'}); ${disconnect ? 'setInterval(()=>{},1000)' : 'setTimeout(()=>process.exit(0),50)'}`], cwd: fixture.root, env: fixture.env, prompt: '', timeoutMs: 5000 });
      await spawned;
      if (disconnect) { await delay(80); watchdog.disconnect(); }
      await closed;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try { process.kill(-groupPid, 0); await delay(30); }
        catch { groupPid = 0; break; }
      }
      assert.equal(groupPid, 0, 'managed process group still exists');
    }
  } finally { fixture.cleanup(); }
});
