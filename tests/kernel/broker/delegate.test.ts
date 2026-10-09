import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brokerFixture } from './support.ts';
import { createMcpHandler } from '../../../src/hosts/mcp/server.ts';
import { delegate } from '../../../src/kernel/broker/delegate.ts';
import { ToolInputError } from '../../../src/kernel/broker/definition.ts';
import { createBrokerContext, openBroker } from '../../../src/cli/broker-context.ts';

test('actual MCP surface exposes opt-in status, rejects unconfigured dispatch, and isolates runners', async () => {
  const fixture = brokerFixture();
  try {
    const handle = createMcpHandler('interactive', fixture.broker);
    const reply = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delegate', arguments: { action: 'status' } } });
    const data = (reply as { result: { structuredContent: { executors: Array<{ configured: boolean; liveVerified: boolean }> } } }).result.structuredContent;
    assert.equal(data.executors.length, 3);
    assert.ok(data.executors.every(executor => !executor.configured && !executor.liveVerified));
    const runner = createMcpHandler('headless', fixture.broker);
    const denied = await runner({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'delegate', arguments: { action: 'status' } } });
    assert.equal((denied as { error: { code: number } }).error.code, -32602);
    assert.throws(() => openBroker({ ...fixture.ctx, env: { ...fixture.ctx.env, CONSTRUCT_DELEGATED_WORKER: '1' } }, {}), /supplied context/);
  } finally { fixture.cleanup(); }
});

test('delegate has a closed, action-specific contract', () => {
  assert.throws(() => delegate.validate({ action: 'status', model: 'unapproved' }), /not an input/);
  assert.throws(() => delegate.validate({ action: 'cancel' }), /required/);
  assert.throws(() => delegate.validate({ action: 'integrate', id: 'id', instructions: 'override' }), /does not apply/);
  assert.throws(() => delegate.validate({ action: 'triage', id: 'id', dispositions: [{ findingId: 'finding', decision: 'approve', rationale: 'bypass' }] }), /one of/);
  const problem = (raw: Record<string, unknown>): ToolInputError => {
    try {
      delegate.validate(raw);
    } catch (error) {
      assert.ok(error instanceof ToolInputError);
      return error;
    }
    assert.fail('expected a ToolInputError');
  };
  const misplaced = problem({ action: 'integrate', id: 'id', instructions: 'override' });
  assert.equal(misplaced.field, 'instructions', 'the input that does not apply is named');
  assert.deepEqual(misplaced.allowed, ['action', 'id']);
  assert.equal(problem({ action: 'triage', id: 'id', dispositions: ['x'] }).field, 'dispositions');
  const strayField = problem({ action: 'triage', id: 'id', dispositions: [{ findingId: 'f', decision: 'accepted', rationale: 'r', approve: true }] });
  assert.equal(strayField.field, 'dispositions');
  assert.deepEqual(strayField.allowed, ['findingId', 'decision', 'rationale']);
  assert.equal(problem({ action: 'start', workId: 'w', requestKey: 'k', executor: 'codex', role: 'implement', instructions: 'i', paths: [1] }).field, 'paths');
});

test('project-write denial and malformed personal configuration do not widen permissions', async () => {
  const fixture = brokerFixture();
  try {
    const project = { root: fixture.broker.root, layout: fixture.broker.layout, store: fixture.broker.store, lane: null,
      files: { ...fixture.broker.files, config: { ...fixture.broker.files.config!, behavior: { 'policy.projectWrite': 'never' } } } };
    const broker = createBrokerContext(fixture.ctx, project, fixture.binding);
    assert.equal(broker.delegation, undefined);
    await assert.rejects(async () => delegate.run(broker, { action: 'status' }), /unavailable/);
    mkdirSync(fixture.ctx.paths.configDir, { recursive: true });
    writeFileSync(join(fixture.ctx.paths.configDir, 'delegation.json'), '{');
    const malformed = createBrokerContext(fixture.ctx, { ...project, files: fixture.broker.files }, fixture.binding);
    const status = await malformed.delegation!.status() as { executors: Array<{ configured: boolean; reason: string }> };
    assert.ok(status.executors.every(executor => !executor.configured && /invalid personal/.test(executor.reason)));
  } finally { fixture.cleanup(); }
});
