/**
 * lib/mcp/tools/telemetry.mjs — Telemetry MCP tools: trace/score, session usage, efficiency snapshot.
 *
 * Exposes constructTrace, constructScore, sessionUsage, and efficiencySnapshot.
 * Requires ROOT_DIR injected via opts. Remote export uses the shared telemetry
 * adapter when configured; local JSONL remains available by default.
 */
import { join, resolve } from 'node:path';
import { loadRegistry } from '../../registry/loader.mjs';
import { homedir } from 'node:os';
import { createTelemetryClient } from '../../telemetry/client.mjs';
import { summarizePromptComposition } from '../../prompt-composer.mjs';
import { enrichMetadataWithPrompt } from '../../prompt-metadata.mjs';
import { readCurrentModels, resolveExecutionContractModelMetadata, selectModelTierForWorkCategory } from '../../model-router.mjs';
import { routeRequest } from '../../orchestration-policy.mjs';
import { loadWorkflow } from '../../workflow-state.mjs';
import { buildStatus } from '../../status.mjs';
import { readEfficiencyLog, buildCompactEfficiencyDigest } from '../../efficiency.mjs';
import { addObservation } from '../../observation-store.mjs';
import { loadConstructEnv } from '../../env-config.mjs';
import { createSqlClient, closeSqlClient } from '../../storage/backend.mjs';

// Load config.env once at module init so config.env values win over shell env
// (shell env may have stale/truncated credentials from earlier sessions)
const CONF_ENV = loadConstructEnv({ warn: false });

import { execSync as _execSync } from 'node:child_process';

function resolveReleaseTag(cwd) {
  try {
    return _execSync('git rev-parse --short HEAD', { stdio: 'pipe', cwd, timeout: 2000 }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

function telemetryEnv() {
  return { ...process.env, ...CONF_ENV };
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
    || process.env.CONSTRUCT_SESSION_ID
    || process.env.OPENCODE_SESSION_ID
    || workflowId;
  const userId = process.env.USER || process.env.USERNAME || process.env.LOGNAME;
  return { cwd, sessionId, userId, release: resolveReleaseTag(cwd), workflowPhase, workflowOwner, workflowId };
}

export async function constructTrace(args, { ROOT_DIR }) {
  const ctx = resolveSessionContext();
  const registry = loadRegistry({ rootDir: ROOT_DIR });
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
      telemetryBackend: 'telemetry',
    },
  });
  const metadata = enrichMetadataWithPrompt(args.name, {
    ...(args.metadata && typeof args.metadata === 'object' ? args.metadata : {}),
    ...runtimePromptMetadata,
    // Extract model metadata from executionContractModel for backward compatibility
    ...(runtimePromptMetadata.executionContractModel ? {
      selectedTier: runtimePromptMetadata.executionContractModel.selectedTier,
      selectedModel: runtimePromptMetadata.executionContractModel.selectedModel,
      selectedModelSource: runtimePromptMetadata.executionContractModel.selectedModelSource,
      tiers: runtimePromptMetadata.executionContractModel.tiers,
    } : {}),
    workflowId: ctx.workflowId,
    workflowPhase: ctx.workflowPhase,
    workflowOwner: ctx.workflowOwner,
  }, { rootDir: ROOT_DIR });
  const traceId = args.id ?? crypto.randomUUID();
  try {
    const workspacePresetId = args.metadata?.workspacePresetId ?? metadata.workspacePresetId;
    const workCategoryValue = route?.workCategory ?? null;
    const body = {
      id: traceId,
      name: args.name,
      // Ensure workCategory is set, falling back to direct classification if needed
      workCategory: workCategoryValue,
      
      metadata: {
        ...metadata,
        agentName: args.name,
        goal: typeof args.input === 'string' ? args.input : JSON.stringify(args.input ?? ''),
        workspacePresetId,
        traceSource: 'mcp',
        workCategory: workCategoryValue,
        ...(args.output ? { hasOutput: true } : {}),
      },
      tags: [args.name, workspacePresetId].filter(Boolean),
      userId: ctx.userId,
      sessionId: args.session_id || ctx.sessionId,
      input: args.input,
      output: args.output, // Include output if provided — most callers pass it later via construct_score, but some pass it eagerly
      timestamp: args.timestamp ?? new Date().toISOString(),
      release: ctx.release,
    };

    const client = createTelemetryClient({ env: telemetryEnv(), rootDir: ROOT_DIR });
    client.trace(body);
    await client.flush();
    return {
      ok: true,
      id: traceId,
      backend: client.backend,
      remoteStatus: client.remoteStatus,
    };
  } catch (err) {
    return { ok: false, error: err.message, id: traceId };
  }
}

