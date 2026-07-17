/**
 * tests/certification/host-adapter-certification.test.mjs — two-axis host-adapter
 * certification (construct-tsyfe.9.4).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CERTIFICATION_AXES,
  VERIFICATION_METHODS,
  READINESS_STATIC_REASONS,
  READINESS_RUNTIME_ONLY_REASONS,
  collectHarnessClassificationEvidence,
  collectStaticReadinessEvidence,
  recordRuntimeReadinessEvidence,
  collectVscodeReadinessEvidence,
  collectAllHostAdapterEvidence,
} from '../../lib/certification/host-adapter-certification.mjs';
import { HOST_READINESS_REASONS } from '../../lib/host/readiness.mjs';
import { detectHostCapabilities } from '../../lib/host-capabilities.mjs';

// Signal shapes matching detectHostRawSignals() (see tests/host-capabilities.test.mjs)
// for a deterministic harness-classification pass with no real editor install needed.
const LIVE_SIGNALS = {
  claude: '2.1.40 (Claude Code)', tmux: 'tmux 3.4', opencode: '0.9.0', codex: 'codex 1.2.0',
  vscode: { version: '1.99.0', hasSettings: true }, cursor: { version: '0.42.0', hasConfig: true }, copilot: { hasFiles: true },
};
const ARTIFACTS_ONLY_SIGNALS = {
  claude: null, tmux: null, opencode: null, codex: null,
  vscode: { version: null, hasSettings: true }, cursor: { version: null, hasConfig: true }, copilot: { hasFiles: true },
};

test('the two axes are distinct and never collapse to one flag', () => {
  assert.notEqual(CERTIFICATION_AXES.HARNESS_CLASSIFICATION, CERTIFICATION_AXES.VSCODE_READINESS);
  assert.deepEqual(VERIFICATION_METHODS, ['live', 'simulated']);
});

test('harness-classification evidence covers every host lib/host-capabilities.mjs actually classifies', () => {
  const records = collectHarnessClassificationEvidence();
  const names = records.map((r) => r.target);
  assert.deepEqual(names, ['Claude Code', 'OpenCode', 'Codex', 'VS Code', 'Cursor', 'Copilot']);
  for (const record of records) {
    assert.equal(record.axis, CERTIFICATION_AXES.HARNESS_CLASSIFICATION);
    assert.ok(VERIFICATION_METHODS.includes(record.verificationMethod), `${record.target} has a valid verification method`);
    assert.ok(record.method.length > 0, `${record.target} states its method`);
    assert.ok(record.observedAt, `${record.target} records an observation timestamp`);
  }
});

test('a live-probed host is recorded as live-verified, not simulated', () => {
  const records = collectHarnessClassificationEvidence({ hosts: [
    { host: 'Claude Code', availability: 'installed', probe: 'live', liveCapabilityConfirmed: true, degraded: false, degradedReason: null, version: '2.1.40', capability: 'full-native' },
  ] });
  assert.equal(records[0].verificationMethod, 'live');
  assert.match(records[0].method, /binary executed/);
});

test('an artifacts-only host is honestly recorded as simulated, carrying the degraded reason', () => {
  const records = collectHarnessClassificationEvidence({ hosts: [
    { host: 'Copilot', availability: 'installed', probe: 'artifacts-only', liveCapabilityConfirmed: false, degraded: true, degradedReason: 'Detected from host config/prompt files only.', version: null, capability: 'mcp-orchestrated' },
  ] });
  assert.equal(records[0].verificationMethod, 'simulated');
  assert.equal(records[0].notes, 'Detected from host config/prompt files only.');
});

test('an absent host is still recorded as live — the probe itself genuinely ran and found nothing', () => {
  const records = collectHarnessClassificationEvidence({ hosts: [
    { host: 'Cursor', availability: 'missing', probe: 'absent', liveCapabilityConfirmed: false, degraded: false, degradedReason: null, version: null, capability: 'mcp-orchestrated' },
  ] });
  assert.equal(records[0].verificationMethod, 'live');
});

test('an injected full signal set produces all-live evidence end to end through the real detector', () => {
  const records = collectHarnessClassificationEvidence({ hosts: detectHostCapabilities(LIVE_SIGNALS) });
  for (const record of records) {
    if (record.target === 'Copilot') continue; // Copilot has no CLI binary — always artifacts-only when files are present.
    assert.equal(record.verificationMethod, 'live', `${record.target} should be live-verified from a full live signal set`);
  }
});

test('an injected artifacts-only signal set produces simulated evidence for config-detected hosts', () => {
  const records = collectHarnessClassificationEvidence({ hosts: detectHostCapabilities(ARTIFACTS_ONLY_SIGNALS) });
  for (const name of ['VS Code', 'Cursor', 'Copilot']) {
    const record = records.find((r) => r.target === name);
    assert.equal(record.verificationMethod, 'simulated', `${name} should be simulated when only config artifacts are present`);
  }
});

test('READINESS_STATIC_REASONS and READINESS_RUNTIME_ONLY_REASONS partition HOST_READINESS_REASONS exactly', () => {
  const combined = [...READINESS_STATIC_REASONS, ...READINESS_RUNTIME_ONLY_REASONS].sort();
  assert.deepEqual(combined, [...HOST_READINESS_REASONS].sort());
});

test('static readiness evidence exercises the real classifier against a real fixture per reason code', () => {
  const records = collectStaticReadinessEvidence();
  assert.equal(records.length, READINESS_STATIC_REASONS.length);
  for (const record of records) {
    assert.equal(record.axis, CERTIFICATION_AXES.VSCODE_READINESS);
    assert.equal(record.verificationMethod, 'simulated', `${record.target} has no live VS Code session, so it must be simulated`);
    assert.equal(record.result.reasonCode, record.target, `${record.target} fixture actually classified to itself`);
  }
});

test('a runtime-only reason code with no attestation is honestly recorded as simulated', () => {
  const record = recordRuntimeReadinessEvidence({ reasonCode: 'untrusted' });
  assert.equal(record.verificationMethod, 'simulated');
  assert.match(record.method, /no human attestation/);
});

test('a runtime-only reason code with a complete attestation is recorded as live', () => {
  const record = recordRuntimeReadinessEvidence({
    reasonCode: 'server_start_failure',
    attestation: {
      attestedBy: 'test-harness',
      attestedAt: '2026-01-01T00:00:00.000Z',
      sessionEvidence: 'observed the MCP server output channel report a start failure in a real VS Code window',
    },
  });
  assert.equal(record.verificationMethod, 'live');
  assert.match(record.method, /human-attested live VS Code session/);
});

test('an incomplete attestation (missing a required field) does not silently count as live', () => {
  const record = recordRuntimeReadinessEvidence({
    reasonCode: 'missing_tool',
    attestation: { attestedBy: 'test-harness', attestedAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.equal(record.verificationMethod, 'simulated');
});

test('recordRuntimeReadinessEvidence rejects a reason code that is not runtime-only', () => {
  assert.throws(() => recordRuntimeReadinessEvidence({ reasonCode: 'healthy' }), /not a runtime-only reason code/);
});

test('collectVscodeReadinessEvidence covers every HOST_READINESS_REASONS code exactly once', () => {
  const records = collectVscodeReadinessEvidence();
  assert.equal(records.length, HOST_READINESS_REASONS.length);
  const targets = records.map((r) => r.target).sort();
  assert.deepEqual(targets, [...HOST_READINESS_REASONS].sort());
});

test('collectVscodeReadinessEvidence promotes an attested runtime code to live, others stay simulated', () => {
  const records = collectVscodeReadinessEvidence({
    runtimeAttestations: {
      sandbox_disabled: {
        attestedBy: 'test-harness',
        attestedAt: '2026-01-01T00:00:00.000Z',
        sessionEvidence: 'toggled the MCP sandbox setting off in a real VS Code install and observed the resulting state',
      },
    },
  });
  const sandboxDisabled = records.find((r) => r.target === 'sandbox_disabled');
  const untrusted = records.find((r) => r.target === 'untrusted');
  assert.equal(sandboxDisabled.verificationMethod, 'live');
  assert.equal(untrusted.verificationMethod, 'simulated');
});

test('collectAllHostAdapterEvidence tags each axis separately, never merging them', () => {
  const evidence = collectAllHostAdapterEvidence();
  assert.ok(Array.isArray(evidence[CERTIFICATION_AXES.HARNESS_CLASSIFICATION]));
  assert.ok(Array.isArray(evidence[CERTIFICATION_AXES.VSCODE_READINESS]));
  for (const record of evidence[CERTIFICATION_AXES.HARNESS_CLASSIFICATION]) {
    assert.equal(record.axis, CERTIFICATION_AXES.HARNESS_CLASSIFICATION);
  }
  for (const record of evidence[CERTIFICATION_AXES.VSCODE_READINESS]) {
    assert.equal(record.axis, CERTIFICATION_AXES.VSCODE_READINESS);
  }
});
