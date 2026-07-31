/**
 * lib/certification/host-adapter-certification.mjs — two-axis host-adapter
 * certification: harness classification vs VS Code/Copilot readiness
 * (construct-tsyfe.9.4).
 *
 * Sibling to evidence-tiers.mjs: the pattern is reused, not the function.
 * Two axes, recorded separately and never merged:
 *   harness-classification    — lib/host-capabilities.mjs per-host probe.
 *   vscode-copilot-readiness  — lib/host/readiness.mjs reason-code resolution.
 *
 * Verification methods, stated per record:
 *   live      — a host binary executed in this process, a live MCP probe against
 *               real VS Code MCP config observed a runtime state, or a human
 *               attests to a real host session.
 *   simulated — the real classifier ran against constructed fixtures or a
 *               fabricated runtimeState with no live observation.
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

const CONSTRUCT_MCP_SERVER_IDS = ['construct-mcp', 'construct'];

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
 * Evidence for every host lib/host-capabilities.mjs classifies.
 *
 * @param {object} [opts]
 * @param {object[]} [opts.hosts]  inject detectHostCapabilities() output for tests
 * @returns {object[]}
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
 * Evidence for static readiness reason codes from on-disk fixtures.
 *
 * @param {object} [opts]
 * @param {string} [opts.tmpRoot]
 * @returns {object[]}
 */
export function collectStaticReadinessEvidence({ tmpRoot } = {}) {
  const dir = tmpRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'host-adapter-cert-'));
  try {
    const fixtures = buildStaticReadinessFixtures(dir);
    return READINESS_STATIC_REASONS.map((reasonCode) => {
      const input = fixtures[reasonCode];
      const observed = classifyHostReadiness(input);
      if (observed !== reasonCode) {
        throw new Error(`fixture for "${reasonCode}" actually classified as "${observed}"`);
      }
      return makeRecord({
        axis: CERTIFICATION_AXES.VSCODE_READINESS,
        target: reasonCode,
        verificationMethod: 'simulated',
        method: 'classifyHostReadiness() executed against an on-disk fixture; no live VS Code process observed.',
        result: { reasonCode: observed },
      });
    });
  } finally {
    if (!tmpRoot) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function substituteWorkspaceFolder(value, rootDir) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{workspaceFolder\}/g, rootDir);
}

function normalizeVscodeMcpEntry(entry, rootDir) {
  if (!entry || typeof entry !== 'object') return entry;
  const normalized = { ...entry };
  if (typeof normalized.cwd === 'string') normalized.cwd = substituteWorkspaceFolder(normalized.cwd, rootDir);
  if (Array.isArray(normalized.args)) {
    normalized.args = normalized.args.map((arg) => substituteWorkspaceFolder(arg, rootDir));
  }
  return normalized;
}

/**
 * Live MCP handshake probe against entries in a real `.vscode/mcp.json`.
 * Probes every configured server; the first handshake failure maps to
 * `server_start_failure`. When the Construct MCP server handshake succeeds
 * but exposes no tools, maps to `missing_tool`.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @returns {Promise<{reasonCode: string, probeDetail: string, mcpPath: string, serverId: string}|null>}
 */
export async function probeVscodeMcpRuntimeState({ rootDir = process.cwd() } = {}) {
  const mcpPath = path.join(rootDir, '.vscode', 'mcp.json');
  if (!fs.existsSync(mcpPath)) return null;

  let mcp;
  try {
    mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  } catch {
    return null;
  }

  const servers = mcp.servers ?? mcp.mcpServers ?? {};
  const entries = Object.entries(servers);
  if (entries.length === 0) return null;

  const { probeServer } = await import('../doctor/watchers/mcp-protocol.mjs');

  for (const [id, rawEntry] of entries) {
    const entry = normalizeVscodeMcpEntry(rawEntry, rootDir);
    let result;
    try {
      result = await probeServer({ host: 'vscode', id, entry });
    } catch (err) {
      return {
        reasonCode: 'server_start_failure',
        probeDetail: `${id}: ${err?.message || err}`,
        mcpPath,
        serverId: id,
      };
    }
    if (!result.ok) {
      return {
        reasonCode: 'server_start_failure',
        probeDetail: `${id}: ${result.reason ?? 'MCP handshake failed'}`,
        mcpPath,
        serverId: id,
      };
    }
    if (CONSTRUCT_MCP_SERVER_IDS.includes(id) && (!result.toolCount || result.toolCount === 0)) {
      return {
        reasonCode: 'missing_tool',
        probeDetail: `${id}: MCP handshake succeeded but tools/list returned no tools`,
        mcpPath,
        serverId: id,
      };
    }
  }

  return null;
}

