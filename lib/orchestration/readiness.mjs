/**
 * lib/orchestration/readiness.mjs — observed orchestration attachment readiness.
 *
 * Deliberately separate from embedded-contract/execution.mjs: execution resolve
 * reports what Construct can plan; readiness reports what a host/session or
 * local probe actually exposed.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getInstalledVersion } from '../version.mjs';
import { CONTRACT_VERSION, MIN_CLIENT_CONTRACT_VERSION } from '../embedded-contract/contract-version.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { doctorRoot } from '../config/xdg.mjs';
import { resolveExecution } from '../embedded-contract/execution.mjs';
import { resolveEmbeddedModel } from '../embedded-contract/model-resolve.mjs';
import { resolveWorkerBackend } from './runtime.mjs';
import { resolveWebCapability } from './web-capability.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';

export const ORCHESTRATION_READINESS_REASONS = Object.freeze([
  'attached',
  'host_not_attached',
  'server_unreachable',
  'auth_unavailable',
  'profile_mismatch',
  'capability_negotiation_failed',
  'version_mismatch',
  'tool_unlisted',
  'model_unresolved',
  'execution_degraded',
  'unknown',
]);

export const DEFAULT_ORCHESTRATION_TOOLS = Object.freeze([
  'orchestration_policy',
  'orchestration_run',
]);

const NEXT_STEPS = Object.freeze({
  attached: 'Proceed: call orchestration_policy, then orchestration_run when policy indicates an orchestrated or focused run.',
  host_not_attached: 'Refresh the host adapter with `construct sync`, restart the host session, then rerun `construct orchestrate preflight --json` inside the target project.',
  server_unreachable: 'Run `construct doctor`, verify the generated MCP command points at this checkout, then rerun `construct sync` if the server path is stale.',
  auth_unavailable: 'Configure the required Construct/provider credential, restart the host so its MCP process inherits it, then rerun preflight.',
  profile_mismatch: 'Check the active Construct scope/profile and host adapter selection, then rerun `construct sync` from the project root.',
  capability_negotiation_failed: 'Restart the host session so MCP initialize/tools.list negotiation runs again; if it persists, report the issue with the printed Diagnostic id at https://github.com/geraldmaron/construct/issues.',
  version_mismatch: 'Upgrade Construct and refresh adapters with `construct sync` so the host and server use compatible contract versions.',
  tool_unlisted: 'Refresh adapters with `construct sync`; if using a reduced local tool surface, ensure orchestration_run is reachable through the `call` gateway enum.',
  model_unresolved: 'Set CX_MODEL_REASONING/STANDARD/FAST, or configure a provider credential (e.g. ANTHROPIC_API_KEY, OPENROUTER_API_KEY), then rerun preflight.',
  execution_degraded: 'Run `construct orchestrate preflight --json` and inspect the modelResolved/workerBackend/webMode fields to see which one degrades this env; a same-family-fallback or config-error there predicts the same degradation orchestration_run would report.',
  unknown: 'Run `construct doctor` and report the issue with the printed Diagnostic id at https://github.com/geraldmaron/construct/issues.',
});

function normalizeList(values) {
  if (!values) return [];
  const arr = Array.isArray(values) ? values : String(values).split(',');
  return [...new Set(arr.map((v) => String(v || '').trim()).filter(Boolean))].sort();
}

function compareSemver(a, b) {
  const pa = String(a || '').split('.').map((n) => Number(n));
  const pb = String(b || '').split('.').map((n) => Number(n));
  for (let i = 0; i < 3; i += 1) {
    const av = Number.isFinite(pa[i]) ? pa[i] : 0;
    const bv = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function hasTool(tool, observed, reachable) {
  return observed.includes(tool) || reachable.includes(tool);
}

function redactedEnvFacts(env) {
  return {
    hasRemoteOrchestrationUrl: Boolean(env.CONSTRUCT_ORCHESTRATION_URL),
    hasRemoteOrchestrationToken: Boolean(env.CONSTRUCT_ORCHESTRATION_TOKEN || env.CONSTRUCT_DASHBOARD_TOKEN),
    hasOpenRouterKey: Boolean(env.OPENROUTER_API_KEY),
    hasAnthropicKey: Boolean(env.ANTHROPIC_API_KEY),
    hasOpenAiKey: Boolean(env.OPENAI_API_KEY),
  };
}

export function buildOrchestrationReadiness(input = {}, { env = process.env, cwd = process.cwd() } = {}) {
  const requiredTools = normalizeList(input.requiredTools ?? input.required_tools ?? DEFAULT_ORCHESTRATION_TOOLS);
  const observedTools = normalizeList(input.observedTools ?? input.observed_tools);
  const reachableTools = normalizeList(input.reachableTools ?? input.reachable_tools);
  const host = input.host ?? null;
  const sessionId = input.sessionId ?? input.session_id ?? null;
  const observationScope = input.observationScope ?? input.observation_scope ?? (observedTools.length || reachableTools.length ? 'local-probe' : 'local-config');
  const probeError = input.probeError ?? input.probe_error ?? null;
  const clientContractVersion = input.clientContractVersion ?? input.client_contract_version ?? CONTRACT_VERSION;
  const profileExpected = input.expectedProfile ?? input.expected_profile ?? null;
  const profileActual = input.actualProfile ?? input.actual_profile ?? null;
  const authRequired = Boolean(input.authRequired ?? input.auth_required);

  const missingTools = requiredTools.filter((tool) => !hasTool(tool, observedTools, reachableTools));
  const constructVersion = getInstalledVersion()?.version || 'unknown';
  const diagnosticId = input.diagnosticId ?? input.diagnostic_id ?? `orch-${randomUUID()}`;

  let reasonCode = 'attached';
  let detail = 'Required orchestration tools are reachable.';

  if (probeError) {
    reasonCode = 'server_unreachable';
    detail = String(probeError);
  } else if (compareSemver(clientContractVersion, MIN_CLIENT_CONTRACT_VERSION) < 0) {
    reasonCode = 'version_mismatch';
    detail = `Client contract ${clientContractVersion} is older than minimum ${MIN_CLIENT_CONTRACT_VERSION}.`;
  } else if (profileExpected && profileActual && profileExpected !== profileActual) {
    reasonCode = 'profile_mismatch';
    detail = `Expected profile ${profileExpected}, observed ${profileActual}.`;
  } else if (authRequired && !(env.CONSTRUCT_ORCHESTRATION_TOKEN || env.CONSTRUCT_DASHBOARD_TOKEN)) {
    reasonCode = 'auth_unavailable';
    detail = 'A remote/team orchestration token is required but not configured.';
  } else if (observationScope === 'host-session' && observedTools.length === 0 && reachableTools.length === 0) {
    reasonCode = 'host_not_attached';
    detail = 'No observed MCP tools were provided for the active host session.';
  } else if (missingTools.length > 0) {
    reasonCode = 'tool_unlisted';
    detail = `Missing required tool(s): ${missingTools.join(', ')}.`;
  }

  // Attachment/version/auth/tool checks above answer liveness ("is the tool
  // reachable?"). None of them predict whether orchestration_run on this same
  // env would actually serve, so a green verdict here could still precede a
  // "No model could be resolved" degradation. Resolve the identical serve
  // path orchestration_run uses — model tiers, worker backend, web grant —
  // env/config-local, no network calls, so a reason code already set above
  // (a real liveness failure) is never overwritten by a serve-ability check.
  const config = (() => { try { return loadProjectConfig(cwd, env).config || {}; } catch { return {}; } })();
  const workerBackend = resolveWorkerBackend({ config });
  const modelResolved = {};
  let firstUnresolvedTier = null;
  for (const tier of ['reasoning', 'standard', 'fast']) {
    const resolved = resolveEmbeddedModel({ requestedTier: tier }, { env });
    modelResolved[tier] = resolved.resolutionSource !== 'config-error';
    if (!modelResolved[tier] && !firstUnresolvedTier) firstUnresolvedTier = tier;
  }
  const execData = resolveExecution({ requestedStrategy: 'orchestrated' }, { env, cwd });
  const providerFamily = (execData.selectedProvider || '').replace(/^openrouter-.*/, 'openrouter');
  const webGrant = providerFamily ? resolveWebCapability({ family: providerFamily, env }) : { mode: 'unavailable', reason: 'capability-unavailable' };
  const credentialMaterializable = execData.modelResolution?.requiresCredential === false || execData.selectedModel != null;

  if (reasonCode === 'attached' && firstUnresolvedTier) {
    reasonCode = 'model_unresolved';
    detail = `No model could be resolved for the ${firstUnresolvedTier} tier — orchestration_run would degrade on this env. ${execData.modelResolution?.error?.remediation || ''}`.trim();
  } else if (reasonCode === 'attached' && execData.degraded) {
    reasonCode = 'execution_degraded';
    detail = execData.degradationReason || 'The execution contract would degrade on this env.';
  }

  const verdict = reasonCode === 'attached' ? 'pass' : 'fail';
  const bundle = {
    diagnosticId,
    host,
    sessionId,
    cwd,
    observationScope,
    constructVersion,
    contractVersion: CONTRACT_VERSION,
    minClientContractVersion: MIN_CLIENT_CONTRACT_VERSION,
    clientContractVersion,
    deploymentMode: getDeploymentMode(env, { cwd }),
    requiredTools,
    observedTools,
    reachableTools,
    missingTools,
    reasonCode,
    detail,
    modelResolved,
    credentialMaterializable,
    workerBackend,
    webMode: webGrant.mode,
    env: redactedEnvFacts(env),
  };

  return {
    verdict,
    attached: verdict === 'pass',
    reasonCode,
    nextStep: NEXT_STEPS[reasonCode] || NEXT_STEPS.unknown,
    host,
    sessionId,
    observationScope,
    requiredTools,
    observedTools,
    reachableTools,
    missingTools,
    constructVersion,
    contractVersion: CONTRACT_VERSION,
    minClientContractVersion: MIN_CLIENT_CONTRACT_VERSION,
    modelResolved,
    credentialMaterializable,
    workerBackend,
    webMode: webGrant.mode,
    diagnosticBundle: bundle,
  };
}

export function summarizeOrchestrationReadiness(readiness) {
  const state = readiness.attached ? 'Orchestration attached' : 'Orchestration unavailable';
  const missing = readiness.missingTools?.length ? ` missing=${readiness.missingTools.join(',')}` : '';
  const host = readiness.host ? ` host=${readiness.host}` : '';
  return `${state} (${readiness.reasonCode}; scope=${readiness.observationScope}${host}${missing})`;
}

export function recordOrchestrationReadinessEvent(readiness, { homeDir, at = new Date().toISOString() } = {}) {
  const event = {
    ts: at,
    type: 'orchestration.readiness',
    host: readiness.host ?? null,
    sessionId: readiness.sessionId ?? null,
    observationScope: readiness.observationScope,
    verdict: readiness.verdict,
    attached: readiness.attached,
    reasonCode: readiness.reasonCode,
    requiredTools: readiness.requiredTools ?? [],
    missingTools: readiness.missingTools ?? [],
    diagnosticId: readiness.diagnosticBundle?.diagnosticId ?? null,
  };
  const file = join(doctorRoot(homeDir), 'orchestration-readiness.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(event)}\n`);
  return { path: file, event };
}
