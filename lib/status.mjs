/**
 * lib/status.mjs — Project health summary for the Construct CLI.
 *
 * Reads workflow state, plan.md, tracker config, and MCP surface to produce a
 * structured health object. Called by `construct status`, the MCP status tool,
 * and the session-start bootstrap to surface blocked tasks and open questions.
 */
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { loadRegistry } from './registry/loader.mjs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { inspectContextState } from './context-state.mjs';
import { CLI_COMMANDS } from './cli-commands.mjs';
import { checkAllFeatures } from './features.mjs';
import { loadConstructEnv } from './env-config.mjs';
import { describeDeploymentMode, getDeploymentMode, resolveResourceMode } from './deployment-mode.mjs';
import { getActiveOverlays, getPromotionRequests } from './headhunt.mjs';
import { resolveExecutionContractModelMetadata, selectModelTierForWorkCategory } from './model-router.mjs';
import { loadPluginRegistry } from './plugin-registry.mjs';
import { readCostLog, summarizeCostData, normalizeCostEntry } from './cost.mjs';
import { readEfficiencyLog, summarizeEfficiencyData } from './efficiency.mjs';
import { triggerAutoBackfillIfSparse } from './telemetry/backfill.mjs';
import { resolveTraceBackend, telemetryProviderLabel } from './telemetry/client.mjs';
import { doctorRoot } from './config/xdg.mjs';
import { resolveUiColors } from './ui/theme.mjs';
import { applyLinks, terminalLinksEnabled } from './ui/links.mjs';
import { getModeCapabilityStatus, getUnsupportedCapabilities, getCapabilities, categorizeEnterpriseCapability } from './mode-capabilities.mjs';
import { ProviderRegistry } from './embed/providers/registry.mjs';
import { resolveProviders } from './providers/registry.mjs';
import { getState as getBreakerState } from './providers/circuit-breaker.mjs';
import { ConsumptionBudgetStore } from './policy/consumption-budget.mjs';
import { loadGraph, nodesByType, nodeId } from './graph/store.mjs';
import { validateGraph } from './graph/validate.mjs';
import { computeLastExecutionByWorkflow } from './graph/runtime-evidence.mjs';
import { summarizeTeamHealth } from './team/health.mjs';
import { loadProjectConfig } from './config/project-config.mjs';
import { projectKey } from './orchestration/store.mjs';
import { resolveTraceStore } from './orchestration/trace-store.mjs';
import { resolveSharedMemoryStore } from './storage/shared-memory.mjs';
const TOTAL_BYTES_WARNING_THRESHOLD = 750_000;

function readJSON(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}


function readSessionEfficiency(homeDir) {
  const stats = readJSON(join(doctorRoot(homeDir), 'session-efficiency.json'));
  if (!stats) return null;

  const readCount = Number(stats.readCount || 0);
  const uniqueFileCount = Number(stats.uniqueFileCount || 0);
  const repeatedReadCount = Number(stats.repeatedReadCount || 0);
  const largeReadCount = Number(stats.largeReadCount || 0);
  const totalBytesRead = Number(stats.totalBytesRead || 0);
  const warnings = [];

  let score = 1;
  if (readCount > 0) {
    score -= Math.min(0.35, repeatedReadCount * 0.04);
    score -= Math.min(0.25, largeReadCount * 0.05);
    if (totalBytesRead > 500_000) score -= 0.1;
    if (uniqueFileCount > 25) score -= 0.05;
  }

  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  let status = 'healthy';
  if (score < 0.6) status = 'degraded';
  else if (score < 0.8) status = 'configured';

  if (totalBytesRead >= TOTAL_BYTES_WARNING_THRESHOLD) {
    warnings.push(`High byte budget usage: ${Math.round(totalBytesRead / 1024)} KB read this session — compact context or switch to query-focused distill/retrieval before more broad reads.`);
  }

  const summary = [
    `${readCount} reads`,
    `${uniqueFileCount} files`,
    repeatedReadCount ? `${repeatedReadCount} repeated` : null,
    largeReadCount ? `${largeReadCount} large` : null,
    totalBytesRead ? `${Math.round(totalBytesRead / 1024)} KB` : null,
  ].filter(Boolean).join(' · ');

  return {
    status,
    score,
    readCount,
    uniqueFileCount,
    repeatedReadCount,
    largeReadCount,
    totalBytesRead,
    summary,
    warnings,
    lastUpdatedAt: stats.lastUpdatedAt || null,
  };
}

function readTelemetryRichness(homeDir) {
  const stats = readJSON(join(doctorRoot(homeDir), 'session-telemetry.json'));
  if (!stats) return null;

  const total = Number(stats.total || 0);
  const rich = Number(stats.rich || 0);
  const partial = Number(stats.partial || 0);
  const sparse = Number(stats.sparse || 0);
  const derivedCoverage = total > 0 ? (rich + (partial * 0.5)) / total : 0;
  const coverage = Number.isFinite(Number(stats.coverage)) && Number(stats.coverage) > 0
    ? Number(stats.coverage)
    : derivedCoverage;
  const healthyRatio = total > 0 ? rich / total : 0;
  const status = total === 0
    ? 'configured'
    : healthyRatio >= 0.75 || coverage >= 0.75
      ? 'healthy'
      : coverage >= 0.35
        ? 'configured'
        : 'degraded';

  return {
    status,
    total,
    rich,
    partial,
    sparse,
    coverage,
    summary: stats.summary || `${total} traces · rich ${rich} · partial ${partial} · sparse ${sparse}`,
  };
}

export function readSessionUsage(homeDir) {
  const entries = readCostLog(homeDir);
  if (!entries.length) {
    return {
      status: 'unavailable',
      interactions: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      providerTotalTokens: 0,
      billedTotalTokens: 0,
      processedInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      summary: 'No token usage recorded yet',
      lastInteraction: null,
      source: join(doctorRoot(homeDir), 'session-cost.jsonl'),
      lastUpdatedAt: null,
    };
  }

  const lastEntry = entries[entries.length - 1] || {};
  const normalizedLast = normalizeCostEntry(lastEntry);
  const lastInteraction = {
    timestamp: lastEntry.ts || null,
    inputTokens: normalizedLast.inputTokens,
    outputTokens: normalizedLast.outputTokens,
    reasoningTokens: normalizedLast.reasoningTokens,
    cacheReadInputTokens: normalizedLast.cacheReadInputTokens,
    cacheCreationInputTokens: normalizedLast.cacheCreationInputTokens,
    processedInputTokens: normalizedLast.processedInputTokens,
    providerTotalTokens: normalizedLast.providerTotalTokens,
    billedTotalTokens: normalizedLast.billedTotalTokens,
    totalTokens: normalizedLast.providerTotalTokens,
    costUsd: normalizedLast.costUsd,
  };

  const data = summarizeCostData(entries);

  const billed = data.billedTotalTokens || 0;
  const cacheReadPct = billed > 0 ? ((data.cacheReadInputTokens / billed) * 100).toFixed(1) : '?';
  const cacheWritePct = billed > 0 ? ((data.cacheCreationInputTokens / billed) * 100).toFixed(1) : '?';
  const freshPct = billed > 0 ? ((((data.totalInputTokens || 0) + (data.totalOutputTokens || 0)) / billed) * 100).toFixed(1) : '?';

  return {
    status: 'available',
    interactions: data.interactions,
    inputTokens: data.totalInputTokens,
    outputTokens: data.totalOutputTokens,
    reasoningTokens: data.totalReasoningTokens,
    cacheReadInputTokens: data.cacheReadInputTokens,
    cacheCreationInputTokens: data.cacheCreationInputTokens,
    processedInputTokens: data.processedInputTokens,
    cachedTokens: data.cachedTokens,
    cacheReadRate: data.cacheReadRate,
    cacheHitRate: data.cacheReadRate,
    providerTotalTokens: data.providerTotalTokens,
    billedTotalTokens: billed,
    totalTokens: data.providerTotalTokens,
    totalCostUsd: data.totalCostUsd,
    summary: `${data.interactions} interaction${data.interactions === 1 ? '' : 's'} · ${data.providerTotalTokens.toLocaleString()} provider · ${billed.toLocaleString()} billed (${cacheReadPct}% cache read · ${cacheWritePct}% cache write · ${freshPct}% fresh)`,
    lastInteraction,
    source: join(doctorRoot(homeDir), 'session-cost.jsonl'),
    lastUpdatedAt: lastInteraction.timestamp,
  };
}


