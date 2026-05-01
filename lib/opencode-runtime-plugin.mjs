/**
 * lib/opencode-runtime-plugin.mjs — OpenCode plugin: Langfuse telemetry + model fallback.
 *
 * Intercepts OpenCode session events (session.created, session.idle, session.error),
 * records each as a Langfuse trace, and applies model fallback on rate-limit errors.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { findOpenCodeConfigPath } from "./opencode-config.mjs";
import { classifyProviderFailure, readCurrentModels, resolveExecutionContractModelMetadata, resolveFallbackAction, selectModelTierForWorkCategory } from "./model-router.mjs";
import { resolveRuntimePromptMetadata } from "./prompt-composer.js";
import { enrichMetadataWithPrompt } from "./prompt-metadata.mjs";
import { loadToolkitEnv } from "./toolkit-env.mjs";
import { routeRequest } from "./orchestration-policy.mjs";
import {
  onBusEvent,
  onChatMessage,
  onChatParams,
  onToolBefore,
  onToolAfter,
  onPermissionAsk,
  onCommandBefore,
  getIngestClient,
} from "./opencode-telemetry.mjs";
import { syncModelPricing, refreshPricingCatalog } from "./telemetry/langfuse-model-sync.mjs";
import { estimateUsageCost } from "./telemetry/langfuse-model-sync.mjs";

const EFFICIENCY_SESSION_IDLE_RESET_MS = 2 * 60 * 60 * 1000;
const EFFICIENCY_REPEATED_READ_THRESHOLD = 5;
const EFFICIENCY_LARGE_READ_THRESHOLD = 3;
const EFFICIENCY_TOTAL_BYTES_THRESHOLD = 750_000;
const EFFICIENCY_LARGE_READ_LIMIT = 400;

const RATE_LIMIT_PATTERNS = [
  /\b429\b/i,
  /rate limit/i,
  /usage limits?/i,
  /specified API usage limits?/i,
  /regain access/i,
  /weekly limit/i,
  /monthly limit/i,
  /daily limit/i,
  /too many requests/i,
  /quota exceeded/i,
  /model unavailable/i,
  /model.*overloaded/i,
  /timeout/i,
  /timed out/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ProviderModelNotFoundError/i,
  /model.*not found/i,
  /no such model/i,
];

const RUNTIME_TRACE_EVENTS = new Set([
  "session.created",
  "session.idle",
  "session.error",
  "message.updated",
]);

const COOLDOWN_MS = 10 * 60 * 1000;

function getStatePath(env = process.env) {
  const home = env.HOME || homedir();
  return join(home, ".cx", "construct-opencode-fallback.json");
}

function flatten(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flatten).join("\n");
  if (typeof value === "object") return Object.values(value).map(flatten).join("\n");
  return "";
}

function stripPlaceholder(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed && !trimmed.includes("__") ? trimmed : "";
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function getSessionId(event) {
  return stripPlaceholder(
    event?.properties?.info?.sessionID
      || event?.session?.id
      || event?.sessionId
      || event?.sessionID
      || event?.properties?.sessionId
      || event?.data?.sessionId,
  );
}

function getAgentName(event) {
  return stripPlaceholder(
    event?.properties?.info?.agent
      || event?.session?.agent
      || event?.agent
      || event?.properties?.agent
      || event?.data?.agent,
  );
}

function getEventTimestamp(event) {
  const raw = event?.timestamp || event?.time || event?.createdAt;
  const parsed = typeof raw === "string" || typeof raw === "number" ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function classifyErrorText(text) {
  if (!text) return undefined;
  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) return "rate_limit_or_timeout";
  return "session_error";
}

function sanitizeErrorMetadata(event) {
  if (event?.type !== "session.error") return {};
  const error = event?.error && typeof event.error === "object" ? event.error : {};
  const text = flatten(error || event?.message);
  return {
    errorCategory: classifyErrorText(text),
    errorCode: stripPlaceholder(error.code || error.errorCode || event?.code),
    errorName: stripPlaceholder(error.name || event?.name),
    errorStatus: stripPlaceholder(String(error.status || error.statusCode || event?.status || "")),
    provider: stripPlaceholder(error.provider || event?.provider || event?.model?.provider),
  };
}

function sanitizeUsage(event) {
  const info = event?.properties?.info && typeof event.properties.info === 'object'
    ? event.properties.info
    : null;
  const infoTokens = info?.tokens && typeof info.tokens === 'object' ? info.tokens : null;

  const legacyUsage = event?.usage && typeof event.usage === 'object'
    ? event.usage
    : event?.session?.usage && typeof event.session.usage === 'object'
      ? event.session.usage
      : event?.data?.usage && typeof event.data.usage === 'object'
        ? event.data.usage
        : null;

  const inputTokens = positiveNumber(
    infoTokens?.input,
    legacyUsage?.input_tokens,
    legacyUsage?.inputTokens,
    legacyUsage?.prompt_tokens,
    legacyUsage?.promptTokens,
  );
  const outputTokens = positiveNumber(
    infoTokens?.output,
    legacyUsage?.output_tokens,
    legacyUsage?.outputTokens,
    legacyUsage?.completion_tokens,
    legacyUsage?.completionTokens,
  );
  const reasoningTokens = positiveNumber(
    infoTokens?.reasoning,
    legacyUsage?.reasoning_tokens,
    legacyUsage?.reasoningTokens,
    legacyUsage?.completion_tokens_details?.reasoning_tokens,
  );
  const cacheReadInputTokens = positiveNumber(
    infoTokens?.cache?.read,
    legacyUsage?.cache_read_input_tokens,
    legacyUsage?.cacheReadInputTokens,
    legacyUsage?.prompt_tokens_details?.cached_tokens,
  );
  const cacheCreation5mInputTokens = positiveNumber(
    legacyUsage?.cache_creation?.ephemeral_5m_input_tokens,
    legacyUsage?.cache_creation_5m_input_tokens,
    legacyUsage?.cacheCreation5mInputTokens,
  );
  const cacheCreation1hInputTokens = positiveNumber(
    legacyUsage?.cache_creation?.ephemeral_1h_input_tokens,
    legacyUsage?.cache_creation_1h_input_tokens,
    legacyUsage?.cacheCreation1hInputTokens,
  );
  const cacheCreationInputTokens = positiveNumber(
    infoTokens?.cache?.write,
    legacyUsage?.cache_creation_input_tokens,
    legacyUsage?.cacheCreationInputTokens,
    cacheCreation5mInputTokens + cacheCreation1hInputTokens,
  );
  const totalTokens = positiveNumber(
    legacyUsage?.total_tokens,
    legacyUsage?.totalTokens,
    inputTokens + outputTokens + reasoningTokens,
  );
  const cost = positiveNumber(info?.cost);

  if (!inputTokens && !outputTokens && !totalTokens && !reasoningTokens) return {};

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cacheReadInputTokens ? { cacheReadInputTokens } : {}),
    ...(cacheCreationInputTokens ? { cacheCreationInputTokens } : {}),
    ...(cacheCreation5mInputTokens ? { cacheCreation5mInputTokens } : {}),
    ...(cacheCreation1hInputTokens ? { cacheCreation1hInputTokens } : {}),
    ...(reasoningTokens ? { reasoningTokens } : {}),
    ...(cost ? { costUsd: cost, costSource: "event" } : {}),
  };
}

function getModelInfo(event) {
  const info = event?.properties?.info;
  const model = event?.model || event?.session?.model || event?.data?.model || event?.properties?.model;
  const modelName = info?.modelID
    || (typeof model === 'string' ? model : model?.id || model?.name || model?.model)
    || event?.modelName
    || event?.model_name;
  const provider = info?.providerID
    || (typeof model === 'object' && model?.provider)
    || event?.provider
    || event?.session?.provider
    || event?.data?.provider
    || event?.properties?.provider;

  return {
    modelName: stripPlaceholder(modelName),
    provider: stripPlaceholder(provider),
  };
}

function extractRequestText(event) {
  if (event?.type !== "message.updated") return "";
  const info = event?.properties?.info;
  if (!info || info.role !== "assistant") return "";
  if (!Array.isArray(info.parts)) return "";

  const toolInputs = info.parts
    .filter((part) => part && typeof part === "object")
    .map((part) => part?.state?.input || part?.input || part?.args)
    .filter((value) => value && typeof value === "object")
    .map((value) => flatten(value))
    .filter(Boolean);

  return toolInputs.join("\n").trim();
}

function summarizeAssistantParts(parts = []) {
  const summary = {
    textSegments: 0,
    toolCalls: 0,
    toolInvocationCalls: 0,
    textLength: 0,
    toolNames: [],
  };

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") {
      summary.textSegments += 1;
      summary.textLength += part.text.length;
      continue;
    }
    if (part.type === "tool" || part.type === "tool-call" || part.type === "tool_call") {
      summary.toolCalls += 1;
      const toolName = part.tool || part.toolName || part.name;
      if (typeof toolName === "string" && toolName && !summary.toolNames.includes(toolName)) summary.toolNames.push(toolName);
      continue;
    }
    if (part.type === "tool-invocation" || part.type === "tool_invocation") {
      summary.toolInvocationCalls += 1;
      const ti = part.toolInvocation || part;
      const toolName = ti.toolName || ti.tool || ti.name;
      if (typeof toolName === "string" && toolName && !summary.toolNames.includes(toolName)) summary.toolNames.push(toolName);
    }
  }

  return summary;
}

function buildStructuredTraceOutput(event, { agent, modelInfo, route, executionContractModel, usage, errorMeta, outputText }) {
  if (event?.type === "message.updated") {
    const parts = Array.isArray(event?.properties?.info?.parts) ? event.properties.info.parts : [];
    const partSummary = summarizeAssistantParts(parts);
    return {
      kind: "assistant_message",
      eventType: event.type,
      hasText: Boolean(outputText),
      text: outputText || undefined,
      partSummary,
      agent: agent || undefined,
      model: modelInfo.modelName || undefined,
      provider: modelInfo.provider || undefined,
      route: route ? {
        intent: route.intent,
        track: route.track,
        workCategory: route.workCategory ?? null,
        specialists: route.specialists ?? [],
      } : undefined,
      decision: route ? {
        intent: route.intent,
        track: route.track,
        workCategory: route.workCategory ?? null,
        specialists: route.specialists ?? [],
      } : undefined,
      fallbackAction: errorMeta?.fallbackAction || undefined,
      observedFailureClass: errorMeta?.errorCategory || undefined,
      traceQualityFlags: {
        hasText: Boolean(outputText),
        hasToolCalls: Boolean(Array.isArray(parts) && parts.some((part) => part && typeof part === "object" && (part.type === "tool" || part.type === "tool-call" || part.type === "tool_call" || part.type === "tool-invocation" || part.type === "tool_invocation"))),
        hasUsage: Boolean(usage && Object.keys(usage).length),
      },
      executionContractModel,
      usage: Object.keys(usage || {}).length ? usage : undefined,
    };
  }

  if (event?.type === "session.error") {
    return {
      kind: "session_error",
      eventType: event.type,
      agent: agent || undefined,
      model: modelInfo.modelName || undefined,
      provider: modelInfo.provider || errorMeta.provider || undefined,
      error: errorMeta,
      decision: {
        intent: route?.intent ?? null,
        track: route?.track ?? null,
        workCategory: route?.workCategory ?? null,
        specialists: route?.specialists ?? [],
      },
      fallbackAction: errorMeta?.fallbackAction || undefined,
      observedFailureClass: errorMeta?.errorCategory || undefined,
      traceQualityFlags: {
        hasText: Boolean(outputText),
        hasUsage: Boolean(usage && Object.keys(usage).length),
        hasError: true,
      },
      executionContractModel,
      usage: Object.keys(usage || {}).length ? usage : undefined,
    };
  }

  return {
    kind: "runtime_event",
    eventType: event.type,
    agent: agent || undefined,
    model: modelInfo.modelName || undefined,
    provider: modelInfo.provider || undefined,
    status: stripPlaceholder(event?.status || event?.session?.status || event?.data?.status) || undefined,
    decision: route ? {
      intent: route.intent,
      track: route.track,
      workCategory: route.workCategory ?? null,
      specialists: route.specialists ?? [],
    } : undefined,
    observedFailureClass: errorMeta?.errorCategory || undefined,
    traceQualityFlags: {
      hasText: Boolean(outputText),
      hasUsage: Boolean(usage && Object.keys(usage).length),
      hasError: Boolean(Object.keys(errorMeta || {}).length),
    },
    executionContractModel,
    usage: Object.keys(usage || {}).length ? usage : undefined,
    error: Object.keys(errorMeta || {}).length ? errorMeta : undefined,
  };
}

function buildHostConstraints() {
  return {
    runtime: "opencode",
    providerAgnostic: true,
    telemetryBackend: "langfuse",
  };
}

function readRegistryModels(rootDir) {
  try {
    const registryPath = join(rootDir, "agents", "registry.json");
    if (!existsSync(registryPath)) return {};
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    return registry?.models ?? {};
  } catch {
    return {};
  }
}

export function buildRuntimeTracePayload(event, { env = process.env } = {}) {
  if (!RUNTIME_TRACE_EVENTS.has(event?.type)) return null;
  if (event?.type === "message.updated") {
    const info = event?.properties?.info;
    if (!info || info.role !== "assistant") return null;
    if (!info.time?.completed) return null;
    if (!info.tokens || !(info.tokens.input || info.tokens.output)) return null;
  }
  const timestamp = getEventTimestamp(event);
  const sessionId = getSessionId(event);
  const agent = getAgentName(event);
  const messageId = stripPlaceholder(event?.properties?.info?.id);
  const traceId = messageId
    ? ["opencode", sessionId || "session", event.type, messageId].join(":")
    : ["opencode", sessionId || "session", event.type, timestamp].join(":");
  const errorMeta = sanitizeErrorMetadata(event);
  const usage = sanitizeUsage(event);
  const modelInfo = getModelInfo(event);
  const rootDir = env.CX_TOOLKIT_DIR || process.cwd();
  const request = extractRequestText(event);
  const route = request ? routeRequest({ request }) : null;
  const registryModels = readRegistryModels(rootDir);
  const currentModels = readCurrentModels(join(rootDir, ".env"), registryModels, env);
  const pricing = estimateUsageCost(modelInfo.modelName || currentModels?.standard || currentModels?.reasoning || currentModels?.fast || null, usage);
  const executionContractModel = resolveExecutionContractModelMetadata({
    envValues: currentModels,
    registryModels,
    requestedTier: modelInfo.modelName ? null : selectModelTierForWorkCategory(route?.workCategory),
    workCategory: route?.workCategory || null,
  });
  const runtimePromptMetadata = resolveRuntimePromptMetadata(agent, {
    rootDir,
    request,
    route,
    registryModels,
    envValues: currentModels,
    executionContractModel,
    hostConstraints: buildHostConstraints(),
  });
  const metadata = enrichMetadataWithPrompt(agent, {
    source: "opencode-plugin",
    eventType: event.type,
    agent: agent || undefined,
    status: stripPlaceholder(event?.status || event?.session?.status || event?.data?.status),
    ...usage,
    ...(pricing.costUsd ? { costUsd: pricing.costUsd, costSource: pricing.costSource, costModel: pricing.modelName } : { costUsd: 0, costSource: pricing.costSource, costModel: pricing.modelName }),
    ...(modelInfo.modelName ? { modelName: modelInfo.modelName } : {}),
    ...(modelInfo.provider ? { provider: modelInfo.provider } : {}),
    ...errorMeta,
    ...runtimePromptMetadata,
  }, { rootDir });

  // Extract assistant response text for message.updated events so the trace output is populated.
  let outputText;
  if (event?.type === "message.updated") {
    const parts = event?.properties?.info?.parts;
    if (Array.isArray(parts)) {
      const text = parts
        .filter((p) => p?.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n");
      outputText = text || undefined;
    }
  }

  const structuredOutput = buildStructuredTraceOutput(event, {
    agent,
    modelInfo,
    route,
    executionContractModel,
    usage,
    errorMeta,
    outputText,
  });

  return {
    id: traceId,
    name: `opencode.${event.type}`,
    userId: stripPlaceholder(env.USER || env.USERNAME),
    sessionId: sessionId || undefined,
    timestamp,
    tags: ["opencode", "runtime", event.type.replace(/\./g, "-")],
    input: {
      eventType: event?.type,
      agent,
      status: event?.status || event?.session?.status || event?.data?.status,
      usage,
      pricing,
    },
    output: structuredOutput,
    metadata,
  };
}

function efficiencyStorePath(env = process.env) {
  const home = env.HOME || homedir();
  return join(home, ".cx", "session-efficiency.json");
}

function loadEfficiencyStats(nowIso, env = process.env) {
  const fresh = {
    sessionStartedAt: nowIso,
    lastUpdatedAt: nowIso,
    readCount: 0,
    uniqueFileCount: 0,
    repeatedReadCount: 0,
    largeReadCount: 0,
    totalBytesRead: 0,
    warnings: {},
    files: {},
    seenToolCallIds: {},
  };
  try {
    const existing = JSON.parse(readFileSync(efficiencyStorePath(env), "utf8"));
    const lastUpdated = new Date(existing.lastUpdatedAt || 0).getTime();
    if (!lastUpdated || Date.now() - lastUpdated > EFFICIENCY_SESSION_IDLE_RESET_MS) return fresh;
    return {
      ...fresh,
      ...existing,
      warnings: existing.warnings || {},
      files: existing.files || {},
      seenToolCallIds: existing.seenToolCallIds || {},
    };
  } catch {
    return fresh;
  }
}

function saveEfficiencyStats(stats, env = process.env) {
  try {
    const p = efficiencyStorePath(env);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(stats, null, 2)}\n`);
  } catch { /* best effort */ }
}

