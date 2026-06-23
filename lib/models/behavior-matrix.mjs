/**
 * lib/models/behavior-matrix.mjs — provider/model behavior matrix (construct-6zga.1.4).
 *
 * The baseline evidence producer for the ExecutionCapabilityProfile
 * (construct-6zga.1.8). It records measured execution behavior keyed by a
 * structural capability CLASS — hosted-direct, hosted-routed, local-constrained,
 * local-capable, unknown — not by vendor name. The class is derived only from the
 * configured provider's transport (a configuration fact) plus measured signals;
 * capability VALUES (tool support, context behavior, usage fields) come only from
 * evidence, never from a model-name regex. Every observation carries an evidence
 * provenance (hermetic_fixture | live_probe | provider_metadata | operator_override)
 * so the profile can declare where each field came from.
 *
 * Hermetic fixtures are the CI source of truth. Live probing is opt-in only: it
 * requires explicit operator confirmation, is run-bounded, redacts metadata, and
 * appends evidence to a separate log — it never ranks providers and never mutates
 * the active capability record. Reference shape: schemas/provider-behavior-matrix.schema.json.
 */
import { readFileSync } from 'node:fs';

export const BEHAVIOR_MATRIX_SCHEMA_VERSION = 1;

export const CAPABILITY_CLASSES = Object.freeze([
  'hosted-direct',
  'hosted-routed',
  'local-constrained',
  'local-capable',
  'unknown',
]);

export const TRANSPORTS = Object.freeze(['direct', 'routed', 'local', 'unknown']);

export const EVIDENCE_SOURCES = Object.freeze([
  'hermetic_fixture',
  'live_probe',
  'provider_metadata',
  'operator_override',
]);

const SYSTEM_ACCEPTANCE = Object.freeze(['accepted', 'rejected', 'ignored', 'unknown']);
const TOOL_PARSE_SHAPES = Object.freeze(['native_tool_use', 'openai_function', 'none', 'unknown']);
const TOOL_RESULT_SHAPES = Object.freeze(['tool_result_block', 'message_role_tool', 'none', 'unknown']);
const CANCEL_MECHANISMS = Object.freeze(['abort_signal', 'none', 'unknown']);
const CONTEXT_FAILURES = Object.freeze(['error', 'truncate', 'silent_drop', 'unknown']);
const FALLBACK_CLASSES = Object.freeze(['retryable', 'fatal', 'rate_limited', 'model_unavailable', 'unknown']);

const MAX_PROBE_RUNS = 5;
const SECRET_KEY_RE = /(api[_-]?key|secret|token|authorization|password|bearer)/i;

// Transport is the provider's structural topology, taken from the configured
// provider group (the catalog source of truth in lib/model-router.mjs), mirroring
// providerGroupId in lib/models/provider-poll.mjs. It is not a capability guess:
// the aggregator routes a model, a local runtime hosts it, anything else is a
// direct hosted API. Unknown groups stay 'unknown' rather than assuming direct.

const LOCAL_GROUPS = Object.freeze(new Set(['ollama', 'local']));
const DIRECT_GROUPS = Object.freeze(new Set(['anthropic', 'openai', 'github-copilot']));

export function transportForProviderGroup(groupId) {
  const gid = String(groupId || '');
  if (gid.startsWith('openrouter')) return 'routed';
  if (LOCAL_GROUPS.has(gid)) return 'local';
  if (DIRECT_GROUPS.has(gid)) return 'direct';
  return 'unknown';
}

// Class is structural for hosted transports; for local runtimes it splits on
// measured signals only. Unmeasured local models are 'unknown', never assumed
// capable — the conservative default the profile relies on.

export function classifyCapabilityClass({ transport, measured = {} } = {}) {
  if (transport === 'direct') return 'hosted-direct';
  if (transport === 'routed') return 'hosted-routed';
  if (transport === 'local') {
    if (measured.toolsKnown !== true || typeof measured.coherent !== 'boolean') return 'unknown';
    return measured.tools === true && measured.coherent === true ? 'local-capable' : 'local-constrained';
  }
  return 'unknown';
}

function inEnum(values, value) {
  return values.includes(value);
}

function defaultedString(value, allowed, fallback = 'unknown') {
  return inEnum(allowed, value) ? value : fallback;
}

function nonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Normalize a raw measurement into a frozen, schema-shaped observation. Missing
 * fields collapse to conservative 'unknown'/0 defaults rather than being invented.
 */
