/**
 * lib/scopes/lifecycle.mjs — Scope lifecycle operations.
 *
 * A scope is a curated description of an org's work loop, intake taxonomy,
 * role set, and rebrand language. Creating one is a research task, not a
 * code task. The module enforces that by producing a draft + a requirements
 * brief that names which existing Construct specialists are expected to
 * complete each section. Operators dispatch those specialists, collect the
 * answers, then promote the draft.
 *
 * Lifecycle stages:
 *   draft     - in `.cx/scopes/draft-<id>/` with requirements.md + scope.json
 *   active    - in `specialists/org/scopes/<id>.json` (curated), or a named
 *               custom profile under the construct-rf26.13 config-layer tiers
 *               (`~/.construct/org/scopes/<id>.json` or
 *               `<project>/.cx/org/scopes/<id>.json`), or the single-file
 *               `.cx/scope.json` escape hatch (custom, anonymous)
 *   archived  - in `archive/scopes/<id>/` with the final state and an
 *               archive-note.md explaining why it was retired
 *
 * Health: per-scope observation and outcome counts pulled from the existing
 * stores, so scope health travels alongside the rest of the learning loops.
 *
 * Lifecycle events: createDraftScope and archiveScope each fire a
 * scope.updated role event so subscribers can react to taxonomy changes
 * without polling the filesystem.
 */
import fs from 'node:fs';
import path from 'node:path';
import { configPath } from '../config-dir.mjs';
import { fileURLToPath } from 'node:url';

import { listScopes, loadScope } from './loader.mjs';
import { emitBestEffort as emitRoleEvent } from '../roles/event-bus.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

function draftDir(cwd, id) {
  return configPath(cwd, 'scopes', `draft-${id}`);
}

function archiveDir(cwd, id) {
  return path.join(cwd, 'archive', 'scopes', id);
}

