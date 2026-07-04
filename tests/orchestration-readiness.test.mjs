/**
 * tests/orchestration-readiness.test.mjs — typed orchestration readiness contract.
 *
 * Covers the shared, host-agnostic readiness core: attached sessions, missing
 * tools, unattached host sessions, failed local probes, redacted diagnostic
 * bundles, and local readiness telemetry.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildOrchestrationReadiness,
  recordOrchestrationReadinessEvent,
  summarizeOrchestrationReadiness,
} from '../lib/orchestration/readiness.mjs';
import { doctorRoot } from '../lib/config/xdg.mjs';

// A resolvable model on the env is required for a PASS verdict: attachment
// alone does not imply orchestration_run would actually serve on this env.
const RESOLVABLE_ENV = {
  CX_MODEL_REASONING: 'anthropic/claude-sonnet-4-6',
  CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
  CX_MODEL_FAST: 'anthropic/claude-sonnet-4-6',
  ANTHROPIC_API_KEY: 'sk-test-canary',
};

test('readiness passes when required orchestration tools are observed or gateway-reachable', () => {
  const readiness = buildOrchestrationReadiness({
    host: 'OpenCode',
    sessionId: 's1',
    observedTools: ['orchestration_policy', 'call', 'orchestration_readiness'],
    reachableTools: ['orchestration_run'],
    observationScope: 'host-session',
  }, { env: RESOLVABLE_ENV, cwd: '/tmp/project' });

  assert.equal(readiness.verdict, 'pass');
  assert.equal(readiness.reasonCode, 'attached');
  assert.deepEqual(readiness.missingTools, []);
  assert.match(summarizeOrchestrationReadiness(readiness), /Orchestration attached/);
});

test('readiness reports tool_unlisted when orchestration_run is not flat or gateway-reachable', () => {
  const readiness = buildOrchestrationReadiness({
    observedTools: ['orchestration_policy', 'call'],
    reachableTools: ['workflow_invoke'],
    observationScope: 'host-session',
  }, { env: {}, cwd: '/tmp/project' });

  assert.equal(readiness.verdict, 'fail');
  assert.equal(readiness.reasonCode, 'tool_unlisted');
  assert.deepEqual(readiness.missingTools, ['orchestration_run']);
  assert.match(readiness.nextStep, /construct sync/);
});

test('readiness reports host_not_attached for host-session checks with no observed tools', () => {
  const readiness = buildOrchestrationReadiness({
    observationScope: 'host-session',
  }, { env: {}, cwd: '/tmp/project' });

  assert.equal(readiness.reasonCode, 'host_not_attached');
  assert.match(readiness.nextStep, /restart the host session|construct sync/);
});

test('readiness reports server_unreachable from a failed local probe', () => {
  const readiness = buildOrchestrationReadiness({
    probeError: 'spawn ENOENT',
  }, { env: {}, cwd: '/tmp/project' });

  assert.equal(readiness.reasonCode, 'server_unreachable');
  assert.equal(readiness.attached, false);
  assert.match(readiness.diagnosticBundle.detail, /ENOENT/);
});

test('readiness diagnostic bundle redacts secrets into booleans', () => {
  const readiness = buildOrchestrationReadiness({
    observedTools: ['orchestration_policy'],
    reachableTools: ['orchestration_run'],
  }, {
    env: {
      OPENROUTER_API_KEY: 'sk-secret-value',
      CONSTRUCT_ORCHESTRATION_TOKEN: 'token-secret-value',
    },
    cwd: '/tmp/project',
  });

  const blob = JSON.stringify(readiness);
  assert.equal(blob.includes('sk-secret-value'), false);
  assert.equal(blob.includes('token-secret-value'), false);
  assert.equal(readiness.diagnosticBundle.env.hasOpenRouterKey, true);
  assert.equal(readiness.diagnosticBundle.env.hasRemoteOrchestrationToken, true);
});

test('readiness telemetry writes a redacted local event', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-readiness-home-'));
  try {
    const readiness = buildOrchestrationReadiness({
      host: 'Codex',
      sessionId: 'thread-1',
      observedTools: ['orchestration_policy'],
      reachableTools: ['orchestration_run'],
    }, { env: RESOLVABLE_ENV, cwd: '/tmp/project' });
    const { path: eventPath, event } = recordOrchestrationReadinessEvent(readiness, { homeDir: home });
    assert.equal(event.reasonCode, 'attached');
    assert.ok(eventPath.startsWith(doctorRoot(home)));
    assert.match(fs.readFileSync(eventPath, 'utf8'), /orchestration\.readiness/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