export function buildObservation(input = {}) {
  const requestShape = input.requestShape || {};
  const toolCall = input.toolCall || {};
  const cancellation = input.cancellation || {};
  const usage = input.usage || {};
  const evidence = input.evidence || {};

  const observation = {
    capabilityClass: defaultedString(input.capabilityClass, CAPABILITY_CLASSES),
    transport: defaultedString(input.transport, TRANSPORTS),
    adapterProtocol: typeof input.adapterProtocol === 'string' && input.adapterProtocol
      ? input.adapterProtocol
      : 'unknown',
    responseModelId: typeof input.responseModelId === 'string' ? input.responseModelId : null,
    requestShape: Object.freeze({
      system: defaultedString(requestShape.system, SYSTEM_ACCEPTANCE),
      toolSchemaCount: nonNegativeInt(requestShape.toolSchemaCount),
      toolSchemaTokenEstimate: nonNegativeInt(requestShape.toolSchemaTokenEstimate),
    }),
    toolCall: Object.freeze({
      supported: toolCall.supported === true,
      parseShape: defaultedString(toolCall.parseShape, TOOL_PARSE_SHAPES),
      resultShape: defaultedString(toolCall.resultShape, TOOL_RESULT_SHAPES),
    }),
    cancellation: Object.freeze({
      supported: cancellation.supported === true,
      mechanism: defaultedString(cancellation.mechanism, CANCEL_MECHANISMS),
    }),
    usage: Object.freeze({
      fields: Array.isArray(usage.fields) ? Object.freeze(usage.fields.filter((f) => typeof f === 'string')) : Object.freeze([]),
      cost: usage.cost === true,
    }),
    contextFailureBehavior: defaultedString(input.contextFailureBehavior, CONTEXT_FAILURES),
    fallbackClassification: defaultedString(input.fallbackClassification, FALLBACK_CLASSES),
    evidence: Object.freeze({
      source: defaultedString(evidence.source, EVIDENCE_SOURCES, 'hermetic_fixture'),
      capturedAt: typeof evidence.capturedAt === 'string' ? evidence.capturedAt : null,
      redacted: evidence.redacted === true,
      runs: Number.isInteger(evidence.runs) && evidence.runs >= 1 ? evidence.runs : 1,
      distribution: evidence.distribution && typeof evidence.distribution === 'object' ? evidence.distribution : null,
    }),
  };
  return Object.freeze(observation);
}

function validateObservation(obs, index, errors) {
  const at = `observations[${index}]`;
  if (!obs || typeof obs !== 'object') {
    errors.push(`${at}: not an object`);
    return;
  }
  if (!inEnum(CAPABILITY_CLASSES, obs.capabilityClass)) errors.push(`${at}.capabilityClass invalid: ${obs.capabilityClass}`);
  if (!inEnum(TRANSPORTS, obs.transport)) errors.push(`${at}.transport invalid: ${obs.transport}`);
  if (typeof obs.adapterProtocol !== 'string' || !obs.adapterProtocol) errors.push(`${at}.adapterProtocol missing`);
  const rs = obs.requestShape || {};
  if (!inEnum(SYSTEM_ACCEPTANCE, rs.system)) errors.push(`${at}.requestShape.system invalid: ${rs.system}`);
  if (!Number.isInteger(rs.toolSchemaCount) || rs.toolSchemaCount < 0) errors.push(`${at}.requestShape.toolSchemaCount invalid`);
  if (!Number.isInteger(rs.toolSchemaTokenEstimate) || rs.toolSchemaTokenEstimate < 0) errors.push(`${at}.requestShape.toolSchemaTokenEstimate invalid`);
  const tc = obs.toolCall || {};
  if (typeof tc.supported !== 'boolean') errors.push(`${at}.toolCall.supported invalid`);
  if (!inEnum(TOOL_PARSE_SHAPES, tc.parseShape)) errors.push(`${at}.toolCall.parseShape invalid: ${tc.parseShape}`);
  if (!inEnum(TOOL_RESULT_SHAPES, tc.resultShape)) errors.push(`${at}.toolCall.resultShape invalid: ${tc.resultShape}`);
  const cancel = obs.cancellation || {};
  if (typeof cancel.supported !== 'boolean') errors.push(`${at}.cancellation.supported invalid`);
  if (!inEnum(CANCEL_MECHANISMS, cancel.mechanism)) errors.push(`${at}.cancellation.mechanism invalid: ${cancel.mechanism}`);
  const usage = obs.usage || {};
  if (!Array.isArray(usage.fields)) errors.push(`${at}.usage.fields invalid`);
  if (typeof usage.cost !== 'boolean') errors.push(`${at}.usage.cost invalid`);
  if (!inEnum(CONTEXT_FAILURES, obs.contextFailureBehavior)) errors.push(`${at}.contextFailureBehavior invalid: ${obs.contextFailureBehavior}`);
  if (!inEnum(FALLBACK_CLASSES, obs.fallbackClassification)) errors.push(`${at}.fallbackClassification invalid: ${obs.fallbackClassification}`);
  const ev = obs.evidence || {};
  if (!inEnum(EVIDENCE_SOURCES, ev.source)) errors.push(`${at}.evidence.source invalid: ${ev.source}`);
  if (typeof ev.redacted !== 'boolean') errors.push(`${at}.evidence.redacted invalid`);
  if (!Number.isInteger(ev.runs) || ev.runs < 1) errors.push(`${at}.evidence.runs invalid`);
}

