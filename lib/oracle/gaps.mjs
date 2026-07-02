/**
 * lib/oracle/gaps.mjs — human and machine-readable gap surfaces for Oracle.
 *
 * Groups latest verdict gaps into verdict-only (hygiene/meta) vs actionable
 * auto-raise candidates. Does not file tracker beads.
 */

import { readLatestVerdict } from './verdicts.mjs';
import { isVerdictOnlyGap, autoRaiseEnabledForGap } from './policy.mjs';

const HYGIENE_HINTS = {
  'beads-hygiene': 'Run `construct beads drift` to inspect stuck/stale beads.',
  'workflow-misaligned': 'Run `construct workflow new` or `construct init` to align workflow state.',
  'propagation-stale': 'Run `construct sync` to refresh platform propagation.',
  'census-stale': 'Run `node scripts/alignment/census.mjs` to refresh the fleet census.',
  'outcomes-missing': 'Run `construct oracle` action `outcomes-aggregate` when outcome data is available.',
};

/**
 * @param {string} projectDir
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {{ verdict: string|null, gaps: object[], verdictOnly: object[], actionable: object[] }}
 */
export function collectOracleGaps(projectDir, { env = process.env } = {}) {
  const latest = readLatestVerdict(projectDir);
  const gaps = Array.isArray(latest?.gaps) ? latest.gaps : [];
  const verdictOnly = gaps.filter((g) => isVerdictOnlyGap(g));
  const actionable = gaps.filter((g) => autoRaiseEnabledForGap(g, env));
  return {
    verdict: latest?.verdict ?? null,
    gaps,
    verdictOnly,
    actionable,
  };
}

/**
 * @param {ReturnType<typeof collectOracleGaps>} data
 * @returns {string}
 */
export function formatOracleGapsReport(data) {
  const lines = [];
  lines.push(`Oracle gaps · verdict: ${data.verdict ?? 'unknown'}`);
  lines.push('');
  if (!data.gaps.length) {
    lines.push('No gaps in latest verdict.');
    return lines.join('\n') + '\n';
  }
  if (data.verdictOnly.length) {
    lines.push('Verdict-only (not filed to bd ready):');
    for (const g of data.verdictOnly) {
      lines.push(`  [${g.severity}] ${g.id}: ${g.detail}`);
      const hint = HYGIENE_HINTS[g.id];
      if (hint) lines.push(`    → ${hint}`);
    }
    lines.push('');
  }
  if (data.actionable.length) {
    lines.push('Actionable (eligible for auto-raise when high):');
    for (const g of data.actionable) {
      lines.push(`  [${g.severity}] ${g.id}: ${g.detail}`);
    }
    lines.push('');
  }
  const other = data.gaps.filter((g) => !isVerdictOnlyGap(g) && !autoRaiseEnabledForGap(g));
  if (other.length) {
    lines.push('Other gaps (below auto-raise threshold or disabled):');
    for (const g of other) {
      lines.push(`  [${g.severity}] ${g.id}: ${g.detail}`);
    }
    lines.push('');
  }
  lines.push('Inspect: `construct oracle review` · Drift: `construct beads drift`');
  return lines.join('\n') + '\n';
}