function isReadToolName(name) {
  if (typeof name !== "string") return false;
  return name.toLowerCase() === "read";
}

export function extractReadToolCalls(info) {
  const parts = Array.isArray(info?.parts) ? info.parts : [];
  const calls = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const typ = typeof part.type === "string" ? part.type.toLowerCase() : "";
    let toolName;
    let input;
    let callId;
    let state;
    if (typ === "tool" || typ === "tool-call" || typ === "tool_call") {
      toolName = part.tool || part.toolName || part.name;
      input = part.state?.input || part.input || part.args;
      callId = part.callID || part.callId || part.id;
      state = part.state?.status || part.state;
    } else if (typ === "tool-invocation" || typ === "tool_invocation") {
      const ti = part.toolInvocation || part;
      toolName = ti.toolName || ti.tool || ti.name;
      input = ti.args || ti.input;
      callId = ti.toolCallId || ti.callId || ti.id;
      state = ti.state;
    } else if (part.tool && (part.input || part.args || part.state)) {
      toolName = part.tool;
      input = part.state?.input || part.input || part.args;
      callId = part.callID || part.callId || part.id;
      state = part.state?.status || part.state;
    } else {
      continue;
    }
    if (!isReadToolName(toolName)) continue;
    if (state && typeof state === "string" && state !== "completed" && state !== "result") continue;
    const filePath = input?.filePath || input?.file_path || input?.path;
    if (typeof filePath !== "string" || !filePath) continue;
    const limit = Number(input?.limit || 0);
    calls.push({
      callId: typeof callId === "string" && callId ? callId : `${filePath}:${part.id || ""}`,
      filePath,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    });
  }
  return calls;
}

