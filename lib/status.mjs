/**
 * lib/status.mjs — Project health summary for the Construct CLI.
 *
 * Reads workflow state, plan.md, tracker config, and MCP surface to produce a
 * structured health object. Called by `construct status`, the MCP status tool,
 * and the session-start bootstrap to surface blocked tasks and open questions.
 */
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
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
      url: 'local://.cx/traces',
      runtime: 'local',
      note: backend === 'none' ? 'Remote disabled; local JSONL preserved' : 'Local JSONL traces',
      healthyMessage: 'Local trace capture enabled',
      impactsOverall: false,
      selfCheck: {
        status: backend === 'none' ? 'disabled' : 'healthy',
        message: backend === 'none' ? 'Remote telemetry disabled' : 'Writing .cx/traces/*.jsonl',
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
  const registry = readJSON(join(rootDir, 'specialists', 'unified-registry.json')) ?? {};
  const settings = readJSON(join(homeDir, '.claude', 'settings.json')) ?? {};
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
  const sqlStore = { mode: 'lancedb', label: 'LanceDB + Git-Backed', dbUrl: null, vectorEnabled: true };
  const vectorStore = { enabled: true, backend: 'lancedb', label: 'Embedded LanceDB' };
  const sqlHealth = { status: 'healthy', message: 'Local embedded' };
  const promotionRequests = getPromotionRequests(cwd);
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

  return {
    version: pkg.version ?? '1.0.0',
    lastSync: newestMtime(join(homeDir, '.claude', 'agents')),
    deployment: {
      mode: deploymentMode,
      resourceMode,
      description: describeDeploymentMode(deploymentMode),
    },
    system: {
      overall: runtime,
      services,
      integrations,
      plugins,
    },
    features,
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
    mcpServers: Object.keys(settings.mcpServers ?? {}),
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
    executionContractModel,
    sessionEfficiency,
    efficiencyDigest,
    sessionUsage,
    telemetryRichness,
    overlays: activeOverlays,
    promotionRequests,
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
  }
  lines.push('Coordination: external tracker + plan.md · single-writer per file · cass-memory for recall');
  if (status.executionContractModel?.selectedTier && status.executionContractModel?.selectedModel) {
    lines.push(`Execution contract: ${status.executionContractModel.selectedTier} · ${status.executionContractModel.selectedModel} (${status.executionContractModel.selectedModelSource})`);
  }
  if (status.storage?.sql || status.storage?.vector) {
    lines.push(`Storage: ${status.storage.sql?.mode ?? 'unknown'} SQL · ${status.storage.vector?.mode ?? 'unknown'} vector`);
    lines.push(`Storage health: SQL ${status.storage.health?.sql?.status ?? 'unknown'} · vector ${status.storage.health?.vector?.status ?? 'unknown'}`);
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
  return `${lines.join('\n')}\n`;
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
