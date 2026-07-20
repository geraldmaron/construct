/**
 * tests/embedded-contract-parity.test.mjs — cross-surface parity and drift guards.
 *
 * The whole point of the shared core is that CLI, MCP, and SDK return the same
 * contract. These tests prove the MCP and SDK surfaces delegate to one core
 * (identical envelopes modulo the surface label and volatile fields), that every
 * surface stamps a valid contract version, and that no contract leaks a
 * credential value when one is present in the environment.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import * as sdk from '../lib/embedded-contract/index.mjs';
import { modelResolve, triageRecommend, procedureInvoke, capabilityDescribe, executionResolve } from '../lib/mcp/tools/embedded-contract.mjs';
import { CONTRACT_VERSION } from '../lib/embedded-contract/contract-version.mjs';

const VOLATILE_ENVELOPE = new Set(['generatedAt', 'surface']);
const VOLATILE_DATA = new Set(['traceId', 'procedureRunId', 'requestedTier']);

function normalize(envelope) {
  const out = {};
  for (const [k, v] of Object.entries(envelope)) {
    if (VOLATILE_ENVELOPE.has(k)) continue;
    if (k === 'data' && v && typeof v === 'object') {
      const data = {};
      for (const [dk, dv] of Object.entries(v)) {
        if (VOLATILE_DATA.has(dk)) continue;
        if (dk === 'modelResolution' && dv && typeof dv === 'object') {
          const { requestedTier, ...restModel } = dv;
          data[dk] = restModel;
        } else if (dk === 'evidence' && dv && typeof dv === 'object') {
          const { traceId, ...rest } = dv;
          data[dk] = rest;
        } else {
          data[dk] = dv;
        }
      }
      out[k] = data;
    } else {
      out[k] = v;
    }
  }
  return out;
}

test('model resolution: MCP and SDK return identical envelopes (one core)', () => {
  const s = sdk.resolveEmbeddedModel({ hostModel: 'anthropic/claude-sonnet-4-6' });
  const m = modelResolve({ host_model: 'anthropic/claude-sonnet-4-6' });
  assert.equal(s.surface, 'sdk');
  assert.equal(m.surface, 'mcp');
  assert.deepEqual(normalize(s), normalize(m));
});

test('triage: MCP and SDK return identical envelopes', async () => {
  const input = 'Bug: throws an error with a stack trace, failing test in production';
  assert.deepEqual(normalize(sdk.recommendPlan({ input })), normalize(await triageRecommend({ input })));
});

test('capability: MCP and SDK return identical envelopes', () => {
  assert.deepEqual(normalize(sdk.describeCapabilities()), normalize(capabilityDescribe({})));
});

test('Procedure invocation: MCP and SDK return identical envelopes (volatile ids excluded)', async () => {
  const s = await sdk.invokeProcedure({ procedureId: 'prd-draft', approvalMode: 'proposal-only' });
  const m = await procedureInvoke({ procedure_id: 'prd-draft', approval_mode: 'proposal-only' });
  assert.deepEqual(normalize(s), normalize(m));
});

test('execution resolution: MCP and SDK return identical envelopes (one core)', () => {
  const req = { procedureId: 'evidence-ingest', requestedStrategy: 'orchestrated', hostModel: 'anthropic/claude-sonnet-4-6' };
  const s = sdk.resolveExecution(req);
  const m = executionResolve({ procedure_id: 'evidence-ingest', requested_strategy: 'orchestrated', host_model: 'anthropic/claude-sonnet-4-6' });
  assert.equal(s.surface, 'sdk');
  assert.equal(m.surface, 'mcp');
  assert.deepEqual(normalize(s), normalize(m));
});

test('every surface stamps the same valid contract version', async () => {
  const envelopes = [
    sdk.resolveEmbeddedModel({ requestedTier: 'fast' }),
    modelResolve({ requested_tier: 'fast' }),
    sdk.recommendPlan({ input: 'x' }),
    sdk.describeCapabilities(),
    sdk.resolveExecution({ procedureId: 'evidence-ingest', requestedStrategy: 'auto' }),
    executionResolve({ procedure_id: 'evidence-ingest', requested_strategy: 'auto' }),
    await sdk.invokeProcedure({ procedureId: 'evidence-ingest', approvalMode: 'proposal-only' }),
  ];
  for (const env of envelopes) {
    assert.equal(env.contractVersion, CONTRACT_VERSION);
    assert.match(env.contractVersion, /^\d+\.\d+\.\d+$/);
  }
});

test('no contract leaks a credential value present in the environment', async () => {
  // The redaction guard keys off the env variable NAME (a known credential key),
  // not the value format, so a plain canary value exercises it fully.
  const canary = 'leak-canary-value-must-not-appear-0001';
  const env = { ANTHROPIC_API_KEY: canary, OPENAI_API_KEY: canary };
  const envelopes = [
    sdk.resolveEmbeddedModel({ hostModel: 'anthropic/claude-sonnet-4-6' }, { env }),
    sdk.recommendPlan({ input: 'Bug: throws an error' }, { env }),
    sdk.describeCapabilities({ env }),
    sdk.resolveExecution({ procedureId: 'evidence-ingest', requestedStrategy: 'orchestrated', hostModel: 'anthropic/claude-sonnet-4-6' }, { env }),
    await sdk.invokeProcedure({ procedureId: 'evidence-ingest', approvalMode: 'proposal-only' }, { env }),
  ];
  for (const envelope of envelopes) {
    assert.equal(JSON.stringify(envelope).includes(canary), false, `${envelope.surface} contract leaked the canary`);
  }
});