function sizeOf(filePath, cwd) {
  try {
    const abs = filePath.startsWith("/") ? filePath : resolve(cwd || process.cwd(), filePath);
    return statSync(abs).size;
  } catch {
    return 0;
  }
}

export function trackReadEfficiencyFromMessage(event, { env = process.env, cwd = process.cwd() } = {}) {
  if (event?.type !== "message.updated") return { warnings: [] };
  const info = event?.properties?.info;
  if (!info || info.role !== "assistant" || !info.time?.completed) return { warnings: [] };
  const calls = extractReadToolCalls(info);
  if (!calls.length) return { warnings: [] };

  const nowIso = new Date().toISOString();
  const stats = loadEfficiencyStats(nowIso, env);
  const warnings = [];

  for (const call of calls) {
    if (stats.seenToolCallIds[call.callId]) continue;
    stats.seenToolCallIds[call.callId] = nowIso;

    const size = sizeOf(call.filePath, cwd);
    const existingFile = stats.files[call.filePath];
    const effectiveLimit = call.limit > 0 ? call.limit : 2000;
    const isLargeRead = effectiveLimit > EFFICIENCY_LARGE_READ_LIMIT;

    stats.readCount += 1;
    stats.totalBytesRead += size;
    if (isLargeRead) stats.largeReadCount += 1;
    if (existingFile) stats.repeatedReadCount += 1;
    else stats.uniqueFileCount += 1;

    stats.files[call.filePath] = {
      count: (existingFile?.count || 0) + 1,
      size,
      lastReadAt: nowIso,
      lastRequestedLimit: effectiveLimit,
    };
  }

  if (stats.repeatedReadCount >= EFFICIENCY_REPEATED_READ_THRESHOLD && !stats.warnings.repeatedReads) {
    const top = Object.entries(stats.files)
      .map(([p, v]) => ({ filePath: p, count: Number(v?.count || 0) }))
      .filter((e) => e.count > 1)
      .sort((a, b) => b.count - a.count || a.filePath.localeCompare(b.filePath))[0];
    const topNote = top ? ` Top repeat: ${top.filePath} (${top.count}x).` : "";
    warnings.push(`Efficiency: ${stats.repeatedReadCount} repeated reads this session.${topNote} Use rg or construct distill before re-reading more files.`);
    stats.warnings.repeatedReads = nowIso;
  }
  if (stats.largeReadCount >= EFFICIENCY_LARGE_READ_THRESHOLD && !stats.warnings.largeReads) {
    warnings.push(`Efficiency: ${stats.largeReadCount} large reads this session — prefer rg/glob plus targeted reads under 400 lines.`);
    stats.warnings.largeReads = nowIso;
  }
  if (stats.totalBytesRead >= EFFICIENCY_TOTAL_BYTES_THRESHOLD && !stats.warnings.totalBytes) {
    warnings.push(`Efficiency: ${Math.round(stats.totalBytesRead / 1024)} KB read this session — consider distill/query-focused retrieval or compact context before continuing.`);
    stats.warnings.totalBytes = nowIso;
  }

  stats.lastUpdatedAt = nowIso;
  saveEfficiencyStats(stats, env);
  return { warnings };
}

