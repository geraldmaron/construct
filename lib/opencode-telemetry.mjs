/**
 * lib/opencode-telemetry.mjs — OpenCode → Langfuse full-fidelity tracing.
 *
 * Maintains per-session state, maps OpenCode events/hooks onto Langfuse
 * trace/generation/span/event observations, and flushes on session.idle.
 */
import { randomUUID } from "node:crypto";
import { createIngestClient } from "./telemetry/langfuse-ingest.mjs";

const SECRET_PATH_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /credentials/i,
  /secrets?\./i,
  /private.*key/i,
  /\.pem$/i,
  /id_rsa/i,
  /id_ed25519/i,
];

const LARGE_OUTPUT_CHARS = 20_000;

const sessionTraces = new Map();
let cachedIngest = null;

export function getIngestClient(env = process.env) {
  if (cachedIngest) return cachedIngest;
  cachedIngest = createIngestClient({
    baseUrl: env.LANGFUSE_BASEURL,
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    onError: (err) => {
      if (env.CONSTRUCT_TRACE_DEBUG === "1") {
        // eslint-disable-next-line no-console
        console.error("[construct-telemetry]", err?.message || err);
      }
    },
  });
  return cachedIngest;
}

export function resetForTests() {
  sessionTraces.clear();
  cachedIngest = null;
}

function stringifyModel(model) {
  if (!model) return undefined;
  if (typeof model === "string") return model;
  if (model.providerID && model.modelID) return `${model.providerID}/${model.modelID}`;
  return model.id || model.name || undefined;
}

function redactToolArgs(tool, args) {
  if (!args || typeof args !== "object") return args;
  const filePath = args.filePath || args.file_path || args.path;
  if (typeof filePath === "string" && SECRET_PATH_PATTERNS.some((re) => re.test(filePath))) {
    return { _redacted: "sensitive path", filePath };
  }
  return args;
}

function redactToolOutput(output) {
  if (typeof output !== "string") return output;
  if (output.length > LARGE_OUTPUT_CHARS) {
    return `${output.slice(0, LARGE_OUTPUT_CHARS)}…[truncated ${output.length - LARGE_OUTPUT_CHARS} chars]`;
  }
  return output;
}

