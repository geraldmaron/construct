/**
 * lib/mcp/tools/telemetry.mjs — Telemetry MCP tools: Langfuse trace/score, session usage, efficiency snapshot.
 *
 * Exposes cxTrace, cxScore, sessionUsage, and efficiencySnapshot.
 * Requires ROOT_DIR injected via opts. Langfuse credentials must be in env.
 */
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import * as langfuse from '../../telemetry/backends/langfuse.mjs';
import { summarizePromptComposition } from '../../prompt-composer.mjs';
import { enrichMetadataWithPrompt } from '../../prompt-metadata.mjs';
import { readCurrentModels, resolveExecutionContractModelMetadata, selectModelTierForWorkCategory } from '../../model-router.mjs';
import { routeRequest } from '../../orchestration-policy.mjs';
import { loadWorkflow } from '../../workflow-state.mjs';
import { buildStatus } from '../../status.mjs';
import { readEfficiencyLog, buildCompactEfficiencyDigest } from '../../efficiency.mjs';
import { addObservation } from '../../observation-store.mjs';
import { loadConstructEnv } from '../../env-config.mjs';

// Load config.env once at module init so config.env values win over shell env
// (shell env may have stale/truncated credentials from earlier sessions)
const CONF_ENV = loadConstructEnv({ warn: false });

