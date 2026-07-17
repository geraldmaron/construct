/**
 * lib/oracle/synthesize.mjs — derive verdicts, gaps, and recommended actions
 * from the Oracle read model. Pure function — no side effects.
 *
 * `verdict` is one of the 11 ADR-0091 evidence-status states (VERDICT_STATES
 * below), not the old healthy/attention/degraded 3-value rollup. Consumers
 * must not compare against the old literals; use isCleanVerdict() or an
 * explicit VERDICT_STATES membership check instead.
 */

import { orgGraphToGapHints } from './org-graph.mjs';
import { routeAction, routeGap, signOffMetadata } from './routing.mjs';
import { resolveRemediationDispatch } from './remediation-dispatch.mjs';
import { isConstructPackageRepo } from '../host-disposition.mjs';

const LOW_SUCCESS_RATE = 0.6;
const UNRECOVERED_MISS_THRESHOLD = 5;

function gap(id, severity, signal, detail, extra = {}) {
  return { id, severity, signal, detail, ...extra };
}

function action(kind, summary, context = {}) {
  return { kind, summary, ...context };
}

function isDoctorEscalation(entry) {
  return entry.result === 'escalated'
    || entry.kind === 'escalation'
    || entry.kind === 'escalate';
}

// ADR-0091's 11-state evidence-status vocabulary, replacing the old 3-value
// healthy/attention/degraded rollup. `passed`/`failed`/`degraded` derive
// from the gaps this function already builds (severity-driven — same rule
// the old code used, just renamed and given siblings); the rest derive
// from explicit collection-outcome signals already on readModel sections
// (a `.error` from a caught collector exception, a `present` / `skipped` /
// `stale` / `pendingAsync` flag some collector in read-model.mjs sets).
//
// not-applicable vs unsupported (the ambiguity ADR-0091's rejected
// alternatives flags): `not-applicable` means this check's own
// precondition does not hold for *this* target — the detector exists and
// works, it just has nothing to check here (parity.skipped: not a
// Construct project; deadCode.skipped / dependencyGraph.applicable ===
// false: not a Construct package repo). `unsupported` means no detector
// for that check class exists in this codebase at all yet. Every section
// synthesizeVerdict reads today has a real collector behind it — none of
// them represent a not-yet-built detector — so `unsupported` is not
// reachable from current inputs; it is reserved for a future evidence
// producer that legitimately has none. Do not reach for `not-applicable`
// as a stand-in for "we haven't built this check", and do not reach for
// `unsupported` for "this project doesn't need this check."
export const VERDICT_STATES = Object.freeze([
  'collection-error', 'blocked', 'failed', 'incomplete', 'stale', 'not-run',
  'degraded', 'not-applicable', 'unsupported', 'passed', 'unknown',
]);

// Worst-status-wins rollup order, most severe first (ADR-0091 §Decision 2:
// "the existing rollup semantics carry forward"), grouped into four tiers:
// (1) collection-error/blocked — Oracle itself couldn't produce trustworthy
// evidence this tick, which undermines every other signal, not just one
// item; (2) failed — a confirmed hard problem; (3) incomplete/stale/not-run
// — the evidence backing *some* item is compromised or missing, which can
// mask a worse true severity than a same-cause low/medium gap alone would
// suggest, so these outrank a mere `degraded` even when (as they often do,
// e.g. a stale census also emitting a low-severity census-stale gap) they
// fire from the same section; (4) degraded, then the inert states.
// `unknown` is deliberately absent — it is only produced by the outer
// try/catch in synthesizeVerdict when synthesis itself throws,
// short-circuiting this rollup entirely rather than competing within it.
const VERDICT_PRIORITY = [
  'collection-error', 'blocked', 'failed', 'incomplete', 'stale', 'not-run',
  'degraded', 'not-applicable', 'unsupported', 'passed',
];

// Verdicts a consumer can treat as "nothing to act on": the check ran
// clean, or legitimately did not apply / has no detector yet. Every other
// state — a found problem, an evidence gap Oracle cannot vouch for, or an
// outright indeterminate result — is exactly what consumers' old
// `=== 'healthy'` / `!== 'healthy'` literal comparisons were trying (and,
// per ADR-0091, mostly failing) to distinguish.
export const CLEAN_VERDICTS = Object.freeze(new Set(['passed', 'not-applicable', 'unsupported']));

