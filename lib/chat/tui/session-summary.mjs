/**
 * lib/chat/tui/session-summary.mjs — honest session metrics for startup/farewell chrome.
 *
 * Aggregates turn blocks, usage, and wall-clock timing into a serializable summary.
 * Never fabricates metrics — only reports what was measured or recorded.
 */

import path from 'node:path';

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec ? `${min}m ${sec}s` : `${min}m`;
}

function countToolCalls(turnBlocks = []) {
  const counts = { total: 0, completed: 0, failed: 0, pending: 0 };
  for (const entry of turnBlocks) {
    const tools = entry?.block?.tools || entry?.tools || [];
    for (const tool of tools) {
      counts.total += 1;
      const status = tool.status || 'pending';
      if (status === 'failed') counts.failed += 1;
      else if (status === 'completed') counts.completed += 1;
      else counts.pending += 1;
    }
  }
  return counts;
}

function parseSessionIdFromPath(filePath) {
  if (!filePath) return null;
  const base = path.basename(filePath, '.jsonl');
  const parts = base.split('-');
  const constructIdx = parts.lastIndexOf('construct');
  if (constructIdx >= 0 && parts[constructIdx + 1]) return parts.slice(constructIdx + 1).join('-');
  return base;
}

function buildResumeCommand({ persist, sessionId }) {
  const filePath = persist?.filePath;
  if (filePath) {
    const base = path.basename(filePath);
    return `construct --resume=${base}`;
  }
  if (sessionId) return `construct --resume`;
  return null;
}

export function buildSessionSummary({
  turnBlocks = [],
  session = null,
  persist = null,
  timing = null,
} = {}) {
  const sessionId = session?.sessionId || parseSessionIdFromPath(persist?.filePath) || null;
  const toolCalls = countToolCalls(turnBlocks);
  const turns = Number.isFinite(session?.usage?.turns)
    ? session.usage.turns
    : turnBlocks.filter((e) => e?.kind === 'turn' || e?.block).length;

  const successRate = toolCalls.total > 0
    ? (toolCalls.completed / toolCalls.total) * 100
    : null;

  const wallMs = timing?.wallStart != null ? Math.max(0, Date.now() - timing.wallStart) : null;
  const activeMs = Number.isFinite(timing?.activeMs) ? timing.activeMs : null;
  const toolMs = Number.isFinite(timing?.toolMs) ? timing.toolMs : null;
  const apiMs = Number.isFinite(timing?.apiMs)
    ? timing.apiMs
    : (activeMs != null && toolMs != null ? Math.max(0, activeMs - toolMs) : null);

  return {
    sessionId,
    turns,
    toolCalls,
    successRate,
    tokens: session?.usage?.tokens ? { ...session.usage.tokens } : null,
    cost: session?.usage?.cost ? { ...session.usage.cost } : null,
    timing: {
      wallMs,
      activeMs,
      toolMs,
      apiMs,
    },
    resumeCommand: buildResumeCommand({ persist, sessionId }),
    sessionFile: persist?.filePath || null,
  };
}

export function bannerEnabled({ env = process.env, flags = {}, session = null, plain = false } = {}) {
  if (plain || flags.plain || flags.noBanner) return false;
  if (env.CX_CHAT_BANNER === '0') return false;
  if (session?.ui?.banner === false) return false;
  return true;
}