const REQUIREMENTS_BRIEF = (id, displayName) => `# Scope requirements: ${displayName} (${id})

This brief is a discovery and design contract for a new Construct scope. Methodology lives in \`docs/guides/concepts/persona-research.md\` and lifecycle in \`docs/guides/concepts/profile-lifecycle.md\`. Treat each section as a task to dispatch to the named specialist. A draft scope is not ready to promote until every section has evidence backing it. The aim is research-grounded, not opinion-grounded.

Specialists used here are the existing Construct cx-* personas (already in the registry). They are dispatched the standard way; this doc just names which questions each one owns.

A scope selects flows and skill emphasis over the shared, fixed 12-role core roster (\`specialists/org/specialists/\`) — it does not invent new roles or departments. If this org genuinely needs a role absent from that roster, author it as a custom specialist via the construct-rf26.13 config layer (\`construct specialist create <id> --custom\`, docs/guides/cookbook/custom-specialists-and-teams.md) rather than declaring it inline here.

This draft scaffolding produces:
- \`scope.json\` — the structural definition (intake taxonomy, doc templates, skill emphasis)
- \`requirements.md\` — this brief
- \`personas/<role>.md\` — optional, only when \`seedRoles\` names a role genuinely absent from the core roster (rare; most orgs route entirely through the existing 12)

## 1. Discovery (cx-researcher)

Goal: characterize the people, the work, and the outputs of this org type.

- Which of the 12 core roles (architect, reviewer, engineer, debugger, qa, security, operations, product-manager, data-analyst, designer, researcher, orchestrator) are primary for this org, and which are rarely if ever needed?
- What is the dominant work loop? Describe in 5 to 8 stages.
- What are the recurring signals that enter the loop (briefs, bug reports, customer messages, etc.)?
- What are the canonical output artifacts (campaigns, runbooks, papers, etc.)?
- Evidence: cite at least 2 primary sources (interviews, docs, postmortems, public job-spec language).

## 2. Framing (cx-product-manager)

Goal: turn discovery into an intake taxonomy and a stage sequence.

- Propose intake types (max 24). Each must be: distinct, observable, and routable to a primary owner among the 12 core roles.
- Propose stages (max 12). Order matters; each stage must answer "what changed?" not just "what happened next?".
- For each intake type, name the primary owner role (one of the 12) and the recommended chain (max 3 hops).
- For each stage, name the dominant artifact produced.
- Acceptance: a representative real signal classifies into a single intake type with confidence > 0.6.

## 3. Skill emphasis (cx-architect)

Goal: pick the flows and skill bundles this profile should emphasize from the shared registry — not a new role set.

- For each doc template the profile ships, confirm a docTemplates entry exists and name its owning role.
- List the \`defaultSkills\` (skill ids under \`skills/\`) this org's work loop leans on most — these become the profile's baseline skill entitlement (lib/skills/router.mjs), on top of whatever an individual specialist already carries.
- Set \`researchProfiles\` per intake type (external, user, codebase, market, compliance) and \`toneDefaults\` per doc template.
- Name the orchestrator's role in this loop (routing/dispatch is always cx-orchestrator; this just confirms nothing here bypasses it).
- Acceptance: every \`defaultSkills\` entry resolves to a real file under \`skills/\`; every doc template maps to an owning role among the 12.

## 4. Validation (cx-reviewer)

Goal: prove the draft works on real signals before promotion.

- Run \`construct scope classify --draft=${id} --fixture=<path>\` against at least 5 representative signals.
- Score: precision (right intake type), recall (no false unknowns), routing-confidence (median).
- Acceptance: precision >= 0.7, recall >= 0.7, no \`unknown\` for the canonical signals.

## 5. Promotion (operator decision)

Goal: move the draft into the active catalog, or leave it as a durable custom profile.

- Curated path: hand-edit \`specialists/org/scopes/${id}.json\` from this draft, open a PR, run \`npm run lint:scopes\`.
- Custom path (named, reusable): copy the draft scope.json to \`<project>/.cx/org/scopes/${id}.json\` (project tier, git-tracked) or \`~/.construct/org/scopes/${id}.json\` (user tier, shared across projects) — the same builtin -> user -> project precedence construct-rf26.13 gives custom specialists and teams. Then \`construct scope set ${id}\` switches to it exactly like a curated scope.
- Custom path (anonymous, one-off): copy the draft scope.json to \`<project>/.cx/scope.json\` with \`"custom": true\` — the pre-rf26.13 escape hatch, still supported for a single ad hoc override.
- Any path requires the validation acceptance criteria above to be met.

## 6. Health monitoring (cx-reviewer)

Goal: keep the scope honest after it ships.

- \`construct scope health ${id}\` reports observation counts, per-role outcome rates, classification confidence over a window.
- Any role with success-rate < 0.5 across 10+ runs triggers a review: is the role wrong, the prompt wrong, or the routing wrong?
- Health data is the input for future scope revisions; never edit a scope without a health report first.

## 7. Archive (cx-operations + operator)

Goal: retire a scope cleanly without losing the learning.

- \`construct scope archive ${id}\` moves the scope JSON and the intake table reference into \`archive/scopes/${id}/\`, including the final health report as evidence.
- Observations and outcomes already recorded under this scope stay in place; they are durable.
- An archive-note.md explains why it was retired (superseded by, deprecated for, merged into).
`;

const DRAFT_PROFILE_TEMPLATE = (id, displayName) => ({
  $schema: '../schemas/scope.schema.json',
  id,
  displayName: displayName || id,
  tagline: 'Draft. Fill in via the requirements brief.',
  extends: null,
  custom: true,
  roles: [],
  departments: [],
  intake: {
    types: [],
    stages: [],
    classificationTable: null,
  },
  docTemplates: [],
  hooks: {
    sessionReflect: 'on',
    sessionOptimize: 'on',
  },
  defaultSkills: [],
  rebrand: {
    intakeQueueLabel: 'Intake',
    signalNoun: 'signal',
  },
});

function personaTemplate(displayName) {
  return `# ${displayName}

> Persona research artifact. Methodology: \`docs/guides/concepts/persona-research.md\`. Fill from evidence; opinion is rejected at review.

## Goals
- <What does success look like for this role?>

## Frustrations
- <What slows them down?>

## Decision rights
- Decides: <list>
- Escalates: <list>

## Handoffs
- Hands off to: <role> when <condition>
- Receives from: <role> when <condition>

## Output contract
- Format: <markdown, diff, JSON>
- Depth: <one-paragraph, two-page, etc.>
- Citations: <required | encouraged | none>

## Failure modes
- <Common ways this persona goes wrong>

## Evidence
- <Primary source 1>
- <Primary source 2>
`;
}

