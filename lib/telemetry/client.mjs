/**
 * lib/telemetry/client.mjs — shared local-first telemetry adapter.
 *
 * Local JSONL trace capture is the default. Remote export is opt-in through
 * CONSTRUCT_TRACE_BACKEND and never throws into callers.
 */
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createIngestClient } from './ingest.mjs';
import { ensureCxDir } from '../project-init-shared.mjs';

const DEFAULT_MAX_BATCH = 50;

export const TRACE_BACKENDS = new Set(['local', 'langfuse', 'http', 'otel', 'none']);

function cleanUrl(value = '') {
  return String(value || '').replace(/\/$/, '');
}

function inferRemoteBackend(env) {
  const url = cleanUrl(env.CONSTRUCT_TELEMETRY_URL);
  const hasKeys = Boolean(env.CONSTRUCT_TELEMETRY_PUBLIC_KEY && env.CONSTRUCT_TELEMETRY_SECRET_KEY);
  if (!url) return 'local';
  return hasKeys ? 'langfuse' : 'http';
}

export function resolveTraceBackend(env = process.env) {
  const raw = String(env.CONSTRUCT_TRACE_BACKEND || '').trim().toLowerCase();
  if (!raw) return inferRemoteBackend(env);
  if (raw === 'remote' || raw === 'telemetry') return inferRemoteBackend(env);
  if (raw === 'off') return 'none';
  return TRACE_BACKENDS.has(raw) ? raw : 'local';
}

export function telemetryProviderLabel(env = process.env) {
  return env.CONSTRUCT_TELEMETRY_PROVIDER || resolveTraceBackend(env);
}

function resolveProjectRoot({ rootDir, env = process.env } = {}) {
  return rootDir || env.CX_TOOLKIT_DIR || env.PWD || process.cwd();
}

function localTraceEnabled(env = process.env) {
  return env.CONSTRUCT_TRACE_LOCAL_ENABLED !== '0';
}

function traceShard() {
  return new Date().toISOString().slice(0, 10);
}

function appendLocalTelemetry(type, body, { rootDir, env = process.env, onError = () => {} } = {}) {
  if (!localTraceEnabled(env)) return;
  const projectRoot = resolveProjectRoot({ rootDir, env });
  const dir = join(projectRoot, '.cx', 'traces');
  try {
    if (!existsSync(dir)) {
      ensureCxDir(projectRoot);
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(join(dir, `${traceShard()}.jsonl`), `${JSON.stringify({
      traceId: body?.traceId || body?.id || randomUUID(),
      spanId: body?.id || randomUUID(),
      eventType: `telemetry.${type}`,
      telemetryType: type,
      project: body?.metadata?.project || body?.project || null,
      role: body?.metadata?.agent || body?.metadata?.agentName || body?.name || null,
      metadata: body?.metadata || {},
      input: body?.input,
      output: body?.output,
      createdAt: body?.timestamp || body?.startTime || new Date().toISOString(),
    })}\n`, 'utf8');
  } catch (err) {
    onError(err);
  }
}

function buildOtlpPayload(batch) {
  return {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'construct' } },
        ],
      },
      scopeSpans: [{
        scope: { name: 'construct.telemetry' },
        spans: batch.map((item) => {
          const body = item.body || {};
          const startedAt = Date.parse(body.startTime || body.timestamp || item.timestamp || new Date().toISOString());
          const endedAt = Date.parse(body.endTime || body.startTime || body.timestamp || item.timestamp || new Date().toISOString());
          return {
            traceId: String(body.traceId || body.id || item.id).replace(/[^a-fA-F0-9]/g, '').padEnd(32, '0').slice(0, 32),
            spanId: String(body.id || item.id).replace(/[^a-fA-F0-9]/g, '').padEnd(16, '0').slice(0, 16),
            name: body.name || item.type,
            kind: 1,
            startTimeUnixNano: String(Math.max(0, startedAt) * 1_000_000),
            endTimeUnixNano: String(Math.max(0, endedAt) * 1_000_000),
            attributes: [
              { key: 'construct.telemetry.type', value: { stringValue: item.type } },
              ...(body.model ? [{ key: 'llm.model_name', value: { stringValue: String(body.model) } }] : []),
            ],
          };
        }),
      }],
    }],
  };
}

function createRemoteClient({ backend, env, fetchImpl, onError }) {
  if (backend === 'local' || backend === 'none') return null;
  if (backend === 'otel') {
    const endpoint = cleanUrl(env.CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT);
    return createIngestClient({
      baseUrl: endpoint,
      endpointPath: endpoint.endsWith('/v1/traces') ? '' : '/v1/traces',
      authMode: 'none',
      payloadBuilder: buildOtlpPayload,
      fetchImpl,
      onError,
      maxBatch: DEFAULT_MAX_BATCH,
    });
  }
  if (backend === 'http') {
    return createIngestClient({
      baseUrl: cleanUrl(env.CONSTRUCT_TELEMETRY_URL),
      endpointPath: '/ingest',
      authMode: 'none',
      fetchImpl,
      onError,
      maxBatch: DEFAULT_MAX_BATCH,
    });
  }
  return createIngestClient({
    baseUrl: cleanUrl(env.CONSTRUCT_TELEMETRY_URL),
    publicKey: env.CONSTRUCT_TELEMETRY_PUBLIC_KEY,
    secretKey: env.CONSTRUCT_TELEMETRY_SECRET_KEY,
    fetchImpl,
    onError,
    maxBatch: DEFAULT_MAX_BATCH,
  });
}

export function createTelemetryClient({
  env = process.env,
  rootDir,
  fetchImpl = globalThis.fetch,
  onError = () => {},
  localWrites = true,
} = {}) {
  const backend = resolveTraceBackend(env);
  const remote = createRemoteClient({ backend, env, fetchImpl, onError });
  const localAvailable = localWrites && localTraceEnabled(env);
  const remoteAvailable = Boolean(remote?.available);

  function emit(type, body) {
    if (!body) return;
    if (localWrites) appendLocalTelemetry(type, body, { rootDir, env, onError });
    if (!remoteAvailable) return;
    try {
      remote[type]?.(body);
    } catch (err) {
      onError(err);
    }
  }

  return {
    backend,
    provider: telemetryProviderLabel(env),
    available: localAvailable || remoteAvailable,
    localAvailable,
    remoteAvailable,
    remoteStatus: remoteAvailable ? 'configured' : backend === 'local' || backend === 'none' ? backend : 'unconfigured',
    trace: (body) => emit('trace', body),
    traceUpdate: (body) => emit('traceUpdate', body),
    generation: (body) => emit('generation', body),
    generationUpdate: (body) => emit('generationUpdate', body),
    span: (body) => emit('span', body),
    spanUpdate: (body) => emit('spanUpdate', body),
    event: (body) => emit('event', body),
    score: (body) => emit('score', body),
    async flush() {
      if (remote?.flush) await remote.flush();
    },
    queueSize: () => remote?.queueSize?.() ?? 0,
  };
}
