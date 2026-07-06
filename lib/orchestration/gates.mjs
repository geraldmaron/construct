/**
 * lib/orchestration/gates.mjs — gate evaluation for orchestration routing
 * policy: research/framing/executive-approval gates, artifact review
 * requirements, and team-aware routing (blocked-decision escalation).
 *
 * Extracted from lib/orchestration-policy.mjs (construct-rf26.10). Every
 * function here answers "must this be true before work starts / who must
 * approve" — as distinct from classification.mjs (what kind of request is
 * this) and flow-selection.mjs (which specialists/chain run it).
 * orchestration-policy.mjs re-exports these unchanged for existing callers.
 */
import { getArtifactEntry } from '../artifact-manifest.mjs';
import { loadRegistry } from '../registry/loader.mjs';
import { resolveActiveScope } from '../scopes/loader.mjs';
import { scopeTeamsById, resolveIntentTeamForScope, resolveScopeTeamMeta } from '../scopes/teams.mjs';
import { WORK_CATEGORIES, INTENT_TO_TEAM } from './policy-constants.mjs';
import {
  classifyWorkCategory, detectRiskFlags, requiresLiveWebAccess,
  extractNamedEntities, classifyResearchShape, isProductIntelligenceRequest,
  detectDocAuthoringIntent,
} from './classification.mjs';

/**
 * Returns whether external research is required before scaffolding, with the
 * reason. Triggered by named entities not in the project glossary, by
 * architecture / writing / docs work, or by research-shaped intent regardless of
 * entities.
 */
export function requiresExternalResearch({ request = '', workCategory, riskFlags } = {}) {
  const entities = extractNamedEntities(request);
  const category = workCategory ?? classifyWorkCategory(request);
  const flags = riskFlags ?? detectRiskFlags(request);
  if (requiresLiveWebAccess(request)) {
    return { required: true, reason: 'web-access' };
  }
  if (entities.length > 0) {
    return { required: true, reason: 'named-entities', entities };
  }
  if (category === WORK_CATEGORIES.writing || flags.architecture || flags.docs) {
    return { required: true, reason: 'writing-or-architecture' };
  }
  // Research-shaped intent (compare, landscape, market, standards, …) fires even
  // without a named entity, since the answer is external. Bare research intent
  // does not: a code walkthrough ("explain how X works", "understand the
  // retrieval path") carries none of these terms and stays answered from local
  // context — the distinction that keeps the gate from firing on every prompt.
  const shape = classifyResearchShape(request);
  if (shape) {
    return { required: true, reason: 'research-shaped', shape };
  }
  return { required: false };
}

/**
 * Returns whether the request must pass a framing challenge
 * (cx-devil-advocate or cx-architect problem-reframing) before scaffolding.
 * Fires for architecture work, documentation sets, and any research-driven
 * artifact. Fail-closed: when in doubt, require the challenge.
 */
export function requiresFramingChallenge({ request = '', workCategory, riskFlags, introducesContract = false } = {}) {
  const category = workCategory ?? classifyWorkCategory(request);
  const flags = riskFlags ?? detectRiskFlags(request);
  if (flags.architecture || introducesContract) return { required: true, reason: 'architecture-or-contract' };
  if (category === WORK_CATEGORIES.writing && flags.docs) return { required: true, reason: 'documentation-set' };
  if (isProductIntelligenceRequest(request)) return { required: true, reason: 'product-intelligence' };
  if (detectDocAuthoringIntent(request)) return { required: true, reason: 'typed-document' };
  return { required: false };
}

export function requiresExecutiveApproval({
  scopeChange = false,
  productDecision = false,
  riskAcceptance = false,
  irreversibleAction = false,
  blockedDependency = false,
} = {}) {
  return Boolean(scopeChange || productDecision || riskAcceptance || irreversibleAction || blockedDependency);
}

export function resolveArtifactReviewRequirements(docAuthoring) {
  if (!docAuthoring?.docType) {
    return { requiredReviewers: [], optionalReviewers: [], releaseGate: null };
  }
  const entry = getArtifactEntry(docAuthoring.docType);
  const gate = entry?.releaseGate ?? {};
  return {
    requiredReviewers: gate.requiredReviewers ?? [],
    optionalReviewers: gate.optionalReviewers ?? [],
    releaseGate: gate,
  };
}

// Map a free-text request to the decision names that gate it. Keyed against the
// union of every team's forbiddenDecisions so a BLOCKED status fires only when
// the request actually asks for a decision the primary team cannot make. Ordered
// most-specific-first (deployment-timing before deployment) so the narrow match
// wins.

const REQUESTED_DECISION_PATTERNS = [
  [/\bsecurity[ -]?override\b|\boverride\s+(the\s+)?security\b/i, 'security-override'],
  [/\bdeployment[ -]?timing\b|\bwhen\s+to\s+deploy\b|\bdeploy\s+(?:immediately|now)\b/i, 'deployment-timing'],
  [/\bdeployment[ -]?readiness\b/i, 'deployment-readiness'],
  [/\bdeploy(?:ment|ing|s)?\b|\brelease\s+to\s+prod/i, 'deployment'],
  [/\binfra(?:structure)?[ -]?change\b|\bchange\s+(?:the\s+)?infra/i, 'infra-change'],
  [/\bscope[ -]?change\b|\bchange\s+(?:the\s+)?scope\b|\bre-?scope\b/i, 'scope-change'],
  [/\bproduct[ -]?scope\b/i, 'product-scope'],
  [/\buser[ -]?research\s+method/i, 'user-research-methods'],
  [/\buser[ -]?research\b/i, 'user-research'],
  [/\bimplementation[ -]?approach\b/i, 'implementation-approach'],
  [/\bimplementation[ -]?detail/i, 'implementation-details'],
  [/\bsecurity[ -]?policy\b/i, 'security-policy'],
  [/\bops[ -]?procedure|operational\s+procedure/i, 'ops-procedures'],
  [/\barchitect/i, 'architecture'],
];