/**
 * readDegradationRecords(cwd)
 *
 * Reads `.cx/degradation.jsonl` (written by `requireTeamCapabilityOrDegrade` in
 * deployment-mode.mjs) and returns an array of structured degradation detail objects.
 *
 * Each record in the JSONL file has the shape written by deployment-mode.mjs:
 *   { ts, mode, subsystem, degradedOk: true }
 *
 * Each record is surfaced as:
 *   { subsystem, declared, actual, reason }
 *
 * `declared` and `actual` are inferred from the subsystem name when not
 * explicitly present in the record (the deployment-mode writer does not yet emit
 * them). `reason` reflects the CONSTRUCT_DEGRADED_OK value.
 *
 * Returns an empty array when the file is absent or unreadable.
 */
function readDegradationRecords(cwd) {
  const filePath = join(cwd, '.cx', 'degradation.jsonl');
  if (!existsSync(filePath)) return [];
  let lines;
  try {
    lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const records = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (!entry || typeof entry.subsystem !== 'string') continue;
      // Infer declared/actual from the subsystem id when not explicit.
      // Convention: subsystem ids use the format "<declared>-queue", "<declared>-memory", etc.
      const declared = entry.declared ?? entry.subsystem;
      const actual = entry.actual ?? 'fallback';
      const reason = entry.reason
        ?? (entry.degradedOk ? `CONSTRUCT_DEGRADED_OK=${entry.subsystem} set` : 'degraded');
      records.push({
        subsystem: entry.subsystem,
        declared,
        actual,
        reason,
        ts: entry.ts ?? null,
        mode: entry.mode ?? null,
      });
    } catch {
      // malformed line — skip
    }
  }
  return records;
}

/**
 * countPersonaDegradedRuns(cwd)
 *
 * Reads orchestration run records from `.cx/runtime/orchestration/runs/` and
 * counts runs carrying at least one task with `personaAvailable === false`
 * (LMCP-E2: solo-mode persona fallback). Reads the filesystem store directly
 * — the same best-effort, no-throw pattern as readDegradationRecords — since
 * status is a read-only surface and must not fail when a run file is
 * corrupt or the sqlite/postgres store is in use instead of the default.
 *
 * Returns { total, runs } where `runs` is the degraded run ids (capped at 20
 * for the summary), and `total` counts every matching run.
 */
function countPersonaDegradedRuns(cwd) {
  const dir = join(cwd, '.cx', 'runtime', 'orchestration', 'runs');
  if (!existsSync(dir)) return { total: 0, runs: [] };
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return { total: 0, runs: [] };
  }
  const runs = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const run = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      const hasPersonaFallback = (run.tasks || []).some((t) => t.personaAvailable === false);
      if (hasPersonaFallback) runs.push(run.runId || name.replace(/\.json$/, ''));
    } catch {
      // a corrupt run file is skipped, not fatal to the count
    }
  }
  return { total: runs.length, runs: runs.slice(0, 20) };
}

/**
 * summarizeRecentRunExecutionStates(cwd, opts)
 *
 * Reads orchestration run records from `.cx/runtime/orchestration/runs/` (same
 * best-effort, no-throw filesystem read as countPersonaDegradedRuns above) and
 * buckets the most recent runs by their LMCP-F4 run-level `executionState`
 * (prepared|executed|degraded-executed|failed|unknown), so `construct status`
 * can distinguish a run that only prepared specialist work from one that
 * actually executed it — the honesty gap construct-1yhp.2 and incident
 * run-02158a157d53 (construct-neq9.7) both trace back to.
 *
 * A run with no tasks (prompt-only/host-direct) or a pre-F4 legacy record
 * carrying no `executionState` field is bucketed `unknown` rather than guessed
 * into `prepared` or `executed`.
 *
 * Returns { total, byState: {prepared,executed,degraded-executed,failed,unknown},
 * recent: [{runId, executionState, status, createdAt}] } ordered newest-first
 * and capped at `limit` (default 10) for the `recent` list; `byState` counts
 * every readable run regardless of the cap.
 */
function summarizeRecentRunExecutionStates(cwd, { limit = 10 } = {}) {
  const dir = join(cwd, '.cx', 'runtime', 'orchestration', 'runs');
  const empty = { total: 0, byState: { prepared: 0, executed: 0, 'degraded-executed': 0, failed: 0, unknown: 0 }, recent: [] };
  if (!existsSync(dir)) return empty;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return empty;
  }
  const runs = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const run = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      runs.push({
        runId: run.runId || name.replace(/\.json$/, ''),
        executionState: run.executionState ?? 'unknown',
        status: run.status ?? 'unknown',
        createdAt: run.createdAt ?? null,
      });
    } catch {
      // a corrupt run file is skipped, not fatal to the summary
    }
  }
  runs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const byState = { prepared: 0, executed: 0, 'degraded-executed': 0, failed: 0, unknown: 0 };
  for (const r of runs) {
    const key = Object.hasOwn(byState, r.executionState) ? r.executionState : 'unknown';
    byState[key] += 1;
  }

  return { total: runs.length, byState, recent: runs.slice(0, limit) };
}

// LMCP-G10: cross-machine read side of team mode's trace/memory boundary.
// lib/orchestration/runtime.mjs's persistTeamTrace writes every completed
// run's lifecycle trace into the same postgres-backed trace store this reads
// back from, keyed on the same projectKey(config, cwd) — a trace worker A's
// machine wrote is the exact row machine B's `construct status` lists here.
// Shared memory (lib/storage/shared-memory.mjs) is listed the same way; only
// records that opted in with visibility 'shared-project' + provenance ever
// appear. Solo mode (both stores resolve to kind:'none') reports
// unavailable rather than fabricating an empty list as "no team activity".

async function summarizeSharedState(cwd, env, config) {
  const project = projectKey(config, cwd);
  const traceStore = resolveTraceStore({ env, cwd, config });
  const memoryStore = resolveSharedMemoryStore({ env, cwd, config });
  if (traceStore.kind !== 'postgres' && memoryStore.kind !== 'postgres') {
    return { status: 'unavailable', reason: 'no-team-store-configured', recentTraces: [], sharedMemory: [] };
  }
  const [recentTraces, sharedMemory] = await Promise.all([
    traceStore.kind === 'postgres' ? traceStore.listTeamTraces({ project, limit: 5 }).catch(() => []) : Promise.resolve([]),
    memoryStore.kind === 'postgres' ? memoryStore.listSharedMemory({ project, limit: 5 }).catch(() => []) : Promise.resolve([]),
  ]);
  return { status: 'healthy', project, recentTraces, sharedMemory };
}

