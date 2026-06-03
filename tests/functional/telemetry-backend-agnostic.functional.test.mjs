/**
 * tests/functional/telemetry-backend-agnostic.functional.test.mjs
 *
 * Pins the telemetry data plane as vendor-agnostic (see audit §12): the trace
 * backend resolves to a vendor-neutral default and supports OpenTelemetry (OTLP)
 * as a first-class backend, with Langfuse selected only when Langfuse-style keys
 * are present. Also guards the restored, vendor-neutral login bridge
 * (lib/server/telemetry-login.mjs), which the server now wires for any backend
 * configured via CONSTRUCT_TELEMETRY_URL.
 *
 * Hermetic: pure functions + a stubbed fetch/res. No network, no model.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = join(REPO_ROOT, 'lib');

test('trace backend is agnostic — local default, OTel first-class, Langfuse only with keys', async () => {
  const { resolveTraceBackend, createTelemetryClient, TRACE_BACKENDS } =
    await import(`${LIB}/telemetry/client.mjs`);

  assert.ok(TRACE_BACKENDS.has('otel'), 'otel is a supported backend');
  assert.equal(resolveTraceBackend({}), 'local', 'default backend is vendor-neutral local');
  assert.equal(
    resolveTraceBackend({ CONSTRUCT_TELEMETRY_URL: 'http://collector' }), 'http',
    'a bare telemetry URL infers the generic http backend, not Langfuse',
  );
  assert.equal(
    resolveTraceBackend({
      CONSTRUCT_TELEMETRY_URL: 'http://lf', CONSTRUCT_TELEMETRY_PUBLIC_KEY: 'pk',
      CONSTRUCT_TELEMETRY_SECRET_KEY: 'sk',
    }), 'langfuse',
    'Langfuse is selected only when Langfuse-style keys are present',
  );

  const otelEnv = {
    CONSTRUCT_TRACE_BACKEND: 'otel',
    CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/v1/traces',
  };
  assert.equal(resolveTraceBackend(otelEnv), 'otel', 'CONSTRUCT_TRACE_BACKEND=otel resolves to otel');
  const client = createTelemetryClient({ env: otelEnv, onError: () => {} });
  assert.equal(client.backend, 'otel', 'the client uses the otel backend');
  assert.equal(client.remoteStatus, 'configured', 'the OTLP client is configured for export');
});

test('vendor-neutral telemetry login bridge renders for a configured URL and 503s without one', async () => {
  const { handleTelemetryLogin } = await import(`${LIB}/server/telemetry-login.mjs`);

  function fakeRes() {
    return {
      statusCode: null, body: '',
      writeHead(code) { this.statusCode = code; },
      end(s = '') { this.body = s; },
    };
  }

  const noUrl = fakeRes();
  await handleTelemetryLogin({}, noUrl, { baseUrl: '' });
  assert.equal(noUrl.statusCode, 503, 'no configured telemetry URL → 503');

  const okRes = fakeRes();
  const stubFetch = async () => ({ ok: true, json: async () => ({ csrfToken: 'tok-123' }) });
  await handleTelemetryLogin({}, okRes, {
    baseUrl: 'http://telemetry.example', email: 'u@example.com', password: 'pw', fetchFn: stubFetch,
  });
  assert.equal(okRes.statusCode, 200, 'a configured URL yields the auto-submit form');
  assert.match(okRes.body, /tok-123/, 'the fetched CSRF token is embedded in the form');
  assert.match(okRes.body, /telemetry\.example/, 'the form posts to the configured backend, not a hard-coded vendor');
});
