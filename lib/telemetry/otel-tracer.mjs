/**
 * lib/telemetry/otel-tracer.mjs — OTel API tracer factory with graceful no-op fallback.
 *
 * When @opentelemetry/api is installed and an SDK is configured, returns a real
 * TracerProvider-backed tracer.  When the SDK is absent (default solo install),
 * returns a no-op tracer so call sites compile and run without change.
 *
 * GenAI attribute constants follow the stable OTel GenAI semantic conventions
 * (gen_ai_latest_experimental opt-in, May 2026).  Use GenAiAttrs.* at every
 * LLM and embedding call site.
 *
 * W3C trace context propagation: inject() / extract() use the standard
 * W3CTraceContextPropagator.  MCP callers inject into params._meta;
 * MCP handlers extract from params._meta to create child spans.
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT   — enables real SDK + OTLP HTTP export
 *   OTEL_SERVICE_NAME              — overrides default 'construct'
 *   OTEL_SEMCONV_STABILITY_OPT_IN — 'gen_ai_latest_experimental' (default)
 *
 * Disable with CONSTRUCT_OTEL=off.
 */

// GenAI semantic convention attribute names (stable + experimental opt-in).
export const GenAiAttrs = {
  SYSTEM:                'gen_ai.system',
  OPERATION_NAME:        'gen_ai.operation.name',
  REQUEST_MODEL:         'gen_ai.request.model',
  RESPONSE_MODEL:        'gen_ai.response.model',
  USAGE_INPUT_TOKENS:    'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS:   'gen_ai.usage.output_tokens',
  RESPONSE_FINISH_REASONS: 'gen_ai.response.finish_reasons',
  TOOL_NAME:             'gen_ai.tool.name',
  TOOL_CALL_ID:          'gen_ai.tool.call.id',

  // MCP-specific (SEP-414 / OTel MCP semconv)
  MCP_METHOD:            'mcp.method.name',
  MCP_TRANSPORT:         'mcp.transport',
};

// W3C propagation header names used in MCP params._meta.
export const TRACEPARENT_KEY = 'traceparent';
export const TRACESTATE_KEY  = 'tracestate';

// Singleton holder — module-level so `getTracer` always returns the same instance.
let _tracer = null;
let _propagator = null;
let _sdkAvailable = null;

async function _tryLoadSdk() {
  if (_sdkAvailable !== null) return _sdkAvailable;
  try {
    const api = await import('@opentelemetry/api');
    _tracer = api.trace.getTracer(
      process.env.OTEL_SERVICE_NAME || 'construct',
      process.env.npm_package_version || '0.0.0',
    );
    _propagator = api.propagation;
    _sdkAvailable = true;
  } catch {
    _sdkAvailable = false;
  }
  return _sdkAvailable;
}

// Synchronous no-op span — safe to call .setAttribute, .setStatus, .end, etc.
const _noopSpan = {
  setAttribute: () => _noopSpan,
  setAttributes: () => _noopSpan,
  setStatus: () => _noopSpan,
  addEvent: () => _noopSpan,
  recordException: () => _noopSpan,
  end: () => {},
  isRecording: () => false,
  spanContext: () => ({ traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 0 }),
};

const _noopTracer = {
  startSpan: () => _noopSpan,
  startActiveSpan: (_name, optsFnOrFn, ctxOrFn, fn) => {
    const callback = fn || ctxOrFn || optsFnOrFn;
    if (typeof callback === 'function') return callback(_noopSpan);
  },
};

const _noopPropagator = {
  inject: () => {},
  extract: (_ctx) => _ctx,
  fields: () => [],
};

/**
 * Return the active OTel tracer (real or no-op).  Call sites import this once.
 * If CONSTRUCT_OTEL=off or SDK not installed, always returns the no-op tracer.
 */
export async function getTracer() {
  if (process.env.CONSTRUCT_OTEL === 'off') return _noopTracer;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return _noopTracer;
  await _tryLoadSdk();
  return _tracer || _noopTracer;
}

/** Synchronous version — returns no-op immediately if SDK not yet loaded. */
export function getTracerSync() {
  return _tracer || _noopTracer;
}

/** Return the propagator for W3C trace context injection/extraction. */
export async function getPropagator() {
  if (process.env.CONSTRUCT_OTEL === 'off') return _noopPropagator;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return _noopPropagator;
  await _tryLoadSdk();
  return _propagator || _noopPropagator;
}

/**
 * Inject W3C trace context into a metadata dict (used for MCP params._meta).
 * Returns the same dict mutated in place.
 */
export async function injectTraceContext(meta = {}) {
  const propagator = await getPropagator();
  propagator.inject({}, meta, { set: (carrier, key, val) => { carrier[key] = val; } });
  return meta;
}

/**
 * Extract W3C trace context from a metadata dict (used in MCP handlers).
 * Returns an OTel Context object, or null when SDK is absent.
 */
export async function extractTraceContext(meta = {}) {
  if (_sdkAvailable === false) return null;
  const propagator = await getPropagator();
  let ctx = null;
  try {
    const api = await import('@opentelemetry/api');
    ctx = propagator.extract(api.ROOT_CONTEXT, meta, {
      get: (carrier, key) => carrier[key],
      keys: (carrier) => Object.keys(carrier),
    });
  } catch { /* SDK not available */ }
  return ctx;
}

/**
 * Convenience wrapper: start a gen_ai.client span, run fn(span), end the span.
 * Attributes passed at start; fn receives the span for dynamic attrs.
 *
 * @param {string} operationName  e.g. 'chat', 'embeddings'
 * @param {object} attrs          Initial GenAiAttrs.*
 * @param {function} fn           (span) => result — may be async
 * @param {object|null} [parentCtx] OTel Context from extractTraceContext (MCP handlers)
 */
export async function withGenAiSpan(operationName, attrs, fn, parentCtx = null) {
  const tracer = await getTracer();
  const spanName = `gen_ai ${operationName}`;

  const startOpts = {
    kind: 1 /* SpanKind.CLIENT */,
    attributes: {
      [GenAiAttrs.OPERATION_NAME]: operationName,
      ...attrs,
    },
  };
  if (parentCtx) startOpts.parent = parentCtx;

  let span = _noopSpan;
  try {
    span = tracer.startSpan ? tracer.startSpan(spanName, startOpts) : _noopSpan;
  } catch { /* no-op path */ }

  const t0 = Date.now();
  try {
    const result = await fn(span);
    span.setAttribute('construct.duration_ms', Date.now() - t0);
    span.setStatus({ code: 1 /* OK */ });
    return result;
  } catch (err) {
    span.setStatus({ code: 2 /* ERROR */, message: err?.message });
    span.recordException(err);
    throw err;
  } finally {
    span.end();
  }
}
