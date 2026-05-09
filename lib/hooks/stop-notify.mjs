#!/usr/bin/env node
/**
 * lib/hooks/stop-notify.mjs — Stop notify hook — emits a session summary notification when Claude stops.
 *
 * Runs as a Stop hook. Summarizes the session work and efficiency
 * signals into a final message written to stdout for the user.
 *
 * Per-transcript checkpoints in ~/.cx/transcript-checkpoints.json track the last processed
 * line so every assistant turn in a Stop cycle is priced, not just the final one.
 * Cost is computed via estimateUsageCost using the model ID from each transcript entry.
 *
 * @p95ms 500
 * @maxBlockingScope Stop
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { listSessions, loadSession, updateSession } from '../session-store.mjs';
import { captureSessionArtifacts } from '../artifact-capture.mjs';
import { appendSessionStats } from '../memory-stats.mjs';
import { estimateUsageCost } from '../telemetry/langfuse-model-sync.mjs';

function loadTranscriptCheckpoints(checkpointPath) {
  try {
    if (!existsSync(checkpointPath)) return {};
    return JSON.parse(readFileSync(checkpointPath, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveTranscriptCheckpoints(checkpointPath, data) {
  try {
    mkdirSync(dirname(checkpointPath), { recursive: true });
    writeFileSync(checkpointPath, JSON.stringify(data));
  } catch { /* non-critical */ }
}

function collectUnprocessedUsage(transcriptPath, checkpoints) {
  const entries = [];
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return entries;
    const content = readFileSync(transcriptPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const state = checkpoints[transcriptPath] || { lastLine: 0 };

    // Reset on truncation/rotation rather than skipping lines or double-counting.
    const startLine = state.lastLine > lines.length ? 0 : state.lastLine;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const usage = obj?.message?.usage || obj?.usage;
      if (!usage) continue;
      if (!usage.input_tokens && !usage.output_tokens && !usage.cache_read_input_tokens && !usage.cache_creation_input_tokens) continue;
      const model =
        obj?.message?.model ||
        obj?.model ||
        obj?.message?.modelID ||
        obj?.modelID ||
        null;
      const ts = obj?.timestamp || obj?.message?.timestamp || null;
      entries.push({ usage, model, ts });
    }
    checkpoints[transcriptPath] = { lastLine: lines.length };
  } catch { /* non-critical */ }
  return entries;
}

function priceUsage(model, usage) {
  const inputTokens = Number(usage?.input_tokens || 0);
  const outputTokens = Number(usage?.output_tokens || 0);
  const reasoningTokens = Number(
    usage?.reasoning_tokens ||
    usage?.output_token_details?.reasoning ||
    usage?.completion_tokens_details?.reasoning_tokens ||
    0,
  );
  const cacheReadInputTokens = Number(usage?.cache_read_input_tokens || 0);
  const cacheCreation5mInputTokens = Number(
    usage?.cache_creation?.ephemeral_5m_input_tokens ||
    usage?.cache_creation_5m_input_tokens ||
    0,
  );
  const cacheCreation1hInputTokens = Number(
    usage?.cache_creation?.ephemeral_1h_input_tokens ||
    usage?.cache_creation_1h_input_tokens ||
    0,
  );
  const explicitCacheCreationInputTokens = Number(usage?.cache_creation_input_tokens || 0);
  const cacheCreationInputTokens =
    explicitCacheCreationInputTokens ||
    (cacheCreation5mInputTokens + cacheCreation1hInputTokens);

  const pricing = estimateUsageCost(model, {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    cacheCreation5mInputTokens,
    cacheCreation1hInputTokens,
  });

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    cacheCreation5mInputTokens,
    cacheCreation1hInputTokens,
    costUsd: pricing.costUsd || 0,
    costSource: pricing.costSource,
    modelName: pricing.modelName || model || null,
  };
}

