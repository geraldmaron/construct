/**
 * lib/orchestration/readiness.mjs — observed orchestration attachment readiness.
 *
 * Deliberately separate from embedded-contract/execution.mjs: execution resolve
 * reports what Construct can plan; readiness reports what a host/session or
 * local probe actually exposed.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getInstalledVersion } from '../version.mjs';
import { CONTRACT_VERSION, MIN_CLIENT_CONTRACT_VERSION } from '../embedded-contract/contract-version.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { MODEL_TIERS } from '../model-tiers.mjs';
import { doctorRoot } from '../config/xdg.mjs';
import { resolveExecution } from '../embedded-contract/execution.mjs';
import { resolveEmbeddedModel } from '../embedded-contract/model-resolve.mjs';
import { resolveWorkerBackend } from './runtime.mjs';
import { resolveWebCapability } from './web-capability.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';

// A run planned with no explicit backend only actually reaches the host worker
// backend when TWO things are true: the call is MCP-originated (so
// orchestration_run's own host-default applies at all — a bare CLI call keeps
// the inline default) and a real host session is attached to receive the
// materialized prompts and submit results back. `host-session` scope with a
// named host is the strongest signal readiness has for the second condition —
// a self-report or a bare local-probe/local-config check proves no live host is
// on the other end of this call, so host execution would only ever produce an
// abandoned awaiting-host run with nobody to submit results.

function hostExecutionViability({ observationScope, host }) {
  return observationScope === 'host-session' && Boolean(host);
}

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
  auth_unavailable: 'Set CONSTRUCT_ORCHESTRATION_TOKEN or CONSTRUCT_DASHBOARD_TOKEN so the MCP process serving CONSTRUCT_ORCHESTRATION_URL inherits it, restart the host, then rerun preflight.',
  profile_mismatch: 'Check the active Construct scope/profile and host adapter selection, then rerun `construct sync` from the project root.',
  capability_negotiation_failed: 'Restart the host session so MCP initialize/tools.list negotiation runs again; if it persists, report the issue with the printed Diagnostic id at https://github.com/geraldmaron/construct/issues.',
  version_mismatch: 'Upgrade Construct and refresh adapters with `construct sync` so the host and server use compatible contract versions.',
  tool_unlisted: 'Expected until host MCP tools are attached: run `construct sync`, open your coding host (Cursor/Claude Code/OpenCode), then re-run `construct orchestrate preflight`. To probe the local MCP server without a host session, omit `--no-probe`. If tools stay missing after sync, ensure orchestration_run is flat or reachable via the `call` gateway enum.',
  model_unresolved: 'Set CONSTRUCT_MODEL_REASONING/STANDARD/FAST, or configure a provider credential (e.g. ANTHROPIC_API_KEY, OPENROUTER_API_KEY), then rerun preflight.',
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

// An unresolved `op://vault/item/field` literal is a configured *reference*,
// not a materialized credential — counting it as a present key would tell the
// verdict chain a provider is usable when the secret was never actually read.
function isMaterializedSecret(value) {
  return Boolean(value) && !/^op:\/\//.test(String(value).trim());
}

function redactedEnvFacts(env) {
  return {
    hasRemoteOrchestrationUrl: Boolean(env.CONSTRUCT_ORCHESTRATION_URL),
    hasRemoteOrchestrationToken: Boolean(env.CONSTRUCT_ORCHESTRATION_TOKEN || env.CONSTRUCT_DASHBOARD_TOKEN),
    hasOpenRouterKey: isMaterializedSecret(env.OPENROUTER_API_KEY),
    hasAnthropicKey: isMaterializedSecret(env.ANTHROPIC_API_KEY),
    hasOpenAiKey: isMaterializedSecret(env.OPENAI_API_KEY),
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
  // No self-default to CONTRACT_VERSION: a caller that never reports its own
  // contract version is unknown, not "assumed current" — assuming current
  // made the version_mismatch check untrippable by construction.
  const clientContractVersion = input.clientContractVersion ?? input.client_contract_version ?? null;
  const profileExpected = input.expectedProfile ?? input.expected_profile ?? null;
  const profileActual = input.actualProfile ?? input.actual_profile ?? null;
  const envFacts = redactedEnvFacts(env);
  // A configured CONSTRUCT_ORCHESTRATION_URL means orchestration_run WILL hit
  // a remote that needs a token; auth is required by that fact alone, not
  // only when a caller opts in with --auth-required.
  const authRequired = Boolean(input.authRequired ?? input.auth_required ?? envFacts.hasRemoteOrchestrationUrl);

  const missingTools = requiredTools.filter((tool) => !hasTool(tool, observedTools, reachableTools));
  const constructVersion = getInstalledVersion()?.version || 'unknown';
  const diagnosticId = input.diagnosticId ?? input.diagnostic_id ?? `orch-${randomUUID()}`;

  let reasonCode = 'attached';
  let detail = 'Required orchestration tools are reachable.';

  if (probeError) {
    reasonCode = 'server_unreachable';
    detail = String(probeError);
  } else if (clientContractVersion && compareSemver(clientContractVersion, MIN_CLIENT_CONTRACT_VERSION) < 0) {
    reasonCode = 'version_mismatch';
    detail = `Client contract ${clientContractVersion} is older than minimum ${MIN_CLIENT_CONTRACT_VERSION}.`;
  } else if (profileExpected && profileActual && profileExpected !== profileActual) {
    reasonCode = 'profile_mismatch';
    detail = `Expected profile ${profileExpected}, observed ${profileActual}.`;
  } else if (authRequired && !envFacts.hasRemoteOrchestrationToken) {
    reasonCode = 'auth_unavailable';
    detail = envFacts.hasRemoteOrchestrationUrl
      ? 'CONSTRUCT_ORCHESTRATION_URL is configured but CONSTRUCT_ORCHESTRATION_TOKEN/CONSTRUCT_DASHBOARD_TOKEN is not set.'
      : 'A remote/team orchestration token is required but not configured.';
  } else if (observationScope === 'host-session' && observedTools.length === 0 && reachableTools.length === 0) {
    reasonCode = 'host_not_attached';
    detail = 'No observed MCP tools were provided for the active host session.';
  } else if (missingTools.length > 0) {
    reasonCode = 'tool_unlisted';
    const freshLocal = observationScope === 'local-config'
      || (observationScope === 'local-probe' && !host);
    detail = freshLocal
      ? `Missing required tool(s): ${missingTools.join(', ')}. This is expected in a fresh project or tarball checkout before host adapters expose orchestration tools — not a Construct install failure.`
      : `Missing required tool(s): ${missingTools.join(', ')}.`;
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
  for (const tier of MODEL_TIERS) {
    const resolved = resolveEmbeddedModel({ requestedTier: tier }, { env });
    modelResolved[tier] = resolved.resolutionSource !== 'config-error';
    if (!modelResolved[tier] && !firstUnresolvedTier) firstUnresolvedTier = tier;
  }
  const execData = resolveExecution({ requestedStrategy: 'orchestrated' }, { env, cwd });
  const providerFamily = (execData.selectedProvider || '').replace(/^openrouter-.*/, 'openrouter');
  // resolveWebCapability checks env.WEB_SEARCH_URL before ever looking at
  // family, so a governed grant must not be skipped just because no LLM
  // provider resolved — call it unconditionally and let it fall through to
  // 'unavailable' on its own when neither WEB_SEARCH_URL nor family applies.
  const webGrant = resolveWebCapability({ family: providerFamily, env });
  const credentialMaterializable = execData.modelResolution?.requiresCredential === false || execData.selectedModel != null;

  if (reasonCode === 'attached' && firstUnresolvedTier) {
    reasonCode = 'model_unresolved';
    const presentKeys = Object.entries({ anthropic: envFacts.hasAnthropicKey, openrouter: envFacts.hasOpenRouterKey, openai: envFacts.hasOpenAiKey })
      .filter(([, present]) => present)
      .map(([name]) => name);
    const keyNote = presentKeys.length ? `Provider key(s) detected: ${presentKeys.join(', ')}.` : 'No provider key detected (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY).';
    detail = `No model could be resolved for the ${firstUnresolvedTier} tier — orchestration_run would degrade on this env. ${execData.modelResolution?.error?.remediation || ''} ${keyNote}`.trim();
  } else if (reasonCode === 'attached' && execData.degraded) {
    reasonCode = 'execution_degraded';
    detail = execData.degradationReason || 'The execution contract would degrade on this env.';
  }

  // A server-self-report catalog is a liveness-shaped fact ("the process
  // exposes tools"), not a readiness-shaped one ("this session can serve
  // orchestration_run") — disclose it on every verdict, pass or fail, rather
  // than laundering it into an unqualified host-session pass. Applied last so
  // a later-computed reasonCode/detail (model_unresolved, execution_degraded)
  // never silently drops this caveat by overwriting `detail` above it.
  if (observationScope === 'server-self-report') {
    detail = `${detail} Derived from the server self-report catalog, not an observed host session; orchestration_run serve-ability for this session was not independently confirmed.`.trim();
  }

  const verdict = reasonCode === 'attached' ? 'pass' : 'fail';
  const hostExecutionViable = hostExecutionViability({ observationScope, host });
  // tool_unlisted on a CLI-only / fresh-project probe is a hard fail for
  // orchestration_run (tools really are missing) but an expected setup phase —
  // not an install corruption. Surfaces in JSON + human guidance so operators
  // do not treat exit 1 as "Construct is broken."
  const expectedUntilHostSync = reasonCode === 'tool_unlisted'
    && (observationScope === 'local-config'
      || (observationScope === 'local-probe' && !host)
      || (observationScope === 'host-session' && !host));
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
    expectedUntilHostSync,
    modelResolved,
    credentialMaterializable,
    workerBackend,
    webMode: webGrant.mode,
    hostExecutionViable,
    env: envFacts,
  };

  return {
    verdict,
    attached: verdict === 'pass',
    reasonCode,
    nextStep: NEXT_STEPS[reasonCode] || NEXT_STEPS.unknown,
    expectedUntilHostSync,
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
    // Normalized provider family (anthropic/openrouter/openai) the same
    // resolveExecution call above selected — exposed so a first-run summary
    // can name which provider it found a key for, without recomputing
    // resolveExecution a second time and risking drift.
    providerFamily,
    env: envFacts,
    webMode: webGrant.mode,
    // Whether a run planned with no explicit worker_backend on THIS session
    // would both default to (host) and have a real host attached to execute it
    // — distinct from workerBackend, which reports the config-resolved
    // backend a bare CLI/no-session check would predict.
    hostExecutionViable,
    diagnosticBundle: bundle,
  };
}