/**
 * @param {object} probeResult
 * @returns {object}
 */
export function recordLiveProbedRuntimeEvidence(probeResult) {
  const { reasonCode, probeDetail, mcpPath, serverId } = probeResult;
  if (!READINESS_RUNTIME_ONLY_REASONS.includes(reasonCode)) {
    throw new Error(`probe result "${reasonCode}" is not a runtime-only reason code`);
  }
  const observed = classifyHostReadiness({ host: 'vscode', runtimeState: reasonCode });
  if (observed !== reasonCode) {
    throw new Error(`classifyHostReadiness did not echo back "${reasonCode}"`);
  }
  return makeRecord({
    axis: CERTIFICATION_AXES.VSCODE_READINESS,
    target: reasonCode,
    verificationMethod: 'live',
    method: `live MCP handshake probe against ${serverId} in ${mcpPath} observed ${reasonCode}: ${probeDetail}`,
    result: { reasonCode: observed, serverId, mcpPath, probeDetail },
  });
}

/**
 * @param {object} opts
 * @param {string} opts.reasonCode
 * @param {{attestedBy: string, attestedAt: string, sessionEvidence: string}} [opts.attestation]
 * @returns {object}
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
      method: 'no live observation or complete human attestation was supplied; classifyHostReadiness was only exercised with a fabricated runtimeState input.',
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
 * @param {object} [opts]
 * @param {Record<string, {attestedBy: string, attestedAt: string, sessionEvidence: string}>} [opts.runtimeAttestations]
 * @param {{reasonCode: string, probeDetail: string, mcpPath: string, serverId: string}|null} [opts.liveProbeResult]
 * @returns {object[]}
 */
export function collectVscodeReadinessEvidence({ runtimeAttestations = {}, liveProbeResult = null } = {}) {
  const records = [
    ...collectStaticReadinessEvidence(),
    ...READINESS_RUNTIME_ONLY_REASONS.map((reasonCode) => {
      const attestation = runtimeAttestations[reasonCode] ?? null;
      if (liveProbeResult?.reasonCode === reasonCode && !attestation) {
        return recordLiveProbedRuntimeEvidence(liveProbeResult);
      }
      return recordRuntimeReadinessEvidence({ reasonCode, attestation });
    }),
  ];
  const covered = new Set(records.map((r) => r.target));
  for (const reasonCode of HOST_READINESS_REASONS) {
    if (!covered.has(reasonCode)) throw new Error(`no evidence record was produced for reason code "${reasonCode}"`);
  }
  return records;
}

/**
 * @param {object} [opts]
 * @param {Record<string, object>} [opts.runtimeAttestations]
 * @param {boolean} [opts.probeLiveRuntime]
 * @param {string} [opts.rootDir]
 * @returns {Promise<{ [axis: string]: object[] }>}
 */
export async function collectAllHostAdapterEvidence({ runtimeAttestations = {}, probeLiveRuntime = false, rootDir = process.cwd() } = {}) {
  const liveProbeResult = probeLiveRuntime ? await probeVscodeMcpRuntimeState({ rootDir }) : null;
  return {
    [CERTIFICATION_AXES.HARNESS_CLASSIFICATION]: collectHarnessClassificationEvidence(),
    [CERTIFICATION_AXES.VSCODE_READINESS]: collectVscodeReadinessEvidence({ runtimeAttestations, liveProbeResult }),
  };
}

if (isMainModule(import.meta.url)) {
  const evidence = await collectAllHostAdapterEvidence({ probeLiveRuntime: true });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
