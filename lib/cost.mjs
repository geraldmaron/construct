/**
 * lib/cost.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function numberFrom(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

export function normalizeCostEntry(entry = {}) {
  const cacheCreation5mInputTokens = numberFrom(
    entry.cache_creation_5m_input_tokens,
    entry.cacheCreation5mInputTokens,
    entry.cache_creation?.ephemeral_5m_input_tokens,
  );
  const cacheCreation1hInputTokens = numberFrom(
    entry.cache_creation_1h_input_tokens,
    entry.cacheCreation1hInputTokens,
    entry.cache_creation?.ephemeral_1h_input_tokens,
  );
  const explicitCacheCreation = numberFrom(
    entry.cache_creation_input_tokens,
    entry.cacheCreationInputTokens,
  );
  const cacheCreationInputTokens = explicitCacheCreation || cacheCreation5mInputTokens + cacheCreation1hInputTokens;
  const cacheReadInputTokens = numberFrom(
    entry.cache_read_input_tokens,
    entry.cacheReadInputTokens,
    entry.prompt_tokens_details?.cached_tokens,
  );
  const inputTokens = numberFrom(
    entry.input_tokens,
    entry.inputTokens,
    entry.prompt_tokens,
    entry.promptTokens,
  );
  const outputTokens = numberFrom(
    entry.output_tokens,
    entry.outputTokens,
    entry.completion_tokens,
    entry.completionTokens,
  );
  const reasoningTokens = numberFrom(
    entry.reasoning_tokens,
    entry.reasoningTokens,
    entry.completion_tokens_details?.reasoning_tokens,
  );
  const providerTotalTokens = numberFrom(
    entry.total_tokens,
    entry.totalTokens,
    inputTokens + outputTokens + reasoningTokens,
  );
  const billedOutputTokens = outputTokens + reasoningTokens;
  const billedTotalTokens = inputTokens + cacheReadInputTokens + cacheCreationInputTokens + billedOutputTokens;

  return {
    ...entry,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    cacheCreation5mInputTokens,
    cacheCreation1hInputTokens,
    processedInputTokens: inputTokens + cacheReadInputTokens + cacheCreationInputTokens,
    providerTotalTokens,
    billedOutputTokens,
    billedTotalTokens,
    totalTokens: providerTotalTokens,
    costUsd: Number(entry.cost_usd ?? entry.costUsd ?? 0),
  };
}

export function readCostLog(homeDir) {
  const logPath = join(homeDir, '.cx', 'session-cost.jsonl');
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function clearCostLog(homeDir) {
  const logPath = join(homeDir, '.cx', 'session-cost.jsonl');
  if (existsSync(logPath)) writeFileSync(logPath, '');
}

export function aggregateCostByAgent(entries) {
  const agentMap = new Map();
  for (const rawEntry of entries) {
    const entry = normalizeCostEntry(rawEntry);
    const agent = entry.agent || 'orchestrator';
    const acc = agentMap.get(agent) ?? {
      agent,
      interactions: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      processedInputTokens: 0,
      providerTotalTokens: 0,
      billedTotalTokens: 0,
      costUsd: 0,
    };
    acc.interactions += 1;
    acc.inputTokens += entry.inputTokens;
    acc.outputTokens += entry.outputTokens;
    acc.reasoningTokens += entry.reasoningTokens;
    acc.cacheReadInputTokens += entry.cacheReadInputTokens;
    acc.cacheCreationInputTokens += entry.cacheCreationInputTokens;
    acc.processedInputTokens += entry.processedInputTokens;
    acc.providerTotalTokens += entry.providerTotalTokens;
    acc.billedTotalTokens += entry.billedTotalTokens;
    acc.costUsd += entry.costUsd;
    acc.cacheReadRate = acc.processedInputTokens > 0
      ? Number((acc.cacheReadInputTokens / acc.processedInputTokens).toFixed(3))
      : 0;
    agentMap.set(agent, acc);
  }
  return [...agentMap.values()].sort((a, b) => b.costUsd - a.costUsd);
}

export function computeCacheStats(entries) {
  const normalized = entries.map((entry) => normalizeCostEntry(entry));
  const totalInput = normalized.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalCacheReadInputTokens = normalized.reduce((sum, e) => sum + e.cacheReadInputTokens, 0);
  const totalCacheCreationInputTokens = normalized.reduce((sum, e) => sum + e.cacheCreationInputTokens, 0);
  const totalCacheCreation5mInputTokens = normalized.reduce((sum, e) => sum + e.cacheCreation5mInputTokens, 0);
  const totalCacheCreation1hInputTokens = normalized.reduce((sum, e) => sum + e.cacheCreation1hInputTokens, 0);
  const totalProcessedInputTokens = totalInput + totalCacheReadInputTokens + totalCacheCreationInputTokens;
  return {
    totalInput,
    totalCacheReadInputTokens,
    totalCacheCreationInputTokens,
    totalCacheCreation5mInputTokens,
    totalCacheCreation1hInputTokens,
    totalProcessedInputTokens,
    totalCached: totalCacheReadInputTokens + totalCacheCreationInputTokens,
    cacheReadRate: totalProcessedInputTokens > 0 ? Number((totalCacheReadInputTokens / totalProcessedInputTokens).toFixed(3)) : 0,
  };
}

export function summarizeCostData(entries, { days, agent } = {}) {
  const cutoff = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  let filtered = cutoff ? entries.filter((e) => e.ts && e.ts >= cutoff) : entries;
  if (agent) filtered = filtered.filter((e) => (e.agent || 'orchestrator') === agent);

  const normalized = filtered.map((entry) => normalizeCostEntry(entry));
  const totalInputTokens = normalized.reduce((s, e) => s + e.inputTokens, 0);
  const totalOutputTokens = normalized.reduce((s, e) => s + e.outputTokens, 0);
  const totalReasoningTokens = normalized.reduce((s, e) => s + e.reasoningTokens, 0);
  const providerTotalTokens = normalized.reduce((s, e) => s + e.providerTotalTokens, 0);
  const billedTotalTokens = normalized.reduce((s, e) => s + e.billedTotalTokens, 0);
  const totalCostUsd = normalized.reduce((s, e) => s + e.costUsd, 0);
  const cacheStats = computeCacheStats(normalized);

  return {
    interactions: normalized.length,
    totalInputTokens,
    totalOutputTokens,
    totalReasoningTokens,
    providerTotalTokens,
    billedTotalTokens,
    totalTokens: providerTotalTokens,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    processedInputTokens: cacheStats.totalProcessedInputTokens,
    cacheReadInputTokens: cacheStats.totalCacheReadInputTokens,
    cacheCreationInputTokens: cacheStats.totalCacheCreationInputTokens,
    cacheCreation5mInputTokens: cacheStats.totalCacheCreation5mInputTokens,
    cacheCreation1hInputTokens: cacheStats.totalCacheCreation1hInputTokens,
    cachedTokens: cacheStats.totalCached,
    cacheReadRate: cacheStats.cacheReadRate,
    cacheHitRate: cacheStats.cacheReadRate,
    byAgent: aggregateCostByAgent(normalized),
    days: days ?? null,
    agentFilter: agent ?? null,
  };
}

export function formatCostReport(data, colors = {}) {
  const C = { bold: '', dim: '', reset: '', green: '', yellow: '', cyan: '', red: '', ...colors };
  const lines = [];
  lines.push(`${C.bold}Construct Cost Report${C.reset}`);
  lines.push('═════════════════════');
  lines.push('');

  if (data.days) lines.push(`${C.dim}Window: last ${data.days} day${data.days === 1 ? '' : 's'}${C.reset}`);
  if (data.agentFilter) lines.push(`${C.dim}Agent filter: ${data.agentFilter}${C.reset}`);

  lines.push(`Interactions:    ${data.interactions}`);
  lines.push(`Provider total:  ${Number(data.providerTotalTokens || 0).toLocaleString()} (${data.totalInputTokens.toLocaleString()} uncached in / ${data.totalOutputTokens.toLocaleString()} out / ${Number(data.totalReasoningTokens || 0).toLocaleString()} reasoning)`);
  lines.push(`Billed total:    ${Number(data.billedTotalTokens || 0).toLocaleString()}`);
  lines.push(`Processed input: ${Number(data.processedInputTokens || data.totalInputTokens || 0).toLocaleString()}`);

  const readPct = ((data.cacheReadRate ?? data.cacheHitRate ?? 0) * 100).toFixed(1);
  const cacheColor = (data.cacheReadRate ?? data.cacheHitRate ?? 0) >= 0.5 ? C.green : (data.cacheReadRate ?? data.cacheHitRate ?? 0) >= 0.2 ? C.yellow : C.red;
  lines.push(`Cache reads:     ${Number(data.cacheReadInputTokens || 0).toLocaleString()} (${cacheColor}${readPct}% read rate${C.reset})`);
  lines.push(`Cache writes:    ${Number(data.cacheCreationInputTokens || 0).toLocaleString()} (${Number(data.cacheCreation5mInputTokens || 0).toLocaleString()} 5m / ${Number(data.cacheCreation1hInputTokens || 0).toLocaleString()} 1h)`);
  lines.push(`Estimated cost:  $${data.totalCostUsd.toFixed(4)}`);

  if (data.byAgent.length > 0) {
    lines.push('');
    lines.push('By Agent:');
    lines.push(`  ${'Agent'.padEnd(28)} ${'Turns'.padStart(5)}  ${'Provider'.padStart(10)}  ${'Billed'.padStart(10)}  ${'Cost'.padStart(8)}  ${'Share'.padStart(5)}  Cache`);
    lines.push(`  ${'-'.repeat(28)} ${'-'.repeat(5)}  ${'-'.repeat(10)}  ${'-'.repeat(10)}  ${'-'.repeat(8)}  ${'-'.repeat(5)}  -----`);
    for (const a of data.byAgent) {
      const sharePct = data.totalCostUsd > 0 ? Math.round((a.costUsd / data.totalCostUsd) * 100) : 0;
      const hitRate = Math.round((a.cacheReadRate || 0) * 100);
      const shareColor = sharePct >= 50 ? C.red : sharePct >= 25 ? C.yellow : '';
      lines.push(
        `  ${a.agent.padEnd(28)} ${String(a.interactions).padStart(5)}` +
        `  ${a.providerTotalTokens.toLocaleString().padStart(10)}` +
        `  ${a.billedTotalTokens.toLocaleString().padStart(10)}` +
        `  ${'$' + a.costUsd.toFixed(4).padStart(7)}` +
        `  ${shareColor}${String(sharePct + '%').padStart(5)}${C.reset}` +
        `  ${hitRate}%`,
      );
    }
  }

  if (data.interactions === 0) {
    lines.push('');
    lines.push(`${C.dim}No cost data recorded yet. Token usage is logged at session end.${C.reset}`);
  }

  lines.push('');
  return lines.join('\n');
}
