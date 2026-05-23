/**
 * lib/mcp/tools/profile.mjs — MCP wrappers for the org-profile + learning surfaces.
 *
 * Bridges PR #67 capabilities (profiles, outcomes, sandboxes, knowledge_add,
 * learning status) so subagents talking through the construct-mcp server can
 * read the same state the CLI exposes. Operator-only surfaces (optimize_apply,
 * optimize_rollback) remain CLI-only and are not registered here.
 *
 * Pattern: each export is a thin schema-validated wrapper around the existing
 * lib/* function the CLI already uses. Errors return `{ error: string }` so
 * the MCP dispatcher hands a structured failure back instead of crashing.
 * Destructive operations (profile_archive) require `confirm: true`, matching
 * the storage_reset / delete_ingested_artifacts pattern in tools/storage.mjs.
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadProfile,
  listProfiles,
  loadCustomProfile,
  resolveActiveProfile,
} from '../../profiles/loader.mjs';
import {
  createDraftProfile,
  listDrafts,
  archiveProfile,
  profileHealth,
} from '../../profiles/lifecycle.mjs';
import { recordOutcome } from '../../outcomes/record.mjs';
import { aggregateOutcomes, readSummary } from '../../outcomes/aggregate.mjs';
import { addResearchFinding } from '../../knowledge/research-store.mjs';
import { listSandboxes } from '../../sandbox.mjs';

function cwdOf(args) {
  return args && args.cwd ? resolve(String(args.cwd)) : process.cwd();
}

// Read-only: active profile.

export function profileShow(args = {}) {
  const cwd = cwdOf(args);
  const profile = resolveActiveProfile(cwd, args.id ? String(args.id) : null);
  return {
    id: profile.id,
    displayName: profile.displayName ?? profile.id,
    tagline: profile.tagline ?? null,
    custom: profile.custom === true,
    roles: Array.isArray(profile.roles) ? profile.roles : [],
    departments: Array.isArray(profile.departments)
      ? profile.departments.map((d) => ({ id: d.id, displayName: d.displayName, roleCount: Array.isArray(d.roles) ? d.roles.length : 0 }))
      : [],
    intake: {
      types: profile.intake?.types ?? [],
      stages: profile.intake?.stages ?? [],
    },
    docTemplates: profile.docTemplates ?? [],
    hooks: profile.hooks ?? null,
    rebrand: profile.rebrand ?? null,
  };
}

// Read-only: catalog summary.

export function profileList() {
  return {
    profiles: listProfiles().map((id) => {
      const p = loadProfile(id);
      return p
        ? {
            id: p.id,
            displayName: p.displayName ?? p.id,
            tagline: p.tagline ?? null,
            roleCount: Array.isArray(p.roles) ? p.roles.length : 0,
            departmentCount: Array.isArray(p.departments) ? p.departments.length : 0,
          }
        : { id, error: 'failed to parse' };
    }),
  };
}

// Read-only: drafts + custom profile under .cx/.

export function profileDrafts(args = {}) {
  const cwd = cwdOf(args);
  const drafts = listDrafts(cwd).map((d) => ({
    id: d.id,
    dir: d.dir,
    hasProfile: d.hasProfile,
    hasBrief: d.hasBrief,
  }));
  const custom = loadCustomProfile(cwd);
  return {
    drafts,
    custom: custom ? { id: custom.id, displayName: custom.displayName ?? custom.id } : null,
  };
}

// Read-only: per-profile health rollup.

export function profileHealthTool(args = {}) {
  const cwd = cwdOf(args);
  const id = args.id ? String(args.id) : resolveActiveProfile(cwd).id;
  const windowDays = Number.isFinite(args.window_days) ? Number(args.window_days) : 30;
  return { id, windowDays, ...profileHealth(cwd, id, { windowDays }) };
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
  const profile = args.profile ? String(args.profile) : resolveActiveProfile(cwd)?.id;
  const file = recordOutcome(cwd, {
    role: String(args.role),
    intakeId: args.intake_id ? String(args.intake_id) : null,
    profile,
    success: !!args.success,
    escalated: !!args.escalated,
    durationMs: Number.isFinite(args.duration_ms) ? Number(args.duration_ms) : null,
    notes: args.notes ? String(args.notes) : null,
    source: args.source ? String(args.source) : 'mcp',
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

// Mutating, gated: scaffold a draft profile.

export function profileCreate(args = {}) {
  if (args.confirm !== true) {
    return { error: 'profile_create requires confirm=true to scaffold files' };
  }
  const cwd = cwdOf(args);
  if (!args.id) return { error: 'profile_create requires id:string' };
  try {
    const res = createDraftProfile({
      cwd,
      id: String(args.id),
      displayName: args.display_name ? String(args.display_name) : undefined,
      seedRoles: Array.isArray(args.seed_roles) ? args.seed_roles.map(String) : [],
      seedDepartments: Array.isArray(args.seed_departments) ? args.seed_departments : [],
    });
    return {
      ok: true,
      dir: res.dir,
      briefPath: res.briefPath,
      draftPath: res.draftPath,
      personaPaths: res.personaPaths,
      departmentPaths: res.departmentPaths,
    };
  } catch (err) {
    return { error: err.message ?? String(err) };
  }
}

// Mutating, gated, destructive: archive a curated profile.

export function profileArchive(args = {}) {
  if (args.confirm !== true) {
    return { error: 'profile_archive requires confirm=true (destructive: moves files into archive/profiles/)' };
  }
  if (!args.id || !args.reason || String(args.reason).trim().length < 8) {
    return { error: 'profile_archive requires id:string and reason:string (>=8 chars)' };
  }
  try {
    return { ok: true, ...archiveProfile({ id: String(args.id), reason: String(args.reason) }) };
  } catch (err) {
    return { error: err.message ?? String(err) };
  }
}

// Read-only: sandbox roster.

export function sandboxList() {
  return { sandboxes: listSandboxes() };
}

// Read-only: learning dashboard mirror.

export function learningStatus(args = {}) {
  const cwd = cwdOf(args);

  let observations = { total: 0, last24h: 0 };
  try {
    const idxPath = join(cwd, '.cx', 'observations', 'index.json');
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
    const dir = join(cwd, '.cx', 'knowledge', 'external', 'research');
    if (existsSync(dir)) {
      researchCount = readdirSync(dir).filter((f) => f.endsWith('.md')).length;
    }
  } catch { /* best effort */ }

  const profile = resolveActiveProfile(cwd);
  const outcomes = readSummary(cwd) || { roles: {} };

  return {
    profile: { id: profile.id, displayName: profile.displayName ?? profile.id, custom: profile.custom === true },
    observations,
    research: { count: researchCount },
    outcomes,
  };
}
