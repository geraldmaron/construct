/**
 * tests/kernel/execution/from-host.test.ts — HostAdapter → ExecutionAdapter bridge.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HostAdapter, HostContext, HostResult } from '../../../src/kernel/hosts/interface.ts';
import { executionAdapterFromHost } from '../../../src/kernel/execution/from-host.ts';

function fakeHost(overrides: Partial<HostAdapter> = {}): HostAdapter {
  let lastId: string | undefined;
  const base: HostAdapter = {
    name: 'fake',
    kind: 'coding',
    capabilities: ['interrupt', 'concurrent'],
    async init() {},
    async invoke(request: unknown, context?: HostContext): Promise<HostResult> {
      lastId = context?.invocationId;
      const req = request as { role?: string; task?: string };
      assert.equal(req.role, 'execution');
      assert.equal(typeof req.task, 'string');
      return {
        id: lastId ?? 'missing',
        status: 'ok',
        output: { echo: req.task },
        error: null,
      };
    },
    async health() {
      return { live: true, detail: 'ok' };
    },
    async cancel(invocationId: string) {
      return { cancelled: invocationId === lastId, reason: 'stopped' };
    },
  };
  return { ...base, ...overrides };
}

test('executionAdapterFromHost maps prompt invoke and cancel', async () => {
  const exec = executionAdapterFromHost(fakeHost());
  assert.equal(exec.id, 'fake');
  assert.ok(exec.capabilities.capabilities.includes('interrupt'));
  await exec.init({ cwd: '/tmp/proj', model: 'x' });
  const result = await exec.invoke({ prompt: 'do the thing', cwd: '/tmp/proj' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.output, { echo: 'do the thing' });
  const cancelled = await exec.cancel({ reason: 'test' });
  assert.equal(cancelled.ok, true);
});

test('cancel before invoke reports no in-flight work', async () => {
  const exec = executionAdapterFromHost(fakeHost());
  const cancelled = await exec.cancel();
  assert.equal(cancelled.ok, false);
});

test('health mirrors host liveness', async () => {
  const exec = executionAdapterFromHost(
    fakeHost({
      async health() {
        return { live: false, detail: 'down' };
      },
    }),
  );
  const h = await exec.health();
  assert.equal(h.ok, false);
  assert.equal(h.detail, 'down');
});