function resolveAttribution(workflow) {
  try {
    if (!workflow) return { agent: 'construct' };
    const active = (workflow.tasks || []).find((t) => t.status === 'in-progress' || t.status === 'in_progress');
    if (active?.owner) return { agent: active.owner, taskKey: active.key };
    return { agent: 'construct' };
  } catch {
    return { agent: 'construct' };
  }
}

let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { /* non-critical */ }
if (raw) process.stdout.write(raw);

const home = homedir();
const tsResultPath = join(home, '.cx', 'ts-result.txt');
const warnFlagsPath = join(home, '.cx', 'warn-flags.txt');
const countPath = join(home, '.cx', 'files-changed-count.txt');
const costLogPath = join(home, '.cx', 'session-cost.jsonl');
const lastAgentPath = join(home, '.cx', 'last-agent.json');
const checkpointPath = join(home, '.cx', 'transcript-checkpoints.json');

let tsResult = 'unchecked';
try { tsResult = existsSync(tsResultPath) ? readFileSync(tsResultPath, 'utf8').trim() : 'unchecked'; } catch { /* non-critical */ }

let warnings = [];
try {
  if (existsSync(warnFlagsPath)) {
    warnings = readFileSync(warnFlagsPath, 'utf8').split('\n').filter(Boolean);
    writeFileSync(warnFlagsPath, '');
  }
} catch { /* non-critical */ }

let fileCount = 0;
try {
  if (existsSync(countPath)) {
    fileCount = parseInt(readFileSync(countPath, 'utf8').trim() || '0', 10) || 0;
    writeFileSync(countPath, '0');
  }
} catch { /* non-critical */ }

let costNote = '';
let totalCostUsd = 0;
let turnsLogged = 0;
try {
  const payload = raw ? JSON.parse(raw) : {};
  const transcriptPath =
    payload?.transcript_path ||
    payload?.transcriptPath ||
    process.env.CLAUDE_TRANSCRIPT_PATH;

  let agentName = null;
  let taskKey = null;
  try {
    if (existsSync(lastAgentPath)) {
      const lastAgent = JSON.parse(readFileSync(lastAgentPath, 'utf8'));
      agentName = lastAgent.agent || null;
      taskKey = lastAgent.taskKey || null;
      writeFileSync(lastAgentPath, '');
    }
  } catch { /* non-critical */ }

  if (!agentName) {
    agentName = 'construct';
  }

  const checkpoints = loadTranscriptCheckpoints(checkpointPath);
  let turns = collectUnprocessedUsage(transcriptPath, checkpoints);

  if (turns.length === 0) {
    const usage = payload?.usage || payload?.stop_hook_active?.usage || null;
    const model = payload?.model || payload?.session?.model || null;
    if (usage && (usage.input_tokens || usage.output_tokens)) {
      turns = [{ usage, model, ts: null }];
    }
  }

  const nowIso = new Date().toISOString();
  for (const turn of turns) {
    const priced = priceUsage(turn.model, turn.usage);
    if (
      !priced.inputTokens &&
      !priced.outputTokens &&
      !priced.cacheReadInputTokens &&
      !priced.cacheCreationInputTokens
    ) continue;

    const entry = {
      ts: turn.ts || nowIso,
      input_tokens: priced.inputTokens,
      output_tokens: priced.outputTokens,
      cost_usd: priced.costUsd,
    };
    if (priced.reasoningTokens) entry.reasoning_tokens = priced.reasoningTokens;
    entry.total_tokens = priced.inputTokens + priced.outputTokens + priced.reasoningTokens;
    if (priced.cacheReadInputTokens) entry.cache_read_input_tokens = priced.cacheReadInputTokens;
    if (priced.cacheCreationInputTokens) entry.cache_creation_input_tokens = priced.cacheCreationInputTokens;
    if (priced.cacheCreation5mInputTokens) entry.cache_creation_5m_input_tokens = priced.cacheCreation5mInputTokens;
    if (priced.cacheCreation1hInputTokens) entry.cache_creation_1h_input_tokens = priced.cacheCreation1hInputTokens;
    if (priced.modelName) entry.model = priced.modelName;
    if (priced.costSource) entry.cost_source = priced.costSource;
    if (agentName) entry.agent = agentName;
    if (taskKey) entry.task_key = taskKey;

    try { appendFileSync(costLogPath, JSON.stringify(entry) + '\n'); } catch { /* non-critical */ }

    totalCostUsd += priced.costUsd;
    turnsLogged += 1;
  }

  saveTranscriptCheckpoints(checkpointPath, checkpoints);

  if (totalCostUsd > 0) {
    const label = turnsLogged > 1 ? `${turnsLogged} turns` : 'this response';
    costNote = `~$${totalCostUsd.toFixed(2)} ${label}`;
  }
} catch { /* non-critical */ }

