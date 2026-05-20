/**
 * lib/performance/generate.mjs — end-of-session performance review writer.
 *
 * Reads two sources for the trailing 7-day window:
 *
 *   1. `~/.cx/session-cost.jsonl` — appended by the Stop hook.
 *      Per-call entries with model, tokens, cost, agent.
 *   2. Telemetry `/api/public/observations?type=GENERATION` — generation
 *      observations with latency, completionStartTime, errors,
 *      metadata.agent. Optional — review degrades when telemetry
 *      isn't reachable.
 *
 * Aggregates per agent: invocations, avgScore (placeholder = 1 -
 * failureRate until telemetry scores are wired), failureRate, p50/p95
 * latency, totalCostUsd, trend (compares this window to the prior
 * 7-day window — 'improving' / 'stable' / 'declining' / 'unknown'),
 * status ('healthy' if failureRate < 5% and avgScore >= 0.6;
 * 'needs_attention' if failureRate 5–20% or avgScore 0.4–0.6;
 * 'failing' if worse).
 *
 * Writes the result to
 * `~/.cx/performance-reviews/review-<iso>.json` (no test- prefix,
 * no -mock suffix, so the dashboard surfaces it as a real review).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const WINDOW_DAYS = 7;
const REVIEW_DIR = path.join(os.homedir(), '.cx', 'performance-reviews');
const COST_LEDGER = path.join(os.homedir(), '.cx', 'session-cost.jsonl');

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function readLedger(cutoffMs) {
  if (!fs.existsSync(COST_LEDGER)) return [];
  const raw = fs.readFileSync(COST_LEDGER, 'utf8');
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const ts = Date.parse(entry.ts);
      if (Number.isFinite(ts) && ts >= cutoffMs) entries.push({ ...entry, _ts: ts });
    } catch { /* skip malformed */ }
  }
  return entries;
}

async function fetchTelemetryGenerations(env, { sinceMs, limit = 500 } = {}) {
  const key = env.CONSTRUCT_TELEMETRY_PUBLIC_KEY;
  const secret = env.CONSTRUCT_TELEMETRY_SECRET_KEY;
  if (!key || !secret) return null;
  const baseUrl = (env.CONSTRUCT_TELEMETRY_URL ?? '').replace(/\/$/, '');
  const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let res = await fetch(
      `${baseUrl}/api/public/observations?type=GENERATION&fromStartTime=${encodeURIComponent(new Date(sinceMs).toISOString())}&limit=${limit}`,
      { headers: { Authorization: auth }, signal: controller.signal },
    );
    if (res.status === 400 || res.status === 422) {
      res = await fetch(
        `${baseUrl}/api/public/observations?type=GENERATION&limit=${limit}`,
        { headers: { Authorization: auth }, signal: controller.signal },
      );
    }
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function classifyStatus(avgScore, failureRate) {
  if (failureRate >= 0.2 || avgScore < 0.4) return 'failing';
  if (failureRate >= 0.05 || avgScore < 0.6) return 'needs_attention';
  return 'healthy';
}

function classifyTrend(currentScore, priorScore) {
  if (priorScore == null) return 'unknown';
  if (currentScore > priorScore + 0.05) return 'improving';
  if (currentScore < priorScore - 0.05) return 'declining';
  return 'stable';
}

function aggregateAgentStats(ledger, generations) {
  const byAgent = new Map();
  for (const entry of ledger) {
    const agent = entry.agent || 'orchestrator';
    const stat = byAgent.get(agent) || {
      name: agent,
      invocations: 0,
      totalCostUsd: 0,
      latencies: [],
      errors: 0,
      models: new Set(),
    };
    stat.invocations += 1;
    stat.totalCostUsd += Number(entry.cost_usd) || 0;
    if (entry.model) stat.models.add(entry.model);
    byAgent.set(agent, stat);
  }
  if (Array.isArray(generations)) {
    for (const g of generations) {
      const agent =
        g.metadata?.agent ||
        (typeof g.name === 'string' && g.name.startsWith('llm.') ? g.name.slice(4) : null);
      if (!agent || agent === 'chat') continue;
      const stat = byAgent.get(agent) || {
        name: agent,
        invocations: 0,
        totalCostUsd: 0,
        latencies: [],
        errors: 0,
        models: new Set(),
      };
      const start = g.startTime ? Date.parse(g.startTime) : null;
      const end = g.endTime ? Date.parse(g.endTime) : null;
      if (start && end && end > start) stat.latencies.push(end - start);
      if ((g.level || '').toLowerCase() === 'error') stat.errors += 1;
      if (g.model) stat.models.add(g.model);
      byAgent.set(agent, stat);
    }
  }
  return byAgent;
}

export async function generatePerformanceReview({
  windowDays = WINDOW_DAYS,
  now = Date.now(),
  env = process.env,
} = {}) {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const priorCutoff = now - windowDays * 2 * 24 * 60 * 60 * 1000;
  const ledger = readLedger(cutoff);
  const priorLedger = readLedger(priorCutoff).filter((e) => e._ts < cutoff);
  const generations = await fetchTelemetryGenerations(env, { sinceMs: cutoff });
  const currentByAgent = aggregateAgentStats(ledger, generations || []);
  const priorByAgent = aggregateAgentStats(priorLedger, []);
  const agentStats = [];
  for (const [name, s] of currentByAgent) {
    const failureRate = s.invocations > 0 ? s.errors / s.invocations : 0;
    const avgScore = Math.max(0, Math.min(1, 1 - failureRate));
    const priorStats = priorByAgent.get(name);
    const priorScore = priorStats && priorStats.invocations > 0
      ? Math.max(0, Math.min(1, 1 - priorStats.errors / priorStats.invocations))
      : null;
    const status = classifyStatus(avgScore, failureRate);
    const trend = classifyTrend(avgScore, priorScore);
    agentStats.push({
      name,
      invocations: s.invocations,
      scoredInvocations: s.invocations,
      avgScore: Number(avgScore.toFixed(2)),
      failureRate: Number(failureRate.toFixed(3)),
      status,
      trend,
      totalCostUsd: Number(s.totalCostUsd.toFixed(4)),
      latencyMs: s.latencies.length
        ? { p50: Math.round(quantile(s.latencies, 0.5)), p95: Math.round(quantile(s.latencies, 0.95)) }
        : null,
      models: [...s.models],
      reasoning: failureRate > 0
        ? `${s.errors}/${s.invocations} calls errored over the window`
        : `${s.invocations} calls, no errors detected`,
    });
  }
  agentStats.sort((a, b) => b.invocations - a.invocations);
  const generatedAt = new Date(now).toISOString();
  return {
    generated: generatedAt,
    period: {
      from: new Date(cutoff).toISOString(),
      to: generatedAt,
      days: windowDays,
    },
    sources: {
      costLedgerEntries: ledger.length,
      telemetryGenerations: Array.isArray(generations) ? generations.length : null,
      telemetryReachable: generations !== null,
    },
    agentStats,
  };
}

export function writeReview(report, { dir = REVIEW_DIR, now = Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const filename = `review-${stamp}.json`;
  const full = path.join(dir, filename);
  fs.writeFileSync(full, JSON.stringify(report, null, 2));
  return { filename, path: full };
}

export async function runGenerator({ env = process.env, now = Date.now() } = {}) {
  const report = await generatePerformanceReview({ env, now });
  const written = writeReview(report, { now });
  return { ...written, agentCount: report.agentStats.length };
}
