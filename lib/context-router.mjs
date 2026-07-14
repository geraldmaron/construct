/**
 * lib/context-router.mjs — role-aware context routing for persona dispatch.
 *
 * Reduces token waste and context leakage by giving each persona only the
 * artifact types its role policy prefers, within a caller-supplied token
 * budget. Routing is deterministic: same input → same output. Each kept
 * artifact carries a `reason` string; each omitted candidate carries the
 * reason it was dropped so debug output can explain the packet end-to-end.
 *
 * Per-role policies map a persona name to a prioritized list of artifact
 * kinds (e.g. product-manager prefers user-signal → prd → research-brief).
 * Unknown roles fall through to a DEFAULT_POLICY so the router never
 * silently produces an empty packet.
 *
 * The router does not call retrieval. The caller does hybrid retrieval
 * up front, then hands the candidate list in. Keeps this module pure and
 * fast to test.
 */

const APPROX_CHARS_PER_TOKEN = 4;

function approximateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / APPROX_CHARS_PER_TOKEN);
}

function artifactTokenCost(artifact) {
  return approximateTokens(artifact.summary || '') + approximateTokens(artifact.title || '') + approximateTokens(artifact.path || '');
}

/**
 * Per-role context policy. `prefers` is an ordered list of artifact kinds
 * for that role. `avoids` is an explicit reject list. `maxArtifacts` caps
 * the count regardless of budget. Roles not listed here fall back to
 * DEFAULT_POLICY.
 *
 * Artifact `kind` strings align with the existing storage taxonomy
 * (lib/docs-routing.mjs lanes and construct_documents.kind values):
 * user-signal, prd, prfaq, research-brief, adr, rfc, system-design,
 * interface-contract, dep-map, target-file, test, build-command,
 * eval-spec, success-metric, failure-case, trace, quality-score,
 * incident, runbook, slo, log, service-dep.
 */
export const ROLE_POLICIES = {
  'product-manager': {
    prefers: ['user-signal', 'prd', 'prfaq', 'research-brief', 'acceptance-criteria', 'roadmap'],
    avoids: ['runbook', 'service-dep'],
    maxArtifacts: 8,
  },
  'ux-researcher': {
    prefers: ['user-signal', 'research-brief', 'prfaq', 'prd'],
    avoids: ['runbook', 'service-dep', 'interface-contract'],
    maxArtifacts: 8,
  },
  'business-strategist': {
    prefers: ['research-brief', 'prfaq', 'prd', 'roadmap'],
    avoids: ['runbook', 'target-file'],
    maxArtifacts: 8,
  },
  'researcher': {
    prefers: ['research-brief', 'user-signal', 'prfaq', 'eval-spec'],
    avoids: ['runbook'],
    maxArtifacts: 10,
  },
  'rd-lead': {
    prefers: ['research-brief', 'eval-spec', 'prfaq', 'prd', 'failure-case'],
    avoids: ['runbook'],
    maxArtifacts: 10,
  },
  'architect': {
    prefers: ['adr', 'rfc', 'system-design', 'interface-contract', 'dep-map'],
    avoids: ['runbook', 'user-signal'],
    maxArtifacts: 8,
  },
  'ai-engineer': {
    prefers: ['eval-spec', 'failure-case', 'trace', 'system-design', 'target-file'],
    avoids: ['runbook'],
    maxArtifacts: 10,
  },
  'engineer': {
    prefers: ['target-file', 'test', 'interface-contract', 'build-command', 'system-design'],
    avoids: ['prfaq', 'roadmap', 'user-signal'],
    maxArtifacts: 12,
  },
  'debugger': {
    prefers: ['target-file', 'test', 'trace', 'failure-case', 'log'],
    avoids: ['prfaq', 'roadmap'],
    maxArtifacts: 10,
  },
  'qa': {
    prefers: ['test', 'acceptance-criteria', 'failure-case', 'target-file'],
    avoids: ['research-brief', 'prfaq'],
    maxArtifacts: 10,
  },
  'reviewer': {
    prefers: ['target-file', 'test', 'interface-contract', 'adr'],
    avoids: ['prfaq', 'roadmap'],
    maxArtifacts: 10,
  },
  'evaluator': {
    prefers: ['eval-spec', 'success-metric', 'failure-case', 'trace', 'quality-score'],
    avoids: ['runbook', 'user-signal'],
    maxArtifacts: 10,
  },
  'trace-reviewer': {
    prefers: ['trace', 'failure-case', 'quality-score', 'eval-spec'],
    avoids: ['runbook', 'roadmap'],
    maxArtifacts: 10,
  },
  'security': {
    prefers: ['adr', 'interface-contract', 'target-file', 'trace', 'failure-case'],
    avoids: ['roadmap', 'prfaq'],
    maxArtifacts: 10,
  },
  'sre': {
    prefers: ['incident', 'runbook', 'slo', 'log', 'service-dep'],
    avoids: ['prfaq', 'roadmap', 'research-brief'],
    maxArtifacts: 12,
  },
  'platform-engineer': {
    prefers: ['service-dep', 'runbook', 'slo', 'interface-contract', 'target-file'],
    avoids: ['prfaq', 'roadmap'],
    maxArtifacts: 12,
  },
  'operations': {
    prefers: ['runbook', 'service-dep', 'slo', 'dep-map'],
    avoids: ['prfaq', 'research-brief'],
    maxArtifacts: 10,
  },
  'release-manager': {
    prefers: ['acceptance-criteria', 'test', 'changelog', 'roadmap'],
    avoids: ['research-brief'],
    maxArtifacts: 8,
  },
  'docs-keeper': {
    prefers: ['adr', 'rfc', 'prd', 'changelog'],
    avoids: ['log', 'trace'],
    maxArtifacts: 10,
  },
  'legal-compliance': {
    prefers: ['adr', 'prfaq', 'research-brief', 'interface-contract'],
    avoids: ['runbook', 'log'],
    maxArtifacts: 8,
  },
  'designer': {
    prefers: ['prd', 'prfaq', 'user-signal', 'research-brief'],
    avoids: ['runbook', 'target-file'],
    maxArtifacts: 8,
  },
  'accessibility': {
    prefers: ['prd', 'failure-case', 'test', 'target-file'],
    avoids: ['runbook', 'research-brief'],
    maxArtifacts: 8,
  },
  'data-analyst': {
    prefers: ['research-brief', 'success-metric', 'trace', 'eval-spec'],
    avoids: ['runbook', 'roadmap'],
    maxArtifacts: 10,
  },
  'data-engineer': {
    prefers: ['interface-contract', 'system-design', 'target-file', 'dep-map'],
    avoids: ['prfaq', 'roadmap'],
    maxArtifacts: 10,
  },
  'explorer': {
    prefers: ['research-brief', 'user-signal', 'prd', 'rfc'],
    avoids: [],
    maxArtifacts: 12,
  },
  'orchestrator': {
    prefers: ['rfc', 'adr', 'prd', 'roadmap'],
    avoids: [],
    maxArtifacts: 10,
  },
};