/**
 * Update an existing trace with output and metadata.
 * Call this when a trace was created early but the result is only known later.
 * Uses the telemetry PATCH endpoint directly since trace updates are infrequent.
 */
export async function constructTraceUpdate(args) {
  const traceId = args.trace_id ?? '';
  const output = args.output;
  const metadata = args.metadata;

  try {
    const client = createTelemetryClient({ env: telemetryEnv(), rootDir: process.cwd() });
    client.traceUpdate({
      id: traceId,
      output,
      metadata: {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        traceUpdatedAt: new Date().toISOString(),
      },
    });
    await client.flush();

    // Also record as observation for local learning
    if (output || metadata) {
      const rootDir = homedir();
      addObservation(rootDir, {
        role: 'construct',
        category: 'insight',
        summary: `Trace ${traceId.slice(0, 8)} updated with output`,
        content: `traceId: ${traceId}\nhasOutput: ${Boolean(output)}\nmetadata: ${metadata ? Object.keys(metadata).join(', ') : 'none'}`,
        tags: ['trace-update', 'telemetry'],
        confidence: 0.9,
        source: 'construct_trace_update',
      });
    }

    return { ok: true, traceId, backend: client.backend, remoteStatus: client.remoteStatus };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Quality score thresholds for observation recording
const SCORE_POOR_THRESHOLD = 0.5;    // below this → record anti-pattern
const SCORE_GOOD_THRESHOLD = 0.85;   // at or above this → record positive pattern

export async function constructScore(args) {
  const traceId = args.trace_id ?? '';
  try {
    const body = {
      id: crypto.randomUUID(),
      traceId,
      name: args.name ?? 'quality',
      value: args.value,
      dataType: 'NUMERIC',
      comment: args.comment,
    };
    const client = createTelemetryClient({ env: telemetryEnv(), rootDir: process.cwd() });
    client.score(body);
    await client.flush();

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
          source: 'construct_score',
        });
      } else if (numericValue >= SCORE_GOOD_THRESHOLD) {
        addObservation(rootDir, {
          role: agentName ?? 'construct',
          category: 'pattern',
          summary: `High quality score (${numericValue.toFixed(2)}) on trace ${traceId.slice(0, 8)}${comment ? `: ${comment}` : ''}`,
          content: `Trace: ${traceId}\nScore: ${numericValue}\nComment: ${comment || 'none'}\nAgent: ${agentName ?? 'unknown'}\nRecorded at: ${new Date().toISOString()}`,
          tags: ['quality-score', 'high-score', agentName].filter(Boolean),
          confidence: 0.75,
          source: 'construct_score',
        });
      }
    }

    // Postgres write-through backs the
    // construct_skill_quality_correlation view that `construct skills
    // correlate-quality` reads — without this, the view stays empty and
    // the CLI surface that promised correlation data delivered nothing.
    // Best-effort: a missing DATABASE_URL or schema misalignment never
    // blocks the score from reaching the remote telemetry or the local
    // observation store above.

    if (Number.isFinite(numericValue)) {
      const sqlClient = createSqlClient(process.env);
      if (sqlClient) {
        try {
          await sqlClient`
            insert into construct_scores (ts, trace_id, session_id, agent_id, name, value, comment)
            values (
              ${new Date().toISOString()},
              ${traceId},
              ${args.session_id ?? null},
              ${args.agent_id ?? args.name ?? null},
              ${args.name ?? 'quality'},
              ${numericValue},
              ${args.comment ?? null}
            )
          `;
        } catch { /* best-effort write — never block on DB issues */ }
        finally { await closeSqlClient(sqlClient).catch(() => {}); }
      }
    }

    return { ok: true, traceId, backend: client.backend, remoteStatus: client.remoteStatus };
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