/**
 * summarizeGraphWorkflows(rootDir)
 *
 * Classifies every workflow node in the living graph (LMCP-C1/C2) as
 * available / degraded / missing, sourced from the same validateGraph() the
 * `graph validate` CLI and the doctor check (lib/doctor/graph-validate.mjs)
 * both call — so status, doctor, and `construct graph validate` can never
 * report three different truths about the same workflow.
 *
 * - missing: no `workflow:<id>` node exists in the graph (or the graph has
 *   not been built yet).
 * - degraded: the node exists but validateGraph raised an error or warning
 *   that names this workflow, or the most recent runtime-evidence outcome
 *   (LMCP-C9, runtime-evidence.mjs) for it is 'failed'.
 * - available: the node exists and neither of the above applies.
 *
 * Read-only against .cx/graph and .cx/runtime/orchestration/runs — this
 * function never writes to the graph store or the runtime-evidence store.
 */
function summarizeGraphWorkflows(rootDir) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) {
    return { available: [], degraded: [], missing: [], graphBuilt: false, errors: [], warnings: [] };
  }

  const validation = validateGraph(rootDir);
  const graphWorkflowIds = new Set(nodesByType(graph, 'workflow').map((n) => n.id));
  const lastExecutionByWorkflow = computeLastExecutionByWorkflow(rootDir);

  const findingsFor = (id, name) => {
    const needles = [id, name].filter(Boolean);
    const matches = (msg) => needles.some((needle) => msg.includes(`'${needle}'`));
    return {
      errors: validation.errors.filter(matches),
      warnings: validation.warnings.filter(matches),
    };
  };

  const available = [];
  const degraded = [];
  const missing = [];

  for (const type of Object.keys(lastExecutionByWorkflow)) {
    const id = nodeId('workflow', type);
    const evidence = lastExecutionByWorkflow[type];
    if (!graphWorkflowIds.has(id)) {
      missing.push({ type, reason: 'no workflow node in living graph' });
      continue;
    }
    const findings = findingsFor(id, type);
    const evidenceFailed = evidence?.outcome === 'failed';
    if (findings.errors.length > 0 || findings.warnings.length > 0 || evidenceFailed) {
      degraded.push({
        type,
        errors: findings.errors,
        warnings: findings.warnings,
        lastExecution: evidence,
      });
    } else {
      available.push({ type, lastExecution: evidence });
    }
  }

  return {
    available,
    degraded,
    missing,
    graphBuilt: true,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

function newestMtime(dir) {
  if (!existsSync(dir)) return null;
  let newest = 0;
  try {
    for (const file of readdirSync(dir)) {
      const stat = statSync(join(dir, file));
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    }
  } catch {
    return null;
  }
  return newest ? new Date(newest).toISOString() : null;
}

function listCommands(rootDir) {
  const commandsDir = join(rootDir, 'commands');
  if (!existsSync(commandsDir)) return [];
  const result = [];
  for (const domain of readdirSync(commandsDir).sort()) {
    const domainPath = join(commandsDir, domain);
    try {
      if (!statSync(domainPath).isDirectory()) continue;
      const commands = [];
      for (const file of readdirSync(domainPath).sort()) {
        if (!file.endsWith('.md')) continue;
        const content = readFileSync(join(domainPath, file), 'utf8');
        const match = content.match(/^---\r?\n[\s\S]*?description:\s*(.+?)\r?\n[\s\S]*?---/);
        const description = match ? match[1].trim() : file.replace('.md', '');
        commands.push({ name: file.replace('.md', ''), description, slash: `/${domain}:${file.replace('.md', '')}` });
      }
      if (commands.length) result.push({ domain, commands });
    } catch {
      continue;
    }
  }
  return result;
}

function listSkills(rootDir) {
  const skillsDir = join(rootDir, 'skills');
  if (!existsSync(skillsDir)) return [];
  const result = [];
  for (const category of readdirSync(skillsDir)) {
    const categoryPath = join(skillsDir, category);
    try {
      if (!statSync(categoryPath).isDirectory()) continue;
      const files = readdirSync(categoryPath)
        .filter((file) => file.endsWith('.md') || file.endsWith('.mjs'))
        .filter((file) => file !== 'SKILL.md');
      result.push({ category, files });
    } catch {
      continue;
    }
  }
  return result;
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function probeHttp(url, { method = 'GET', headers, body, timeout = 5000 } = {}) {
  // 5s is generous on purpose. A local service can batch many concurrent requests
  // at startup, which can stall its own event loop just long enough that a 2s
  // timeout fires on a healthy
  // localhost service. Reachability is a yes/no signal — a hung remote dies
  // visibly via ECONNREFUSED long before this, so the extra headroom is free.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    return { ok: res.ok, statusCode: res.status };
  } catch (error) {
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

// Per-service probe-result cache so back-to-back /api/status calls (page reload,
// React StrictMode double-mount, multiple components polling) don't pound the
// same probe URLs. TTL is short so a true outage shows within a few seconds.
const PROBE_CACHE = new Map();
const PROBE_CACHE_TTL_MS = 3000;
function probeCacheKey(service) {
  return `${service.id || service.name}\0${service.method || 'GET'}\0${service.probeUrl || service.url}`;
}
function readProbeCache(service, now = Date.now()) {
  const entry = PROBE_CACHE.get(probeCacheKey(service));
  if (!entry) return null;
  if (now - entry.at > PROBE_CACHE_TTL_MS) return null;
  return entry.result;
}
function writeProbeCache(service, result, now = Date.now()) {
  PROBE_CACHE.set(probeCacheKey(service), { at: now, result });
}

function normalizeProbeResult(result) {
  if (typeof result === 'string') {
    return { status: result };
  }
  return result ?? { status: 'unavailable', message: 'Probe failed' };
}

async function defaultProbeService(service) {
  const cached = readProbeCache(service);
  if (cached) return cached;

  const headers = service.probeHeaders || (service.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined);
  const result = service.method === 'POST'
    ? await probeHttp(service.url, { method: 'POST', headers, body: service.body })
    : await probeHttp(service.url, headers ? { headers } : undefined);

  let outcome;
  if (result.ok) outcome = { status: 'healthy', message: service.healthyMessage ?? 'Reachable' };
  else if (result.statusCode) outcome = { status: 'degraded', message: `HTTP ${result.statusCode}` };
  else if (result.error?.name === 'AbortError') outcome = { status: 'unavailable', message: 'Timed out' };
  else if (result.error?.cause?.code === 'ECONNREFUSED' || result.error?.code === 'ECONNREFUSED') {
    outcome = { status: 'unavailable', message: 'Connection refused' };
  } else {
    outcome = { status: 'unavailable', message: result.error?.message ?? 'Connection failed' };
  }

  writeProbeCache(service, outcome);
  return outcome;
}

async function fetchTelemetryStatus(env, { timeout = 2500 } = {}) {
  const backend = resolveTraceBackend(env);
  if (backend === 'local') return { status: 'healthy', summary: 'Local JSONL tracing enabled · remote export not configured', backend, provider: telemetryProviderLabel(env) };
  if (backend === 'none') return { status: 'disabled', summary: 'Remote telemetry disabled · local JSONL tracing preserved', backend, provider: telemetryProviderLabel(env) };
  if (backend === 'otel') {
    const endpoint = (env.CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT ?? '').replace(/\/$/, '');
    if (!endpoint) return { status: 'unavailable', summary: 'OTLP endpoint not configured', backend, provider: telemetryProviderLabel(env) };
    return { status: 'configured', summary: `OTLP export configured · ${endpoint}`, backend, provider: telemetryProviderLabel(env) };
  }
  const baseUrl = (env.CONSTRUCT_TELEMETRY_URL ?? '').replace(/\/$/, '');
  const key = env.CONSTRUCT_TELEMETRY_PUBLIC_KEY;
  const secret = env.CONSTRUCT_TELEMETRY_SECRET_KEY;
  if (backend === 'langfuse' && (!key || !secret)) return { status: 'unavailable', summary: 'Langfuse credentials not configured', backend, provider: telemetryProviderLabel(env) };
  if (!baseUrl) return { status: 'unavailable', summary: 'CONSTRUCT_TELEMETRY_URL not set' };
  const headers = {
    ...(key && secret ? { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` } : {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const tracesPath = backend === 'http' ? '/traces?limit=25' : '/api/public/traces?limit=25';
    const res = await fetch(`${baseUrl}${tracesPath}`, { headers, signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      return { status: 'credentials-invalid', summary: `Telemetry credentials rejected (HTTP ${res.status}) — run: construct init` };
    }
    if (!res.ok) return { status: 'degraded', summary: `Telemetry HTTP ${res.status}` };
    const json = await res.json().catch(() => ({}));
    const traces = Array.isArray(json.data) ? json.data : [];
    const counts = { rich: 0, partial: 0, sparse: 0 };

    for (const trace of traces) {
      const observationCount = Number(trace?.observationCount ?? trace?.observations?.length ?? trace?.spanCount ?? trace?.generationCount ?? 0) || 0;
      const hasInput = trace?.input != null;
      const hasOutput = trace?.output != null;
      const metaKeys = trace?.metadata && typeof trace.metadata === 'object' ? Object.keys(trace.metadata).length : 0;
      const hasRichMetadata = metaKeys >= 5;
      const hasPayload = hasInput || hasOutput || metaKeys > 0;
      if ((hasInput || hasOutput) && (observationCount >= 1 || hasRichMetadata)) counts.rich += 1;
      else if (hasPayload || observationCount >= 1) counts.partial += 1;
      else counts.sparse += 1;
    }

    const total = traces.length;
    const coverage = total > 0 ? (counts.rich + counts.partial * 0.5) / total : 0;
    let status = 'configured';
    if (total === 0) status = 'configured';
    else if (coverage >= 0.75) status = 'healthy';
    else if (coverage >= 0.35) status = 'configured';
    else status = 'degraded';

    return {
      status,
      backend,
      provider: telemetryProviderLabel(env),
      total,
      rich: counts.rich,
      partial: counts.partial,
      sparse: counts.sparse,
      coverage: Number(coverage.toFixed(2)),
      summary: total > 0
        ? `Telemetry reachable · ${total} traces · rich ${counts.rich} · partial ${counts.partial} · sparse ${counts.sparse} · coverage ${(coverage * 100).toFixed(0)}%`
        : 'Telemetry reachable · no traces yet',
    };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'timed out' : err.message;
    return { status: 'unavailable', summary: `Telemetry ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeTelemetryHealth() {
  return null;
}

function summarizeRuntime(services) {
  const coreServices = services.filter((service) => service.impactsOverall !== false);
  const optionalServices = services.filter((service) => service.impactsOverall === false);

  const healthy = coreServices.filter((service) => service.status === 'healthy').length;
  const degraded = coreServices.filter((service) => service.status === 'degraded' || service.status === 'credentials-invalid').length;
  const unavailable = coreServices.filter((service) => service.status === 'unavailable').length;
  const optionalUnavailable = optionalServices.filter((service) => service.status !== 'healthy').length;

  let status = 'healthy';
  if (unavailable > 0) status = healthy > 0 ? 'degraded' : 'unavailable';
  else if (degraded > 0) status = 'degraded';

  const parts = [`${healthy}/${coreServices.length} core runtime surfaces reachable`];
  if (degraded > 0) parts.push(`${degraded} degraded`);
  if (unavailable > 0) parts.push(`${unavailable} unavailable`);
  if (optionalUnavailable > 0) parts.push(`${optionalUnavailable} optional unavailable`);

  return {
    status,
    healthy,
    degraded,
    unavailable,
    summary: parts.join(' · '),
  };
}

function summarizeIntegrations(features) {
  const counts = features.reduce((acc, feature) => {
    const key = feature.status ?? 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const summary = [
    counts.healthy ? `${counts.healthy} live` : null,
    counts.configured ? `${counts.configured} configured` : null,
    counts.degraded ? `${counts.degraded} degraded` : null,
    counts.unavailable ? `${counts.unavailable} unavailable` : null,
    counts.disabled ? `${counts.disabled} disabled` : null,
  ].filter(Boolean).join(' · ');

  return { counts, summary: summary || 'No integrations detected' };
}

// Embed daemon provider set is the unified extension registry (lib/extensions/*)
// filtered by capability + credential presence (LMCP-B3) — this reads the same
// ProviderRegistry.fromEnv() the daemon builds, so status can never drift from
// what the daemon actually resolves.

async function summarizeEmbedProviders(env) {
  const registry = await ProviderRegistry.fromEnv(env);
  const available = registry.names().filter((name, idx, all) => all.indexOf(name) === idx);
  const unavailable = registry.unavailable();

  const summary = [
    available.length ? `${available.length} available` : null,
    unavailable.length ? `${unavailable.length} unavailable` : null,
  ].filter(Boolean).join(' · ') || 'no embed providers configured';

  return {
    summary,
    available,
    unavailable: unavailable.map((u) => ({ id: u.id, reason: u.reason })),
  };
}

// Circuit-breaker state (lib/providers/circuit-breaker.mjs) is per resolved
// data-source provider (lib/providers/registry.mjs wraps read/search/watch/
// write/webhook with a breaker keyed 'provider:<id>', failureThreshold=5,
// cooldownMs=30_000 — LMCP-B9). Reading it here through resolveProviders()
// means status can never show a provider getBreaker never wrapped.

async function summarizeProviderBreakers({ rootDir, env }) {
  const { providers, errors } = await resolveProviders({ rootDir, env });
  const entries = Object.keys(providers).sort().map((id) => {
    const breaker = getBreakerState(`provider:${id}`);
    const state = breaker ? breaker.state : 'CLOSED';
    return {
      id,
      state,
      failures: breaker ? breaker.failures : 0,
      lastFailure: breaker?.lastFailure ? breaker.lastFailure.toISOString() : null,
      open: state === 'OPEN',
    };
  });
  const openCount = entries.filter((e) => e.open).length;
  const summary = entries.length === 0
    ? 'No providers configured'
    : openCount > 0
      ? `${openCount} of ${entries.length} provider circuit(s) OPEN`
      : `${entries.length} provider(s), all circuits closed`;
  return { entries, openCount, summary, loadErrors: errors };
}

// Per-actor/run durable consumption (lib/policy/consumption-budget.mjs,
// LMCP-N5) — accrued by lib/mcp/broker.mjs's Broker.invoke whenever a caller
// passes a runId. Rows only exist for runs that have actually consumed
// something, so an empty list here means no run has recorded consumption
// yet, not that budgets are unconfigured.

function summarizeConsumptionBudgets({ rootDir, env }) {
  const store = new ConsumptionBudgetStore({ rootDir, env });
  const entries = store.allEntries().map((entry) => {
    const overBudget = entry.budget
      ? Object.entries(entry.budget).some(([kind, cap]) => Number.isFinite(cap) && entry.consumption[kind] > cap)
      : false;
    return { ...entry, overBudget };
  });
  const overCount = entries.filter((e) => e.overBudget).length;
  const summary = entries.length === 0
    ? 'No run consumption recorded yet'
    : overCount > 0
      ? `${overCount} of ${entries.length} run(s) over budget`
      : `${entries.length} run(s) tracked, all within budget`;
  return { entries, overCount, summary };
}

function summarizePlugins(pluginRegistry) {
  const plugins = pluginRegistry?.plugins ?? [];
  const external = plugins.filter((plugin) => !plugin.builtIn);
  const invalidCount = pluginRegistry?.errors?.length ?? 0;
  const totalMcpCount = pluginRegistry?.mcps?.length ?? 0;

  let status = 'healthy';
  if (invalidCount > 0) status = 'degraded';
  else if (external.length === 0) status = 'configured';

  const summary = [
    `${plugins.length} plugin${plugins.length === 1 ? '' : 's'}`,
    `${external.length} external`,
    `${totalMcpCount} MCP entries`,
    invalidCount ? `${invalidCount} errors` : null,
  ].filter(Boolean).join(' · ');

  return {
    status,
    total: plugins.length,
    external: external.length,
    builtIn: plugins.length - external.length,
    totalMcpCount,
    invalidCount,
    summary,
  };
}

export function buildPublicHealthSurface({
  cwd = process.cwd(),
  contextInspection = inspectContextState(cwd),
  executionContractModel = null,
} = {}) {
  return {
    context: {
      hasFile: Boolean(contextInspection?.hasFile),
      source: contextInspection?.source ?? 'missing',
      savedAt: contextInspection?.savedAt ?? null,
      summary: contextInspection?.summary ?? null,
    },
    coordination: {
      authority: 'external-tracker-plus-plan',
      fileOwnershipRule: 'single-writer',
      memoryRole: 'cross-session-recall',
    },
    metadataPresence: {
      executionContractModel: Boolean(executionContractModel?.version),
      contextState: contextInspection?.source === 'json',
    },
  };
}

function traceBackendDefinition(env) {
  const backend = resolveTraceBackend(env);
  const provider = telemetryProviderLabel(env);
  if (backend === 'local' || backend === 'none') {
    return {
      id: 'telemetry',
      name: 'Telemetry',
      url: 'local://<state-root>/traces',
      runtime: 'local',
      note: backend === 'none' ? 'Remote disabled; local JSONL preserved' : 'Local JSONL traces',
      healthyMessage: 'Local trace capture enabled',
      impactsOverall: false,
      selfCheck: {
        status: backend === 'none' ? 'disabled' : 'healthy',
        message: backend === 'none' ? 'Remote telemetry disabled' : 'Writing <state-root>/traces/*.jsonl',
      },
    };
  }
  if (backend === 'otel') {
    const endpoint = (env.CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT ?? '').replace(/\/$/, '');
    return {
      id: 'telemetry',
      name: 'Telemetry',
      url: endpoint || '(not configured)',
      probeUrl: '',
      runtime: 'remote',
      note: `${provider} trace export`,
      healthyMessage: 'Configured',
      impactsOverall: false,
      selfCheck: {
        status: endpoint ? 'configured' : 'unavailable',
        message: endpoint ? `OTLP export configured: ${endpoint}` : 'CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT not set',
      },
    };
  }
  const url = (env.CONSTRUCT_TELEMETRY_URL ?? '').replace(/\/$/, '');
  const pubKey = env.CONSTRUCT_TELEMETRY_PUBLIC_KEY || '';
  const secKey = env.CONSTRUCT_TELEMETRY_SECRET_KEY || '';
  const auth = pubKey && secKey ? `Basic ${Buffer.from(`${pubKey}:${secKey}`).toString('base64')}` : '';
  return {
    id: 'telemetry',
    name: 'Telemetry',
    url: url || '(not configured)',
    probeUrl: url ? `${url}${backend === 'http' ? '/traces?limit=1' : '/api/public/traces?limit=1'}` : '',
    probeHeaders: auth ? { Authorization: auth } : undefined,
    runtime: 'live',
    note: `${provider} trace export`,
    healthyMessage: 'Reachable',
    impactsOverall: false,
  };
}

function serviceDefinitions(env) {
  const memoryPort = parsePort(env.MEMORY_PORT, 8765);
  const bridgePort = parsePort(env.BRIDGE_PORT, 5173);

  return [
    traceBackendDefinition(env),
    {
      id: 'memory',
      name: 'Memory (cm)',
      url: `http://127.0.0.1:${memoryPort}`,
      probeUrl: `http://127.0.0.1:${memoryPort}/`,
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      runtime: 'live',
      note: 'MCP-managed',
      healthyMessage: 'Reachable',
      impactsOverall: false,
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      url: `http://127.0.0.1:${bridgePort}`,
      runtime: 'live',
      note: 'Optional web UI',
      healthyMessage: 'Reachable',
      impactsOverall: false,
    },
  ];
}

// Storage health: real filesystem state plus a live LanceDB open probe (tableNames() call).
// A corrupted or locked store reports unhealthy. A timeout (default 2000ms) prevents a
// locked DB from stalling `construct status`. Results are cached with a short TTL.

const STORAGE_PROBE_CACHE = new Map();
const STORAGE_PROBE_CACHE_TTL_MS = 5000;

// Exported for testing: allows callers to inject a custom lancedb opener and clock.
export async function probeStorageHealth(
  cwd,
  {
    fsExistsSync = existsSync,
    lancedbOpener = null,
    probeTimeoutMs = 2000,
    now = () => Date.now(),
  } = {},
) {
  const cxExists = fsExistsSync(join(cwd, '.cx'));
  const lancedbPath = join(cwd, '.cx', 'lancedb');
  const lancedbExists = fsExistsSync(lancedbPath);

  const sqlStore = { mode: 'lancedb', label: 'LanceDB + Git-Backed', dbUrl: null, vectorEnabled: true };

  if (!cxExists) {
    return {
      sqlStore,
      sqlHealth: { status: 'unavailable', message: 'Local store not initialized (.cx/ absent)' },
      vectorStore: { enabled: false, backend: 'lancedb', label: 'Embedded LanceDB' },
    };
  }

  if (!lancedbExists) {
    return {
      sqlStore,
      sqlHealth: { status: 'degraded', message: 'Local embedded — no vector index yet (.cx/lancedb absent)' },
      vectorStore: { enabled: false, backend: 'lancedb', label: 'Embedded LanceDB' },
    };
  }

  // Check cache before probing.
  const cacheKey = lancedbPath;
  const cached = STORAGE_PROBE_CACHE.get(cacheKey);
  if (cached && now() - cached.at < STORAGE_PROBE_CACHE_TTL_MS) {
    return cached.result;
  }

  // Probe the LanceDB store: open it and call tableNames() with a timeout.
  let sqlHealth;
  try {
    const opener = lancedbOpener ?? (async (p) => {
      const ldb = await import('@lancedb/lancedb');
      return ldb.connect(p);
    });

    const probeResult = await Promise.race([
      (async () => {
        const db = await opener(lancedbPath);
        await db.tableNames();
        return { status: 'healthy', message: 'Local embedded' };
      })(),
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ status: 'unhealthy', reason: 'LanceDB open timed out' }),
          probeTimeoutMs,
        ),
      ),
    ]);

    if (probeResult.status === 'unhealthy') {
      sqlHealth = { status: 'unhealthy', message: probeResult.reason };
    } else {
      sqlHealth = probeResult;
    }
  } catch (err) {
    sqlHealth = { status: 'unhealthy', message: `LanceDB open failed: ${err?.message ?? String(err)}` };
  }

  const result = {
    sqlStore,
    sqlHealth,
    vectorStore: {
      enabled: sqlHealth.status === 'healthy',
      backend: 'lancedb',
      label: 'Embedded LanceDB',
    },
  };

  STORAGE_PROBE_CACHE.set(cacheKey, { at: now(), result });
  return result;
}

// categorizeEnterpriseCapability (ADR-0057's active/fail-closed/later/absent
// partition) lives in mode-capabilities.mjs — the single authoritative registry
// module — and is re-exported here so existing status.mjs consumers/tests don't
// need a second import path.
export { categorizeEnterpriseCapability } from './mode-capabilities.mjs';

export async function buildStatus({
  rootDir,
  cwd = process.cwd(),
  homeDir = homedir(),
  env = process.env,
  probeService = defaultProbeService,
} = {}) {
  if (!rootDir) throw new Error('rootDir is required');

  const mergedEnv = loadConstructEnv({ rootDir, homeDir, env });

  const pkg = readJSON(join(rootDir, 'package.json')) ?? {};
  let registry;
  try {
    registry = loadRegistry({ rootDir });
  } catch {
    registry = { teams: {}, specialists: {}, contracts: {}, policies: {} };
  }
  const settings = readJSON(join(homeDir, '.claude', 'settings.json')) ?? {};
  // MCP server definitions live in ~/.claude.json's top-level `mcpServers`, not
  // settings.json (settings.json carries hooks/permissions only — construct-ranh).
  const claudeUserConfig = readJSON(join(homeDir, '.claude.json')) ?? {};
  const features = await checkAllFeatures({ homeDir, cwd, env: mergedEnv });
  const pluginRegistry = loadPluginRegistry({ cwd, homeDir, rootDir, env: mergedEnv });
  const services = [];

  for (const definition of serviceDefinitions(mergedEnv)) {
    if (definition.selfCheck) {
      const check = definition.selfCheck;
      services.push({
        ...definition,
        status: check.status,
        message: check.message,
        selfCheck: undefined,
      });
      continue;
    }

    const result = normalizeProbeResult(await probeService({
      ...definition,
      url: definition.probeUrl ?? definition.url,
    }));

    const { probeHeaders, ...safeDef } = definition;
    services.push({
      ...safeDef,
      status: result.status ?? 'unavailable',
      message: result.message ?? '',
    });
  }

  const runtime = summarizeRuntime(services);
  const integrations = summarizeIntegrations(features);
  const embedProviders = await summarizeEmbedProviders(mergedEnv);
  const providerBreakers = await summarizeProviderBreakers({ rootDir: cwd, env: mergedEnv });
  const consumptionBudgets = summarizeConsumptionBudgets({ rootDir: cwd, env: mergedEnv });
  const plugins = summarizePlugins(pluginRegistry);
  const contextInspection = inspectContextState(cwd);
  const sessionEfficiency = readSessionEfficiency(homeDir);
  const sessionUsage = readSessionUsage(homeDir);
  const telemetryRichness = readTelemetryRichness(homeDir)
    ?? summarizeTelemetryHealth()
    ?? await fetchTelemetryStatus(mergedEnv);

  // Fire-and-forget: post backfill observations to sparse traces when coverage is low.
  triggerAutoBackfillIfSparse(telemetryRichness, { ...mergedEnv });
  const efficiencyDigest = summarizeEfficiencyData(readEfficiencyLog(homeDir));
  const activeOverlays = getActiveOverlays(cwd);
  const { sqlStore, vectorStore, sqlHealth } = await probeStorageHealth(cwd);
  const promotionRequests = getPromotionRequests(cwd);
  const degradationDetails = readDegradationRecords(cwd);
  const personaDegradedRuns = countPersonaDegradedRuns(cwd);
  const recentRunExecutionStates = summarizeRecentRunExecutionStates(cwd);
  const workflows = summarizeGraphWorkflows(cwd);
  const executionContractModel = resolveExecutionContractModelMetadata({
    envValues: mergedEnv,
    registryModels: registry.models ?? {},
    requestedTier: selectModelTierForWorkCategory(null),
    workCategory: null,
  });
  const publicHealth = buildPublicHealthSurface({
    cwd,
    contextInspection,
    executionContractModel,
  });

  const personas = registry.orchestrator
    ? {
        name: registry.orchestrator.name,
        displayName: registry.orchestrator.displayName ?? registry.orchestrator.name,
        role: registry.orchestrator.role ?? '',
        description: registry.orchestrator.description ?? '',
        modelTier: registry.orchestrator.modelTier ?? 'standard',
      }
    : null;

  const prefix = `${registry.prefix ?? 'cx'}-`;
  const specialists = Object.values(registry.specialists ?? {}).map((specialist) => ({
    name: `${prefix}${specialist.name}`,
    description: specialist.description ?? '',
    modelTier: specialist.modelTier ?? 'standard',
  }));

  const hooks = [];
  for (const [phase, entries] of Object.entries(settings.hooks ?? {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      hooks.push({
        id: `${phase.toLowerCase()}:${(entry.description ?? entry.command ?? '').toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40)}`,
        phase,
        description: entry.description ?? entry.command ?? '',
        blocking: !entry.background,
      });
    }
  }

  const deploymentMode = getDeploymentMode(mergedEnv);
  const resourceMode = resolveResourceMode(deploymentMode);
  const capStatus = getModeCapabilityStatus(deploymentMode);
  const unsupportedCaps = getUnsupportedCapabilities(deploymentMode);
  const teamHealth = deploymentMode === 'team' || deploymentMode === 'enterprise'
    ? await summarizeTeamHealth({ rootDir: cwd, env: mergedEnv })
    : null;
  const sharedState = deploymentMode === 'team' || deploymentMode === 'enterprise'
    ? await summarizeSharedState(cwd, mergedEnv, loadProjectConfig(cwd, mergedEnv).config)
    : null;

  // Enterprise mode: build a per-capability truth table so status/doctor can show
  // the real implementation state rather than a single aggregate label.
  // The overall enterprise verdict is 'unsupported' until all three ADR-0057
  // IMPLEMENT-NOW capabilities (tenant-isolation, rbac, mandatory-audit) are
  // marked 'implemented' in mode-capabilities.mjs.
  const ENTERPRISE_IMPLEMENT_NOW_IDS = new Set(['tenant-isolation', 'rbac', 'mandatory-audit']);
  let enterpriseCapabilityTable = null;
  let enterpriseVerdict = null;
  if (deploymentMode === 'enterprise') {
    const allCaps = getCapabilities('enterprise');
    enterpriseCapabilityTable = allCaps.map((cap) => ({
      id: cap.id,
      label: cap.label,
      status: cap.status,
      category: categorizeEnterpriseCapability(cap),
      implementNow: ENTERPRISE_IMPLEMENT_NOW_IDS.has(cap.id),
    }));
    const implementNowDone = allCaps
      .filter((cap) => ENTERPRISE_IMPLEMENT_NOW_IDS.has(cap.id))
      .every((cap) => cap.status === 'implemented');
    enterpriseVerdict = implementNowDone ? 'supported' : 'unsupported';
  }

  return {
    version: pkg.version ?? '1.0.0',
    lastSync: newestMtime(join(homeDir, '.claude', 'agents')),
    deployment: {
      mode: deploymentMode,
      resourceMode,
      description: describeDeploymentMode(deploymentMode),
      capabilityStatus: capStatus,
      unsupportedCapabilities: capStatus !== 'fully-implemented' ? unsupportedCaps : [],
      ...(deploymentMode === 'enterprise' && {
        enterpriseCapabilityTable,
        enterpriseVerdict,
      }),
    },
    system: {
      overall: runtime,
      services,
      integrations,
      plugins,
    },
    features,
    embedProviders,
    providerBreakers,
    consumptionBudgets,
    plugins: {
      status: plugins.status,
      summary: plugins.summary,
      directories: pluginRegistry.pluginDirs,
      errors: pluginRegistry.errors,
      entries: pluginRegistry.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        capabilities: plugin.capabilities ?? [],
        builtIn: Boolean(plugin.builtIn),
        manifestPath: plugin.manifestPath,
        mcpCount: (plugin.mcps ?? []).length,
        mcps: (plugin.mcps ?? []).map((mcp) => ({
          id: mcp.id,
          name: mcp.name,
          category: mcp.category,
        })),
      })),
    },
    personas,
    specialists,
    hooks,
    skills: listSkills(rootDir),
    commands: listCommands(rootDir),
    cliCommands: CLI_COMMANDS,
    mcpServers: Object.keys(claudeUserConfig.mcpServers ?? settings.mcpServers ?? {}),
    publicHealth,
    storage: {
      sql: sqlStore,
      vector: vectorStore,
      health: {
        sql: sqlHealth,
        vector: vectorStore.mode === 'remote' || vectorStore.mode === 'local'
          ? { status: 'configured', message: `Vector retrieval configured (${vectorStore.mode})` }
          : { status: 'unavailable', message: 'No vector index configured; using file-state only' },
      },
    },
    teamHealth,
    sharedState,
    executionContractModel,
    sessionEfficiency,
    efficiencyDigest,
    sessionUsage,
    telemetryRichness,
    overlays: activeOverlays,
    promotionRequests,
    degradationDetails,
    personaDegradedRuns,
    recentRunExecutionStates,
    workflows,
  };
}

function serviceIcon(status) {
  if (status === 'healthy' || status === 'configured') return '✓';
  if (status === 'degraded') return '⚠';
  return '✗';
}

function statusLabel(status) {
  const labels = {
    healthy: 'healthy',
    degraded: 'degraded',
    unavailable: 'unavailable',
    configured: 'configured',
    disabled: 'disabled',
    pass: 'pass',
    warn: 'warn',
    fail: 'fail',
    missing: 'missing',
  };
  return labels[status] ?? status;
}

export function formatStatusReport(status) {
  const lines = [];
  lines.push('Construct Status');
  lines.push('════════════════');
  lines.push('');
  lines.push(`Overall: ${statusLabel(status.system.overall.status)} · ${status.system.overall.summary}`);
  if (status.deployment?.mode) {
    const r = status.deployment.resourceMode || {};
    lines.push(`Deployment: ${status.deployment.mode} · queue:${r.queue} · workers:${r.workers} · telemetry:${r.telemetry}`);
    if (status.deployment.capabilityStatus && status.deployment.capabilityStatus !== 'fully-implemented') {
      const caps = status.deployment.unsupportedCapabilities ?? [];
      lines.push(`Mode capabilities: ${status.deployment.capabilityStatus} · ${caps.length} not fully implemented: ${caps.map(c => c.label).join(', ')}`);
    }
    if (status.deployment.mode === 'enterprise') {
      lines.push(`Enterprise verdict: ${status.deployment.enterpriseVerdict ?? 'unsupported'}`);
      lines.push('WARNING: Enterprise mode: most capabilities not yet implemented. See construct status for details.');
      // ADR-0057 status contract: render only active/fail-closed/later — never a
      // bare 'not-implemented' that could read as active, and never collapse
      // fail-closed (hard-errors at runtime) into later (no runtime effect) or
      // vice versa. A capability categorized 'absent' is not advertised at all.
      const table = (status.deployment.enterpriseCapabilityTable ?? []).filter((cap) => cap.category !== 'absent');
      if (table.length > 0) {
        lines.push('Enterprise capability table:');
        for (const cap of table) {
          const icon = cap.category === 'active' ? '✓' : cap.category === 'fail-closed' ? '✗' : '·';
          const tag = cap.implementNow ? ' [implement-now]' : '';
          lines.push(`  ${icon} ${cap.label} (${cap.category})${tag}`);
        }
      }
    }
  }
  lines.push('Coordination: external tracker + plan.md · single-writer per file · cass-memory for recall');
  if (status.executionContractModel?.selectedTier && status.executionContractModel?.selectedModel) {
    lines.push(`Execution contract: ${status.executionContractModel.selectedTier} · ${status.executionContractModel.selectedModel} (${status.executionContractModel.selectedModelSource})`);
  }
  if (status.storage?.sql || status.storage?.vector) {
    lines.push(`Storage: ${status.storage.sql?.mode ?? 'unknown'} SQL · ${status.storage.vector?.mode ?? 'unknown'} vector`);
    lines.push(`Storage health: SQL ${status.storage.health?.sql?.status ?? 'unknown'} · vector ${status.storage.health?.vector?.status ?? 'unknown'}`);
  }
  if (status.teamHealth) {
    lines.push(`Team health: ${statusLabel(status.teamHealth.status)} · ${status.teamHealth.summary}`);
  }
  if (status.sharedState) {
    if (status.sharedState.status === 'unavailable') {
      lines.push('Shared state: unavailable · no team trace/memory store configured');
    } else {
      lines.push(`Shared state: ${status.sharedState.recentTraces.length} recent team trace(s) · ${status.sharedState.sharedMemory.length} shared memory record(s)`);
    }
  }
  if (status.sessionEfficiency) {
    lines.push(`Efficiency: ${statusLabel(status.sessionEfficiency.status)} · score ${status.sessionEfficiency.score.toFixed(2)} · ${status.sessionEfficiency.summary}`);
    for (const warning of status.sessionEfficiency.warnings ?? []) {
      lines.push(`Warning: ${warning}`);
    }
  }
  if (status.efficiencyDigest) {
    lines.push(`Context: ${statusLabel(status.efficiencyDigest.status)} · ${status.efficiencyDigest.summary}`);
    lines.push(`  ${status.efficiencyDigest.recommendation}`);
  }
  if (status.sessionUsage) {
    const cacheNote = status.sessionUsage.cacheHitRate > 0
      ? ` · cache ${(status.sessionUsage.cacheHitRate * 100).toFixed(1)}% hit`
      : '';
    lines.push(`Usage: ${statusLabel(status.sessionUsage.status)} · ${status.sessionUsage.summary}${cacheNote}`);
    if (status.sessionUsage.lastInteraction) {
      lines.push(
        `Last interaction: ${status.sessionUsage.lastInteraction.providerTotalTokens.toLocaleString()} provider total` +
        ` · ${status.sessionUsage.lastInteraction.billedTotalTokens.toLocaleString()} billed total` +
        ` (${status.sessionUsage.lastInteraction.inputTokens.toLocaleString()} uncached in / ` +
        `${status.sessionUsage.lastInteraction.outputTokens.toLocaleString()} out / ` +
        `${Number(status.sessionUsage.lastInteraction.reasoningTokens || 0).toLocaleString()} reasoning)`,
      );
    }
  }
  if (status.telemetryRichness) {
    lines.push(`Telemetry: ${statusLabel(status.telemetryRichness.status)} · ${status.telemetryRichness.summary}`);
  }
  if ((status.overlays ?? []).length > 0) {
    lines.push(`Overlays: ${status.overlays.length} active`);
    for (const overlay of status.overlays) {
      lines.push(`  - ${overlay.domain} · ${overlay.focus} · ${overlay.attachTo.join(', ')}`);
    }
  }
  if ((status.promotionRequests ?? []).length > 0) {
    lines.push(`Promotion requests: ${status.promotionRequests.length}`);
    for (const request of status.promotionRequests) {
      const challenge = request.challenge?.status ? ` · challenge ${request.challenge.status}` : '';
      lines.push(`  - ${request.domain} · ${request.status}${challenge}`);
    }
  }
  if ((status.degradationDetails ?? []).length > 0) {
    lines.push('Degradation details:');
    for (const d of status.degradationDetails) {
      lines.push(`  ${d.subsystem}: declared=${d.declared} actual=${d.actual} (${d.reason})`);
    }
  }
  if ((status.personaDegradedRuns?.total ?? 0) > 0) {
    lines.push(`Persona-degraded runs: ${status.personaDegradedRuns.total} (solo-mode persona-fallback)`);
  }
  if ((status.recentRunExecutionStates?.total ?? 0) > 0) {
    const b = status.recentRunExecutionStates.byState;
    lines.push(
      `Recent runs: ${status.recentRunExecutionStates.total} total`
      + ` · prepared ${b.prepared}` + ` · executed ${b.executed}`
      + ` · degraded-executed ${b['degraded-executed']}` + ` · failed ${b.failed}`
      + (b.unknown ? ` · unknown ${b.unknown}` : ''),
    );
    for (const r of status.recentRunExecutionStates.recent.slice(0, 5)) {
      lines.push(`  ${r.runId}: executionState=${r.executionState} (status=${r.status})`);
    }
  }
  if (status.workflows) {
    lines.push('');
    if (!status.workflows.graphBuilt) {
      lines.push('Workflows: living graph not built yet — run `construct graph build`');
    } else {
      const w = status.workflows;
      lines.push(`Workflows: ${w.available.length} available · ${w.degraded.length} degraded · ${w.missing.length} missing (source: graph validate)`);
      for (const entry of w.degraded) {
        const reason = entry.errors[0] || entry.warnings[0] || (entry.lastExecution?.outcome === 'failed' ? 'last run failed' : 'degraded');
        lines.push(`  ⚠ ${entry.type} — ${reason}`);
      }
      for (const entry of w.missing) {
        lines.push(`  ✗ ${entry.type} — ${entry.reason}`);
      }
    }
  }
  lines.push('');
  lines.push('Runtime');
  for (const service of status.system.services) {
    const suffix = service.note ? ` (${service.note})` : '';
    const detail = service.message ? ` — ${service.message}` : '';
    lines.push(`  ${serviceIcon(service.status)} ${service.name.padEnd(14)} ${service.url}${suffix}${detail}`);
  }
  lines.push('');
  lines.push(`Integrations: ${status.system.integrations.summary}`);
  for (const feature of status.features) {
    lines.push(`  ${serviceIcon(feature.status)} ${feature.name.padEnd(22)} ${statusLabel(feature.status)} — ${feature.message}`);
  }
  if (status.embedProviders) {
    lines.push('');
    lines.push(`Embed providers: ${status.embedProviders.summary}`);
    for (const name of status.embedProviders.available) {
      lines.push(`  ${serviceIcon('healthy')} ${name.padEnd(22)} configured`);
    }
    for (const entry of status.embedProviders.unavailable) {
      lines.push(`  ${serviceIcon('unavailable')} ${entry.id.padEnd(22)} configured but unavailable — ${entry.reason}`);
    }
  }
  if (status.providerBreakers && status.providerBreakers.entries.length > 0) {
    lines.push('');
    lines.push(`Provider circuits: ${status.providerBreakers.summary}`);
    for (const entry of status.providerBreakers.entries) {
      const icon = entry.open ? serviceIcon('unavailable') : serviceIcon('healthy');
      const detail = entry.open ? ` — OPEN since ${entry.lastFailure} (${entry.failures} failures)` : '';
      lines.push(`  ${icon} ${entry.id.padEnd(22)} ${entry.state}${detail}`);
    }
  }
  if (status.consumptionBudgets && status.consumptionBudgets.entries.length > 0) {
    lines.push('');
    lines.push(`Run consumption: ${status.consumptionBudgets.summary}`);
    for (const entry of status.consumptionBudgets.entries) {
      const icon = entry.overBudget ? serviceIcon('unavailable') : serviceIcon('healthy');
      const budgetNote = entry.budget
        ? `tokens ${entry.consumption.tokens}/${entry.budget.tokens} · toolCalls ${entry.consumption.toolCalls}/${entry.budget.toolCalls}`
        : `tokens ${entry.consumption.tokens} · toolCalls ${entry.consumption.toolCalls} (unbounded)`;
      lines.push(`  ${icon} ${entry.actor}/${entry.runId} — ${budgetNote}`);
    }
  }
  if (status.plugins) {
    lines.push('');
    lines.push(`Plugins: ${statusLabel(status.plugins.status)} · ${status.plugins.summary}`);
    for (const plugin of status.plugins.entries ?? []) {
      const source = plugin.builtIn ? 'built-in' : plugin.manifestPath;
      lines.push(`  ${serviceIcon(plugin.builtIn ? 'configured' : 'healthy')} ${plugin.name.padEnd(22)} ${plugin.version} — ${source}`);
    }
    for (const error of status.plugins.errors ?? []) {
      lines.push(`  ${serviceIcon('degraded')} manifest error — ${error}`);
    }
  }

  // Service URLs and repo paths become Cmd-clickable on an interactive stream; on
  // a pipe or in CI links resolve off and colors are empty, so the report stays
  // byte-identical for machine consumers and tests.

  const colors = resolveUiColors();
  const enabled = terminalLinksEnabled(process.env, { stream: process.stdout });
  const rendered = lines.map((line) => applyLinks(line, colors, { enabled })).join('\n');
  return `${rendered}\n`;
}

export async function printStatus(options = {}) {
  const status = await buildStatus(options);
  process.stdout.write(formatStatusReport(status));
}

if (process.argv[1] && process.argv[1].endsWith('/status.mjs')) {
  const args = new Set(process.argv.slice(2));
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const rootDir = join(moduleDir, '..');
  const status = await buildStatus({
    rootDir,
    cwd: process.cwd(),
  });
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  } else {
    process.stdout.write(formatStatusReport(status));
  }
}
