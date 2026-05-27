/**
 * tests/telemetry-client.test.mjs — shared telemetry adapter selection and export contracts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTelemetryClient, resolveTraceBackend } from '../lib/telemetry/client.mjs';

test('resolveTraceBackend defaults to local and preserves legacy remote alias', () => {
  assert.equal(resolveTraceBackend({}), 'local');
  assert.equal(resolveTraceBackend({ CONSTRUCT_TRACE_BACKEND: 'none' }), 'none');
  assert.equal(resolveTraceBackend({ CONSTRUCT_TRACE_BACKEND: 'otel' }), 'otel');
  assert.equal(resolveTraceBackend({
    CONSTRUCT_TRACE_BACKEND: 'remote',
    CONSTRUCT_TELEMETRY_URL: 'https://lf.example.com',
    CONSTRUCT_TELEMETRY_PUBLIC_KEY: 'pk',
    CONSTRUCT_TELEMETRY_SECRET_KEY: 'sk',
  }), 'langfuse');
  assert.equal(resolveTraceBackend({
    CONSTRUCT_TRACE_BACKEND: 'remote',
    CONSTRUCT_TELEMETRY_URL: 'https://ingest.example.com',
  }), 'http');
});

test('local backend writes JSONL without remote fetch', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-telemetry-local-'));
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });
  let fetchCalls = 0;
  const client = createTelemetryClient({
    rootDir,
    env: {},
    fetchImpl: async () => { fetchCalls += 1; return { ok: true, status: 200 }; },
  });

  client.trace({ id: 'trace-local', name: 'local.trace', metadata: { agent: 'cx-test' } });
  await client.flush();

  const files = fs.readdirSync(path.join(rootDir, '.cx', 'traces'));
  assert.equal(files.length, 1);
  const [line] = fs.readFileSync(path.join(rootDir, '.cx', 'traces', files[0]), 'utf8').trim().split('\n');
  const event = JSON.parse(line);
  assert.equal(event.traceId, 'trace-local');
  assert.equal(event.telemetryType, 'trace');
  assert.equal(fetchCalls, 0);
});

test('langfuse backend posts ingestion batch and keeps local JSONL', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-telemetry-langfuse-'));
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });
  const calls = [];
  const client = createTelemetryClient({
    rootDir,
    env: {
      CONSTRUCT_TRACE_BACKEND: 'langfuse',
      CONSTRUCT_TELEMETRY_URL: 'https://lf.example.com',
      CONSTRUCT_TELEMETRY_PUBLIC_KEY: 'pk',
      CONSTRUCT_TELEMETRY_SECRET_KEY: 'sk',
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return { ok: true, status: 200 };
    },
  });

  client.event({ id: 'event-1', traceId: 'trace-1', name: 'worker.started' });
  await client.flush();

  assert.equal(calls[0].url, 'https://lf.example.com/api/public/ingestion');
  assert.ok(calls[0].init.headers.Authorization.startsWith('Basic '));
  assert.equal(calls[0].body.batch[0].type, 'event-create');
  assert.equal(fs.existsSync(path.join(rootDir, '.cx', 'traces')), true);
});

test('generic http backend posts construct ingestion payload without credentials', async () => {
  const calls = [];
  const client = createTelemetryClient({
    env: {
      CONSTRUCT_TRACE_BACKEND: 'http',
      CONSTRUCT_TELEMETRY_URL: 'https://ingest.example.com',
      CONSTRUCT_TRACE_LOCAL_ENABLED: '0',
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return { ok: true, status: 200 };
    },
  });

  client.trace({ id: 'trace-http', name: 'http.trace' });
  await client.flush();

  assert.equal(calls[0].url, 'https://ingest.example.com/ingest');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].body.batch[0].type, 'trace-create');
});

test('otel backend posts OTLP-style resourceSpans payload', async () => {
  const calls = [];
  const client = createTelemetryClient({
    env: {
      CONSTRUCT_TRACE_BACKEND: 'otel',
      CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com',
      CONSTRUCT_TRACE_LOCAL_ENABLED: '0',
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200 };
    },
  });

  client.generation({ id: 'gen-1', traceId: 'trace-otel', name: 'llm.test', model: 'test-model' });
  await client.flush();

  assert.equal(calls[0].url, 'https://otel.example.com/v1/traces');
  assert.ok(Array.isArray(calls[0].body.resourceSpans));
  assert.equal(calls[0].body.resourceSpans[0].scopeSpans[0].spans[0].name, 'llm.test');
});

test('missing remote credentials mark remote unconfigured without throwing', async () => {
  const client = createTelemetryClient({
    env: {
      CONSTRUCT_TRACE_BACKEND: 'langfuse',
      CONSTRUCT_TELEMETRY_URL: 'https://lf.example.com',
      CONSTRUCT_TRACE_LOCAL_ENABLED: '0',
    },
    fetchImpl: async () => { throw new Error('should not fetch'); },
  });
  client.trace({ id: 'trace-missing', name: 'missing' });
  await client.flush();
  assert.equal(client.remoteAvailable, false);
  assert.equal(client.remoteStatus, 'unconfigured');
});
