/**
 * lib/oracle/synthesize.mjs — derive verdicts, gaps, and recommended actions
 * from the Oracle read model. Pure function — no side effects.
 */

const LOW_SUCCESS_RATE = 0.6;

function gap(id, severity, signal, detail) {
  return { id, severity, signal, detail };
}

function action(kind, summary, context = {}) {
  return { kind, summary, ...context };
}

/**
 * @param {object} readModel — output of collectReadModel
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
      { count: violations },
    ));
  }

  const doctorEscalations = (readModel.doctorLog?.recent ?? []).filter(
    (e) => e.result === 'escalated' || e.kind === 'escalation',
  );
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
      { count: doctorEscalations.length },
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
      { roles: degradedRoles },
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

  if (readModel.alignmentCensus?.present === false) {
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
  }

  if (readModel.observations?.present && readModel.observations.count === 0) {
    gaps.push(gap(
      'observations-empty',
      'low',
      'observations',
      'Observation store exists but contains no records',
    ));
  }

  recommendedActions.push(action(
    'registry-validate',
    'Validate capability registry against repo reality',
  ));

  let verdict = 'healthy';
  if (gaps.some((g) => g.severity === 'high')) verdict = 'degraded';
  else if (gaps.length > 0) verdict = 'attention';

  return { verdict, gaps, recommendedActions };
}