function extractTextFromParts(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

function getSessionIdFromEvent(event) {
  return (
    event?.properties?.info?.sessionID
    || event?.properties?.sessionID
    || event?.properties?.sessionId
    || event?.session?.id
    || event?.sessionID
    || event?.sessionId
    || event?.data?.sessionId
    || null
  );
}

function getAgentFromEvent(event) {
  return (
    event?.properties?.info?.agent
    || event?.properties?.agent
    || event?.session?.agent
    || event?.agent
    || null
  );
}

function sanitizeUsage(tokens, cost) {
  if (!tokens) return undefined;
  const input = Number(tokens.input) || 0;
  const output = Number(tokens.output) || 0;
  const reasoning = Number(tokens.reasoning) || 0;
  const total = input + output + reasoning;
  if (!input && !output && !total) return undefined;
  const usage = { input, output, total, unit: "TOKENS" };
  if (Number(cost) > 0) usage.totalCost = Number(cost);
  return usage;
}

export function ensureSessionTrace(sessionId, { env = process.env, agent, userId, metadata } = {}) {
  if (!sessionId) return null;
  const ingest = getIngestClient(env);
  if (!ingest.available) return null;
  let entry = sessionTraces.get(sessionId);
  if (!entry) {
    const traceId = sessionId;
    const startedAt = new Date().toISOString();
    entry = {
      traceId,
      startedAt,
      generationIdByMessage: new Map(),
      toolSpanByCallId: new Map(),
      pendingGenerationId: null,
      agent: agent || null,
    };
    sessionTraces.set(sessionId, entry);
    ingest.trace({
      id: traceId,
      name: agent ? `opencode.${agent}` : "opencode.session",
      userId: userId || env.USER || env.USERNAME || undefined,
      sessionId,
      timestamp: startedAt,
      tags: ["opencode", "construct", agent ? `agent:${agent}` : null].filter(Boolean),
      metadata: metadata || undefined,
    });
  } else if (agent && !entry.agent) {
    entry.agent = agent;
  }
  return entry;
}

// ── Hook: chat.message ──────────────────────────────────────────────────────
export async function onChatMessage(input, output, { env = process.env } = {}) {
  const ingest = getIngestClient(env);
  if (!ingest.available) return;
  const sessionId = input?.sessionID;
  const entry = ensureSessionTrace(sessionId, { env, agent: input?.agent });
  if (!entry) return;
  const text = extractTextFromParts(output?.parts) || output?.message?.content;
  ingest.event({
    id: randomUUID(),
    traceId: entry.traceId,
    name: "user.message",
    startTime: new Date().toISOString(),
    input: { text, messageID: input?.messageID, variant: input?.variant },
    metadata: {
      agent: input?.agent,
      model: stringifyModel(input?.model),
    },
  });
}

// ── Hook: chat.params ───────────────────────────────────────────────────────
export async function onChatParams(input, output, { env = process.env } = {}) {
  const ingest = getIngestClient(env);
  if (!ingest.available) return;
  const sessionId = input?.sessionID;
  const entry = ensureSessionTrace(sessionId, { env, agent: input?.agent });
  if (!entry) return;
  const generationId = randomUUID();
  entry.pendingGenerationId = generationId;
  ingest.generation({
    id: generationId,
    traceId: entry.traceId,
    name: `llm.${input?.agent || "chat"}`,
    startTime: new Date().toISOString(),
    model: stringifyModel(input?.model),
    modelParameters: {
      temperature: output?.temperature,
      topP: output?.topP,
      topK: output?.topK,
      maxOutputTokens: output?.maxOutputTokens,
    },
    input: input?.message,
    metadata: {
      agent: input?.agent,
      provider: input?.provider?.info?.id || input?.model?.providerID,
    },
  });
}

// ── Hook: tool.execute.before ───────────────────────────────────────────────
export async function onToolBefore(input, output, { env = process.env } = {}) {
  const ingest = getIngestClient(env);
  if (!ingest.available) return;
  const sessionId = input?.sessionID;
  const entry = ensureSessionTrace(sessionId, { env });
  if (!entry) return;
  const spanId = randomUUID();
  const startedAt = new Date().toISOString();
  entry.toolSpanByCallId.set(input?.callID, { spanId, startedAt, tool: input?.tool });
  ingest.span({
    id: spanId,
    traceId: entry.traceId,
    name: `tool.${input?.tool}`,
    startTime: startedAt,
    input: redactToolArgs(input?.tool, output?.args),
    metadata: { tool: input?.tool, callID: input?.callID },
  });
}

// ── Hook: tool.execute.after ────────────────────────────────────────────────
export async function onToolAfter(input, output, { env = process.env } = {}) {
  const ingest = getIngestClient(env);
  if (!ingest.available) return;
  const entry = sessionTraces.get(input?.sessionID);
  const tracked = entry?.toolSpanByCallId.get(input?.callID);
  if (!entry || !tracked) return;
  ingest.spanUpdate({
    id: tracked.spanId,
    traceId: entry.traceId,
    endTime: new Date().toISOString(),
    output: redactToolOutput(output?.output),
    metadata: {
      tool: input?.tool,
      title: output?.title,
      ...(output?.metadata && typeof output.metadata === "object" ? output.metadata : {}),
    },
  });
  entry.toolSpanByCallId.delete(input?.callID);
}

// ── Hook: permission.ask ────────────────────────────────────────────────────
export async function onPermissionAsk(input, output, { env = process.env } = {}) {
  const ingest = getIngestClient(env);
  if (!ingest.available) return;
  const sessionId = input?.sessionID || input?.session?.id;
  const entry = ensureSessionTrace(sessionId, { env });
  if (!entry) return;
  ingest.event({
    id: randomUUID(),
    traceId: entry.traceId,
    name: `permission.${output?.status || "ask"}`,
    startTime: new Date().toISOString(),
    input: {
      type: input?.type,
      title: input?.title,
      pattern: input?.pattern,
      tool: input?.tool,
    },
    metadata: { status: output?.status },
  });
}

// ── Hook: command.execute.before ────────────────────────────────────────────
export async function onCommandBefore(input, output, { env = process.env } = {}) {
  const ingest = getIngestClient(env);
  if (!ingest.available) return;
  const sessionId = input?.sessionID;
  const entry = ensureSessionTrace(sessionId, { env });
  if (!entry) return;
  ingest.event({
    id: randomUUID(),
    traceId: entry.traceId,
    name: `command.${input?.command}`,
    startTime: new Date().toISOString(),
    input: { command: input?.command, arguments: input?.arguments },
  });
}

// ── Bus: event ──────────────────────────────────────────────────────────────
export async function onBusEvent(event, { env = process.env, buildUsage } = {}) {
  const ingest = getIngestClient(env);
  if (!ingest.available) return;
  const sessionId = getSessionIdFromEvent(event);
  if (!sessionId) return;
  const agent = getAgentFromEvent(event);
  const entry = ensureSessionTrace(sessionId, { env, agent });
  if (!entry) return;

  switch (event.type) {
    case "message.updated": {
      const info = event?.properties?.info;
      if (!info || info.role !== "assistant") return;
      if (!info.time?.completed) return;
      const msgId = info.id;
      const existingGenId = entry.generationIdByMessage.get(msgId);
      const genId = existingGenId || entry.pendingGenerationId || randomUUID();
      entry.generationIdByMessage.set(msgId, genId);
      entry.pendingGenerationId = null;

      const usage = typeof buildUsage === "function"
        ? buildUsage(event)
        : sanitizeUsage(info.tokens, info.cost);

      const outputText = extractTextFromParts(info.parts);

      const body = {
        id: genId,
        traceId: entry.traceId,
        name: `llm.${agent || "chat"}`,
        startTime: info.time?.created ? new Date(info.time.created).toISOString() : undefined,
        endTime: info.time?.completed ? new Date(info.time.completed).toISOString() : new Date().toISOString(),
        model: info.modelID && info.providerID ? `${info.providerID}/${info.modelID}` : (info.modelID || undefined),
        output: outputText || undefined,
        usage: usage ? {
          input: usage.input,
          output: usage.output,
          total: usage.total,
          unit: usage.unit,
          ...(usage.totalCost ? { totalCost: usage.totalCost } : {}),
        } : undefined,
        metadata: {
          agent,
          provider: info.providerID,
          ...(info.tokens?.cache ? { cacheTokens: info.tokens.cache } : {}),
          ...(info.cost ? { costUsd: info.cost } : {}),
        },
      };
      if (existingGenId) ingest.generationUpdate(body);
      else ingest.generation(body);
      return;
    }

    case "message.part.updated": {
      const part = event?.properties?.part;
      if (!part) return;
      if (part.type === "reasoning" && part.text) {
        ingest.event({
          id: randomUUID(),
          traceId: entry.traceId,
          name: "assistant.reasoning",
          startTime: new Date().toISOString(),
          output: part.text,
        });
      }
      return;
    }

    case "session.error": {
      const err = event?.error || {};
      ingest.event({
        id: randomUUID(),
        traceId: entry.traceId,
        name: "session.error",
        startTime: new Date().toISOString(),
        level: "ERROR",
        statusMessage: err.message || err.name || "session error",
        metadata: { code: err.code, status: err.status, provider: err.provider },
      });
      return;
    }

    case "session.idle":
    case "session.compacted": {
      ingest.event({
        id: randomUUID(),
        traceId: entry.traceId,
        name: event.type,
        startTime: new Date().toISOString(),
      });
      await ingest.flush();
      return;
    }

    case "session.created":
    case "session.updated": {
      // Trace already created in ensureSessionTrace; record as event for timeline.
      ingest.event({
        id: randomUUID(),
        traceId: entry.traceId,
        name: event.type,
        startTime: new Date().toISOString(),
      });
      return;
    }

    case "file.edited":
    case "EventFileEdited": {
      ingest.event({
        id: randomUUID(),
        traceId: entry.traceId,
        name: "file.edited",
        startTime: new Date().toISOString(),
        input: event?.properties || {},
      });
      return;
    }

    case "todo.updated":
    case "EventTodoUpdated": {
      ingest.event({
        id: randomUUID(),
        traceId: entry.traceId,
        name: "todo.updated",
        startTime: new Date().toISOString(),
        input: event?.properties || {},
      });
      return;
    }

    case "command.executed":
    case "EventCommandExecuted": {
      ingest.event({
        id: randomUUID(),
        traceId: entry.traceId,
        name: "command.executed",
        startTime: new Date().toISOString(),
        input: event?.properties || {},
      });
      return;
    }

    case "permission.replied":
    case "permission.updated":
    case "permission.asked": {
      ingest.event({
        id: randomUUID(),
        traceId: entry.traceId,
        name: event.type,
        startTime: new Date().toISOString(),
        metadata: event?.properties || {},
      });
      return;
    }

    default:
      return;
  }
}