/**
 * Hand-rolled validator (no ajv — Construct stays dependency-free at startup).
 * Returns { valid, errors } against schemas/provider-behavior-matrix.schema.json.
 */
export function validateBehaviorMatrix(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return { valid: false, errors: ['document is not an object'] };
  if (!Number.isInteger(doc.version) || doc.version < 1) errors.push('version must be an integer >= 1');
  if (!Array.isArray(doc.observations)) {
    errors.push('observations must be an array');
    return { valid: false, errors };
  }
  doc.observations.forEach((obs, i) => validateObservation(obs, i, errors));
  return { valid: errors.length === 0, errors };
}

export function loadBehaviorMatrix(filePath) {
  const doc = JSON.parse(readFileSync(filePath, 'utf8'));
  const { valid, errors } = validateBehaviorMatrix(doc);
  if (!valid) throw new Error(`invalid behavior matrix ${filePath}: ${errors.join('; ')}`);
  return doc;
}

// Repeated probes of one target rarely agree on every field, so the matrix
// reports a distribution rather than a single verdict. Agreement is the share of
// runs at the modal class; deterministic means every run agreed.

export function summarizeProbeRuns(runs) {
  const list = Array.isArray(runs) ? runs.filter(Boolean) : [];
  if (!list.length) return { runs: 0, deterministic: true, classCounts: {}, modalClass: 'unknown', agreement: 0, toolSupportedRatio: 0 };
  const classCounts = {};
  let toolSupported = 0;
  for (const obs of list) {
    const cls = inEnum(CAPABILITY_CLASSES, obs.capabilityClass) ? obs.capabilityClass : 'unknown';
    classCounts[cls] = (classCounts[cls] || 0) + 1;
    if (obs.toolCall?.supported === true) toolSupported += 1;
  }
  let modalClass = 'unknown';
  let modalCount = -1;
  for (const [cls, count] of Object.entries(classCounts)) {
    if (count > modalCount) { modalClass = cls; modalCount = count; }
  }
  return {
    runs: list.length,
    deterministic: Object.keys(classCounts).length === 1,
    classCounts,
    modalClass,
    agreement: modalCount / list.length,
    toolSupportedRatio: toolSupported / list.length,
  };
}

function redactMetadata(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SECRET_KEY_RE.test(key)) { out[key] = '[redacted]'; continue; }
    out[key] = typeof value === 'object' && value !== null ? redactMetadata(value) : value;
  }
  return out;
}

/**
 * Opt-in live behavior probe (construct-6zga.1.4 acceptance #2).
 *
 * Requires explicit operator confirmation, bounds the run count, redacts captured
 * metadata, and appends each observation to an append-only sink. It returns
 * evidence and a distribution; it never ranks providers and never writes to the
 * active capability record — promotion is the operator-gated job of the profile
 * inventory (construct-6zga.1.8), not this producer.
 *
 * probeFn is injected so the producer stays provider-agnostic and CI-hermetic;
 * a real run wires it to the W1 probeProviderCapabilities adapter path.
 */
export async function runLiveBehaviorProbe(modelId, {
  confirm = false,
  runs = 1,
  transport = 'unknown',
  adapterProtocol = 'unknown',
  probeFn,
  appendSink,
  now = () => new Date().toISOString(),
} = {}) {
  if (confirm !== true) {
    throw new Error('live behavior probe requires explicit operator confirmation (opts.confirm === true)');
  }
  if (typeof probeFn !== 'function') {
    throw new Error('live behavior probe requires an injected probeFn (provider-agnostic, opt-in)');
  }
  const boundedRuns = Math.max(1, Math.min(MAX_PROBE_RUNS, Number.isInteger(runs) ? runs : 1));
  const observations = [];
  for (let i = 0; i < boundedRuns; i += 1) {
    const raw = await probeFn(modelId, { run: i });
    const measured = raw?.measured || {};
    const observation = buildObservation({
      ...raw,
      transport,
      adapterProtocol,
      capabilityClass: classifyCapabilityClass({ transport, measured }),
      evidence: {
        source: 'live_probe',
        capturedAt: now(),
        redacted: true,
        runs: 1,
        distribution: null,
      },
    });
    const record = Object.freeze({ modelId, metadata: Object.freeze(redactMetadata(raw?.metadata)), observation });
    if (typeof appendSink === 'function') await appendSink(record);
    observations.push(observation);
  }
  return {
    modelId,
    observations,
    distribution: boundedRuns > 1 ? summarizeProbeRuns(observations) : null,
  };
}
