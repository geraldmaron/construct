#!/usr/bin/env node
/**
 * lib/hooks/stop-notify.mjs — Stop notify hook — emits a session summary notification when Claude stops.
 *
 * Runs as a Stop hook. Summarizes the session work, active workflow state, and efficiency signals into a final message written to stdout for the user.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { loadWorkflow, summarizeWorkflow, alignmentFindings } from '../workflow-state.mjs';

function readLastTranscriptUsage(transcriptPath) {
  try {
    if (!transcriptPath || !existsSync(transcriptPath)) return null;
    const size = statSync(transcriptPath).size;
    const readSize = Math.min(size, 256 * 1024);
    const content = readFileSync(transcriptPath, 'utf8');
    const tail = content.slice(-readSize);
    const lines = tail.split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        const usage = obj?.message?.usage || obj?.usage;
        if (usage && (usage.input_tokens || usage.output_tokens)) return usage;
      } catch { /* skip */ }
    }
  } catch { /* best effort */ }
  return null;
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

// Stop hooks must echo stdin to stdout
let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
if (raw) process.stdout.write(raw);

const home = homedir();
const tsResultPath = join(home, '.cx', 'ts-result.txt');
const warnFlagsPath = join(home, '.cx', 'warn-flags.txt');
const countPath = join(home, '.cx', 'files-changed-count.txt');
const costLogPath = join(home, '.cx', 'session-cost.jsonl');
const lastAgentPath = join(home, '.cx', 'last-agent.json');

// Read TS result
let tsResult = 'unchecked';
try { tsResult = existsSync(tsResultPath) ? readFileSync(tsResultPath, 'utf8').trim() : 'unchecked'; } catch { /* best effort */ }

// Read and clear warn flags
let warnings = [];
try {
  if (existsSync(warnFlagsPath)) {
    warnings = readFileSync(warnFlagsPath, 'utf8').split('\n').filter(Boolean);
    writeFileSync(warnFlagsPath, '');
  }
} catch { /* best effort */ }

// Read and clear files-changed count
let fileCount = 0;
try {
  if (existsSync(countPath)) {
    fileCount = parseInt(readFileSync(countPath, 'utf8').trim() || '0', 10) || 0;
    writeFileSync(countPath, '0');
  }
} catch { /* best effort */ }

// Estimate cost from stdin usage tokens using Sonnet 4.5/4.6 defaults.
let costNote = '';
try {
  const payload = raw ? JSON.parse(raw) : {};
  let usage = payload?.usage || payload?.stop_hook_active?.usage || null;
  const transcriptPath = payload?.transcript_path || payload?.transcriptPath || process.env.CLAUDE_TRANSCRIPT_PATH;
  if (!usage || (!usage.input_tokens && !usage.output_tokens)) {
    const fromTranscript = readLastTranscriptUsage(transcriptPath);
    if (fromTranscript) usage = fromTranscript;
  }
  usage = usage || {};
  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;
  const cacheReadInputTokens = usage?.cache_read_input_tokens || 0;
  const cacheCreation5mInputTokens = usage?.cache_creation?.ephemeral_5m_input_tokens || usage?.cache_creation_5m_input_tokens || 0;
  const cacheCreation1hInputTokens = usage?.cache_creation?.ephemeral_1h_input_tokens || usage?.cache_creation_1h_input_tokens || 0;
  const explicitCacheCreationInputTokens = usage?.cache_creation_input_tokens || 0;
  const cacheCreationInputTokens = explicitCacheCreationInputTokens || cacheCreation5mInputTokens + cacheCreation1hInputTokens;
  if (inputTokens || outputTokens) {
    const cost = (
      inputTokens * 3 +
      cacheCreation5mInputTokens * 3.75 +
      cacheCreation1hInputTokens * 6 +
      Math.max(0, cacheCreationInputTokens - cacheCreation5mInputTokens - cacheCreation1hInputTokens) * 3.75 +
      cacheReadInputTokens * 0.3 +
      outputTokens * 15
    ) / 1_000_000;
    costNote = `~${cost.toFixed(2)} this response`;

    // Read agent attribution recorded by agent-tracker hook (best effort, cleared after read)
    let agentName = null;
    let taskKey = null;
    try {
      if (existsSync(lastAgentPath)) {
        const lastAgent = JSON.parse(readFileSync(lastAgentPath, 'utf8'));
        agentName = lastAgent.agent || null;
        taskKey = lastAgent.taskKey || null;
        writeFileSync(lastAgentPath, '');
      }
    } catch { /* best effort */ }

    // Fallback attribution: active workflow task owner, else 'construct'
    if (!agentName) {
      try {
        const wf = loadWorkflow(process.cwd());
        const resolved = resolveAttribution(wf);
        agentName = resolved.agent;
        if (!taskKey && resolved.taskKey) taskKey = resolved.taskKey;
      } catch { agentName = 'construct'; }
    }

    try {
      const entry = { ts: new Date().toISOString(), input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: cost };
      if (cacheReadInputTokens) entry.cache_read_input_tokens = cacheReadInputTokens;
      if (cacheCreationInputTokens) entry.cache_creation_input_tokens = cacheCreationInputTokens;
      if (cacheCreation5mInputTokens) entry.cache_creation_5m_input_tokens = cacheCreation5mInputTokens;
      if (cacheCreation1hInputTokens) entry.cache_creation_1h_input_tokens = cacheCreation1hInputTokens;
      if (agentName) entry.agent = agentName;
      if (taskKey) entry.task_key = taskKey;
      appendFileSync(costLogPath, JSON.stringify(entry) + '\n');
    } catch { /* best effort */ }
  }
} catch { /* payload parse failure */ }

// Executive Summary from Workflow
let execSummary = '';
try {
  const workflow = loadWorkflow(process.cwd());
  if (workflow) {
    const findings = alignmentFindings(workflow);
    const high = findings.filter(f => f.severity === 'HIGH').length;
    const phase = workflow.phase.toUpperCase();
    execSummary = `${phase}: ${workflow.status}${high > 0 ? ` (${high} blocks)` : ''}`;
  }
} catch { /* best effort */ }

// Compose message parts
const parts = [];
if (execSummary) parts.push(execSummary);
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

// Fire notification
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
  // Fallback to stderr if notification fails
  process.stderr.write(`[stop-notify] ${title}: ${body}\n`);
}

process.exit(0);