const DEFAULT_POLICY = {
  prefers: ['rfc', 'adr', 'prd', 'target-file', 'test'],
  avoids: [],
  maxArtifacts: 8,
};

const DEFAULT_BUDGET_TOKENS = 6000;

function policyFor(role) {
  return ROLE_POLICIES[role] || DEFAULT_POLICY;
}

function scoreCandidate(candidate, policy) {
  const kind = candidate.kind || 'unknown';
  if (policy.avoids.includes(kind)) return -1;
  const preferIdx = policy.prefers.indexOf(kind);
  const preferenceScore = preferIdx === -1 ? 0 : (policy.prefers.length - preferIdx) / policy.prefers.length;
  const retrievalScore = typeof candidate.score === 'number' ? candidate.score : 0;
  return preferenceScore * 0.7 + retrievalScore * 0.3;
}

function reasonForKeep(candidate, policy) {
  const kind = candidate.kind || 'unknown';
  const idx = policy.prefers.indexOf(kind);
  if (idx !== -1) return `role prioritizes "${kind}" (rank ${idx + 1}/${policy.prefers.length})`;
  return `acceptable kind "${kind}" for role`;
}

function reasonForOmit(candidate, policy, cause) {
  const kind = candidate.kind || 'unknown';
  if (cause === 'avoid') return `kind "${kind}" is in this role's avoid list`;
  if (cause === 'budget') return `exceeded token budget`;
  if (cause === 'maxArtifacts') return `role's maxArtifacts cap (${policy.maxArtifacts}) reached`;
  return 'no reason recorded';
}

function buildTaskSummary(request, triage) {
  const lines = [];
  if (request) lines.push(String(request).slice(0, 240));
  if (triage?.intakeType && triage.intakeType !== 'unknown') {
    lines.push(`Triage: ${triage.intakeType} / ${triage.rdStage} · owner ${triage.primaryOwner} · next ${triage.recommendedAction}`);
  }
  return lines.join(' — ');
}

/**
 * Build a role-aware context packet.
 *
 * @param {object} opts
 * @param {string} opts.request
 * @param {object} [opts.triage]
 * @param {string} opts.role
 * @param {string} [opts.project]
 * @param {object} [opts.budget]
 * @param {number} [opts.budget.maxTokens]
 * @param {Array}  [opts.candidates] — pre-retrieved artifacts (path, title, kind, summary, score)
 * @param {Array}  [opts.constraints]
 * @param {Array}  [opts.priorObservations]
 * @param {Array}  [opts.verificationRequirements]
 * @returns {{ role: string, contextPacket: object, omitted: Array, tokensUsed: number }}
 */