// True EXECUTE requires the worker backend to actually reach a provider (the
// only backend covered by this line — inline never runs Worker Profile LLM
// reasoning, and host requires an attached MCP session the CLI first-run
// surfaces below never have) AND a materialized key for the provider family
// resolveExecution selected. Anything else degrades to PLAN, matching what
// orchestration_run would actually do on this env.

const FAMILY_KEY_FACT = Object.freeze({
  anthropic: 'hasAnthropicKey',
  openrouter: 'hasOpenRouterKey',
  openai: 'hasOpenAiKey',
});

export function formatFirstRunExecutionReadiness(readiness) {
  const keyFact = FAMILY_KEY_FACT[readiness.providerFamily];
  const keyFound = Boolean(keyFact && readiness.env?.[keyFact]);
  const executes = readiness.workerBackend === 'provider' && Boolean(readiness.providerFamily) && keyFound;
  if (executes) {
    return `Worker Profiles will EXECUTE (provider ${readiness.providerFamily} + key found)`;
  }
  return 'Worker Profiles will only PLAN (fix: set orchestration.workerBackend=provider + a key)';
}

export function summarizeOrchestrationReadiness(readiness) {
  const state = readiness.attached ? 'Orchestration attached' : 'Orchestration unavailable';
  const missing = readiness.missingTools?.length ? ` missing=${readiness.missingTools.join(',')}` : '';
  const host = readiness.host ? ` host=${readiness.host}` : '';
  const phase = readiness.expectedUntilHostSync ? '; expected-until-host-sync' : '';
  return `${state} (${readiness.reasonCode}; scope=${readiness.observationScope}${host}${missing}${phase})`;
}

