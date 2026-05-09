#!/usr/bin/env node
/**
 * lib/hooks/context-watch.mjs — monitors cumulative token usage and injects
 * a compaction recommendation when thresholds are crossed.
 *
 * Runs as UserPromptSubmit. Reads ~/.cx/session-cost.jsonl, takes the most
 * recent turn's cache-read + cache-creation + processed input tokens,
 * resolves the active model's context window, and compares against
 * percentage-of-window thresholds.
 *
 * Window resolution (resolveContextWindow):
 *   1. observedMaxTokens — largest input ever seen this session (authoritative:
 *      if the API accepted N tokens, the window is >= N)
 *   2. catalog maxInputTokens — from LiteLLM live data or static fallback
 *   3. 200k Anthropic baseline
 * This lets a 1M-tier session self-promote once a turn exceeds 200k tokens,
 * without requiring the user to declare their tier anywhere.
 *
 * Thresholds are policy ratios, not absolute numbers:
 *   - 60% of window: gentle nudge to distill + summarize
 *   - 80% of window: stronger push to compact now
 *
 * Only fires once per threshold per session to avoid spam. State is in
 * ~/.cx/context-watch-state.json, reset when the session (by start timestamp
 * in session-efficiency.json) rolls.
 *
 * @p95ms 20
 * @maxBlockingScope UserPromptSubmit
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveContextWindow } from '../telemetry/langfuse-model-sync.mjs';

const CX_DIR = join(homedir(), '.cx');
const COST_LOG = join(CX_DIR, 'session-cost.jsonl');
const EFFICIENCY = join(CX_DIR, 'session-efficiency.json');
const STATE = join(CX_DIR, 'context-watch-state.json');

const WARN_RATIO = 0.60;
const URGENT_RATIO = 0.80;

function readSessionStart() {
  try {
    const e = JSON.parse(readFileSync(EFFICIENCY, 'utf8'));
    return e?.sessionStartedAt || null;
  } catch {
    return null;
  }
}

function readCurrentContextSize(sessionStart) {
  // Use the MOST RECENT turn's tokens — that approximates current context
  // size (what the model saw on its last request). Summing across turns
  // double-counts cached content since each turn re-reads the same cache.
  try {
    if (!existsSync(COST_LOG)) return { total: 0, model: null };
    const lines = readFileSync(COST_LOG, 'utf8').split('\n').filter(Boolean);
    const cutoff = sessionStart ? new Date(sessionStart).getTime() : 0;
    let latest = null;
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        const rowTs = new Date(row.ts).getTime();
        if (rowTs < cutoff) continue;
        if (!latest || rowTs > new Date(latest.ts).getTime()) latest = row;
      } catch { /* skip malformed line */ }
    }
    if (!latest) return { total: 0, model: null };
    const total =
      Number(latest.cache_read_input_tokens || 0) +
      Number(latest.cache_creation_input_tokens || 0) +
      Number(latest.input_tokens || 0);
    return { total, model: latest.model || null };
  } catch {
    return { total: 0, model: null };
  }
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return { sessionStart: null, warnedAt: null, urgentAt: null, observedMaxTokens: 0 };
  }
}

function saveState(state) {
  try {
    mkdirSync(CX_DIR, { recursive: true });
    writeFileSync(STATE, JSON.stringify(state, null, 2));
  } catch { /* best effort */ }
}

const sessionStart = readSessionStart();
const { total, model } = readCurrentContextSize(sessionStart);

let state = loadState();
if (state.sessionStart !== sessionStart) {
  state = { sessionStart, warnedAt: null, urgentAt: null, observedMaxTokens: 0 };
}

state.observedMaxTokens = Math.max(Number(state.observedMaxTokens) || 0, total);

const contextWindow = resolveContextWindow(model, state.observedMaxTokens);
const WARN_AT = Math.floor(contextWindow * WARN_RATIO);
const URGENT_AT = Math.floor(contextWindow * URGENT_RATIO);

let message = null;

if (total >= URGENT_AT && !state.urgentAt) {
  message =
    `Context at ~${Math.round(total / 1000)}k of ~${Math.round(contextWindow / 1000)}k tokens — above the 80% urgent threshold. ` +
    `Stop broad exploration. Save the salient state to .cx/context.md (current task, ` +
    `decisions, open questions, files changed), then run /compact. Continuing without ` +
    `compaction risks degraded responses and higher cost per turn.`;
  state.urgentAt = new Date().toISOString();
} else if (total >= WARN_AT && !state.warnedAt) {
  message =
    `Context at ~${Math.round(total / 1000)}k of ~${Math.round(contextWindow / 1000)}k tokens — past the 60% nudge threshold. ` +
    `Consider running \`construct distill --query "<focus>"\` before more broad reads, ` +
    `and summarize the active task to .cx/context.md so /compact has something to preserve.`;
  state.warnedAt = new Date().toISOString();
}

saveState(state);

if (message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[context-watch] ${message}`,
    },
  }));
}

process.exit(0);