function langfuseAvailable(env = process.env) {
  return Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}

function langfuseHeaders(env = process.env) {
  const key = env.LANGFUSE_PUBLIC_KEY;
  const secret = env.LANGFUSE_SECRET_KEY;
  return {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

function langfuseBaseUrl(env = process.env) {
  return (env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
}

async function emitRuntimeTrace(event, { client, env = process.env }) {
  const payload = buildRuntimeTracePayload(event, { env });
  if (!payload) return;
  const ingest = getIngestClient(env);
  if (!ingest.available) return;

  try {
    ingest.trace({
      id: payload.id,
      name: payload.name,
      userId: payload.userId,
      sessionId: payload.sessionId,
      timestamp: payload.timestamp,
      tags: payload.tags,
      input: payload.input,
      output: payload.output,
      metadata: payload.metadata,
    });

    if (event.type === "message.updated") {
      const info = event?.properties?.info;
      const usage = sanitizeUsage(event);
      const { modelName, provider } = getModelInfo(event);
      const model = provider && modelName ? `${provider}/${modelName}` : (modelName || undefined);
      const pricing = estimateUsageCost(model, usage);
      const outputText = (() => {
        if (!Array.isArray(info?.parts)) return undefined;
        const text = info.parts
          .filter((p) => p?.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join("\n");
        return text || undefined;
      })();
      const toolCalls = extractReadToolCalls(info);
      const langfuseUsage = usage.inputTokens ? {
        input: usage.inputTokens,
        output: usage.outputTokens,
        total: usage.totalTokens,
        unit: "TOKENS",
        ...(usage.costUsd ? { totalCost: usage.costUsd } : {}),
      } : undefined;
      ingest.generation({
        id: randomUUID(),
        traceId: payload.id,
        name: `llm.${payload.metadata?.agent || "chat"}`,
        startTime: info?.time?.created ? new Date(info.time.created).toISOString() : payload.timestamp,
        endTime: info?.time?.completed ? new Date(info.time.completed).toISOString() : new Date().toISOString(),
        model,
        usage: langfuseUsage,
        output: {
          kind: "assistant_generation",
          agent: payload.metadata?.agent || undefined,
          model,
          provider,
          hasText: Boolean(outputText),
          text: outputText || undefined,
          costUsd: pricing.costUsd,
          costSource: pricing.costSource,
          costModel: pricing.modelName,
          toolCalls: toolCalls.length ? toolCalls.map((call) => ({ filePath: call.filePath, limit: call.limit, callId: call.callId })) : undefined,
          usage: langfuseUsage ? {
            input: langfuseUsage.input,
            output: langfuseUsage.output,
            total: langfuseUsage.total,
            unit: langfuseUsage.unit,
            ...(langfuseUsage.totalCost ? { totalCost: langfuseUsage.totalCost } : {}),
          } : undefined,
        },
        metadata: {
          agent: payload.metadata?.agent,
          provider,
          costUsd: pricing.costUsd,
          costSource: pricing.costSource,
          costModel: pricing.modelName,
          ...(usage.reasoningTokens ? { reasoningTokens: usage.reasoningTokens } : {}),
          ...(usage.cacheReadInputTokens ? { cacheReadInputTokens: usage.cacheReadInputTokens } : {}),
        },
      });
      await ingest.flush();
    }
  } catch {
    await client?.app?.log?.({
      body: {
        service: "construct",
        level: "warn",
        message: "OpenCode runtime telemetry failed before delivery.",
      },
    });
  }
}

function recentlyApplied(now, env = process.env) {
  try {
    const state = JSON.parse(readFileSync(getStatePath(env), "utf8"));
    return typeof state.lastAppliedAt === "number" && now - state.lastAppliedAt < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function writeState(payload, env = process.env) {
  const statePath = getStatePath(env);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(payload, null, 2));
}

function readOpenRouterApiKey(configPath = findOpenCodeConfigPath(), env = process.env) {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const auth = config?.provider?.openrouter?.options?.headers?.Authorization;
    if (typeof auth !== "string") return "";
    const key = auth.replace(/^Bearer\s+/i, "").trim();
    if (!key || key.includes("__OPENROUTER_API_KEY__")) return "";
    return key;
  } catch {
    return "";
  }
}

async function maybeApplyModelFallback(event, { client, env, toolkitDir, configPath }) {
  if (event?.type !== "session.error") return;
  const classifiedFailure = classifyProviderFailure(event);
  const haystack = flatten(event);
  if (!classifiedFailure && !RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(haystack))) return;

  const constructBin = join(toolkitDir, "bin", "construct");
  if (!existsSync(constructBin)) return;

  const openRouterApiKey = readOpenRouterApiKey(configPath, env);
  if (!openRouterApiKey) return;

  const registryModels = readRegistryModels(toolkitDir);
  const currentModels = readCurrentModels(join(toolkitDir, ".env"), registryModels, env);
  const fallbackAction = resolveFallbackAction({
    failure: classifiedFailure ?? { kind: "rate_limit", retryable: true },
    requestedTier: null,
    workCategory: null,
    currentModels,
    registryModels,
  });

  const now = Date.now();
  if (recentlyApplied(now, env)) return;

  if (!fallbackAction?.targetModel) {
    try {
      await client?.app?.log?.({
        body: {
          service: "construct",
          level: "warn",
          message: "Provider usage limit detected; no safe fallback target was available.",
        },
      });
    } catch {
      // best effort: fallback must continue even if logging fails
    }
    return;
  }

  try {
    await client?.app?.log?.({
      body: {
        service: "construct",
        level: "warn",
        message: fallbackAction?.targetModel
          ? `Provider usage limit detected; applying model fallback toward ${fallbackAction.targetModel}.`
          : "Provider usage limit detected; applying model fallback.",
      },
    });
  } catch {
    // best effort: fallback must continue even if logging fails
  }

  const command = fallbackAction?.targetModel
    ? ["models", `--tier=${fallbackAction.tier}`, `--set=${fallbackAction.targetModel}`]
    : ["models", "--apply"];

  const result = spawnSync(constructBin, command, {
    cwd: toolkitDir,
    stdio: "ignore",
    env: {
      ...env,
      CX_TOOLKIT_DIR: toolkitDir,
      OPENROUTER_API_KEY: openRouterApiKey,
    },
    timeout: 120_000,
  });

  if (result.status === 0) {
    writeState({
      lastAppliedAt: now,
      ok: true,
      status: result.status,
      targetModel: fallbackAction.targetModel,
      targetTier: fallbackAction.tier,
      reason: "opencode-session-error",
    }, env);
  }
}

export function createConstructOpenCodePlugin({
  toolkitDir = process.env.CX_TOOLKIT_DIR,
  env = process.env,
  configPath = findOpenCodeConfigPath(),
} = {}) {
  loadToolkitEnv(toolkitDir, env);
  // Refresh local pricing catalog from LiteLLM (24h cached, no auth). Runs before
  // Langfuse sync so estimateUsageCost uses live rates from the first assistant turn.
  void refreshPricingCatalog().catch(() => {});
  // Fire-and-forget: sync model pricing into Langfuse on plugin load.
  void syncModelPricing({
    baseUrl: env.LANGFUSE_BASEURL,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
  }).catch(() => {});
  const safe = async (fn, label, client) => {
    try {
      await fn();
    } catch (err) {
      await client?.app?.log?.({
        body: {
          service: "construct",
          level: "warn",
          message: `telemetry hook ${label} failed: ${err?.message || err}`,
        },
      }).catch(() => {});
    }
  };
  return async ({ client }) => ({
    event: async ({ event }) => {
      await safe(() => onBusEvent(event, { env }), "event", client);
      await safe(() => emitRuntimeTrace(event, { client, env }), "legacy-trace", client);
      await maybeApplyModelFallback(event, { client, env, toolkitDir, configPath });
      try {
        const { warnings } = trackReadEfficiencyFromMessage(event, { env, cwd: toolkitDir || process.cwd() });
        for (const message of warnings) {
          await client?.app?.log?.({ body: { service: "construct", level: "warn", message } });
        }
      } catch { /* best effort */ }
    },
    "chat.message": async (input, output) => {
      await safe(() => onChatMessage(input, output, { env }), "chat.message", client);
    },
    "chat.params": async (input, output) => {
      await safe(() => onChatParams(input, output, { env }), "chat.params", client);
    },
    "tool.execute.before": async (input, output) => {
      await safe(() => onToolBefore(input, output, { env }), "tool.execute.before", client);
    },
    "tool.execute.after": async (input, output) => {
      await safe(() => onToolAfter(input, output, { env }), "tool.execute.after", client);
    },
    "permission.ask": async (input, output) => {
      await safe(() => onPermissionAsk(input, output, { env }), "permission.ask", client);
    },
    "command.execute.before": async (input, output) => {
      await safe(() => onCommandBefore(input, output, { env }), "command.execute.before", client);
    },
  });
}