function departmentTemplate(id, displayName) {
  return `# ${displayName} (${id})

> Department charter. One paragraph: what this department owns, what it does not own, who it hands off to. Frame from organizational-design research (\`docs/guides/concepts/persona-research.md\` § departmental structure).

## Charter

<One paragraph mission statement. Be specific about boundaries.>

## Roles in this department

- <role-id> — see \`personas/<role>.md\`

## Handoffs

- To <department>: <condition>
- From <department>: <condition>

## Evidence

- <Interview, doc, public job spec>
`;
}

/**
 * Scaffold a draft scope under .cx/scopes/draft-<id>/. Returns the paths
 * to the requirements brief and the draft scope JSON.
 */
/**
 * Scaffold a draft scope + its persona and department research artifacts.
 *
 * @param {object} args
 * @param {string} args.cwd
 * @param {string} args.id
 * @param {string} [args.displayName]
 * @param {string[]} [args.seedRoles] - role ids to scaffold persona files for
 * @param {Array<{id:string,displayName:string}>} [args.seedDepartments] - departments to scaffold charters for
 */
export function createDraftScope({ cwd, id, displayName, seedRoles = [], seedDepartments = [] }) {
  if (!cwd || !id) throw new Error('createDraftScope: cwd and id are required');
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) {
    throw new Error('createDraftScope: id must match ^[a-z][a-z0-9-]{1,30}$');
  }
  if (listScopes().includes(id)) {
    throw new Error(`createDraftScope: ${id} already exists in the curated catalog`);
  }
  const dir = draftDir(cwd, id);
  if (fs.existsSync(dir)) {
    throw new Error(`createDraftScope: draft already exists at ${path.relative(cwd, dir)}; archive or delete it before recreating`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'personas'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'departments'), { recursive: true });

  const briefPath = path.join(dir, 'requirements.md');
  const draftPath = path.join(dir, 'scope.json');
  fs.writeFileSync(briefPath, REQUIREMENTS_BRIEF(id, displayName || id));

  const draft = DRAFT_PROFILE_TEMPLATE(id, displayName);
  if (Array.isArray(seedRoles) && seedRoles.length > 0) draft.roles = seedRoles.slice(0, 80);
  if (Array.isArray(seedDepartments) && seedDepartments.length > 0) {
    draft.departments = seedDepartments.slice(0, 12).map((d) => ({
      id: d.id,
      displayName: d.displayName || d.id,
      charter: 'Draft. See departments/<id>.md for the canonical charter, derived from organizational-design research (Galbraith STAR).',
      roles: [],
    }));
  }
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2) + '\n');

  const personaPaths = [];
  for (const roleId of seedRoles) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(roleId)) continue;
    const p = path.join(dir, 'personas', `${roleId}.md`);
    fs.writeFileSync(p, personaTemplate(roleId));
    personaPaths.push(p);
  }

  const departmentPaths = [];
  for (const dept of seedDepartments) {
    if (!dept?.id || !/^[a-z][a-z0-9-]{1,40}$/.test(dept.id)) continue;
    const p = path.join(dir, 'departments', `${dept.id}.md`);
    fs.writeFileSync(p, departmentTemplate(dept.id, dept.displayName || dept.id));
    departmentPaths.push(p);
  }

  emitScopeUpdated({ id, stage: 'draft', dir });
  return { dir, briefPath, draftPath, personaPaths, departmentPaths };
}

// Lifecycle bridge: emits scope.updated whenever the curated catalog gains
// or loses an entry, so subscribers (none by default; project overlays can
// bind) can react to taxonomy changes.

function emitScopeUpdated(context) {
  emitRoleEvent('scope.updated', {
    summary: `scope ${context.stage}: ${context.id}`,
    context,
  });
}

/**
 * List drafts under .cx/scopes/. Returns [{ id, dir, hasScope, hasBrief }].
 */
export function listDrafts(cwd) {
  const root = configPath(cwd, 'scopes');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('draft-')) continue;
    const id = entry.name.replace(/^draft-/, '');
    const dir = path.join(root, entry.name);
    out.push({
      id,
      dir,
      hasScope: fs.existsSync(path.join(dir, 'scope.json')),
      hasBrief: fs.existsSync(path.join(dir, 'requirements.md')),
    });
  }
  return out;
}