const parts = [];
if (fileCount > 0) parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''} updated`);
if (tsResult === 'pass') parts.push('TS OK');
else if (tsResult !== 'unchecked') parts.push(`TS: ${tsResult}`);
if (costNote) parts.push(costNote);

const hasWarnings = warnings.length > 0;
const title = hasWarnings ? 'Construct — Review needed' : 'Construct';
const body = [
  ...warnings.slice(0, 3),
  parts.join(' · '),
].filter(Boolean).join('\n');

try {
  const cwd = process.cwd();
  const activeSessions = listSessions(cwd, { status: 'active', limit: 1 });
  if (activeSessions.length > 0) {
    const sid = activeSessions[0].id;
    const summaryParts = [];
    try {
      const recentCommits = execSync(`git -C "${cwd}" log --oneline -5 2>/dev/null`, { timeout: 4000 }).toString().trim();
      if (recentCommits) summaryParts.push('commits: ' + recentCommits.split('\n').map((l) => l.trim()).slice(0, 3).join('; '));
    } catch { /* non-critical */ }
    if (fileCount > 0) summaryParts.push(fileCount + ' file' + (fileCount !== 1 ? 's' : '') + ' updated');
    if (warnings.length > 0) summaryParts.push(warnings.length + ' warning' + (warnings.length !== 1 ? 's' : ''));
    const summary = summaryParts.join(' — ') || 'Session completed';
    updateSession(cwd, sid, { status: 'completed', summary });
  }
} catch { /* non-critical */ }

try {
  const cwd2 = process.cwd();
  const closedSessions = listSessions(cwd2, { status: 'completed', limit: 1 });
  if (closedSessions.length > 0) {
    const session = loadSession(cwd2, closedSessions[0].id);
    if (session) captureSessionArtifacts(cwd2, session);
  }
} catch { /* non-critical */ }

const memStatsPath = join(home, '.cx', 'session-memory-stats.json');
try {
  if (existsSync(memStatsPath)) {
    const memStats = JSON.parse(readFileSync(memStatsPath, 'utf8'));
    appendSessionStats(process.cwd(), {
      project: memStats.project || null,
      observationsInjected: memStats.observationsInjected || 0,
      memoryEnabled: memStats.memoryEnabled !== false,
    });
    writeFileSync(memStatsPath, '');
  }
} catch { /* non-critical */ }

const platform = process.platform;
try {
  if (platform === 'darwin') {
    const escaped = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const titleEsc = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${escaped}" with title "${titleEsc}"'`, {
      timeout: 5000,
      stdio: 'pipe',
    });
  } else if (platform === 'linux') {
    execSync(`notify-send "${title}" "${body.replace(/"/g, '\\"')}"`, {
      timeout: 5000,
      stdio: 'pipe',
    });
  } else {
    process.stderr.write(`[stop-notify] ${title}: ${body}\n`);
  }
} catch {
  process.stderr.write(`[stop-notify] ${title}: ${body}\n`);
}

process.exit(0);
