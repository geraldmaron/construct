/**
 * lib/certification/host-adapter-certification.mjs — two-axis host-adapter
 * certification: harness classification vs VS Code/Copilot readiness
 * (construct-tsyfe.9.4).
 *
 * Sibling to evidence-tiers.mjs and provider-evidence-tiers.mjs (ADR-0090's
 * "reuse the pattern, not the function" precedent) — a third, independent
 * evidence axis with its own vocabulary. Not a parameterization of either
 * existing module: this axis measures whether a host-DETECTION mechanism was
 * actually exercised (a real classifier call, against a real or an attested
 * live session) versus reasoned about from documentation — not whether an
 * LLM behaved correctly (evidence-tiers.mjs) or a wire protocol still works
 * (provider-evidence-tiers.mjs).
 *
 * Two axes, recorded separately and never merged into one host-supported
 * flag (construct-tsyfe.9.4 Decision):
 *   harness-classification    — lib/host-capabilities.mjs's per-host
 *                               availability/probe classification.
 *   vscode-copilot-readiness  — lib/host/readiness.mjs's host-config
 *                               reason-code resolution (missing_config
 *                               through healthy, plus four runtime-only
 *                               codes its own header says require a live
 *                               host session).
 *
 * Corrected-scope note (re-verified against the live code at execution time):
 * the bead that requested this module named the harness-classification
 * targets as "Claude Code, OpenCode, plain terminal, subagent." No such
 * four-way state exists in lib/host-capabilities.mjs today, and never has —
 * detectHostCapabilities() returns six named hosts (Claude Code, OpenCode,
 * Codex, VS Code, Cursor, Copilot; tests/host-capabilities.test.mjs:33
 * asserts exactly that array, with no plain-terminal or subagent case). This
 * module certifies the six targets the code actually has.
 *
 * Verification methods, stated per record, never inferred upward:
 *   'live'      — a real signal was observed directly: a host binary
 *                  actually executed in this process (harness axis), or a
 *                  human attests to a real host session via the evidence
 *                  input (readiness axis runtime-only codes — these cannot
 *                  be derived from repo-local static analysis, mirroring
 *                  provider-evidence-tiers.mjs's manualAttestation idiom for
 *                  live-sandbox-tested/production-proven).
 *   'simulated' — the real classifier function ran, but against a
 *                  constructed input (config artifacts present with no
 *                  binary confirmed, or an on-disk fixture built for the
 *                  check) rather than an observed live host session.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectHostCapabilities } from '../host-capabilities.mjs';
import { classifyHostReadiness, HOST_READINESS_REASONS } from '../host/readiness.mjs';
import { isMainModule } from '../roots.mjs';

export const CERTIFICATION_AXES = Object.freeze({
  HARNESS_CLASSIFICATION: 'harness-classification',
  VSCODE_READINESS: 'vscode-copilot-readiness',
});

export const VERIFICATION_METHODS = Object.freeze(['live', 'simulated']);

export const READINESS_STATIC_REASONS = Object.freeze([
  'missing_config',
  'stale_path',
  'jsonc_unpatched',
  'wrong_key',
  'disabled',
  'healthy',
]);

export const READINESS_RUNTIME_ONLY_REASONS = Object.freeze([
  'untrusted',
  'server_start_failure',
  'missing_tool',
  'sandbox_disabled',
]);

function nowIso() {
  return new Date().toISOString();
}

function makeRecord({ axis, target, verificationMethod, method, result, notes = null }) {
  if (!Object.values(CERTIFICATION_AXES).includes(axis)) {
    throw new Error(`unknown certification axis: ${axis}`);
  }
  if (!VERIFICATION_METHODS.includes(verificationMethod)) {
    throw new Error(`unknown verification method: ${verificationMethod}`);
  }
  return { axis, target, verificationMethod, method, result, notes, observedAt: nowIso() };
}

// Harness-classification axis ------------------------------------------------

// hostProbe's own taxonomy (lib/host-capabilities.mjs) already distinguishes a
// confirmed-live binary from a config-artifacts-only degraded detection from
// an absent host. 'absent' is still a live check — a real command execution
// ran and genuinely found nothing — only 'artifacts-only' means no binary was
// ever executed to confirm the runtime, which is this axis's 'simulated'.

function harnessVerificationMethod(probe) {
  return probe === 'artifacts-only' ? 'simulated' : 'live';
}

function harnessMethodNote(host) {
  if (host.probe === 'live') {
    return `${host.host} binary executed in this process and returned a version (${host.version}).`;
  }
  if (host.probe === 'artifacts-only') {
    return `${host.host} config/prompt files were found on disk, but no host binary was executed to confirm a live runtime.`;
  }
  return `${host.host} binary was probed and confirmed absent; no config artifacts were found either.`;
}

/**
 * Evidence for every host lib/host-capabilities.mjs actually classifies.
 * Calling detectHostCapabilities() with no injected signals runs the real
 * probes (binary execs + config-file stats) in this process — when this
 * runs inside an actual Claude Code session, its "Claude Code" record is
 * genuinely live-verified, not simulated.
 *
 * @param {object} [opts]
 * @param {object[]} [opts.hosts]  inject detectHostCapabilities() output for
 *                                 a deterministic test; omit to probe for real.
 * @returns {object[]} one evidence record per host
 */
