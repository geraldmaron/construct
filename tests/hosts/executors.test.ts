import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnerCapabilities, executorSupport, executorCommand, prepareExecutor } from '../../src/hosts/executors.ts';
import { WIRABLE_CLIENTS } from '../../src/hosts/wiring/clients.ts';

test('every supported interactive host has an explicit unattended status, with no fallback or inherited grants', async () => {
  assert.deepEqual(executorSupport().map((row) => row.host), [...WIRABLE_CLIENTS]);
  for (const row of executorSupport()) {
    if (!row.supported) {
      assert.deepEqual(runnerCapabilities(row.host), []);
      await assert.rejects(prepareExecutor(row.host, { PATH: '' }), /unprovisioned executor/);
    }
  }
  await assert.rejects(prepareExecutor('codex', { PATH: '' }), /no executable/);
  assert.deepEqual(runnerCapabilities('runner:nightly'), []);
  assert.ok(!runnerCapabilities('codex').includes('write_source'));
  assert.ok(!runnerCapabilities('codex').includes('read_source'));
});

test('executor handoff uses argument arrays, the same project and run, an isolated MCP surface and the host sandbox', () => {
  const root = '/tmp/a project $(touch nope)';
  const args = executorCommand({ root, runId: 'run-one', executorId: 'runner:codex:unique', launcher: '/tmp/construct/bin/construct.mjs' });
  assert.equal(args[args.indexOf('--cd') + 1], root);
  assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(args.includes('--skip-git-repo-check'), 'an initialized project need not be a Git repository');
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.some((arg) => arg.includes('--headless') && arg.includes('runner:codex:unique')));
  assert.ok(!args.some((arg) => /dangerously|--model|--force/.test(arg)));
  assert.match(args.at(-1)!, /run-one/);
  assert.match(args.at(-1)!, /Do not start other work/);
});