function readJSON(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

import { execSync as _execSync } from 'node:child_process';

function resolveReleaseTag(cwd) {
  try {
    return _execSync('git rev-parse --short HEAD', { stdio: 'pipe', cwd, timeout: 2000 }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

function langfuseHeaders() {
  const key = CONF_ENV.LANGFUSE_PUBLIC_KEY ?? process.env.LANGFUSE_PUBLIC_KEY;
  const secret = CONF_ENV.LANGFUSE_SECRET_KEY ?? process.env.LANGFUSE_SECRET_KEY;
  if (!key || !secret) throw new Error('LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set.');
  return {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

function langfuseBaseUrl() {
  return (CONF_ENV.LANGFUSE_BASEURL ?? process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
}

function resolveSessionContext() {
  const cwd = process.cwd();
  let workflowId;
  let workflowPhase;
  let workflowOwner;
  try {
    const wf = loadWorkflow(cwd);
    if (wf) {
      workflowId = wf.id;
      workflowPhase = wf.phase;
      const active = (wf.tasks || []).find((t) => t.status === 'in-progress' || t.status === 'in_progress');
      if (active) workflowOwner = active.owner;
    }
  } catch { /* best effort */ }
  const sessionId = process.env.CLAUDE_SESSION_ID
    || process.env.CX_SESSION_ID
    || process.env.OPENCODE_SESSION_ID
    || workflowId;
  const userId = process.env.USER || process.env.USERNAME || process.env.LOGNAME;
  return { cwd, sessionId, userId, release: resolveReleaseTag(cwd), workflowPhase, workflowOwner, workflowId };
}

export async function cxTrace(args, { ROOT_DIR }) {
  const ctx = resolveSessionContext();
  const registry = readJSON(join(ROOT_DIR, 'agents', 'registry.json')) ?? {};
  const registryModels = registry.models ?? {};
  const currentModels = readCurrentModels(join(ROOT_DIR, '.env'), registryModels, process.env);
  const route = typeof args.input === 'string' ? routeRequest({ request: args.input }) : null;
  const executionContractModel = resolveExecutionContractModelMetadata({
    envValues: currentModels,
    registryModels,
    requestedTier: selectModelTierForWorkCategory(route?.workCategory),
    workCategory: route?.workCategory || null,
  });
  const runtimePromptMetadata = summarizePromptComposition(args.name, {
    rootDir: ROOT_DIR,
    request: typeof args.input === 'string' ? args.input : '',
    route,
    registryModels,
    envValues: currentModels,
    executionContractModel,
    hostConstraints: {
      runtime: 'mcp',
      providerAgnostic: true,
      telemetryBackend: 'langfuse',
    },
  });
  const metadata = enrichMetadataWithPrompt(args.name, {
    ...(args.metadata && typeof args.metadata === 'object' ? args.metadata : {}),
    ...runtimePromptMetadata,
    workflowId: ctx.workflowId,
    workflowPhase: ctx.workflowPhase,
    workflowOwner: ctx.workflowOwner,
  }, { rootDir: ROOT_DIR });
  const traceId = args.id ?? crypto.randomUUID();
  try {
    const available = await langfuse.isAvailable();
    if (!available) return { ok: false, error: 'Langfuse credentials not configured', id: traceId };
    const teamId = args.metadata?.teamId ?? metadata.teamId;
    const body = {
      id: traceId,
      name: args.name,
      metadata: {
        ...metadata,
        agentName: args.name,
        goal: typeof args.input === 'string' ? args.input : JSON.stringify(args.input ?? ''),
        teamId,
        traceSource: 'mcp',
        ...(args.output ? { hasOutput: true } : {}),
      },
      tags: [args.name, teamId].filter(Boolean),
      userId: ctx.userId,
      sessionId: args.session_id || ctx.sessionId,
      input: args.input,
      output: args.output, // Include output if provided — most callers pass it later via cx_score, but some pass it eagerly
      timestamp: args.timestamp ?? new Date().toISOString(),
      release: ctx.release,
    };

    // Use ingestion batch for creation (handles large payloads better than direct API)
    const ingestClient = getOrCreateIngestClient();
    if (ingestClient?.available) {
      ingestClient.trace(body);
      return { ok: true, id: traceId };
    }

    // Fallback: direct API call
    const res = await fetch(`${langfuseBaseUrl()}/api/public/traces`, {
      method: 'POST',
      headers: langfuseHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Langfuse API error ${res.status}: ${text}`, id: traceId };
    }
    return { ok: true, id: traceId };
  } catch (err) {
    return { ok: false, error: err.message, id: traceId };
  }
}

/**
 * Update an existing trace with output and metadata.
 * Call this when a trace was created early but the result is only known later.
 * Uses the Langfuse PATCH endpoint directly since trace updates are infrequent.
 */
export async function cxTraceUpdate(args) {
  const traceId = args.trace_id ?? '';
  const output = args.output;
  const metadata = args.metadata;

  try {
    const available = await langfuse.isAvailable();
    if (!available) return { ok: false, error: 'Langfuse credentials not configured' };

    const res = await fetch(`${langfuseBaseUrl()}/api/public/traces/${traceId}`, {
      method: 'PATCH',
      headers: langfuseHeaders(),
      body: JSON.stringify({
        output,
        metadata: {
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
          traceUpdatedAt: new Date().toISOString(),
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Langfuse PATCH error ${res.status}: ${text}` };
    }

    // Also record as observation for local learning
    if (output || metadata) {
      const rootDir = homedir();
      addObservation(rootDir, {
        role: 'construct',
        category: 'insight',
        summary: `Trace ${traceId.slice(0, 8)} updated with output`,
        content: `traceId: ${traceId}\nhasOutput: ${Boolean(output)}\nmetadata: ${metadata ? Object.keys(metadata).join(', ') : 'none'}`,
        tags: ['trace-update', 'langfuse'],
        confidence: 0.9,
        source: 'cx_trace_update',
      });
    }

    return { ok: true, traceId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Quality score thresholds for observation recording
const SCORE_POOR_THRESHOLD = 0.5;    // below this → record anti-pattern
const SCORE_GOOD_THRESHOLD = 0.85;   // at or above this → record positive pattern

export async function cxScore(args) {
  const traceId = args.trace_id ?? '';
  try {
    const available = await langfuse.isAvailable();
    if (!available) return { ok: false, error: 'Langfuse credentials not configured' };
    const body = {
      id: crypto.randomUUID(),
      traceId,
      name: args.name ?? 'quality',
      value: args.value,
      dataType: 'NUMERIC',
      comment: args.comment,
    };
    const res = await fetch(`${langfuseBaseUrl()}/api/public/scores`, {
      method: 'POST',
      headers: langfuseHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Langfuse API error ${res.status}: ${text}` };
    }

    // Feed score back into the local observation store so future agents learn from it.
    // Low scores generate anti-pattern observations; high scores reinforce positive patterns.
    const numericValue = Number(args.value);
    if (Number.isFinite(numericValue)) {
      const rootDir = homedir();
      const agentName = args.name && args.name !== 'quality' ? args.name : null;
      const comment = args.comment ? String(args.comment) : '';

      if (numericValue < SCORE_POOR_THRESHOLD) {
        addObservation(rootDir, {
          role: agentName ?? 'construct',
          category: 'anti-pattern',
          summary: `Low quality score (${numericValue.toFixed(2)}) on trace ${traceId.slice(0, 8)}${comment ? `: ${comment}` : ''}`,
          content: `Trace: ${traceId}\nScore: ${numericValue}\nComment: ${comment || 'none'}\nAgent: ${agentName ?? 'unknown'}\nRecorded at: ${new Date().toISOString()}`,
          tags: ['quality-score', 'low-score', agentName].filter(Boolean),
          confidence: 0.8,
          source: 'cx_score',
        });
      } else if (numericValue >= SCORE_GOOD_THRESHOLD) {
        addObservation(rootDir, {
          role: agentName ?? 'construct',
          category: 'pattern',
          summary: `High quality score (${numericValue.toFixed(2)}) on trace ${traceId.slice(0, 8)}${comment ? `: ${comment}` : ''}`,
          content: `Trace: ${traceId}\nScore: ${numericValue}\nComment: ${comment || 'none'}\nAgent: ${agentName ?? 'unknown'}\nRecorded at: ${new Date().toISOString()}`,
          tags: ['quality-score', 'high-score', agentName].filter(Boolean),
          confidence: 0.75,
          source: 'cx_score',
        });
      }
    }

    return { ok: true, traceId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sessionUsage(args, { ROOT_DIR }) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const homeDir = args.home_dir ? resolve(args.home_dir) : homedir();
  const status = await buildStatus({ rootDir: ROOT_DIR, cwd, homeDir, env: process.env });
  return {
    cwd,
    sessionUsage: status.sessionUsage,
  };
}

export function efficiencySnapshot(args) {
  const homeDir = args.home_dir ? resolve(String(args.home_dir)) : homedir();
  const stats = readEfficiencyLog(homeDir);
  const digest = buildCompactEfficiencyDigest(stats);
  return digest || { status: 'unavailable', summary: 'No read-efficiency data recorded yet' };
}
