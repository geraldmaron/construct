/**
 * lib/telemetry/team-rollup.mjs — Backend-agnostic team telemetry rollup.
 *
 * Groups agent traces by teamId (stamped by construct headhunt at overlay creation),
 * computes per-team success rates, latency, handoff counts, and common blockers.
 * Backend is selected via CONSTRUCT_TRACE_BACKEND env var (default: langfuse).
 * Called by 'construct team review'.
 */

import * as langfuseBackend from './backends/langfuse.mjs';
import * as noopBackend from './backends/noop.mjs';

const BACKENDS = {
  langfuse: langfuseBackend,
  noop: noopBackend,
};

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function resolveBackend() {
  const name = process.env.CONSTRUCT_TRACE_BACKEND ?? 'langfuse';
  const backend = BACKENDS[name];
  if (!backend) throw new Error(`Unknown trace backend: ${name}. Available: ${Object.keys(BACKENDS).join(', ')}`);
  return backend;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rollupByTeam(traces) {
  const byTeam = {};
  for (const trace of traces) {
    const key = trace.teamId ?? 'unknown';
    if (!byTeam[key]) byTeam[key] = { teamId: key, traces: [] };
    byTeam[key].traces.push(trace);
  }

  return Object.values(byTeam).map(({ teamId, traces: tl }) => {
    const total = tl.length;
    const successes = tl.filter((t) => t.status === 'DONE').length;
    const latencies = tl.map((t) => t.latencyMs).filter((v) => v != null);
    const qualityScores = tl.map((t) => t.qualityScore).filter((v) => v != null);
    const totalHandoffs = tl.reduce((acc, t) => acc + (t.handoffs ?? 0), 0);

    const blockerCounts = {};
    for (const t of tl) {
      for (const b of (t.blockers ?? [])) {
        blockerCounts[b] = (blockerCounts[b] ?? 0) + 1;
      }
    }
    const topBlockers = Object.entries(blockerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, count]) => ({ label, count }));

    return {
      teamId,
      total,
      successRate: total > 0 ? (successes / total) : null,
      medianLatencyMs: median(latencies),
      medianQualityScore: median(qualityScores),
      totalHandoffs,
      topBlockers,
      agents: [...new Set(tl.map((t) => t.agentName))],
    };
  });
}

function formatRollup(rollups) {
  const lines = [];
  lines.push('Team Telemetry Rollup');
  lines.push('═════════════════════');
  lines.push('');

  if (rollups.length === 0) {
    lines.push('  No team traces found in the selected window.');
    lines.push('  Run construct headhunt with --temp or a template, then tasks will generate traces.');
    return lines.join('\n');
  }

  for (const r of rollups) {
    const successPct = r.successRate != null ? `${(r.successRate * 100).toFixed(0)}%` : 'n/a';
    const latency = r.medianLatencyMs != null ? `${(r.medianLatencyMs / 1000).toFixed(1)}s` : 'n/a';
    const quality = r.medianQualityScore != null ? r.medianQualityScore.toFixed(2) : 'n/a';
    lines.push(`  Team: ${r.teamId}`);
    lines.push(`    Runs: ${r.total}  Success: ${successPct}  Median latency: ${latency}  Quality: ${quality}`);
    lines.push(`    Handoffs: ${r.totalHandoffs}  Agents: ${r.agents.join(', ')}`);
    if (r.topBlockers.length > 0) {
      lines.push(`    Top blockers: ${r.topBlockers.map((b) => `${b.label} (${b.count})`).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function runTeamRollup({ windowMs = DEFAULT_WINDOW_MS, teamIds = [], silent = false } = {}) {
  const backend = resolveBackend();

  if (!(await backend.isAvailable())) {
    if (!silent) {
      process.stdout.write(`Trace backend '${backend.name}' is not configured — using noop.\n`);
      process.stdout.write('Set CONSTRUCT_TRACE_BACKEND and required credentials to enable telemetry.\n');
    }
    return [];
  }

  const targets = teamIds.length > 0 ? teamIds : ['all'];
  const allTraces = [];

  for (const teamId of targets) {
    const traces = await backend.listTraces(teamId === 'all' ? null : teamId, windowMs);
    allTraces.push(...traces);
  }

  const rollups = rollupByTeam(allTraces);

  if (!silent) {
    process.stdout.write(formatRollup(rollups) + '\n');
  }

  return rollups;
}

export async function runTeamReviewCli(args = []) {
  const windowArg = args.find((a) => a.startsWith('--window='))?.split('=')[1];
  const windowMs = windowArg ? parseWindowArg(windowArg) : DEFAULT_WINDOW_MS;
  const teamIds = args.filter((a) => !a.startsWith('--'));
  await runTeamRollup({ windowMs, teamIds });
}

function parseWindowArg(value) {
  const match = value.match(/^(\d+)(d|h|m)?$/);
  if (!match) return DEFAULT_WINDOW_MS;
  const n = parseInt(match[1], 10);
  const unit = match[2] ?? 'd';
  const multipliers = { d: 86_400_000, h: 3_600_000, m: 60_000 };
  return n * (multipliers[unit] ?? multipliers.d);
}