export function buildContextPacket({
  request = '',
  triage = null,
  role = 'orchestrator',
  project = null,
  budget = {},
  candidates = [],
  constraints = [],
  priorObservations = [],
  verificationRequirements = [],
} = {}) {
  const policy = policyFor(role);
  const maxTokens = budget?.maxTokens ?? DEFAULT_BUDGET_TOKENS;

  const partitioned = [];
  const omitted = [];

  for (const c of candidates) {
    const score = scoreCandidate(c, policy);
    if (score < 0) {
      omitted.push({ artifact: c, reason: reasonForOmit(c, policy, 'avoid') });
      continue;
    }
    partitioned.push({ candidate: c, score });
  }

  partitioned.sort((a, b) => b.score - a.score);

  const taskSummary = buildTaskSummary(request, triage);
  let tokensUsed = approximateTokens(taskSummary);
  const relatedArtifacts = [];

  for (const { candidate } of partitioned) {
    if (relatedArtifacts.length >= policy.maxArtifacts) {
      omitted.push({ artifact: candidate, reason: reasonForOmit(candidate, policy, 'maxArtifacts') });
      continue;
    }
    const cost = artifactTokenCost(candidate);
    if (tokensUsed + cost > maxTokens) {
      omitted.push({ artifact: candidate, reason: reasonForOmit(candidate, policy, 'budget') });
      continue;
    }
    tokensUsed += cost;
    relatedArtifacts.push({
      path: candidate.path,
      title: candidate.title,
      kind: candidate.kind,
      summary: candidate.summary,
      reason: reasonForKeep(candidate, policy),
    });
  }

  const relevantFiles = relatedArtifacts
    .filter((a) => a.kind === 'target-file' || a.kind === 'test')
    .map(({ path, reason, kind }) => ({ path, kind, reason }));

  return {
    role,
    project,
    contextPacket: {
      taskSummary,
      relevantFiles,
      relatedArtifacts,
      priorObservations: [...priorObservations],
      constraints: [...constraints],
      verificationRequirements: [...verificationRequirements],
    },
    omitted,
    tokensUsed,
  };
}

// A run persists whatever candidate artifacts the caller supplies, and that
// snapshot is re-read at every task's prompt materialization (provider and
// host must see the same bytes). Sanitize the caller's list once at plan time:
// coerce fields to strings, bound each field and the total count, and drop
// entries with no usable content — so an unbounded or malformed candidate list
// can never bloat the persisted run record or the downstream prompt.

const MAX_CONTEXT_CANDIDATES = 40;
const MAX_CANDIDATE_SUMMARY_CHARS = 600;
const MAX_CANDIDATE_TITLE_CHARS = 200;
const MAX_CANDIDATE_PATH_CHARS = 300;

export function normalizeContextCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  const out = [];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const path = c.path != null ? String(c.path).slice(0, MAX_CANDIDATE_PATH_CHARS) : '';
    const title = c.title != null ? String(c.title).slice(0, MAX_CANDIDATE_TITLE_CHARS) : '';
    const kind = c.kind != null ? String(c.kind) : 'unknown';
    const summary = c.summary != null ? String(c.summary).slice(0, MAX_CANDIDATE_SUMMARY_CHARS) : '';
    if (!path && !title && !summary) continue;
    const entry = { path, title, kind, summary };
    const skillId = c.skillId != null ? String(c.skillId) : (kind === 'skill' && path ? path : null);
    if (skillId) entry.skillId = skillId;
    if (typeof c.score === 'number' && Number.isFinite(c.score)) entry.score = c.score;
    out.push(entry);
    if (out.length >= MAX_CONTEXT_CANDIDATES) break;
  }
  return out;
}

// A skill routed to a role as context is a role-attributed load: enforce the
// specialist's skill entitlements (specialists/org/**, the same list get_skill
// checks) before the packet is built, so an unentitled skill can never be
// rendered into that role's prompt. Injection is not interactive, so the
// enforcement is strict — an unentitled skill is dropped, not merely flagged.
// A null/empty entitlement set means "unknown specialist" and is treated as
// unrestricted, matching get_skill's `entitled.size > 0` gate. Non-skill
// candidates pass through untouched.

export function filterEntitledSkillCandidates(candidates, entitledSkills = null) {
  const kept = [];
  const denied = [];
  const gated = entitledSkills instanceof Set && entitledSkills.size > 0;
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const skillId = c?.skillId || (c?.kind === 'skill' ? c?.path : null);
    if (skillId && gated && !entitledSkills.has(skillId)) {
      denied.push({ artifact: c, reason: `skill "${skillId}" is not in this role's entitlement list` });
      continue;
    }
    kept.push(c);
  }
  return { kept, denied };
}