function detectRequestedDecisions(request = '') {
  const text = String(request || '');
  const found = new Set();
  for (const [pattern, decision] of REQUESTED_DECISION_PATTERNS) {
    if (pattern.test(text)) found.add(decision);
  }
  return Array.from(found);
}

/**
 * Build team-aware routing metadata (RFC-0004 §2).
 * Returns { primaryTeam, involvedTeams, requiredApprovals, escalationPath, blockedStatus }.
 *
 * The primary team is intent-driven (INTENT_TO_TEAM), falling back to the first
 * specialist's team when the intent has no mapping. involvedTeams unions the
 * primary team with every selected specialist's team. blockedStatus fires when
 * the primary team's forbiddenDecisions intersect the decisions the request asks
 * for; escalation walks the primary team's path first. Team membership and team
 * metadata resolve from specialists/org.
 */
export function teamRoutingForSpecialists(specialists = [], { intent = null, request = '', cwd = null, docAuthoring = null } = {}) {
  let registry = null;
  try {
    registry = loadRegistry();
  } catch {
    return {
      primaryTeam: null,
      involvedTeams: [],
      requiredApprovals: [],
      escalationPath: [],
      blockedStatus: null,
    };
  }

  const profile = cwd ? resolveActiveScope(cwd) : null;
  const profileTeams = scopeTeamsById(profile);

  const teams = new Map();
  const involvedTeamIds = new Set();
  const addTeam = (teamId) => {
    if (!teamId) return;
    involvedTeamIds.add(teamId);
    if (teams.has(teamId)) return;
    const profileTeam = profileTeams ? resolveScopeTeamMeta(teamId, profile) : null;
    teams.set(teamId, profileTeam || registry.teams?.[teamId] || null);
  };

  for (const specialistId of specialists) {
    const cxId = specialistId.startsWith('cx-') ? specialistId : `cx-${specialistId}`;
    const specialist = registry.specialists?.[cxId];
    if (specialist?.team) addTeam(specialist.team);
  }

  // RFC-0004 §2 step 2: intent selects the primary owning team. It always counts
  // as involved even if no selected specialist sits on it yet.
  const profileIntentTeam = resolveIntentTeamForScope(intent, profile);
  const intentTeam = profileIntentTeam
    ?? (intent && INTENT_TO_TEAM[intent] ? INTENT_TO_TEAM[intent] : null);
  addTeam(intentTeam);

  const involvedTeams = Array.from(involvedTeamIds).sort();
  let primaryTeam = intentTeam || (involvedTeams.length > 0 ? involvedTeams[0] : null);

  if (docAuthoring?.owner) {
    const cxId = docAuthoring.owner.startsWith('cx-') ? docAuthoring.owner : `cx-${docAuthoring.owner}`;
    const ownerTeam = registry.specialists?.[cxId]?.team;
    if (ownerTeam) {
      addTeam(ownerTeam);
      primaryTeam = ownerTeam;
    }
  }

  // Collect required approvals from involved teams' decision rights.
  const requiredApprovals = new Set();
  for (const teamId of involvedTeamIds) {
    const team = teams.get(teamId);
    if (team?.decisionRights) {
      for (const decision of team.decisionRights) requiredApprovals.add(decision);
    }
  }

  // RFC-0004 §2 step 5: BLOCKED when the primary team forbids a decision the
  // request actually asks for. Escalate via that team's path.
  let blockedStatus = null;
  const primaryTeamObj = primaryTeam ? (teams.get(primaryTeam) || registry.teams?.[primaryTeam]) : null;
  if (Array.isArray(primaryTeamObj?.forbiddenDecisions)) {
    const blocked = detectRequestedDecisions(request)
      .filter((decision) => primaryTeamObj.forbiddenDecisions.includes(decision));
    if (blocked.length > 0) {
      blockedStatus = {
        team: primaryTeam,
        forbiddenDecisions: blocked,
        escalationPath: primaryTeamObj.escalationPath || [],
      };
    }
  }

  // Concatenate escalation paths, primary team first, de-duplicated.
  const escalationPath = [];
  const seen = new Set();
  const orderedTeams = primaryTeam
    ? [primaryTeam, ...involvedTeams.filter((t) => t !== primaryTeam)]
    : involvedTeams;
  for (const teamId of orderedTeams) {
    const team = teams.get(teamId) || registry.teams?.[teamId];
    if (Array.isArray(team?.escalationPath)) {
      for (const role of team.escalationPath) {
        if (!seen.has(role)) {
          escalationPath.push(role);
          seen.add(role);
        }
      }
    }
  }

  const squadId = primaryTeamObj?.kind === 'squad' ? primaryTeam : null;
  const groupId = primaryTeamObj?.kind === 'group' ? primaryTeam : (primaryTeamObj?.groupId ?? null);

  return {
    primaryTeam,
    squadId,
    groupId,
    collaborators: primaryTeamObj?.collaborators || [],
    involvedTeams,
    requiredApprovals: Array.from(requiredApprovals).sort(),
    escalationPath,
    blockedStatus,
  };
}
