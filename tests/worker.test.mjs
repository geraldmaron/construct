/**
 * tests/worker.test.mjs — worker plane contract.
 *
 * Pins runJob's command execution + timeout + path policy, trace event
 * emission, evidence recording onto task graph nodes, and the typed
 * BLOCKED / NEEDS_MAIN_INPUT packets that gate node completion.
 *
 * Trace + worker-artifact writes resolve through the machine-scoped state
 * root (ADR-0066), so CONSTRUCT_HOME_OVERRIDE is pinned for the whole file to keep
 * them off the real developer machine's $HOME.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, after } from 'node:test';

import { runJob } from '../lib/worker/run.mjs';
import { emitTraceEvent, traceDir, newTraceId, TRACE_EVENT_TYPES, _resetTelemetryClient } from '../lib/worker/trace.mjs';
import { evidenceFromJobResult, recordEvidence, blockedPacket, needsInputPacket, EVIDENCE_TYPES } from '../lib/worker/evidence.mjs';
import { FilesystemTaskGraphStore } from '../lib/task-graph/store.mjs';
import { generateTaskGraphFromTriage } from '../lib/task-graph/generate.mjs';
import { classifyRdIntake } from '../lib/intake/classify.mjs';

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-worker-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-worker-'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('runJob', () => {
  it('runs a successful command and writes stdout / stderr artifacts', async () => {
    const r = await runJob({
      rootDir: projectRoot,
      job: {
        jobId: 'job-ok',
        command: 'echo hello-world',
        workspaceRef: projectRoot,
        timeoutSeconds: 5,
      },
    });
    assert.equal(r.status, 'passed');
    assert.equal(r.exitCode, 0);
    assert.ok(fs.existsSync(r.stdoutPath));
    const stdout = fs.readFileSync(r.stdoutPath, 'utf8');
    assert.match(stdout, /hello-world/);
  });

  it('reports failure status with non-zero exit code', async () => {
    const r = await runJob({
      rootDir: projectRoot,
      job: {
        jobId: 'job-fail',
        command: 'exit 7',
        workspaceRef: projectRoot,
        timeoutSeconds: 5,
      },
    });
    assert.equal(r.status, 'failed');
    assert.equal(r.exitCode, 7);
  });

  it('enforces timeout and reports status=timeout', async () => {
    const r = await runJob({
      rootDir: projectRoot,
      job: {
        jobId: 'job-timeout',
        command: 'sleep 5',
        workspaceRef: projectRoot,
        timeoutSeconds: 1,
      },
    });
    assert.equal(r.status, 'timeout');
  });

  it('refuses to run when workspaceRef sits outside allowedPaths', async () => {
    await assert.rejects(
      () => runJob({
        rootDir: projectRoot,
        job: {
          jobId: 'job-policy',
          command: 'echo x',
          workspaceRef: '/etc',
          allowedPaths: [projectRoot],
          timeoutSeconds: 5,
        },
      }),
      /outside allowedPaths/,
    );
  });

  it('emits worker.started + worker.completed trace events with the same traceId', async () => {
    const events = [];
    await runJob({
      rootDir: projectRoot,
      job: {
        jobId: 'job-trace',
        command: 'echo trace-test',
        workspaceRef: projectRoot,
        timeoutSeconds: 5,
        taskId: 'task-1',
        project: 'demo',
      },
      emitEvent: (e) => { events.push(e); },
    });
    const types = events.map((e) => e.eventType);
    assert.ok(types.includes('worker.started'));
    assert.ok(types.includes('worker.completed'));
    assert.equal(events[0].traceId, events[events.length - 1].traceId);
  });
});

describe('trace event log', () => {
  it('appends one JSON line per event under the state root\'s traces/<date>.jsonl', () => {
    const traceId = newTraceId();
    emitTraceEvent({
      rootDir: projectRoot,
      eventType: 'intake.received',
      traceId,
      metadata: { sourcePath: '/tmp/x.md' },
    });
    emitTraceEvent({
      rootDir: projectRoot,
      eventType: 'intake.triaged',
      traceId,
      metadata: { intakeType: 'bug' },
    });

    const dir = traceDir(projectRoot);
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1);
    const content = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2);
    const events = lines.map((l) => JSON.parse(l));
    assert.equal(events[0].traceId, traceId);
    assert.equal(events[1].traceId, traceId);
  });

  it('rejects unknown event types', () => {
    assert.throws(
      () => emitTraceEvent({ rootDir: projectRoot, eventType: 'made-up-event' }),
      /unknown eventType/,
    );
  });

  it('exposes the canonical event type list', () => {
    for (const expected of ['intake.received', 'worker.started', 'evidence.recorded']) {
      assert.ok(TRACE_EVENT_TYPES.includes(expected));
    }
  });

  it('skips local append when .construct/ disk budget is exceeded', () => {
    fs.writeFileSync(
      path.join(projectRoot, 'construct.config.json'),
      JSON.stringify({ version: 1, resources: { disk: { totalConstructMaxMb: 1 } } }),
    );
    fs.mkdirSync(path.join(projectRoot, '.construct', 'intake', 'processed'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.construct', 'intake', 'processed', 'p1.json'),
      'x'.repeat(1_050_000),
    );
    const event = emitTraceEvent({
      rootDir: projectRoot,
      eventType: 'intake.received',
      metadata: { blocked: true },
      env: { ...process.env, CONSTRUCT_BUDGET_WARN_IN_TEST: '1' },
    });
    assert.equal(event.budgetSkipped, true);
    const tracesDir = traceDir(projectRoot);
    if (fs.existsSync(tracesDir)) {
      const files = fs.readdirSync(tracesDir);
      for (const name of files) {
        assert.equal(fs.readFileSync(path.join(tracesDir, name), 'utf8').includes('blocked'), false);
      }
    }
  });

  it('is a no-op for telemetry when keys are not configured (solo mode default)', () => {
    _resetTelemetryClient();
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { fetchCalls += 1; return Promise.resolve({ ok: true, status: 200 }); };
    try {
      emitTraceEvent({
        rootDir: projectRoot,
        eventType: 'intake.received',
        env: {}, // no telemetry env
      });
      assert.equal(fetchCalls, 0, 'no telemetry POST when keys absent');
    } finally {
      globalThis.fetch = originalFetch;
      _resetTelemetryClient();
    }
  });

  it('exports to telemetry when CONSTRUCT_TELEMETRY_PUBLIC_KEY + SECRET_KEY are configured', async () => {
    _resetTelemetryClient();
    const captured = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      captured.push({ url, body: JSON.parse(init.body), authHeader: init.headers.Authorization });
      return { ok: true, status: 200 };
    };
    try {
      const env = {
        CONSTRUCT_TELEMETRY_URL: 'http://telemetry.test',
        CONSTRUCT_TELEMETRY_PUBLIC_KEY: 'pk-test',
        CONSTRUCT_TELEMETRY_SECRET_KEY: 'sk-test',
      };
      const traceId = newTraceId();
      emitTraceEvent({ rootDir: projectRoot, eventType: 'intake.received', traceId, env });
      emitTraceEvent({ rootDir: projectRoot, eventType: 'worker.started', traceId, env });
      emitTraceEvent({ rootDir: projectRoot, eventType: 'worker.completed', traceId, env });

      const { createIngestClient } = await import('../lib/telemetry/ingest.mjs');
      // Pull the live client off the trace module to flush its queue.
      const traceMod = await import('../lib/worker/trace.mjs');
      // The exported reset helper proves the singleton exists; force a flush
      // by re-reading the module's internal client via a probe call.
      void traceMod;
      // Wait for the debounced flush.
      await new Promise((r) => setTimeout(r, 700));

      assert.ok(captured.length >= 1, `Telemetry ingest fetch should have fired; got ${captured.length}`);
      const target = captured[0];
      assert.match(target.url, /api\/public\/ingestion/);
      assert.ok(target.authHeader.startsWith('Basic '), 'Basic auth header present');
      const batch = target.body.batch;
      assert.ok(Array.isArray(batch) && batch.length > 0);
      // First seen traceId emits a trace-create then event-creates.
      const types = batch.map((b) => b.type);
      assert.ok(types.includes('trace-create'), `expected trace-create; got ${types.join(',')}`);
      assert.ok(types.includes('event-create'), `expected event-create; got ${types.join(',')}`);
    } finally {
      globalThis.fetch = originalFetch;
      _resetTelemetryClient();
    }
  });
});

describe('evidence', () => {
  function bugGraph() {
    const triage = classifyRdIntake({
      sourcePath: '/tmp/x.md',
      extractedText: 'Stack trace bug on login redirect.',
    });
    return generateTaskGraphFromTriage({ triage, project: 'demo' });
  }

  it('evidenceFromJobResult builds the canonical record from a job result', () => {
    const ev = evidenceFromJobResult({
      jobId: 'j1',
      taskId: 'task-1',
      status: 'passed',
      exitCode: 0,
      durationMs: 120,
      command: 'npm test',
      artifacts: [{ path: '/tmp/stdout.log', kind: 'stdout' }],
      traceId: 'trace-xyz',
    });
    assert.equal(ev.taskId, 'task-1');
    assert.equal(ev.evidenceType, 'test-result');
    assert.equal(ev.status, 'passed');
    assert.match(ev.summary, /passed/);
    assert.equal(ev.traceId, 'trace-xyz');
    assert.ok(EVIDENCE_TYPES.includes(ev.evidenceType));
  });

  it('recordEvidence appends to a node and emits an evidence.recorded event', () => {
    const graph = bugGraph();
    const store = new FilesystemTaskGraphStore(projectRoot);
    store.save(graph);
    const ev = evidenceFromJobResult({ jobId: 'j', taskId: graph.nodes[0].id, status: 'passed', exitCode: 0, durationMs: 50 });
    const events = [];
    const node = recordEvidence({
      store,
      graphId: graph.id,
      nodeId: graph.nodes[0].id,
      evidence: ev,
      rootDir: projectRoot,
      emitEvent: (e) => { events.push(e); },
    });
    assert.equal(node.evidence.length, 1);
    assert.equal(events[0].eventType, 'evidence.recorded');
    const fresh = store.read(graph.id);
    assert.equal(fresh.nodes[0].evidence.length, 1);
  });

  it('blockedPacket enforces the attempted-steps contract', () => {
    assert.throws(() => blockedPacket({ taskId: 't' }), /reason is required/);
    assert.throws(() => blockedPacket({ taskId: 't', reason: 'r', attempted: [] }), /attempted step is required/);
    const p = blockedPacket({ taskId: 't', reason: 'auth-rate-limited', attempted: ['retry with backoff', 'fallback model'] });
    assert.equal(p.status, 'blocked');
    assert.equal(p.attempted.length, 2);
  });

  it('needsInputPacket enforces question + safeDefault + context', () => {
    assert.throws(() => needsInputPacket({ taskId: 't', question: 'q', context: 'c' }), /safeDefault is required/);
    assert.throws(() => needsInputPacket({ taskId: 't', question: 'q', safeDefault: null }), /context is required/);
    const p = needsInputPacket({
      taskId: 't',
      question: 'Which staging cluster should I target?',
      safeDefault: 'cluster-staging-east',
      context: 'PR-457 wants a smoke test before merge',
    });
    assert.equal(p.status, 'needs-input');
    assert.equal(p.question, 'Which staging cluster should I target?');
    assert.equal(p.safeDefault, 'cluster-staging-east');
  });
});
