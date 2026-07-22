#!/usr/bin/env node
/**
 * lib/hooks/stop-notify.mjs — Stop notify hook — emits a session summary notification when Claude stops.
 *
 * Runs as a Stop hook. Summarizes the session work and efficiency
 * signals into a final message written to stdout for the user.
 *
 * Per-transcript checkpoints in ~/.construct/transcript-checkpoints.json track the last processed
 * line so every assistant turn in a Stop cycle is priced, not just the final one.
 * Cost is computed via estimateUsageCost using the model ID from each transcript entry.
 *
 * @p95ms 500
 * @maxBlockingScope Stop
 *
 * @lifecycle Stop
 * @matcher  *
 * @exits 0 = pass
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { appendBounded } from '../logging/rotate.mjs';
import { resolveProjectScope } from '../project-root.mjs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { listSessions, loadSession, updateSession } from '../session-store.mjs';
import { captureSessionArtifacts } from '../artifact-capture.mjs';
import { appendSessionStats } from '../memory-stats.mjs';
import { estimateUsageCost } from '../telemetry/model-pricing-catalog.mjs';
import { flushReadTrackerDeltas } from '../read-tracker-store.mjs';
import { doctorRoot } from '../config/xdg.mjs';

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

// PostToolUse Read hooks append delta lines instead of rewriting the full
// read-tracker JSON on every call. Stop fires once per session end; this
// is the canonical point to fold accumulated deltas back into the JSON.
// Already wired into pre-compact + audit-reads; Stop is the third anchor.
try { flushReadTrackerDeltas({ env: process.env }); } catch { /* non-critical */ }

const home = homedir();
const tsResultPath = join(doctorRoot(home), 'ts-result.txt');
const warnFlagsPath = join(doctorRoot(home), 'warn-flags.txt');
const countPath = join(doctorRoot(home), 'files-changed-count.txt');
const costLogPath = join(doctorRoot(home), 'session-cost.jsonl');
const lastAgentPath = join(doctorRoot(home), 'last-agent.json');
const checkpointPath = join(doctorRoot(home), 'transcript-checkpoints.json');

// Consume-clear like warn-flags/files-changed below: a TS result is reported
// once, not re-fired on every subsequent no-op Stop. stop-typecheck rewrites
// the file each turn it actually runs.
let tsResult = 'unchecked';
try {
  if (existsSync(tsResultPath)) {
    tsResult = readFileSync(tsResultPath, 'utf8').trim() || 'unchecked';
    writeFileSync(tsResultPath, 'unchecked');
  }
} catch { /* non-critical */ }

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

// Pricing readout is intentionally suppressed in user-facing notifications.
// The session-cost ledger is still written (lines below) so OTel + dashboard
// consumers can pick the data up when the observability surfaces are wired.
// Do not reintroduce a costNote variable here without a deliberate decision
// about whether to surface pricing to the user.
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

    // Cross-project ledger — keep at user scope but tag with projectId so a
    // reader can attribute spend to a specific project.

    const scope = resolveProjectScope();
    if (scope?.projectId) entry.projectId = scope.projectId;
    try { appendBounded('session-cost', costLogPath, JSON.stringify(entry) + '\n'); } catch { /* non-critical */ }

    totalCostUsd += priced.costUsd;
    turnsLogged += 1;
  }

  saveTranscriptCheckpoints(checkpointPath, checkpoints);

  // totalCostUsd and turnsLogged stay as ledger-write accumulators only.
  // Downstream telemetry consumers read the session-cost.jsonl ledger.
} catch { /* non-critical */ }

const parts = [];
if (fileCount > 0) parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''} updated`);
if (tsResult === 'pass') parts.push('TS OK');
else if (tsResult !== 'unchecked') parts.push(`TS: ${tsResult}`);

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

const memStatsPath = join(doctorRoot(home), 'session-memory-stats.json');
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

// Auto-generate a performance review every 24h. Cheap — reads the cost
// ledger + (optionally) telemetry generations and writes a structured
// JSON file the dashboard's Performance page consumes. Skipped on
// repeat Stop events within the window to avoid review-spam.
try {
  const homeDir = process.env.HOME || homedir();
  const stampPath = join(doctorRoot(homeDir), 'performance-reviews', '.last-run');
  let lastRun = 0;
  try { lastRun = Number(readFileSync(stampPath, 'utf8')) || 0; } catch { /* fresh */ }
  if (Date.now() - lastRun > 24 * 60 * 60 * 1000) {
    const { runGenerator } = await import('../performance/generate.mjs');
    await runGenerator({ env: process.env });
    mkdirSync(dirname(stampPath), { recursive: true });
    writeFileSync(stampPath, String(Date.now()));
  }
} catch { /* review is best-effort */ }

// Stop fires per-turn, so a desktop banner only earns the interruption when the
// turn produced something actionable: files changed or a warning to review.
// A bare "TS OK" (the sticky-pass default on a no-op turn) is noise — the ledger
// and session bookkeeping above still run; only the banner is suppressed.
const platform = process.platform;
const shouldNotify = (hasWarnings || fileCount > 0) && Boolean(body);
if (shouldNotify) {
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
}

process.exit(0);
