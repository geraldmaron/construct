/**
 * lib/workplace-loop/signals.mjs — rule-based signal detection over
 * normalized source records.
 *
 * Generalizes spike D's detectors (docs/notes/research/workspace-control-plane/
 * spikes/d-daily-workplace-loop/loop/run-loop.mjs: detectStaleOrOverdueObjectives,
 * detectUnaddressedIssues, detectUnownedBlockers, classifyNoise) from
 * fixture-specific field names (`obj.pillar`, `issue.severity` hand-set in
 * JSON built to make the gap legible) to structural properties any real
 * GitHub-shaped issue record carries: staleness by date math, "unowned and
 * risk-labeled" by label pattern, "noise" by an absence of substantive
 * signal (no labels, no assignee, short body) rather than a ground-truth
 * flag baked into test data. This is the part of the pipeline requirement 4
 * ("re-validate detection quality against real, messy source data") exists
 * to stress — these rules were written before being run against this repo's
 * live issues, and the honest result is whatever they actually find, not
 * what a fixture was built to make them find.
 */

const DEFAULT_STALE_DAYS = 30;
const DEFAULT_RISK_LABEL_PATTERN = /\b(blocker|critical|urgent|security|p0|p1)\b/i;
const DEFAULT_NOISE_LABEL_PATTERN = /^(question|duplicate|wontfix|invalid|chore)$/i;
const DEFAULT_NOISE_BODY_MIN_CHARS = 40;

function daysBetween(fromIso, toIso) {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Open issues with no activity in more than `staleDays`. Severity is `high`
 * once stale for 2x the threshold, `medium` otherwise — a coarse, documented
 * escalation, not a fabricated precision judgment.
 */
export function detectStaleIssues(issues, { asOf = new Date().toISOString(), staleDays = DEFAULT_STALE_DAYS } = {}) {
  const signals = [];
  for (const issue of issues) {
    if (issue.state !== 'open' || !issue.updatedAt) continue;
    const daysSince = daysBetween(issue.updatedAt, asOf);
    if (daysSince <= staleDays) continue;
    signals.push({
      id: `SIG-STALE-${issue.id}`,
      type: 'stale_issue',
      severity: daysSince > staleDays * 2 ? 'high' : 'medium',
      summary: `${issue.id} ("${issue.title}") is open with no activity in ${daysSince} days (last activity ${issue.updatedAt}).`,
      sources: [{ ...issue.source }],
      issueRef: issue.id,
    });
  }
  return signals;
}

/**
 * Open issues carrying a risk-suggestive label (`riskLabelPattern`) with no
 * assignee — an unowned issue the label itself marks as consequential.
 */
export function detectUnownedRiskIssues(issues, { riskLabelPattern = DEFAULT_RISK_LABEL_PATTERN } = {}) {
  const signals = [];
  for (const issue of issues) {
    if (issue.state !== 'open' || issue.assignee) continue;
    const matchedLabels = (issue.labels ?? []).filter((l) => riskLabelPattern.test(l));
    if (matchedLabels.length === 0) continue;
    signals.push({
      id: `SIG-RISK-${issue.id}-unowned`,
      type: 'unowned_risk_issue',
      severity: 'high',
      summary: `${issue.id} ("${issue.title}") is labeled ${matchedLabels.join(', ')} and has no assignee.`,
      sources: [{ ...issue.source }],
      issueRef: issue.id,
    });
  }
  return signals;
}

/**
 * Issues with no substantive signal: a label that itself marks the issue as
 * non-actionable (`noiseLabelPattern`), or no labels + no assignee + a body
 * shorter than `bodyMinChars` — structural low-information heuristics, not a
 * ground-truth noise flag.
 */
export function classifyNoiseIssues(issues, {
  noiseLabelPattern = DEFAULT_NOISE_LABEL_PATTERN,
  bodyMinChars = DEFAULT_NOISE_BODY_MIN_CHARS,
} = {}) {
  const noise = [];
  for (const issue of issues) {
    const hasNoiseLabel = (issue.labels ?? []).some((l) => noiseLabelPattern.test(l));
    if (hasNoiseLabel) {
      noise.push({ ...issue.source, ref: issue.id, reason: `carries noise label (${issue.labels.join(', ')})` });
      continue;
    }
    const hasNoLabelsOrOwner = (issue.labels ?? []).length === 0 && !issue.assignee;
    const bodyLen = (issue.body ?? '').trim().length;
    if (hasNoLabelsOrOwner && bodyLen < bodyMinChars) {
      noise.push({ ...issue.source, ref: issue.id, reason: 'no labels, no assignee, and a body too short to carry a decision' });
    }
  }
  return noise;
}

/**
 * Run every detector over one normalized issue set and return the meaningful
 * (non-noise) signal list plus the noise list, mirroring spike D's
 * three-way split (noise / meaningful-no-action / meaningful-needs-action —
 * the last two both land in `meaningful`, since only alignment (align.mjs)
 * can tell "healthy" from "needs action").
 */
export function detectSignals(issues, opts = {}) {
  const stale = detectStaleIssues(issues, opts);
  const unownedRisk = detectUnownedRiskIssues(issues, opts);
  const noise = classifyNoiseIssues(issues, opts);
  const noiseRefs = new Set(noise.map((n) => n.ref));
  const meaningful = [...stale, ...unownedRisk].filter((s) => !noiseRefs.has(s.issueRef));
  return { meaningful, noise };
}