/**
 * Multi-line human guidance for preflight failures. Keeps exit 1 honest when
 * tools are truly required, but teaches the setup path for fresh projects.
 */
export function formatOrchestrationReadinessGuidance(readiness) {
  const lines = [];
  if (readiness.expectedUntilHostSync && readiness.reasonCode === 'tool_unlisted') {
    lines.push('Setup note: orchestration tools are not visible yet — common before `construct sync` and a host MCP session.');
    lines.push('This exit code means tools are required and currently missing, not that the Construct install itself failed.');
    lines.push('1. Run `construct sync` from the project root');
    lines.push('2. Open Cursor / Claude Code / OpenCode so host MCP adapters load');
    lines.push('3. Re-run `construct orchestrate preflight` (omit `--no-probe` to probe the local MCP server from CLI)');
  } else if (readiness.reasonCode === 'tool_unlisted') {
    lines.push(`Missing tools: ${(readiness.missingTools || []).join(', ') || '(none listed)'}`);
    lines.push('Refresh host adapters with `construct sync`, restart the host session, then re-run preflight.');
  }
  return lines.join('\n');
}

export function orchestrationReadinessEventPath(homeDir) {
  return join(doctorRoot(homeDir), 'orchestration-readiness.jsonl');
}

export function loadOrchestrationReadinessEvents({ homeDir, limit = 500 } = {}) {
  const file = orchestrationReadinessEventPath(homeDir);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map((line) => JSON.parse(line));
}

function readinessEventFailed(event) {
  return event.verdict === 'fail' || event.attached === false;
}

function readinessEventPassed(event) {
  return event.verdict === 'pass' || event.attached === true;
}

export function summarizeOrchestrationReadinessMttr(events) {
  if (!events?.length) {
    return { sampleCount: 0, meanRecoveryMs: null, recoveries: [] };
  }
  const recoveries = [];
  let pendingFail = null;
  for (const event of events) {
    const ts = Date.parse(event.ts);
    if (!Number.isFinite(ts)) continue;
    if (readinessEventFailed(event) && !readinessEventPassed(event)) {
      if (!pendingFail) pendingFail = { ts, event };
      continue;
    }
    if (readinessEventPassed(event) && pendingFail) {
      recoveries.push({
        fromTs: pendingFail.event.ts,
        toTs: event.ts,
        recoveryMs: ts - pendingFail.ts,
        fromReason: pendingFail.event.reasonCode,
        toReason: event.reasonCode,
      });
      pendingFail = null;
    }
  }
  const sampleCount = recoveries.length;
  const meanRecoveryMs = sampleCount
    ? Math.round(recoveries.reduce((sum, row) => sum + row.recoveryMs, 0) / sampleCount)
    : null;
  return { sampleCount, meanRecoveryMs, recoveries: recoveries.slice(-20) };
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
  const file = orchestrationReadinessEventPath(homeDir);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(event)}\n`);
  return { path: file, event };
}