export function collectHarnessClassificationEvidence({ hosts } = {}) {
  const resolvedHosts = hosts ?? detectHostCapabilities();
  return resolvedHosts.map((host) => makeRecord({
    axis: CERTIFICATION_AXES.HARNESS_CLASSIFICATION,
    target: host.host,
    verificationMethod: harnessVerificationMethod(host.probe),
    method: harnessMethodNote(host),
    result: { availability: host.availability, probe: host.probe, capability: host.capability, version: host.version },
    notes: host.degraded ? host.degradedReason : null,
  }));
}

// VS Code/Copilot readiness axis ---------------------------------------------

// Minimal on-disk fixtures that drive classifyHostReadiness() to each static
// reason code for real — no editor install required, since the classifier
// takes explicit settingsPath/mcpPath/root arguments rather than resolving a
// real editor's profile directory itself.

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function buildStaticReadinessFixtures(tmpRoot) {
  const missingMcpPath = path.join(tmpRoot, 'missing', 'mcp.json');

  const staleRoot = path.join(tmpRoot, 'stale-project');
  const staleMcpPath = path.join(tmpRoot, 'stale-mcp.json');
  writeJson(staleMcpPath, { servers: { construct: { args: [path.join('/some/other/checkout', 'lib', 'mcp', 'server.mjs')] } } });

  const jsoncSettingsPath = path.join(tmpRoot, 'jsonc-settings.json');
  fs.mkdirSync(path.dirname(jsoncSettingsPath), { recursive: true });
  fs.writeFileSync(jsoncSettingsPath, '// user preferences\n{\n  "editor.tabSize": 2,\n}\n');

  const wrongKeySettingsPath = path.join(tmpRoot, 'wrong-key-settings.json');
  writeJson(wrongKeySettingsPath, { 'chat.mcp.autostart': 'always' });

  const disabledSettingsPath = path.join(tmpRoot, 'disabled-settings.json');
  writeJson(disabledSettingsPath, { 'chat.mcp.autoStart': 'never' });

  const healthySettingsPath = path.join(tmpRoot, 'healthy-settings.json');
  writeJson(healthySettingsPath, { 'editor.tabSize': 2 });

  return {
    missing_config: { host: 'vscode', mcpPath: missingMcpPath },
    stale_path: { host: 'vscode', mcpPath: staleMcpPath, root: staleRoot },
    jsonc_unpatched: { host: 'vscode', settingsPath: jsoncSettingsPath },
    wrong_key: { host: 'vscode', settingsPath: wrongKeySettingsPath },
    disabled: { host: 'vscode', settingsPath: disabledSettingsPath },
    healthy: { host: 'vscode', settingsPath: healthySettingsPath },
  };
}

/**
 * Evidence for the six static (file-inspectable) readiness reason codes.
 * Builds a real on-disk fixture per code and calls classifyHostReadiness()
 * for real against it — genuinely exercising the classifier, but against a
 * constructed input rather than an observed live VS Code session, so every
 * record here is honestly 'simulated'.
 *
 * @param {object} [opts]
 * @param {string} [opts.tmpRoot]  scratch dir for fixtures; a fresh mkdtemp when omitted
 * @returns {object[]} one evidence record per static reason code
 */
