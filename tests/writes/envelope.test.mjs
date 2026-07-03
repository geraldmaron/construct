/**
 * tests/writes/envelope.test.mjs — governed write-envelope unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeWithEnvelope } from '../../lib/writes/envelope.mjs';
import { WriteSentLog } from '../../lib/writes/sent-log.mjs';

function makeFakeProvider() {
  let callCount = 0;
  return {
    meta: { id: 'fake-github' },
    write: async (config, payload) => {
      callCount++;
      return { type: 'issue-created', url: `https://github.com/example/issues/${payload.number || callCount}`, id: String(payload.number || callCount) };
    },
    callCount: () => callCount,
  };
}

function makeFakeApprovalQueue() {
  const records = new Map();
  return {
    enqueue: (spec) => {
      const approvalId = `appr-${Date.now()}`;
      const resumeToken = 'tok-' + Math.random().toString(36).slice(2);
      const rec = { approvalId, resumeToken, expiresAt: new Date(Date.now() + 3600000).toISOString(), state: 'awaiting_approval', toolCall: { tool: spec.tool, args: spec.args } };
      records.set(approvalId, rec);
      return rec;
    },
    findByToolArgs: () => null,
    getByResumeToken: (token) => {
      for (const r of records.values()) if (r.resumeToken === token) return r;
      return null;
    },
  };
}

describe('WriteSentLog', () => {
  it('records and finds by idempotency key', () => {
    const log = new WriteSentLog();
    log.record({ idempotencyKey: 'key1', writeType: 'issue', provider: 'github', status: 'sent' });
    const found = log.findByIdempotencyKey('key1');
    assert.equal(found.idempotencyKey, 'key1');
    assert.equal(found.status, 'sent');
  });

  it('returns null for unknown key', () => {
    const log = new WriteSentLog();
    assert.equal(log.findByIdempotencyKey('nonexistent'), null);
  });

  it('filters by provider', () => {
    const log = new WriteSentLog();
    log.record({ idempotencyKey: 'k1', writeType: 'issue', provider: 'github', status: 'sent' });
    log.record({ idempotencyKey: 'k2', writeType: 'page', provider: 'confluence', status: 'sent' });
    assert.equal(log.list({ provider: 'github' }).length, 1);
  });

  it('persists and reloads from file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sentlog-'));
    const log = new WriteSentLog({ persistPath: join(dir, 'sent-log.jsonl') });
    log.record({ idempotencyKey: 'k1', writeType: 'issue', provider: 'github', status: 'sent' });

    const log2 = new WriteSentLog({ persistPath: join(dir, 'sent-log.jsonl') });
    assert.equal(log2.findByIdempotencyKey('k1').status, 'sent');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('writeWithEnvelope', () => {
  it('happy path: returns sent status with linkback', async () => {
    const provider = makeFakeProvider();
    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', title: 'Test', number: 1 },
    });
    assert.equal(result.status, 'sent');
    assert.ok(result.envelope.externalUrl);
    assert.equal(result.envelope.writeType, 'issue');
  });

  it('dry-run: returns rendered payload without executing', async () => {
    const provider = makeFakeProvider();
    const result = await writeWithEnvelope({
      provider, config: {}, dryRun: true,
      payload: { type: 'issue', title: 'Test' },
    });
    assert.equal(result.status, 'dry-run');
    assert.equal(result.envelope.payload.title, 'Test');
  });

  it('idempotency: same key returns cached result', async () => {
    const sentLog = new WriteSentLog();
    sentLog.record({ idempotencyKey: 'dup-key', writeType: 'issue', provider: 'test', status: 'sent', externalUrl: 'https://example.com/1' });
    const provider = makeFakeProvider();
    const result = await writeWithEnvelope({
      provider, config: {}, sentLog,
      payload: { type: 'issue' },
      idempotencyKey: 'dup-key',
    });
    assert.equal(result.status, 'cached');
    assert.equal(result.envelope.externalUrl, 'https://example.com/1');
  });

  it('approval gate: returns awaiting_approval', async () => {
    const provider = makeFakeProvider();
    const approvalQueue = makeFakeApprovalQueue();
    const broker = {
      invoke: async (opts) => {
        if (opts.tool.startsWith('write:')) {
          const rec = approvalQueue.enqueue({ tool: opts.tool, args: opts.toolArgs, requestedBy: opts.requestedBy });
          return { status: 'awaiting_approval', approvalId: rec.approvalId, resumeToken: rec.resumeToken, expiresAt: rec.expiresAt };
        }
        return {};
      },
    };
    const result = await writeWithEnvelope({
      provider, config: {}, broker, approvalQueue,
      payload: { type: 'issue', title: 'Test' },
    });
    assert.equal(result.status, 'awaiting_approval');
    assert.ok(result.envelope.approvalId);
    assert.ok(result.envelope.resumeToken);
  });

  it('sent-log records pending before execution', async () => {
    const sentLog = new WriteSentLog();
    const provider = makeFakeProvider();
    await writeWithEnvelope({
      provider, config: {}, sentLog,
      payload: { type: 'issue', number: 99 },
    });
    const found = sentLog.list({ status: 'sent' });
    assert.ok(found.length >= 1);
  });

  it('provider error returns error status', async () => {
    const provider = {
      meta: { id: 'failing' },
      write: async () => { throw new Error('API timeout'); },
    };
    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue' },
      maxRetries: 1,
    });
    assert.equal(result.status, 'error');
    assert.ok(result.envelope.error.includes('API timeout'));
  });
});