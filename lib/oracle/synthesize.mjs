/**
 * lib/oracle/synthesize.mjs — derive verdicts, gaps, and recommended actions
 * from the Oracle read model. Pure function — no side effects.
 */

import { orgGraphToGapHints } from './org-graph.mjs';
import { routeAction, routeGap, signOffMetadata } from './routing.mjs';
import { resolveRemediationDispatch } from './remediation-dispatch.mjs';
import { isConstructPackageRepo } from '../host-disposition.mjs';

const LOW_SUCCESS_RATE = 0.6;

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

/**
 * @param {object} readModel — output of collectReadModel / enrichReadModel
 * @returns {{ verdict: string, gaps: object[], recommendedActions: object[] }}
 */
export function synthesizeVerdict(readModel) {
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
      'Dispatch cx-trace-reviewer to inspect degraded specialist outcomes',
      { roles: degradedRoles, signOff: signOffMetadata({ id: 'outcomes-degradation' }, readModel.projectDir) },
    ));
  }

  if (!readModel.outcomes?.present) {
    gaps.push(gap(
      'outcomes-missing',
      'low',
      'outcomes',
      'No .cx/outcomes/_summary.json — learning tiebreakers are blind',
    ));
    recommendedActions.push(action(
      'outcomes-aggregate',
      'Run outcomes aggregation to populate _summary.json',
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

  let verdict = 'healthy';
  if (gaps.some((g) => g.severity === 'high')) verdict = 'degraded';
  else if (gaps.length > 0) verdict = 'attention';

  return { verdict, gaps, recommendedActions };
}

export { isDoctorEscalation };
