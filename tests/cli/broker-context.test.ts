import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostCapabilitiesFor } from '../../src/cli/broker-context.ts';
import { provides } from '../../src/kernel/registry/capability-registry.ts';

test('broker defaults distinguish kernel readers from unobserved host and headless capabilities', () => {
  for (const surface of ['interactive', 'headless'] as const) {
    const host = hostCapabilitiesFor({ client: 'codex', surface, sessionId: 's', executorId: 'runner:test', actor: 'test' }, surface === 'interactive' ? 's' : null);
    assert.equal(provides(host, 'read_source:directory'), true);
    assert.equal(provides(host, 'read_source:unknown'), false);
    assert.equal(provides(host, 'write_source:unknown'), false);
    assert.deepEqual([...host.exercised!], []);
    assert.deepEqual(host.probed, []);
    if (surface === 'headless') {
      assert.equal(provides(host, 'model_review'), false);
      assert.equal(provides(host, 'run_tests'), false);
    }
  }
});