/**
 * @param {string} verdict — one of VERDICT_STATES
 * @returns {boolean} true when the verdict needs no follow-up
 */
export function isCleanVerdict(verdict) {
  return CLEAN_VERDICTS.has(verdict);
}

/**
 * Collection-outcome signals not expressed as gaps today: a collector's own
 * try/catch fired (collection-error), a required external tool was missing
 * so the check could not run at all (blocked), a section's precondition
 * doesn't hold for this target (not-applicable), a section was never
 * generated (not-run), or a section ran but its data is aged out
 * (stale) / partial (incomplete). Each check reads a flag a collector in
 * read-model.mjs already sets — no new input is invented here.
 *
 * @param {object} readModel
 * @returns {string[]} candidate verdict states, may contain duplicates
 */
function collectionSignals(readModel) {
  const signals = [];

  if (readModel.parity?.error) signals.push('collection-error');
  if (readModel.registryValidate?.error) signals.push('collection-error');

  if (readModel.beads?.present === false) signals.push('blocked');

  if (readModel.parity?.skipped === true) signals.push('not-applicable');
  if (readModel.deadCode?.skipped === true) signals.push('not-applicable');
  if (readModel.dependencyGraph && readModel.dependencyGraph.present === false) {
    signals.push(readModel.dependencyGraph.applicable === false ? 'not-applicable' : 'not-run');
  }

  if (readModel.outcomes?.present === false) signals.push('not-run');
  if (readModel.alignmentCensus?.present === false) signals.push('not-run');
  if (readModel.deadCode?.pendingAsync === true) signals.push('not-run');
  if (readModel.artifactGate?.specialistAudit?.present === false) signals.push('not-run');

  if (readModel.alignmentCensus?.present === true && readModel.alignmentCensus?.stale === true) signals.push('stale');
  if (readModel.dependencyGraph?.present === true && readModel.dependencyGraph?.stale === true) signals.push('stale');

  const cov = readModel.dependencyGraph?.coverage;
  const coverageMisses = cov
    ? (cov.capabilitiesWithoutTest?.length ?? 0) + (cov.capabilitiesWithoutImpl?.length ?? 0) + (cov.workflowsUncovered?.length ?? 0)
    : 0;
  if (coverageMisses > 0) signals.push('incomplete');
  if (readModel.observations?.present === true && readModel.observations?.count === 0) signals.push('incomplete');

  return signals;
}

/**
 * @param {object} readModel — output of collectReadModel / enrichReadModel
 * @returns {{ verdict: string, gaps: object[], recommendedActions: object[], error?: string }}
 */
export function synthesizeVerdict(readModel) {
  try {
    return synthesizeVerdictUnsafe(readModel);
  } catch (err) {
    // Synthesis itself broke for a reason no named collector's own
    // try/catch anticipated — 'collection-error' names a known collector
    // failure; 'unknown' names this one, an indeterminate result rather
    // than a crash, so a daemon tick can still write a tick record.
    return { verdict: 'unknown', gaps: [], recommendedActions: [], error: err?.message ?? String(err) };
  }
}

