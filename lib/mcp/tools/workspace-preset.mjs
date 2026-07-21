/**
 * lib/mcp/tools/workspace-preset.mjs — Workspace Preset and learning tools.
 *
 * Exposes Workspace Presets, outcomes, sandboxes, knowledge, and learning
 * status so agents talking through the Construct MCP server can
 * read the same state the CLI exposes. Operator-only surfaces (optimize_apply,
 * optimize_rollback) remain CLI-only and are not registered here.
 *
 * Pattern: each export is a thin schema-validated wrapper around the existing
 * lib/* function the CLI already uses. Errors return `{ error: string }` so
 * the MCP dispatcher hands a structured failure back instead of crashing.
 * Destructive operations (workspace_preset_archive) require `confirm: true`, matching
 * the storage_reset / delete_ingested_artifacts pattern in tools/storage.mjs.
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

import {
  loadWorkspacePreset,
  listWorkspacePresets,
  resolveActiveWorkspacePreset,
} from '../../workspace-presets/loader.mjs';
import {
  createDraftWorkspacePreset,
  listDrafts,
  archiveWorkspacePreset,
  workspacePresetHealth,
} from '../../workspace-presets/lifecycle.mjs';
import { recordOutcome } from '../../outcomes/record.mjs';
import { aggregateOutcomes, readSummary } from '../../outcomes/aggregate.mjs';
import { addResearchFinding } from '../../knowledge/research-store.mjs';
import { askGlobal } from '../../knowledge/graph.mjs';
import { listSandboxes } from '../../sandbox.mjs';
import { configPath } from '../../config-dir.mjs';

function cwdOf(args) {
  return args && args.cwd ? resolve(String(args.cwd)) : process.cwd();
}

// Read-only: active Workspace Preset.

export function workspacePresetShow(args = {}) {
  const cwd = cwdOf(args);
  const workspacePreset = resolveActiveWorkspacePreset(cwd, args.id ? String(args.id) : null);
  return {
    id: workspacePreset.id,
    displayName: workspacePreset.displayName ?? workspacePreset.id,
    tagline: workspacePreset.tagline ?? null,
    skills: workspacePreset.skills ?? [],
    procedures: workspacePreset.procedures ?? [],
    artifactClasses: workspacePreset.artifactClasses ?? [],
    experimental: workspacePreset.experimental === true,
    intake: {
      types: workspacePreset.intake?.types ?? [],
      stages: workspacePreset.intake?.stages ?? [],
    },
    hooks: workspacePreset.hooks ?? null,
    rebrand: workspacePreset.rebrand ?? null,
  };
}

// Read-only: catalog summary.

export function workspacePresetList() {
  return {
    workspacePresets: listWorkspacePresets().map((id) => {
      const p = loadWorkspacePreset(id);
      return p
        ? {
            id: p.id,
            displayName: p.displayName ?? p.id,
            tagline: p.tagline ?? null,
            skillCount: Array.isArray(p.skills) ? p.skills.length : 0,
            procedureCount: Array.isArray(p.procedures) ? p.procedures.length : 0,
            experimental: p.experimental === true,
          }
        : { id, error: 'failed to parse' };
    }),
  };
}

// Read-only: draft Workspace Presets under .construct/.

export function workspacePresetDrafts(args = {}) {
  const cwd = cwdOf(args);
  const drafts = listDrafts(cwd).map((d) => ({
    id: d.id,
    dir: d.dir,
    hasWorkspacePreset: d.hasWorkspacePreset,
    hasBrief: d.hasBrief,
  }));
  return { drafts };
}

// Read-only: per-Workspace Preset health rollup.

export function workspacePresetHealthTool(args = {}) {
  const cwd = cwdOf(args);
  const id = args.id ? String(args.id) : resolveActiveWorkspacePreset(cwd).id;
  const windowDays = Number.isFinite(args.window_days) ? Number(args.window_days) : 30;
  return { id, windowDays, ...workspacePresetHealth(cwd, id, { windowDays }) };
}

// Read-only: outcomes rollup. Optional aggregate=true rebuilds _summary.json.

export function outcomesSummary(args = {}) {
  const cwd = cwdOf(args);
  if (args.aggregate === true) {
    try { aggregateOutcomes(cwd); } catch (err) { return { error: `aggregate failed: ${err.message}` }; }
  }
  const summary = readSummary(cwd);
  if (!summary) return { roles: {}, note: 'no outcomes recorded yet' };
  return summary;
}

// Mutating, gated: append an outcome line.

export function outcomesRecord(args = {}) {
  if (args.confirm !== true) {
    return { error: 'outcomes_record requires confirm=true to write durable state' };
  }
  const cwd = cwdOf(args);
  if (!args.role || typeof args.success !== 'boolean') {
    return { error: 'outcomes_record requires role:string and success:boolean' };
  }
  const workspacePreset = args.workspace_preset
    ? String(args.workspace_preset)
    : resolveActiveWorkspacePreset(cwd)?.id;
  const file = recordOutcome(cwd, {
    role: String(args.role),
    intakeId: args.intake_id ? String(args.intake_id) : null,
    workspacePreset,
    success: !!args.success,
    escalated: !!args.escalated,
    durationMs: Number.isFinite(args.duration_ms) ? Number(args.duration_ms) : null,
    notes: args.notes ? String(args.notes) : null,
    source: args.source ? String(args.source) : 'mcp',
    sessionId: args.session_id ? String(args.session_id) : null,
  });
  if (!file) return { error: 'outcomes_record: write failed' };
  return { ok: true, file };
}

// Mutating, gated: persist a research finding.

export async function knowledgeAdd(args = {}) {
  if (args.confirm !== true) {
    return { error: 'knowledge_add requires confirm=true to write durable state' };
  }
  const cwd = cwdOf(args);
  try {
    const res = await addResearchFinding({
      cwd,
      slug: String(args.slug || ''),
      topic: String(args.topic || ''),
      body: String(args.body || ''),
      confidence: args.confidence ? String(args.confidence) : 'inferred',
      sources: Array.isArray(args.sources) ? args.sources : [],
      ttlDays: Number.isFinite(args.ttl_days) ? Number(args.ttl_days) : undefined,
    });
    return { ok: true, path: res.path, bytes: res.bytes };
  } catch (err) {
    return { error: err.message ?? String(err) };
  }
}

// Mutating, gated: scaffold a draft Workspace Preset.

export function workspacePresetCreate(args = {}) {
  if (args.confirm !== true) {
    return { error: 'workspace_preset_create requires confirm=true to scaffold files' };
  }
  const cwd = cwdOf(args);
  if (!args.id) return { error: 'workspace_preset_create requires id:string' };
  try {
    const res = createDraftWorkspacePreset({
      cwd,
      id: String(args.id),
      displayName: args.display_name ? String(args.display_name) : undefined,
    });
    return {
      ok: true,
      dir: res.dir,
      briefPath: res.briefPath,
      draftPath: res.draftPath,
    };
  } catch (err) {
    return { error: err.message ?? String(err) };
  }
}

// Mutating, gated, destructive: archive a curated Workspace Preset.

export function workspacePresetArchive(args = {}) {
  if (args.confirm !== true) {
    return { error: 'workspace_preset_archive requires confirm=true to archive files' };
  }
  if (!args.id || !args.reason || String(args.reason).trim().length < 8) {
    return { error: 'workspace_preset_archive requires id:string and reason:string (>=8 chars)' };
  }
  try {
    return { ok: true, ...archiveWorkspacePreset({ id: String(args.id), reason: String(args.reason) }) };
  } catch (err) {
    return { error: err.message ?? String(err) };
  }
}

// Read-only: sandbox roster.

export function sandboxList() {
  return { sandboxes: listSandboxes() };
}

// Read-only: GraphRAG global query over the entity graph.

export function knowledgeGraphAsk(args = {}) {
  const cwd = cwdOf(args);
  if (!args.query || typeof args.query !== 'string') {
    return { error: 'knowledge_graph_ask requires query:string' };
  }
  const topK = Number.isFinite(args.top_k) ? Number(args.top_k) : 5;
  const minSize = Number.isFinite(args.min_size) ? Number(args.min_size) : undefined;
  return askGlobal({ query: String(args.query), rootDir: cwd, topK, ...(minSize !== undefined ? { minSize } : {}) });
}

// Read-only: learning dashboard mirror.

export function learningStatus(args = {}) {
  const cwd = cwdOf(args);

  let observations = { total: 0, last24h: 0 };
  try {
    const idxPath = configPath(cwd, 'observations', 'index.json');
    if (existsSync(idxPath)) {
      const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
      if (Array.isArray(idx)) {
        const since = Date.now() - 24 * 60 * 60 * 1000;
        observations = {
          total: idx.length,
          last24h: idx.filter((e) => Date.parse(e?.createdAt) >= since).length,
        };
      }
    }
  } catch { /* best effort */ }

  let researchCount = 0;
  try {
    const dir = configPath(cwd, 'knowledge', 'external', 'research');
    if (existsSync(dir)) {
      researchCount = readdirSync(dir).filter((f) => f.endsWith('.md')).length;
    }
  } catch { /* best effort */ }

  const workspacePreset = resolveActiveWorkspacePreset(cwd);
  const outcomes = readSummary(cwd) || { roles: {} };

  return {
    workspacePreset: { id: workspacePreset.id, displayName: workspacePreset.displayName ?? workspacePreset.id },
    observations,
    research: { count: researchCount },
    outcomes,
  };
}
