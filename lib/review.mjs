#!/usr/bin/env node
/**
 * lib/review.mjs — Langfuse performance data pipeline
 *
 * Fetches traces and quality scores from Langfuse, aggregates per-agent
 * metrics, and writes two files:
 *
 *   {outDir}/{date}-raw.json     — raw aggregated metrics for cx-trace-reviewer
 *   {outDir}/{date}.md           — standalone markdown report (no AI needed)
 *
 * Usage (via construct review):
 *   node lib/review.mjs [--days=N] [--agent=cx-NAME] [--out=PATH] [--json-only]
 *
 * Requires env: LANGFUSE_BASEURL (default: https://cloud.langfuse.com), LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── Config ─────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    })
);

const days = parseInt(args.days ?? "30", 10);
const agentFilter = args.agent ?? null;
const jsonOnly = args["json-only"] === true || args["json-only"] === "true";
const outDir = (args.out && typeof args.out === "string")
  ? path.resolve(args.out)
  : path.join(os.homedir(), ".cx", "performance-reviews");

fs.mkdirSync(outDir, { recursive: true });

const LANGFUSE_BASEURL = (process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com").replace(/\/$/, "");

function langfuseHeaders() {
  const key = process.env.LANGFUSE_PUBLIC_KEY;
  const secret = process.env.LANGFUSE_SECRET_KEY;
  if (!key || !secret) throw new Error("LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set.");
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
  };
}

function readSessionEfficiency() {
  const efficiencyPath = path.join(os.homedir(), ".cx", "session-efficiency.json");
  try {
    const stats = JSON.parse(fs.readFileSync(efficiencyPath, "utf8"));
    const readCount = Number(stats.readCount || 0);
    const uniqueFileCount = Number(stats.uniqueFileCount || 0);
    const repeatedReadCount = Number(stats.repeatedReadCount || 0);
    const largeReadCount = Number(stats.largeReadCount || 0);
    const totalBytesRead = Number(stats.totalBytesRead || 0);

    let score = 1;
    if (readCount > 0) {
      score -= Math.min(0.35, repeatedReadCount * 0.04);
      score -= Math.min(0.25, largeReadCount * 0.05);
      if (totalBytesRead > 500_000) score -= 0.1;
      if (uniqueFileCount > 25) score -= 0.05;
    }

    return {
      score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
      readCount,
      uniqueFileCount,
      repeatedReadCount,
      largeReadCount,
      totalBytesRead,
      lastUpdatedAt: stats.lastUpdatedAt || null,
    };
  } catch {
    return null;
  }
}

// ─── Langfuse API ────────────────────────────────────────────────────────────

async function langfuseGet(path, params = {}) {
  const url = new URL(`${LANGFUSE_BASEURL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: langfuseHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Langfuse ${path} returned ${res.status}: ${body}`);
  }
  return res.json();
}

// ─── Data Fetching ───────────────────────────────────────────────────────────

async function fetchData(fromDate, toDate) {
  const from = fromDate.toISOString();
  console.error(`Fetching traces from ${from}...`);

  const traceParams = { fromTimestamp: from, limit: 100 };
  if (agentFilter) traceParams.name = agentFilter;

  const tracesJson = await langfuseGet("/api/public/traces", traceParams);
  const rawTraces = tracesJson.data ?? [];

  // Fetch quality scores for all traces
  const scoreMap = {};
  for (const t of rawTraces) {
    const scoresJson = await langfuseGet("/api/public/scores", { traceId: t.id, name: "quality", limit: 10 }).catch(() => ({ data: [] }));
    for (const s of scoresJson.data ?? []) {
      scoreMap[t.id] = s;
    }
  }

  // Normalize to shape expected by aggregate()
  const traces = rawTraces.map(t => ({
    id: t.id,
    name: t.metadata?.agentName ?? t.name ?? "unknown",
    timestamp: t.timestamp,
    latency: t.latency != null ? Math.round(t.latency * 1000) : undefined, // Langfuse returns seconds; convert to ms
    input: t.input,
    output: t.output,
  }));

  const scores = rawTraces.flatMap(t => {
    const s = scoreMap[t.id];
    if (!s || s.value == null) return [];
    return [{
      traceId: t.id,
      name: s.name ?? "quality",
      value: s.value,
      comment: s.comment ?? "",
    }];
  });

  console.error(`  Fetched ${traces.length} traces, ${scores.length} quality scores`);
  return { traces, scores };
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

function aggregate(traces, scores, fromDate, toDate) {
  // Index scores by traceId
  const scoresByTrace = new Map();
  for (const score of scores) {
    if (!score.traceId) continue;
    if (!scoresByTrace.has(score.traceId)) scoresByTrace.set(score.traceId, []);
    scoresByTrace.get(score.traceId).push(score);
  }

  // Group traces by agent name
  const byAgent = new Map();
  for (const trace of traces) {
    const name = trace.name ?? "unknown";
    if (!byAgent.has(name)) byAgent.set(name, []);
    byAgent.get(name).push(trace);
  }

  const agentStats = [];
  for (const [agentName, agentTraces] of byAgent.entries()) {
    const qualityScores = [];
    const latencies = [];
    const lowScoreTraces = [];

    for (const trace of agentTraces) {
      // Latency
      if (trace.latency) latencies.push(trace.latency);

      // Quality scores (name='quality' convention from sharedGuidance)
      const traceScores = (scoresByTrace.get(trace.id) ?? [])
        .filter((s) => s.name === "quality" || s.name === "Quality");

      if (traceScores.length > 0) {
        const avg = traceScores.reduce((s, x) => s + x.value, 0) / traceScores.length;
        qualityScores.push({ value: avg, traceId: trace.id, timestamp: trace.timestamp });
        if (avg < 0.5) {
          lowScoreTraces.push({
            id: trace.id,
            score: avg,
            timestamp: trace.timestamp,
            comments: traceScores.map((s) => s.comment).filter(Boolean),
          });
        }
      }
    }

    const avgScore = qualityScores.length > 0
      ? qualityScores.reduce((s, x) => s + x.value, 0) / qualityScores.length
      : null;

    latencies.sort((a, b) => a - b);
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : null;
    const p90 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.9)] : null;

    const failureRate = agentTraces.length > 0
      ? lowScoreTraces.length / agentTraces.length
      : 0;

    // Trend: compare first half vs second half of the period
    const midpoint = new Date((fromDate.getTime() + toDate.getTime()) / 2);
    const firstHalf = qualityScores.filter((s) => new Date(s.timestamp) < midpoint);
    const secondHalf = qualityScores.filter((s) => new Date(s.timestamp) >= midpoint);
    let trend = "stable";
    if (firstHalf.length >= 2 && secondHalf.length >= 2) {
      const avgFirst = firstHalf.reduce((s, x) => s + x.value, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((s, x) => s + x.value, 0) / secondHalf.length;
      const delta = avgSecond - avgFirst;
      if (delta > 0.05) trend = "improving";
      else if (delta < -0.05) trend = "declining";
    }

    const status = (() => {
      if (avgScore === null) return "no-data";
      if (avgScore >= 0.75 && failureRate <= 0.1) return "healthy";
      if (avgScore >= 0.65 && failureRate <= 0.2) return "acceptable";
      return "underperforming";
    })();

    agentStats.push({
      name: agentName,
      invocations: agentTraces.length,
      scoredInvocations: qualityScores.length,
      avgScore: avgScore !== null ? Math.round(avgScore * 100) / 100 : null,
      trend,
      failureRate: Math.round(failureRate * 100) / 100,
      p50Latency: p50 ? Math.round(p50) : null,
      p90Latency: p90 ? Math.round(p90) : null,
      status,
      lowScoreTraces: lowScoreTraces.slice(0, 5),
    });
  }

  agentStats.sort((a, b) => {
    // Underperforming first, then by avg score ascending
    const statusOrder = { underperforming: 0, "no-data": 1, acceptable: 2, healthy: 3 };
    const sa = statusOrder[a.status] ?? 4;
    const sb = statusOrder[b.status] ?? 4;
    if (sa !== sb) return sa - sb;
    return (a.avgScore ?? 1) - (b.avgScore ?? 1);
  });

  return { agentStats, totalTraces: traces.length, totalScores: scores.length };
}

// ─── Report Generation ───────────────────────────────────────────────────────

function trendSymbol(trend) {
  return { improving: "↑", declining: "↓", stable: "→" }[trend] ?? "–";
}

function statusEmoji(status) {
  return { healthy: "✓", acceptable: "~", underperforming: "✗", "no-data": "?" }[status] ?? "?";
}

function formatScore(score) {
  if (score === null) return "–";
  return (score * 10).toFixed(1) + "/10";
}

function formatMs(ms) {
  if (ms === null) return "–";
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return ms + "ms";
}

function buildMarkdownReport(metrics, fromDate, toDate, dateStr, efficiencyStats) {
  const { agentStats, totalTraces, totalScores } = metrics;
  const healthy = agentStats.filter((a) => a.status === "healthy");
  const underperforming = agentStats.filter((a) => a.status === "underperforming");
  const noData = agentStats.filter((a) => a.status === "no-data");

  const overallHealth = underperforming.length === 0 ? "Healthy"
    : underperforming.length <= 2 ? "Needs attention"
    : "Significant issues";

  const lines = [];
  lines.push(`# Agent Performance Review — ${dateStr}`);
  lines.push(`Period: ${fromDate.toISOString().slice(0, 10)} → ${toDate.toISOString().slice(0, 10)} | Traces: ${totalTraces} | Scored: ${totalScores} | Status: **${overallHealth}**`);
  lines.push(`Generated by \`construct review\` + cx-trace-reviewer`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  if (underperforming.length === 0 && agentStats.length > 0) {
    lines.push(`All ${agentStats.length} active agents are performing within acceptable thresholds.`);
  } else if (underperforming.length > 0) {
    lines.push(`${underperforming.length} agent(s) need attention: ${underperforming.map((a) => `\`${a.name}\``).join(", ")}.`);
    const worst = underperforming[0];
    if (worst.avgScore !== null) {
      lines.push(`Lowest performer: \`${worst.name}\` (avg score ${formatScore(worst.avgScore)}, failure rate ${Math.round(worst.failureRate * 100)}%).`);
    }
  }
  if (noData.length > 0) {
    lines.push(`${noData.length} agent(s) have no quality scores — ensure validation scoring is active.`);
  }
  lines.push("");

  if (efficiencyStats) {
    lines.push("## Session Efficiency Snapshot");
    lines.push(`Score: **${efficiencyStats.score.toFixed(2)}** | Reads: ${efficiencyStats.readCount} | Files: ${efficiencyStats.uniqueFileCount} | Repeated reads: ${efficiencyStats.repeatedReadCount} | Large reads: ${efficiencyStats.largeReadCount} | KB read: ${Math.round(efficiencyStats.totalBytesRead / 1024)}`);
    lines.push("");
  }

  // Metrics table
  lines.push("## Metrics");
  lines.push("| Agent | Invocations | Score | Trend | Fail% | P50 | P90 | Status |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const a of agentStats) {
    lines.push(
      `| \`${a.name}\` | ${a.invocations} | ${formatScore(a.avgScore)} | ${trendSymbol(a.trend)} | ${Math.round(a.failureRate * 100)}% | ${formatMs(a.p50Latency)} | ${formatMs(a.p90Latency)} | ${statusEmoji(a.status)} ${a.status} |`
    );
  }
  lines.push("");

  // Underperformer details
  if (underperforming.length > 0) {
    lines.push("## Underperformer Analysis");
    lines.push("> Run `@cx-trace-reviewer` with this review for AI-generated prompt suggestions.");
    lines.push("");
    for (const a of underperforming) {
      lines.push(`### \`${a.name}\``);
      lines.push(`Invocations: ${a.invocations} | Avg score: ${formatScore(a.avgScore)} | Trend: ${trendSymbol(a.trend)} ${a.trend} | Failure rate: ${Math.round(a.failureRate * 100)}%`);
      lines.push("");
      if (a.lowScoreTraces.length > 0) {
        lines.push("**Low-score trace samples:**");
        for (const t of a.lowScoreTraces) {
          const comments = t.comments.length > 0 ? ` — "${t.comments[0]}"` : "";
          lines.push(`- ${new Date(t.timestamp).toISOString().slice(0, 16)} | score ${formatScore(t.score)}${comments}`);
        }
        lines.push("");
      }
      lines.push("**Prompt suggestion:** _Run `@cx-trace-reviewer` with the raw data for AI-generated recommendations._");
      lines.push("");
    }
  }

  // Healthy agents
  if (healthy.length > 0) {
    lines.push("## Healthy Agents");
    lines.push("| Agent | Invocations | Score | Trend |");
    lines.push("|---|---|---|---|");
    for (const a of healthy) {
      lines.push(`| \`${a.name}\` | ${a.invocations} | ${formatScore(a.avgScore)} | ${trendSymbol(a.trend)} ${a.trend} |`);
    }
    lines.push("");
  }

  // Recommended actions
  lines.push("## Recommended Actions");
  if (underperforming.length > 0) {
    lines.push("1. Run `@cx-trace-reviewer` for detailed prompt suggestions on underperformers.");
    let i = 2;
    for (const a of underperforming.slice(0, 3)) {
      lines.push(`${i++}. Review traces for \`${a.name}\` in Langfuse (${LANGFUSE_BASEURL}).`);
    }
  } else if (noData.length > 0) {
    lines.push("1. Ensure validation is scoring agent outputs — call `cx_score` after verification passes.");
  } else {
    lines.push("1. No immediate action required. Continue monitoring.");
  }
  lines.push("");

  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
  const dateStr = toDate.toISOString().slice(0, 10);

  // Ensure output directory exists
  fs.mkdirSync(outDir, { recursive: true });

  let rawData;
  try {
    rawData = await fetchData(fromDate, toDate);
  } catch (err) {
    console.error(`Failed to fetch Langfuse data: ${err.message}`);
    process.exit(1);
  }

  const metrics = aggregate(rawData.traces, rawData.scores, fromDate, toDate);
  const efficiencyStats = readSessionEfficiency();

  // Write raw JSON for cx-trace-reviewer to use
  const rawPath = path.join(outDir, `${dateStr}-raw.json`);
  fs.writeFileSync(rawPath, JSON.stringify({
    generated: toDate.toISOString(),
    period: { from: fromDate.toISOString(), to: toDate.toISOString(), days },
    agentFilter,
    baseUrl: LANGFUSE_BASEURL,
    efficiency: efficiencyStats,
    ...metrics,
  }, null, 2) + "\n");

  if (jsonOnly) {
    console.log(rawPath);
    return;
  }

  // Write markdown report
  const mdPath = path.join(outDir, `${dateStr}.md`);
  const report = buildMarkdownReport(metrics, fromDate, toDate, dateStr, efficiencyStats);
  fs.writeFileSync(mdPath, report);

  // Print summary to stdout
  const { agentStats } = metrics;
  const underperforming = agentStats.filter((a) => a.status === "underperforming");
  console.log(`\nReview written: ${mdPath}`);
  console.log(`Raw data:       ${rawPath}`);
  console.log(`Agents:         ${agentStats.length} | Underperforming: ${underperforming.length}`);
  if (underperforming.length > 0) {
    console.log(`\nRun @cx-trace-reviewer with ${rawPath} for prompt suggestions.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