function synthesizeVerdictUnsafe(readModel) {
  const gaps = [];
  const recommendedActions = [];

  if (readModel.parity && !readModel.parity.skipped && !readModel.parity.ok) {
    const drift = (readModel.parity.summary ?? []).filter((s) => s.includes('drift') || s.includes('stale'));
    gaps.push(gap(
      'parity-drift',
      'high',
      'parity',
      drift.length ? drift.join('; ') : 'Project adapter parity check failed',
    ));
    recommendedActions.push(action(
      'adapters-sync',
      'Sync project adapters to repair parity drift',
      { surfaces: (readModel.parity.surfaces ?? []).filter((s) => s.status !== 'ok').map((s) => s.surface) },
    ));
  }

  const violations = readModel.contractViolations?.recentCount ?? 0;
  if (violations > 0) {
    gaps.push(gap(
      'contract-violations',
      violations >= 5 ? 'high' : 'medium',
      'contract-violations',
      `${violations} contract violation(s) in the last 24h`,
    ));
    recommendedActions.push(action(
      'specialist-review',
      'Review recent contract violations and route remediation to owning specialists',
      { count: violations, signOff: signOffMetadata({ id: 'contract-violations' }, readModel.projectDir) },
    ));
  }

  const doctorEscalations = (readModel.doctorLog?.recent ?? []).filter(isDoctorEscalation);
  if (doctorEscalations.length > 0) {
    gaps.push(gap(
      'doctor-escalation',
      'high',
      'doctor-log',
      `${doctorEscalations.length} doctor escalation(s) in the last 24h`,
    ));
    recommendedActions.push(action(
      'doctor-followup',
      'Inspect doctor escalations and confirm L0 recovery or open a beads issue',
      { count: doctorEscalations.length, signOff: signOffMetadata({ id: 'doctor-escalation' }, readModel.projectDir) },
    ));
  }

  const roles = readModel.outcomes?.roles ?? {};
  const degradedRoles = Object.entries(roles)
    .filter(([, stats]) => {
      const rate = stats?.last30?.successRate ?? stats?.successRate;
      return Number.isFinite(rate) && rate < LOW_SUCCESS_RATE && (stats?.last30?.count ?? stats?.count ?? 0) >= 3;
    })
    .map(([role]) => role);

  if (degradedRoles.length > 0) {
    gaps.push(gap(
      'outcomes-degradation',
      'medium',
      'outcomes',
      `Low 30-day success rate for: ${degradedRoles.join(', ')}`,
    ));
    recommendedActions.push(action(
      'trace-review',
      'Dispatch cx-reviewer to inspect degraded specialist outcomes',
      { roles: degradedRoles, signOff: signOffMetadata({ id: 'outcomes-degradation' }, readModel.projectDir) },
    ));
  }

  if (!readModel.outcomes?.present) {
    gaps.push(gap(
      'outcomes-missing',
      'low',
      'outcomes',
      'No .construct/outcomes/_summary.json — learning tiebreakers are blind',
    ));
    recommendedActions.push(action(
      'outcomes-aggregate',
      'Run outcomes aggregation to populate _summary.json',
    ));
  }

  const misses = readModel.toolDiscoverability?.misses;
  const unrecoveredMisses = (misses?.total ?? 0) - (misses?.recovered ?? 0);
  if (unrecoveredMisses >= UNRECOVERED_MISS_THRESHOLD) {
    const names = (misses.top ?? []).map((m) => m.name).join(', ');
    gaps.push(gap(
      'tool-discoverability',
      'low',
      'tool-recovery',
      `${unrecoveredMisses} unrecovered tool-name miss(es), most frequent: ${names}`,
    ));
  }

  const census = readModel.alignmentCensus;
  if (census?.present === false) {
    gaps.push(gap(
      'census-stale',
      'low',
      'alignment-census',
      'No audit-artifacts/alignment-census.json — alignment scorecard may be stale',
    ));
    recommendedActions.push(action(
      'census-run',
      'Run alignment census to refresh scorecard inputs',
    ));
  } else if (census?.present) {
    if (census.stale) {
      gaps.push(gap(
        'census-stale',
        'medium',
        'alignment-census',
        `Alignment census older than 7 days (${census.generatedAt})`,
      ));
      recommendedActions.push(action('census-run', 'Refresh stale alignment census'));
    }
    const regressions = census.audit?.regressions ?? [];
    if (regressions.length > 0) {
      gaps.push(gap(
        'alignment-regression',
        'high',
        'alignment-census',
        `${regressions.length} alignment ratchet regression(s): ${regressions.slice(0, 3).join(', ')}`,
      ));
    }
    const findingsCount = census.audit?.findingsCount ?? 0;
    if (findingsCount > 0 && regressions.length === 0) {
      gaps.push(gap(
        'alignment-regression',
        'medium',
        'alignment-census',
        `${findingsCount} open alignment audit finding(s)`,
      ));
    }
    const trueOrphans = census.skills?.trueOrphanCount ?? 0;
    if (trueOrphans > 0) {
      gaps.push(gap(
        'true-skill-orphan',
        'medium',
        'alignment-census',
        `${trueOrphans} true skill orphan(s) in census`,
      ));
    }
  }

  if (readModel.observations?.present && readModel.observations.count === 0) {
    gaps.push(gap(
      'observations-empty',
      'low',
      'observations',
      'Observation store exists but contains no records',
    ));
  }

  if (readModel.registryValidate?.needsRun) {
    recommendedActions.push(action(
      'registry-validate',
      'Validate capability registry against repo reality',
      { warnings: readModel.registryValidate.warningCount, errors: readModel.registryValidate.errorCount },
    ));
  }

  if ((readModel.registryValidate?.warningCount ?? 0) > 0) {
    gaps.push(gap(
      'registry-warn',
      'medium',
      'registry',
      `${readModel.registryValidate.warningCount} capability registry warning(s)`,
    ));
  }

  const hookFailures = readModel.hookFailures?.count ?? 0;
  if (hookFailures > 0) {
    gaps.push(gap(
      'hook-failures',
      'high',
      'doctor-log',
      `${hookFailures} hook failure(s) in the last 24h`,
    ));
  }

  const stuck = readModel.beads?.stuckInProgress ?? 0;
  const staleOpen = readModel.beads?.staleOpen ?? 0;
  if (stuck > 0 || staleOpen > 2) {
    gaps.push(gap(
      'beads-hygiene',
      stuck > 0 ? 'high' : 'medium',
      'beads',
      `Beads hygiene: ${stuck} stuck in_progress, ${staleOpen} stale-open`,
    ));
  }

  const deadRegressions = readModel.deadCode?.regressions ?? [];
  if (deadRegressions.length > 0) {
    gaps.push(gap(
      'dead-code-regression',
      'high',
      'dead-code',
      `${deadRegressions.length} new dead module(s): ${deadRegressions.slice(0, 3).join(', ')}`,
    ));
    recommendedActions.push(action(
      'structure-cleanup-proposal',
      'Propose dead-code cleanup (no auto-delete)',
      { modules: deadRegressions, signOff: signOffMetadata({ id: 'dead-code-regression' }, readModel.projectDir) },
    ));
  }

  const dupLanes = readModel.structure?.duplicateLanes ?? [];
  const skipStructureSprawl = isConstructPackageRepo(readModel.projectDir);
  if (dupLanes.length > 0 && !skipStructureSprawl) {
    gaps.push(gap(
      'structure-sprawl',
      'medium',
      'structure',
      `Parallel doc lanes detected: ${dupLanes.join(', ')}`,
    ));
    recommendedActions.push(action(
      'structure-cleanup-proposal',
      'Review duplicate doc lane scaffolding',
      { lanes: dupLanes, signOff: signOffMetadata({ id: 'structure-sprawl' }, readModel.projectDir) },
    ));
  }

  const rootLayout = readModel.alignmentCensus?.rootLayout;
  if (rootLayout && rootLayout.clean === false) {
    const parts = [];
    if (rootLayout.legacyDirs?.length) parts.push(`legacy dirs: ${rootLayout.legacyDirs.join(', ')}`);
    if (rootLayout.phantomPackPaths?.length) parts.push(`phantom pack: ${rootLayout.phantomPackPaths.join(', ')}`);
    if (rootLayout.legacyImports?.length) parts.push(`${rootLayout.legacyImports.length} legacy import(s)`);
    gaps.push(gap(
      'repo-layout-legacy',
      'high',
      'root-layout',
      `Tool-repo layout drift (${parts.join('; ') || `${rootLayout.findingCount} finding(s)`})`,
    ));
    recommendedActions.push(action(
      'structure-cleanup-proposal',
      'Remediate legacy root layout per audit phase 03c-root-layout',
      { rootLayout, signOff: signOffMetadata({ id: 'repo-layout-legacy' }, readModel.projectDir) },
    ));
  }

  const artifactGate = readModel.artifactGate ?? {};
  if (artifactGate.specialistAudit?.present && !artifactGate.specialistAudit.pass) {
    const auditDetail = artifactGate.specialistAudit.error
      ?? `${artifactGate.specialistAudit.crossCheckCount} issue(s)`;
    gaps.push(gap(
      'specialist-audit-drift',
      'high',
      'artifact-manifest',
      `Specialist audit cross-check failed (${auditDetail})`,
    ));
    recommendedActions.push(action(
      'registry-validate',
      'Run construct audit specialists and repair manifest/registry drift',
    ));
  }

  if ((artifactGate.bypassCount ?? 0) > 0) {
    gaps.push(gap(
      'artifact-gate-bypass',
      'medium',
      'artifact-manifest',
      `${artifactGate.bypassCount} artifact(s) bypass release gate via cx_release_gate frontmatter`,
    ));
    recommendedActions.push(action(
      'specialist-review',
      'Review bypassed artifacts and confirm cx_release_gate_reason is durable',
      { paths: (artifactGate.bypassed ?? []).map((b) => b.path).slice(0, 5) },
    ));
  }

  if ((artifactGate.reviewerGapCount ?? 0) > 0 && artifactGate.reviewerGateArmed !== false) {
    gaps.push(gap(
      'artifact-reviewer-gap',
      'medium',
      'artifact-manifest',
      `${artifactGate.reviewerGapCount} high-risk artifact(s) missing manifest required reviewers in agent log`,
    ));
  }

  const dg = readModel.dependencyGraph;
  if (dg?.present) {
    if (dg.stale) {
      gaps.push(gap(
        'dependency-graph-stale',
        'low',
        'dependency-graph',
        `Dependency matrix stale (${dg.staleReason ?? 'seeds changed'}) — run \`construct matrix build\``,
      ));
      recommendedActions.push(action('graph-rebuild', 'Rebuild the dependency matrix to clear staleness'));
    }

    const cov = dg.coverage ?? {};
    const noTest = cov.capabilitiesWithoutTest ?? [];
    const noImpl = cov.capabilitiesWithoutImpl ?? [];
    const uncovered = cov.workflowsUncovered ?? [];
    const coverageMisses = noTest.length + noImpl.length + uncovered.length;
    if (coverageMisses > 0) {
      const parts = [];
      if (noTest.length) parts.push(`${noTest.length} capability(ies) with no validating test`);
      if (noImpl.length) parts.push(`${noImpl.length} with no implementation edge`);
      if (uncovered.length) parts.push(`${uncovered.length} workflow(s) with no capability`);
      gaps.push(gap(
        'matrix-coverage-gap',
        coverageMisses >= 5 ? 'medium' : 'low',
        'dependency-graph',
        `Dependency matrix coverage: ${parts.join('; ')}`,
      ));
    }

    if (dg.untested?.length) {
      gaps.push(gap(
        'impact-untested',
        dg.untested.length >= 5 ? 'high' : 'medium',
        'dependency-graph',
        `${dg.untested.length} capability(ies) have implementation changes since last validation: ${dg.untested.slice(0, 5).map((u) => u.capability).join(', ')}`,
        { signOff: signOffMetadata({ id: 'impact-untested' }, readModel.projectDir) },
      ));
      recommendedActions.push(action(
        'specialist-review',
        'Re-run affected tests and refresh lastValidated for capabilities with changed implementation',
        { capabilities: dg.untested.map((u) => u.capability) },
      ));
    }
  }

  // Team governance signals from unified registry
  const teamGov = readModel.teamGovernance ?? { present: false, teams: {} };
  if (teamGov.present) {
    const understaffedTeams = Object.values(teamGov.teams ?? {}).filter((t) => t.understaffed);
    if (understaffedTeams.length > 0) {
      gaps.push(gap(
        'team-understaffed',
        'high',
        'team-governance',
        `${understaffedTeams.length} team(s) understaffed: ${understaffedTeams.map((t) => t.id).join(', ')}`,
      ));
      recommendedActions.push(action(
        'specialist-review',
        'Review team staffing gaps and escalate to rd-lead for resolution',
        { teams: understaffedTeams.map((t) => ({ id: t.id, name: t.name })) },
      ));
    }

    const brokenEscalations = Object.values(teamGov.teams ?? {}).filter((t) => t.escalationPathBroken);
    if (brokenEscalations.length > 0) {
      gaps.push(gap(
        'escalation-path-broken',
        'high',
        'team-governance',
        `${brokenEscalations.length} team(s) have broken escalation path: ${brokenEscalations.map((t) => t.id).join(', ')}`,
      ));
      recommendedActions.push(action(
        'registry-validate',
        'Validate and repair team escalation paths in unified registry',
        { teams: brokenEscalations.map((t) => t.id) },
      ));
    }

    const ownerlessTeams = Object.values(teamGov.teams ?? {}).filter((t) => !t.ownerExists);
    if (ownerlessTeams.length > 0) {
      gaps.push(gap(
        'team-decision-violation',
        'high',
        'team-governance',
        `${ownerlessTeams.length} team(s) missing owner specialist: ${ownerlessTeams.map((t) => `${t.id} (owner: ${t.owner})`).join(', ')}`,
      ));
      recommendedActions.push(action(
        'specialist-review',
        'Assign specialists to team owner roles or update registry',
        { teams: ownerlessTeams.map((t) => ({ id: t.id, missingOwner: t.owner })) },
      ));
    }

    const blockedHandoffs = teamGov.crossTeamHandoffsBlocked ?? [];
    if (blockedHandoffs.length > 0) {
      gaps.push(gap(
        'cross-team-handoff-blocked',
        'high',
        'team-governance',
        `${blockedHandoffs.length} cross-team handoff(s) blocked on an unstaffed approver team: ${blockedHandoffs.map((h) => `${h.contract} (needs ${h.blockedBy.join(', ')})`).join('; ')}`,
      ));
      recommendedActions.push(action(
        'specialist-review',
        'Staff the required approver team(s) or relax the cross-team approval requirement so the handoff can complete',
        { handoffs: blockedHandoffs },
      ));
    }
  }

  for (const hint of orgGraphToGapHints(readModel.orgGraph ?? {})) {
    if (!gaps.some((g) => g.id === hint.id)) gaps.push(hint);
    if (hint.id === 'workflow-misaligned') {
      recommendedActions.push(action(
        'executive-signoff-required',
        'Workflow alignment requires executive gate review',
        { signOff: signOffMetadata(hint, readModel.projectDir) },
      ));
    }
    if (hint.id === 'legal-review-pending') {
      recommendedActions.push(action(
        'specialist-review',
        'Route legal-compliance intake for sign-off',
        { signOff: signOffMetadata(hint, readModel.projectDir) },
      ));
    }
  }

  for (const g of gaps) {
    const route = routeGap(g);
    g.remediationRoute = {
      primary: route.primary,
      secondary: route.secondary ?? null,
      gateType: route.gateType ?? null,
    };
    const dispatch = resolveRemediationDispatch(g, { projectDir: readModel.projectDir });
    g.remediationRoute.mode = dispatch.mode;
    g.remediationRoute.specialists = dispatch.specialists;
    g.remediationRoute.teamRouting = dispatch.teamRouting;
  }
  for (const a of recommendedActions) {
    const route = routeAction(a.kind);
    a.remediationRoute = {
      primary: route.primary,
      gateType: route.gateType ?? null,
    };
    const dispatch = resolveRemediationDispatch(a, { projectDir: readModel.projectDir });
    a.remediationRoute.mode = dispatch.mode;
    a.remediationRoute.specialists = dispatch.specialists;
    a.remediationRoute.teamRouting = dispatch.teamRouting;
  }

  const signals = collectionSignals(readModel);
  if (gaps.some((g) => g.severity === 'high')) signals.push('failed');
  else if (gaps.length > 0) signals.push('degraded');
  const verdict = VERDICT_PRIORITY.find((v) => signals.includes(v)) ?? 'passed';

  return { verdict, gaps, recommendedActions };
}

export { isDoctorEscalation };
