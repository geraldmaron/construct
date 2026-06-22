/**
 * tests/provider-behavior-matrix.test.mjs — behavior matrix producer (construct-6zga.1.4).
 *
 * Proves the hermetic fixtures cover every capability class and conform to the
 * schema, that classification is structural (transport + measured signals, never
 * a model-name regex), that repeated probes report distributions, and that the
 * opt-in live probe is confirmation-gated, run-bounded, redacted, append-only,
 * and never ranks providers or mutates an active capability record.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as matrix from '../lib/models/behavior-matrix.mjs';
import {
  BEHAVIOR_MATRIX_SCHEMA_VERSION,
  CAPABILITY_CLASSES,
  EVIDENCE_SOURCES,
  transportForProviderGroup,
  classifyCapabilityClass,
  buildObservation,
  validateBehaviorMatrix,
  loadBehaviorMatrix,
  summarizeProbeRuns,
  runLiveBehaviorProbe,
} from '../lib/models/behavior-matrix.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'provider-behavior', 'matrix.fixture.json');

test('hermetic fixture conforms to schema and covers every capability class (AC1)', () => {
  const doc = loadBehaviorMatrix(FIXTURE);
  assert.equal(doc.version, BEHAVIOR_MATRIX_SCHEMA_VERSION);
  const { valid, errors } = validateBehaviorMatrix(doc);
  assert.ok(valid, `fixture invalid: ${errors.join('; ')}`);
  const classes = new Set(doc.observations.map((o) => o.capabilityClass));
  for (const cls of CAPABILITY_CLASSES) {
    assert.ok(classes.has(cls), `missing capability class fixture: ${cls}`);
  }
});

test('every observation carries an evidence source for the profile to declare provenance (AC4 feed)', () => {
  const doc = loadBehaviorMatrix(FIXTURE);
  for (const obs of doc.observations) {
    assert.ok(EVIDENCE_SOURCES.includes(obs.evidence.source), `bad evidence source: ${obs.evidence.source}`);
  }
});

test('classification is structural — transport + measured, no model name (AC4)', () => {
  assert.equal(classifyCapabilityClass({ transport: 'direct' }), 'hosted-direct');
  assert.equal(classifyCapabilityClass({ transport: 'routed' }), 'hosted-routed');
  assert.equal(
    classifyCapabilityClass({ transport: 'local', measured: { toolsKnown: true, tools: true, coherent: true } }),
    'local-capable',
  );
  assert.equal(
    classifyCapabilityClass({ transport: 'local', measured: { toolsKnown: true, tools: false, coherent: false } }),
    'local-constrained',
  );
  assert.equal(classifyCapabilityClass({ transport: 'local', measured: {} }), 'unknown');
  assert.equal(classifyCapabilityClass({ transport: 'unknown' }), 'unknown');
});

test('transport derives from configured provider group, mirroring provider-poll groupings', () => {
  assert.equal(transportForProviderGroup('anthropic'), 'direct');
  assert.equal(transportForProviderGroup('openai'), 'direct');
  assert.equal(transportForProviderGroup('github-copilot'), 'direct');
  assert.equal(transportForProviderGroup('openrouter'), 'routed');
  assert.equal(transportForProviderGroup('openrouter-anthropic'), 'routed');
  assert.equal(transportForProviderGroup('ollama'), 'local');
  assert.equal(transportForProviderGroup('local'), 'local');
  assert.equal(transportForProviderGroup('mystery-host'), 'unknown');
});

test('buildObservation defaults missing fields to conservative unknown/0 and freezes', () => {
  const obs = buildObservation({ transport: 'local' });
  assert.equal(obs.capabilityClass, 'unknown');
  assert.equal(obs.requestShape.system, 'unknown');
  assert.equal(obs.requestShape.toolSchemaCount, 0);
  assert.equal(obs.toolCall.supported, false);
  assert.equal(obs.contextFailureBehavior, 'unknown');
  assert.equal(obs.evidence.source, 'hermetic_fixture');
  assert.ok(Object.isFrozen(obs));
  assert.ok(Object.isFrozen(obs.requestShape));
  assert.throws(() => { obs.capabilityClass = 'hosted-direct'; });
});

test('validateBehaviorMatrix rejects malformed documents', () => {
  assert.equal(validateBehaviorMatrix(null).valid, false);
  assert.equal(validateBehaviorMatrix({ version: 0, observations: [] }).valid, false);
  assert.equal(validateBehaviorMatrix({ version: 1, observations: 'x' }).valid, false);
  const badEnum = { version: 1, observations: [{
    capabilityClass: 'turbo', transport: 'direct', adapterProtocol: 'x',
    requestShape: { system: 'accepted', toolSchemaCount: 0, toolSchemaTokenEstimate: 0 },
    toolCall: { supported: true, parseShape: 'none', resultShape: 'none' },
    cancellation: { supported: false, mechanism: 'none' },
    usage: { fields: [], cost: false },
    contextFailureBehavior: 'error', fallbackClassification: 'fatal',
    evidence: { source: 'hermetic_fixture', redacted: false, runs: 1 },
  }] };
  const res = validateBehaviorMatrix(badEnum);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('capabilityClass')));
});

test('summarizeProbeRuns reports distributions for repeated probes (AC3)', () => {
  const cap = buildObservation({ transport: 'local', capabilityClass: 'local-capable', toolCall: { supported: true } });
  const con = buildObservation({ transport: 'local', capabilityClass: 'local-constrained', toolCall: { supported: false } });
  const deterministic = summarizeProbeRuns([cap, cap, cap]);
  assert.equal(deterministic.runs, 3);
  assert.equal(deterministic.deterministic, true);
  assert.equal(deterministic.modalClass, 'local-capable');
  assert.equal(deterministic.agreement, 1);
  assert.equal(deterministic.toolSupportedRatio, 1);
  const flaky = summarizeProbeRuns([cap, con, cap]);
  assert.equal(flaky.deterministic, false);
  assert.equal(flaky.modalClass, 'local-capable');
  assert.equal(Math.round(flaky.agreement * 100) / 100, 0.67);
  assert.equal(Math.round(flaky.toolSupportedRatio * 100) / 100, 0.67);
});

test('runLiveBehaviorProbe refuses without explicit confirmation and probeFn (AC2)', async () => {
  await assert.rejects(() => runLiveBehaviorProbe('any/model', { probeFn: async () => ({}) }), /explicit operator confirmation/);
  await assert.rejects(() => runLiveBehaviorProbe('any/model', { confirm: true }), /injected probeFn/);
});

test('runLiveBehaviorProbe bounds runs, redacts metadata, appends only, distributes (AC2, AC3)', async () => {
  const sink = [];
  const probeFn = async (modelId, { run }) => ({
    requestShape: { system: 'accepted', toolSchemaCount: 4, toolSchemaTokenEstimate: 1200 },
    toolCall: { supported: true, parseShape: 'openai_function', resultShape: 'message_role_tool' },
    measured: { toolsKnown: true, tools: true, coherent: true },
    metadata: { endpoint: 'https://host/v1', apiKey: 'sk-secret', authorization: 'Bearer t', nested: { token: 'z', region: `us-${run}` } },
  });
  const result = await runLiveBehaviorProbe('local/custom-large', {
    confirm: true,
    runs: 100,
    transport: 'local',
    adapterProtocol: 'openai-compatible',
    probeFn,
    appendSink: async (rec) => sink.push(rec),
    now: () => '2026-06-21T00:00:00.000Z',
  });

  assert.equal(result.observations.length, 5, 'runs are bounded to the max');
  assert.equal(sink.length, result.observations.length, 'append-only: one sink record per run');
  assert.equal(result.observations[0].evidence.source, 'live_probe');
  assert.equal(result.observations[0].capabilityClass, 'local-capable');
  const meta = sink[0].metadata;
  assert.equal(meta.apiKey, '[redacted]');
  assert.equal(meta.authorization, '[redacted]');
  assert.equal(meta.nested.token, '[redacted]');
  assert.equal(meta.endpoint, 'https://host/v1', 'non-secret metadata is preserved');
  assert.ok(meta.nested.region.startsWith('us-'));
  assert.ok(result.distribution && result.distribution.runs === 5, 'distribution present for repeated runs');
});

test('producer neither ranks providers nor exposes promotion of active records (AC5)', () => {
  const forbidden = /rank|best|select|promote|activate|apply/i;
  for (const name of Object.keys(matrix)) {
    assert.ok(!forbidden.test(name), `unexpected ranking/promotion export: ${name}`);
  }
});
