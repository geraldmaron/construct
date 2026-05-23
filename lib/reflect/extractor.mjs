/**
 * lib/reflect/extractor.mjs — Deterministic transcript → observation extractor.
 *
 * Pure-function pass over a Claude Code transcript JSONL. Produces a compact
 * structured summary suitable for `addObservation()` at session end. No LLM
 * call — the transcript itself is the source of truth.
 *
 * Caller responsibility: read the transcript file and pass parsed lines.
 * Output is capped at MAX_BYTES to honor the A1 hook's per-session budget.
 */

// Hard cap on the summary content so a runaway session can't blow up the
// observation store. 5 KB matches the budget set in the A1 plan.
const MAX_BYTES = 5 * 1024;
const MAX_TAGS = 10;
const MAX_TOOL_TYPES = 8;
const MAX_FILES = 12;

/**
 * Extract a session-summary observation from a parsed transcript.
 *
 * @param {object} args
 * @param {object[]} args.entries — parsed transcript JSONL lines (objects)
 * @param {string} args.cwd — session working directory
 * @param {string} [args.sessionId] — session identifier
 * @param {number} [args.durationMs] — wall-clock session duration
 * @returns {object|null} observation payload, or null if transcript is unusable
 */
export function extractSessionObservation({ entries, cwd, sessionId, durationMs }) {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  const stats = collectStats(entries);
  if (stats.assistantTurns === 0 && stats.userTurns === 0) return null;

  const finalAssistant = stats.lastAssistantText;
  const headline = deriveHeadline(finalAssistant, stats);

  const lines = [];
  lines.push(`Session: ${stats.userTurns} user turns, ${stats.assistantTurns} assistant turns`);
  if (stats.toolCallCount > 0) {
    const tools = Array.from(stats.toolTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TOOL_TYPES)
      .map(([name, n]) => `${name}×${n}`)
      .join(', ');
    lines.push(`Tools: ${stats.toolCallCount} calls (${tools})`);
  }
  if (stats.filesTouched.size > 0) {
    const files = Array.from(stats.filesTouched).slice(0, MAX_FILES);
    lines.push(`Files touched: ${files.join(', ')}${stats.filesTouched.size > MAX_FILES ? ', …' : ''}`);
  }
  if (durationMs && Number.isFinite(durationMs)) {
    lines.push(`Duration: ${Math.round(durationMs / 1000)}s`);
  }
  if (finalAssistant) {
    lines.push('', 'Final response excerpt:', clamp(finalAssistant, 800));
  }

  const content = clamp(lines.join('\n'), MAX_BYTES);

  return {
    role: stats.lastAgent || 'construct',
    category: 'session-summary',
    summary: headline,
    content,
    tags: buildTags(stats),
    confidence: 0.7,
    source: 'auto-reflect',
    extras: {
      sessionId: sessionId || null,
      cwd,
      durationMs: durationMs ?? null,
      userTurns: stats.userTurns,
      assistantTurns: stats.assistantTurns,
      toolCallCount: stats.toolCallCount,
      filesTouched: Array.from(stats.filesTouched).slice(0, MAX_FILES),
    },
  };
}

// Walk the transcript once and gather everything we need in one pass. Keeps
// the hook well under its latency budget even on long sessions.

function collectStats(entries) {
  const toolTypes = new Map();
  const filesTouched = new Set();
  let assistantTurns = 0;
  let userTurns = 0;
  let toolCallCount = 0;
  let lastAssistantText = '';
  let lastAgent = null;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const type = entry.type;

    if (type === 'user') {
      userTurns += 1;
      continue;
    }

    if (type === 'assistant') {
      assistantTurns += 1;
      const text = extractAssistantText(entry);
      if (text) lastAssistantText = text;
      const calls = extractToolCalls(entry);
      for (const call of calls) {
        toolCallCount += 1;
        toolTypes.set(call.name, (toolTypes.get(call.name) || 0) + 1);
        for (const f of call.files) filesTouched.add(f);
      }
      const agent = extractAgentName(entry);
      if (agent) lastAgent = agent;
    }
  }

  return { assistantTurns, userTurns, toolCallCount, toolTypes, filesTouched, lastAssistantText, lastAgent };
}

function extractAssistantText(entry) {
  const message = entry.message ?? entry;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .filter((p) => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();
    return text;
  }
  return '';
}

function extractToolCalls(entry) {
  const message = entry.message ?? entry;
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  const calls = [];
  for (const part of content) {
    if (part?.type !== 'tool_use') continue;
    const name = part.name || 'unknown';
    const files = [];
    const input = part.input || {};
    if (typeof input.file_path === 'string') files.push(shortenPath(input.file_path));
    if (typeof input.path === 'string') files.push(shortenPath(input.path));
    calls.push({ name, files });
  }
  return calls;
}

function extractAgentName(entry) {
  // Claude Code may stamp the agent name on subagent transcripts. Fall through
  // to null if not present — caller defaults to 'construct'.
  return entry?.agent || entry?.subagent_type || entry?.message?.agent || null;
}

function deriveHeadline(finalText, stats) {
  // First non-empty line of the final assistant turn is usually a good lead.
  // Fall back to a structural summary when nothing useful is available.
  if (finalText) {
    const firstLine = finalText.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
    if (firstLine) {
      const clean = firstLine.replace(/^[#*\->]\s*/, '').replace(/[`*_]/g, '');
      return `[session] ${clamp(clean, 200)}`;
    }
  }
  return `[session] ${stats.assistantTurns} turn${stats.assistantTurns === 1 ? '' : 's'}, ${stats.toolCallCount} tool call${stats.toolCallCount === 1 ? '' : 's'}`;
}

function buildTags(stats) {
  const tags = ['auto-reflect', 'session-summary'];
  // Surface the most-used tool family so search can filter on "Bash-heavy
  // session", etc. without parsing content.
  const top = Array.from(stats.toolTypes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [name] of top) tags.push(`tool:${name.toLowerCase()}`);
  if (stats.filesTouched.size > 0) tags.push('edits');
  return tags.slice(0, MAX_TAGS);
}

function shortenPath(p) {
  if (typeof p !== 'string') return '';
  // Strip a repo-root prefix when present so observations stay portable.
  const cwd = process.cwd();
  if (p.startsWith(cwd + '/')) return p.slice(cwd.length + 1);
  return p;
}

function clamp(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}
