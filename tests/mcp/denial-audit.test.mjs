/**
 * tests/mcp/denial-audit.test.mjs — LMCP-I3.
 *
 * Pins: a denied broker decision writes a durable denied-store record and
 * an audit-trail entry, both carrying the full {decisionId, actor, tenant,
 * project, tool, target, risk, outcome, correlationId, ts} schema; the same
 * schema is used for allow and approval_required outcomes too; and the
 * correlationId on a decision matches the traceId on the tool.called trace
 * event emitted for the same call, so a denied (or any) call is traceable
 * from the broker decision to the task trace.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Broker, PolicyDenied, ApprovalRequired } from '../../lib/mcp/broker.mjs';
import { DeniedStore, deniedStorePath } from '../../lib/mcp/denied-store.mjs';
import { traceDir as resolveTraceDir } from '../../lib/worker/trace.mjs';

const REQUIRED_FIELDS = [
  'decisionId', 'actor', 'tenant', 'project', 'tool', 'target', 'risk', 'outcome', 'correlationId', 'ts',
];

// The broker's default emit is the real emitTraceEvent, which resolves trace
// writes through the machine-scoped state root (ADR-0066) via
// process.env.CONSTRUCT_HOME_OVERRIDE directly, not through any per-call option, so
// CONSTRUCT_HOME_OVERRIDE is pinned for the whole file to keep those writes off the
// real developer machine's $HOME.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-denial-audit-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

function fakeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-denial-audit-'));
  tmpDirs.push(dir);
  return dir;
}

function denyingPolicy(reason = 'denied for test') {
  return () => ({ allowed: false, reason, approvalRequired: false, source: 'test-policy' });
}

function allowingPolicy() {
  return () => ({ allowed: true, reason: 'ok', approvalRequired: false, source: 'test-policy' });
}

function approvalPolicy() {
  return () => ({ allowed: true, reason: 'needs approval', approvalRequired: true, source: 'test-policy' });
}

function makeBroker({ rootDir, policy, auditEvents, traceEvents }) {
  return new Broker({
    rootDir,
    policy,
    emit: (event) => traceEvents.push(event),
    auditRecorder: (record) => auditEvents.push(record),
  });
}

function assertSchema(record, expected) {
  for (const field of REQUIRED_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(record, field), `missing field "${field}" in ${JSON.stringify(record)}`);
  }
  assert.equal(record.outcome, expected.outcome);
  assert.equal(record.actor, expected.actor);
  assert.equal(record.tool, expected.tool);
  assert.equal(record.target, expected.target);
  assert.equal(record.risk, expected.risk);
  assert.ok(record.tenant, 'tenant must be resolved, not empty');
  assert.ok(record.decisionId.startsWith('decision-'), 'decisionId must use the decision- id shape');
  assert.ok(record.ts && !Number.isNaN(Date.parse(record.ts)), 'ts must be a parseable ISO timestamp');
}

describe('denied decisions — durable evidence', () => {
  it('a denied call writes a durable denied-store record with the full schema', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    const traceEvents = [];
    const broker = makeBroker({ rootDir, policy: denyingPolicy('write forbidden for role'), auditEvents, traceEvents });

    await assert.rejects(
      () => broker.invoke({
        role: 'engineer',
        tool: 'github',
        action: 'push:main',
        risk: 'high',
        project: 'construct',
        requestedBy: { userId: 'alice@example.com', tenantId: 'acme' },
        execute: async () => { throw new Error('must not execute on denial'); },
      }),
      (err) => err instanceof PolicyDenied,
    );

    // Durable denied-store record.
    const storePath = deniedStorePath(rootDir);
    assert.ok(fs.existsSync(storePath), 'denied-decisions.jsonl must exist after a denial');
    const store = new DeniedStore({ rootDir });
    const rows = store.readAll();
    assert.equal(rows.length, 1);
    assertSchema(rows[0], { outcome: 'denied', actor: 'alice@example.com', tool: 'github', target: 'push:main', risk: 'high' });
  });

  it('a denied call also writes an audit-trail entry with the same full schema', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    const traceEvents = [];
    const broker = makeBroker({ rootDir, policy: denyingPolicy(), auditEvents, traceEvents });

    await assert.rejects(
      () => broker.invoke({
        role: 'engineer',
        tool: 'fs',
        action: 'delete',
        risk: 'medium',
        project: 'construct',
        requestedBy: { serviceId: 'svc-worker-1' },
        execute: async () => 'unreachable',
      }),
      (err) => err instanceof PolicyDenied,
    );

    assert.equal(auditEvents.length, 1);
    assertSchema(auditEvents[0], { outcome: 'denied', actor: 'svc-worker-1', tool: 'fs', target: 'delete', risk: 'medium' });
    assert.equal(auditEvents[0].agent, 'mcp-broker');
  });

  it('denied record and audit entry for the same call share decisionId and correlationId', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    const traceEvents = [];
    const broker = makeBroker({ rootDir, policy: denyingPolicy(), auditEvents, traceEvents });

    await assert.rejects(
      () => broker.invoke({
        role: 'engineer',
        tool: 'github',
        action: 'merge:main',
        risk: 'high',
        requestedBy: { userId: 'bob@example.com' },
        execute: async () => 'unreachable',
      }),
      (err) => err instanceof PolicyDenied,
    );

    const store = new DeniedStore({ rootDir });
    const [deniedRecord] = store.readAll();
    const [auditRecord] = auditEvents;

    assert.equal(deniedRecord.decisionId, auditRecord.decisionId);
    assert.equal(deniedRecord.correlationId, auditRecord.correlationId);
  });

  it('the thrown PolicyDenied error itself carries the same correlationId as the durable records', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    const traceEvents = [];
    const broker = makeBroker({ rootDir, policy: denyingPolicy(), auditEvents, traceEvents });

    let caught = null;
    try {
      await broker.invoke({
        role: 'engineer',
        tool: 'github',
        action: 'force_push:main',
        requestedBy: { userId: 'holly@example.com' },
        execute: async () => 'unreachable',
      });
    } catch (err) {
      caught = err;
    }

    assert.ok(caught instanceof PolicyDenied);
    const store = new DeniedStore({ rootDir });
    const [deniedRecord] = store.readAll();
    assert.equal(caught.correlationId, deniedRecord.correlationId);
    assert.equal(caught.correlationId, auditEvents[0].correlationId);
  });
});

describe('every broker decision — same schema, all outcomes', () => {
  it('an allowed call writes an audit entry with the full schema and outcome "allowed"', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    const traceEvents = [];
    const broker = makeBroker({ rootDir, policy: allowingPolicy(), auditEvents, traceEvents });

    const { result } = await broker.invoke({
      role: 'engineer',
      tool: 'fs',
      action: 'read',
      risk: 'low',
      project: 'construct',
      requestedBy: { userId: 'carol@example.com' },
      execute: async () => 'ok',
    });

    assert.equal(result, 'ok');
    assert.equal(auditEvents.length, 1);
    assertSchema(auditEvents[0], { outcome: 'allowed', actor: 'carol@example.com', tool: 'fs', target: 'read', risk: 'low' });

    // Allowed decisions are not written to the denied store.
    const store = new DeniedStore({ rootDir });
    assert.equal(store.readAll().length, 0);
  });

  it('an approval-required call (no queue) writes an audit entry with outcome "approval_required"', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    const traceEvents = [];
    const broker = makeBroker({ rootDir, policy: approvalPolicy(), auditEvents, traceEvents });

    await assert.rejects(
      () => broker.invoke({
        role: 'engineer',
        tool: 'github',
        action: 'create_pr',
        risk: 'medium',
        requestedBy: { userId: 'dave@example.com' },
        execute: async () => 'unreachable',
      }),
      (err) => err instanceof ApprovalRequired,
    );

    assert.equal(auditEvents.length, 1);
    assertSchema(auditEvents[0], { outcome: 'approval_required', actor: 'dave@example.com', tool: 'github', target: 'create_pr', risk: 'medium' });
  });

  it('falls back to role, then "unknown", when requestedBy carries no actor id', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    const traceEvents = [];
    const broker = makeBroker({ rootDir, policy: allowingPolicy(), auditEvents, traceEvents });

    await broker.invoke({ role: 'engineer', tool: 'fs', action: 'read', execute: async () => 'ok' });
    assert.equal(auditEvents[0].actor, 'engineer');

    auditEvents.length = 0;
    await broker.invoke({ tool: 'fs', action: 'read', execute: async () => 'ok' });
    assert.equal(auditEvents[0].actor, 'unknown');
  });
});

describe('correlation id traceability', () => {
  it('correlationId on the decision matches traceId on the tool.called trace event', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    const traceEvents = [];
    const broker = makeBroker({ rootDir, policy: denyingPolicy(), auditEvents, traceEvents });

    await assert.rejects(
      () => broker.invoke({
        role: 'engineer',
        tool: 'github',
        action: 'push:main',
        requestedBy: { userId: 'erin@example.com' },
        execute: async () => 'unreachable',
      }),
      (err) => err instanceof PolicyDenied,
    );

    assert.equal(traceEvents.length, 1);
    assert.equal(traceEvents[0].eventType, 'tool.called');
    assert.equal(auditEvents[0].correlationId, traceEvents[0].traceId);
  });

  it('an inbound traceId is reused as correlationId end to end (run/task → broker → audit)', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    const traceEvents = [];
    const broker = makeBroker({ rootDir, policy: allowingPolicy(), auditEvents, traceEvents });

    const inboundTraceId = 'trace-caller-supplied-0001';
    const { correlationId } = await broker.invoke({
      role: 'engineer',
      tool: 'fs',
      action: 'read',
      traceId: inboundTraceId,
      requestedBy: { userId: 'frank@example.com' },
      execute: async () => 'ok',
    });

    assert.equal(correlationId, inboundTraceId);
    assert.equal(traceEvents[0].traceId, inboundTraceId);
    assert.equal(auditEvents[0].correlationId, inboundTraceId);
  });

  it('a denied call correlationId is traceable from denied-store to the trace shard on disk', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    // Real emitTraceEvent (default `emit`) so the trace event actually lands
    // on disk under rootDir/.construct/traces — this test verifies the on-disk
    // correlation, not just the in-memory event.
    const broker = new Broker({
      rootDir,
      policy: denyingPolicy(),
      auditRecorder: (record) => auditEvents.push(record),
    });

    await assert.rejects(
      () => broker.invoke({
        role: 'engineer',
        tool: 'github',
        action: 'push:main',
        requestedBy: { userId: 'grace@example.com' },
        execute: async () => 'unreachable',
      }),
      (err) => err instanceof PolicyDenied,
    );

    const store = new DeniedStore({ rootDir });
    const [deniedRecord] = store.readAll();

    const today = new Date().toISOString().slice(0, 10);
    const shardPath = path.join(resolveTraceDir(rootDir), `${today}.jsonl`);
    assert.ok(fs.existsSync(shardPath), 'trace shard must exist after a brokered call');

    const lines = fs.readFileSync(shardPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const matching = lines.find((row) => row.traceId === deniedRecord.correlationId);
    assert.ok(matching, 'trace shard must contain an event whose traceId equals the denied record correlationId');
    assert.equal(matching.eventType, 'tool.called');
    assert.equal(matching.metadata.allowed, false);
  });
});

describe('auditRecorded surfaced on invoke() outcomes', () => {
  it('an allowed call surfaces auditRecorded:true when the audit write succeeds', async () => {
    const rootDir = fakeRoot();
    const auditEvents = [];
    const traceEvents = [];
    const broker = makeBroker({ rootDir, policy: allowingPolicy(), auditEvents, traceEvents });

    const { result, auditRecorded } = await broker.invoke({
      role: 'engineer',
      tool: 'fs',
      action: 'read',
      requestedBy: { userId: 'ivan@example.com' },
      execute: async () => 'ok',
    });

    assert.equal(result, 'ok');
    assert.equal(auditRecorded, true);
  });

  it('an allowed call surfaces auditRecorded:false when the audit write throws, but still executes the tool (best-effort, never break dispatch)', async () => {
    const rootDir = fakeRoot();
    const traceEvents = [];
    let executed = false;
    const broker = new Broker({
      rootDir,
      policy: allowingPolicy(),
      emit: (event) => traceEvents.push(event),
      auditRecorder: () => { throw new Error('disk unavailable'); },
    });

    const { result, auditRecorded } = await broker.invoke({
      role: 'engineer',
      tool: 'fs',
      action: 'read',
      requestedBy: { userId: 'judy@example.com' },
      execute: async () => { executed = true; return 'ok'; },
    });

    assert.equal(executed, true, 'execute() must still run in default/solo mode despite the audit write failing');
    assert.equal(result, 'ok');
    assert.equal(auditRecorded, false);
  });

  it('a denied call throws PolicyDenied carrying auditRecorded:false when the audit write throws', async () => {
    const rootDir = fakeRoot();
    const traceEvents = [];
    const broker = new Broker({
      rootDir,
      policy: denyingPolicy(),
      emit: (event) => traceEvents.push(event),
      auditRecorder: () => { throw new Error('disk unavailable'); },
    });

    let caught = null;
    try {
      await broker.invoke({
        role: 'engineer',
        tool: 'github',
        action: 'push:main',
        requestedBy: { userId: 'kim@example.com' },
        execute: async () => 'unreachable',
      });
    } catch (err) {
      caught = err;
    }

    assert.ok(caught instanceof PolicyDenied);
    assert.equal(caught.auditRecorded, false);
  });

  it('an approval-required call (no queue) throws ApprovalRequired carrying auditRecorded:false when the audit write throws', async () => {
    const rootDir = fakeRoot();
    const traceEvents = [];
    const broker = new Broker({
      rootDir,
      policy: approvalPolicy(),
      emit: (event) => traceEvents.push(event),
      auditRecorder: () => { throw new Error('disk unavailable'); },
    });

    let caught = null;
    try {
      await broker.invoke({
        role: 'engineer',
        tool: 'github',
        action: 'create_pr',
        requestedBy: { userId: 'liam@example.com' },
        execute: async () => 'unreachable',
      });
    } catch (err) {
      caught = err;
    }

    assert.ok(caught instanceof ApprovalRequired);
    assert.equal(caught.auditRecorded, false);
  });
});

describe('DeniedStore', () => {
  it('readAll returns [] when the store file does not exist', () => {
    const rootDir = fakeRoot();
    const store = new DeniedStore({ rootDir });
    assert.deepEqual(store.readAll(), []);
  });

  it('findByCorrelationId and findByDecisionId locate the right row among several', () => {
    const rootDir = fakeRoot();
    const store = new DeniedStore({ rootDir });
    store.append({ decisionId: 'decision-aaa', correlationId: 'trace-aaa', tool: 'fs' });
    store.append({ decisionId: 'decision-bbb', correlationId: 'trace-bbb', tool: 'github' });

    assert.equal(store.findByDecisionId('decision-bbb').length, 1);
    assert.equal(store.findByDecisionId('decision-bbb')[0].tool, 'github');
    assert.equal(store.findByCorrelationId('trace-aaa').length, 1);
    assert.equal(store.findByCorrelationId('trace-aaa')[0].tool, 'fs');
  });
});
