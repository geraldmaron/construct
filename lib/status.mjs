/**
 * lib/status.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { inspectContextState } from './context-state.mjs';
import { inspectWorkflowHealth, loadWorkflow } from './workflow-state.mjs';
import { CLI_COMMANDS } from './cli-commands.mjs';
import { checkAllFeatures } from './features.mjs';
import { loadConstructEnv } from './env-config.mjs';
import { getActiveOverlays, getPromotionRequests } from './headhunt.mjs';
import { resolveExecutionContractModelMetadata, selectModelTierForWorkCategory } from './model-router.mjs';
import { readCostLog, summarizeCostData, normalizeCostEntry } from './cost.mjs';
import { readEfficiencyLog, summarizeEfficiencyData } from './efficiency.mjs';
import { describeSqlStore, sqlStoreHealth } from './storage/sql-store.mjs';
import { describeVectorStore } from './storage/vector-store.mjs';
import { describeSqlStoreHealth } from './storage/sql-store.mjs';
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
  const stats = readJSON(join(homeDir, '.cx', 'session-efficiency.json'));
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
  const stats = readJSON(join(homeDir, '.cx', 'session-telemetry.json'));
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
      totalTokens: 0,
      totalCostUsd: 0,
      summary: 'No token usage recorded yet',
      lastInteraction: null,
      source: join(homeDir, '.cx', 'session-cost.jsonl'),
      lastUpdatedAt: null,
    };
  }

  const lastEntry = entries[entries.length - 1] || {};
  const normalizedLast = normalizeCostEntry(lastEntry);
  const lastInteraction = {
    timestamp: lastEntry.ts || null,
    inputTokens: normalizedLast.inputTokens,
    outputTokens: normalizedLast.outputTokens,
    cacheReadInputTokens: normalizedLast.cacheReadInputTokens,
    cacheCreationInputTokens: normalizedLast.cacheCreationInputTokens,
    processedInputTokens: normalizedLast.processedInputTokens,
    totalTokens: normalizedLast.totalTokens,
    costUsd: normalizedLast.costUsd,
  };

  const data = summarizeCostData(entries);

  return {
    status: 'available',
    interactions: data.interactions,
    inputTokens: data.totalInputTokens,
    outputTokens: data.totalOutputTokens,
    cacheReadInputTokens: data.cacheReadInputTokens,
    cacheCreationInputTokens: data.cacheCreationInputTokens,
    processedInputTokens: data.processedInputTokens,
    cachedTokens: data.cachedTokens,
    cacheReadRate: data.cacheReadRate,
    cacheHitRate: data.cacheReadRate,
    totalTokens: data.totalTokens,
    totalCostUsd: data.totalCostUsd,
    summary: `${data.interactions} interaction${data.interactions === 1 ? '' : 's'} · ${data.totalTokens.toLocaleString()} tokens · $${data.totalCostUsd.toFixed(2)}`,
    lastInteraction,
    source: join(homeDir, '.cx', 'session-cost.jsonl'),
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

async function probeHttp(url, { method = 'GET', headers, body, timeout = 2000 } = {}) {
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

function normalizeProbeResult(result) {
  if (typeof result === 'string') {
    return { status: result };
  }
  return result ?? { status: 'unavailable', message: 'Probe failed' };
}

async function defaultProbeService(service) {
  const result = service.method === 'POST'
    ? await probeHttp(service.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: service.body,
      })
    : await probeHttp(service.url);

  if (result.ok) return { status: 'healthy', message: service.healthyMessage ?? 'Reachable' };
  if (result.statusCode) return { status: 'degraded', message: `HTTP ${result.statusCode}` };
  if (result.error?.name === 'AbortError') return { status: 'unavailable', message: 'Timed out' };
  if (result.error?.cause?.code === 'ECONNREFUSED' || result.error?.code === 'ECONNREFUSED') {
    return { status: 'unavailable', message: 'Connection refused' };
  }
  return { status: 'unavailable', message: result.error?.message ?? 'Connection failed' };
}

async function fetchLangfuseTelemetryStatus(env, { timeout = 2500 } = {}) {
  const baseUrl = (env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
  const key = env.LANGFUSE_PUBLIC_KEY;
  const secret = env.LANGFUSE_SECRET_KEY;
  if (!key || !secret) return { status: 'unavailable', summary: 'Langfuse credentials not configured' };
  const headers = {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${baseUrl}/api/public/traces?limit=25`, { headers, signal: controller.signal });
    if (!res.ok) return { status: 'unavailable', summary: `Langfuse HTTP ${res.status}` };
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
      // Rich: has meaningful input/output AND (at least one observation OR rich metadata with 5+ keys).
      // This correctly scores event-style traces (session, message) that carry metadata instead of spans.
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
      backend: 'langfuse',
      total,
      rich: counts.rich,
      partial: counts.partial,
      sparse: counts.sparse,
      coverage: Number(coverage.toFixed(2)),
      summary: total > 0
        ? `Langfuse reachable · ${total} traces · rich ${counts.rich} · partial ${counts.partial} · sparse ${counts.sparse} · coverage ${(coverage * 100).toFixed(0)}%`
        : 'Langfuse reachable · no traces yet',
    };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'timed out' : err.message;
    return { status: 'unavailable', summary: `Langfuse ${msg}` };
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
  const degraded = coreServices.filter((service) => service.status === 'degraded').length;
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

function workflowStatusSummary(workflow, cwd) {
  const health = inspectWorkflowHealth(workflow, { cwd });
  return {
    cwd,
    exists: health.exists,
    status: health.alignment.status,
    summary: health.summary,
    state: workflow,
    findings: health.alignment.findings,
  };
}

export function buildPublicHealthSurface({
  cwd = process.cwd(),
  contextInspection = inspectContextState(cwd),
  workflow = loadWorkflow(cwd),
  executionContractModel = null,
} = {}) {
  const workflowHealth = inspectWorkflowHealth(workflow, { cwd });

  return {
    activeTask: workflowHealth.activeTask,
    context: {
      hasFile: Boolean(contextInspection?.hasFile),
      source: contextInspection?.source ?? 'missing',
      savedAt: contextInspection?.savedAt ?? null,
      summary: contextInspection?.summary ?? null,
    },
    workflow: {
      exists: workflowHealth.exists,
      phase: workflowHealth.phase,
      lifecycleStatus: workflowHealth.lifecycleStatus,
      currentTaskKey: workflowHealth.currentTaskKey,
      summary: workflowHealth.summary,
    },
    alignment: workflowHealth.alignment,
    metadataPresence: {
      executionContractModel: Boolean(executionContractModel?.version),
      contextState: contextInspection?.source === 'json',
    },
  };
}

function traceBackendDefinition(env) {
  const langfuseUrl = (env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
  return {
    id: 'langfuse',
    name: 'Langfuse',
    url: langfuseUrl,
    probeUrl: `${langfuseUrl}/api/public/health`,
    runtime: 'live',
    note: 'Trace backend',
    healthyMessage: 'Reachable',
  };
}

function serviceDefinitions(env, dashboardPort, selfDashboard) {
  const memoryPort = parsePort(env.MEMORY_PORT, 8765);
  const bridgePort = parsePort(env.BRIDGE_PORT, 5173);

  return [
    {
      id: 'dashboard',
      name: 'Dashboard',
      url: `http://127.0.0.1:${dashboardPort}`,
      runtime: 'live',
      note: selfDashboard ? 'Current process' : 'Dashboard API',
      healthyMessage: selfDashboard ? 'Serving status API' : 'Reachable',
      selfHealthy: selfDashboard,
    },
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
  dashboardPort,
  selfDashboard = false,
  probeService = defaultProbeService,
} = {}) {
  if (!rootDir) throw new Error('rootDir is required');

  const mergedEnv = loadConstructEnv({ rootDir, homeDir, env });
  const resolvedDashboardPort = parsePort(dashboardPort ?? mergedEnv.DASHBOARD_PORT, 4242);

  const pkg = readJSON(join(rootDir, 'package.json')) ?? {};
  const registry = readJSON(join(rootDir, 'agents', 'registry.json')) ?? {};
  const settings = readJSON(join(homeDir, '.claude', 'settings.json')) ?? {};
  const features = await checkAllFeatures({ homeDir, env: mergedEnv });
  const services = [];

  for (const definition of serviceDefinitions(mergedEnv, resolvedDashboardPort, selfDashboard)) {
    if (definition.selfHealthy) {
      services.push({ ...definition, status: 'healthy', message: definition.healthyMessage ?? 'Reachable' });
      continue;
    }

    const result = normalizeProbeResult(await probeService({
      ...definition,
      url: definition.probeUrl ?? definition.url,
    }));

    services.push({
      ...definition,
      status: result.status ?? 'unavailable',
      message: result.message ?? '',
    });
  }

  const runtime = summarizeRuntime(services);
  const integrations = summarizeIntegrations(features);
  const workflow = loadWorkflow(cwd);
  const workflowSummary = workflowStatusSummary(workflow, cwd);
  const contextInspection = inspectContextState(cwd);
  const sessionEfficiency = readSessionEfficiency(homeDir);
  const sessionUsage = readSessionUsage(homeDir);
  const telemetryRichness = readTelemetryRichness(homeDir)
    ?? summarizeTelemetryHealth()
    ?? await fetchLangfuseTelemetryStatus(mergedEnv);
  const efficiencyDigest = summarizeEfficiencyData(readEfficiencyLog(homeDir));
  const activeOverlays = getActiveOverlays(cwd);
  const sqlStore = describeSqlStore(mergedEnv);
  const vectorStore = describeVectorStore(mergedEnv);
  const sqlHealth = sqlStore.mode === 'postgres' ? await describeSqlStoreHealth(mergedEnv) : sqlStoreHealth(mergedEnv);
  const promotionRequests = getPromotionRequests(cwd);
  const executionContractModel = resolveExecutionContractModelMetadata({
    envValues: mergedEnv,
    registryModels: registry.models ?? {},
    requestedTier: selectModelTierForWorkCategory(workflowSummary.state?.tasks?.find((task) => task.key === workflowSummary.state?.currentTaskKey)?.workCategory),
    workCategory: null,
  });
  const publicHealth = buildPublicHealthSurface({
    cwd,
    contextInspection,
    workflow,
    executionContractModel,
  });

  const personas = (registry.personas ?? []).map((persona) => ({
    name: persona.name,
    displayName: persona.displayName ?? persona.name,
    role: persona.role ?? '',
    description: persona.description ?? '',
    modelTier: persona.modelTier ?? 'standard',
  }));

  const prefix = `${registry.prefix ?? 'cx'}-`;
  const specialists = (registry.agents ?? []).map((agent) => ({
    name: `${prefix}${agent.name}`,
    description: agent.description ?? '',
    modelTier: agent.modelTier ?? 'standard',
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

  return {
    version: pkg.version ?? '1.0.0',
    lastSync: newestMtime(join(homeDir, '.claude', 'agents')),
    system: {
      overall: runtime,
      services,
      integrations,
    },
    features,
    personas,
    specialists,
    hooks,
    skills: listSkills(rootDir),
    commands: listCommands(rootDir),
    cliCommands: CLI_COMMANDS,
    mcpServers: Object.keys(settings.mcpServers ?? {}),
    workflow: workflowSummary,
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
  if (status === 'healthy') return '✓';
  if (status === 'degraded' || status === 'configured') return '⚠';
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
  lines.push(`Workflow: ${statusLabel(status.workflow.status)} · ${status.workflow.summary}`);
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
      lines.push(`Last interaction: ${status.sessionUsage.lastInteraction.totalTokens.toLocaleString()} tokens (${status.sessionUsage.lastInteraction.inputTokens.toLocaleString()} in / ${status.sessionUsage.lastInteraction.outputTokens.toLocaleString()} out)`);
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