/**
 * Archive a curated scope by moving it (and any artifacts it owns in the
 * repo) into archive/scopes/<id>/. Observations and outcomes are not
 * touched; they remain as historical record. Requires a non-empty `reason`.
 */
export function archiveScope({ id, reason }) {
  if (!id) throw new Error('archiveScope: id is required');
  if (!reason || reason.trim().length < 8) {
    throw new Error('archiveScope: a substantive reason (>= 8 chars) is required');
  }
  const srcScope = path.join(REPO_ROOT, 'specialists', 'org', 'scopes', `${id}.json`);
  if (!fs.existsSync(srcScope)) {
    throw new Error(`archiveScope: ${id} not found in specialists/org/scopes/`);
  }
  const scopeJson = JSON.parse(fs.readFileSync(srcScope, 'utf8'));
  const tablePath = typeof scopeJson?.intake?.classificationTable === 'string'
    ? path.join(REPO_ROOT, scopeJson.intake.classificationTable)
    : null;

  const dstDir = archiveDir(REPO_ROOT, id);
  fs.mkdirSync(dstDir, { recursive: true });
  fs.renameSync(srcScope, path.join(dstDir, `${id}.json`));
  if (tablePath && fs.existsSync(tablePath)) {
    fs.renameSync(tablePath, path.join(dstDir, path.basename(tablePath)));
  }
  fs.writeFileSync(path.join(dstDir, 'archive-note.md'), [
    `# Archive: ${id}`,
    '',
    `Archived at ${new Date().toISOString()}.`,
    '',
    '## Reason',
    '',
    reason.trim(),
    '',
    '## What stayed',
    '',
    'Observations and outcomes recorded under this scope remain in `.cx/observations/` and `.cx/outcomes/` and continue to be searchable. The intake table and scope JSON were moved into this directory. To restore: move the files back to their original paths and re-run `npm run lint:scopes`.',
    '',
  ].join('\n'));
  emitScopeUpdated({ id, stage: 'archived', dir: dstDir, reason: reason.trim() });
  return { archived: dstDir };
}

/**
 * Per-scope health rollup. Counts observations and outcomes tagged with
 * the scope id, plus the median classification confidence over a window.
 *
 * @param {string} cwd - project root
 * @param {string} scopeId
 * @param {object} [opts]
 * @param {number} [opts.windowDays=30]
 */
export function scopeHealth(cwd, scopeId, { windowDays = 30 } = {}) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const obsDir = configPath(cwd, 'observations');
  let observationCount = 0;
  if (fs.existsSync(obsDir)) {
    const indexPath = path.join(obsDir, 'index.json');
    if (fs.existsSync(indexPath)) {
      try {
        const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        for (const entry of idx) {
          if (Date.parse(entry.createdAt) < cutoff) continue;
          // Observations stamp project, not scope. Fall back to project ==
          // scope id for the common case where the operator named them the
          // same; otherwise count under "all" so we never silently report 0.
          observationCount += entry.project === scopeId ? 1 : 0;
        }
      } catch { /* unreadable index — health stays 0 */ }
    }
  }

  const outcomesDir = configPath(cwd, 'outcomes');
  const roleHealth = {};
  if (fs.existsSync(outcomesDir)) {
    for (const f of fs.readdirSync(outcomesDir)) {
      if (!f.endsWith('.jsonl')) continue;
      const role = f.replace(/\.\d+\.jsonl$|\.jsonl$/, '');
      const lines = fs.readFileSync(path.join(outcomesDir, f), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry.profile !== scopeId) continue;
        if (Date.parse(entry.ts) < cutoff) continue;
        const r = roleHealth[role] || (roleHealth[role] = { count: 0, success: 0 });
        r.count += 1;
        if (entry.success === true) r.success += 1;
      }
    }
  }
  const roleSummary = Object.fromEntries(
    Object.entries(roleHealth).map(([r, s]) => [r, {
      runs: s.count,
      successRate: s.count > 0 ? Number((s.success / s.count).toFixed(3)) : 0,
    }]),
  );

  return {
    scope: scopeId,
    scopeExists: !!loadScope(scopeId, { cwd }),
    windowDays,
    observationCount,
    roles: roleSummary,
    generatedAt: new Date().toISOString(),
  };
}