export function collectStaticReadinessEvidence({ tmpRoot } = {}) {
  const dir = tmpRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'host-adapter-cert-'));
  try {
    const fixtures = buildStaticReadinessFixtures(dir);
    return READINESS_STATIC_REASONS.map((reasonCode) => {
      const input = fixtures[reasonCode];
      const observed = classifyHostReadiness(input);
      if (observed !== reasonCode) {
        throw new Error(`fixture for "${reasonCode}" actually classified as "${observed}" — evidence would misrepresent the classifier`);
      }
      return makeRecord({
        axis: CERTIFICATION_AXES.VSCODE_READINESS,
        target: reasonCode,
        verificationMethod: 'simulated',
        method: 'classifyHostReadiness() executed for real against an on-disk fixture constructed for this state; no live VS Code process observed.',
        result: { reasonCode: observed },
      });
    });
  } finally {
    if (!tmpRoot) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Evidence for one runtime-only readiness reason code (untrusted,
 * server_start_failure, missing_tool, sandbox_disabled). readiness.mjs's own
 * header states these require a live host session — there is no repo-local
 * signal that can derive them, so this never infers 'live' on its own. It is
 * 'live' only when the caller supplies an explicit human attestation of a
 * real VS Code session, mirroring provider-evidence-tiers.mjs's
 * manualAttestation.liveSandboxTested idiom for evidence that cannot be
 * derived from static analysis.
 *
 * @param {object} opts
 * @param {string} opts.reasonCode
 * @param {{attestedBy: string, attestedAt: string, sessionEvidence: string}} [opts.attestation]
 * @returns {object} one evidence record
 */
export function recordRuntimeReadinessEvidence({ reasonCode, attestation = null }) {
  if (!READINESS_RUNTIME_ONLY_REASONS.includes(reasonCode)) {
    throw new Error(`"${reasonCode}" is not a runtime-only reason code (expected one of ${READINESS_RUNTIME_ONLY_REASONS.join(', ')})`);
  }
  const observed = classifyHostReadiness({ host: 'vscode', runtimeState: reasonCode });
  if (observed !== reasonCode) {
    throw new Error(`classifyHostReadiness did not echo back "${reasonCode}" — got "${observed}"`);
  }

  const attested = Boolean(attestation?.attestedBy && attestation?.attestedAt && attestation?.sessionEvidence);
  if (!attested) {
    return makeRecord({
      axis: CERTIFICATION_AXES.VSCODE_READINESS,
      target: reasonCode,
      verificationMethod: 'simulated',
      method: 'no human attestation of a live VS Code session was supplied; classifyHostReadiness was only exercised with a fabricated runtimeState input.',
      result: { reasonCode: observed },
    });
  }

  return makeRecord({
    axis: CERTIFICATION_AXES.VSCODE_READINESS,
    target: reasonCode,
    verificationMethod: 'live',
    method: `human-attested live VS Code session: ${attestation.sessionEvidence}`,
    result: { reasonCode: observed, attestedBy: attestation.attestedBy, attestedAt: attestation.attestedAt },
  });
}

/**
 * Full readiness-axis coverage: all six static codes (always simulated, from
 * real fixtures) plus all four runtime-only codes (simulated unless an
 * attestation is supplied per code via `runtimeAttestations`).
 *
 * @param {object} [opts]
 * @param {Record<string, {attestedBy: string, attestedAt: string, sessionEvidence: string}>} [opts.runtimeAttestations]
 * @returns {object[]} HOST_READINESS_REASONS.length evidence records
 */
export function collectVscodeReadinessEvidence({ runtimeAttestations = {} } = {}) {
  const records = [
    ...collectStaticReadinessEvidence(),
    ...READINESS_RUNTIME_ONLY_REASONS.map((reasonCode) => recordRuntimeReadinessEvidence({
      reasonCode,
      attestation: runtimeAttestations[reasonCode] ?? null,
    })),
  ];
  const covered = new Set(records.map((r) => r.target));
  for (const reasonCode of HOST_READINESS_REASONS) {
    if (!covered.has(reasonCode)) throw new Error(`no evidence record was produced for reason code "${reasonCode}"`);
  }
  return records;
}

/**
 * Both axes, tagged separately — the shape construct-tsyfe.9.4's Decision
 * requires: harness-classification evidence is never mistaken for
 * VS Code/Copilot readiness evidence.
 *
 * @param {object} [opts]
 * @param {Record<string, object>} [opts.runtimeAttestations]  see collectVscodeReadinessEvidence
 * @returns {{ [axis: string]: object[] }}
 */
export function collectAllHostAdapterEvidence({ runtimeAttestations = {} } = {}) {
  return {
    [CERTIFICATION_AXES.HARNESS_CLASSIFICATION]: collectHarnessClassificationEvidence(),
    [CERTIFICATION_AXES.VSCODE_READINESS]: collectVscodeReadinessEvidence({ runtimeAttestations }),
  };
}

if (isMainModule(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(collectAllHostAdapterEvidence(), null, 2)}\n`);
}
