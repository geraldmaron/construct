/**
 * lib/chat/tui/turn-block.mjs — discriminated turn blocks for construct chat.
 *
 * Each user prompt opens a TurnBlock: user message, policy overlay (turn_context),
 * optional thinking/tools streams, assistant answer, turn usage footer, and system
 * notices. Pure data — no React — so Ink and the linear renderer share one model.
 * Sources in turn_context are populated only from recorded tool events (no-fabrication).
 */

import { formatUsageFooter } from './usage.mjs';

export const BLOCK_TYPES = [
  'user', 'turn_context', 'thinking', 'tool', 'assistant', 'turn_usage', 'system_notice',
];

export function createTurnBlock(userText) {
  return {
    id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userText: String(userText),
    overlay: null,
    thinking: '',
    tools: [],
    assistant: '',
    usage: null,
    sources: [],
    notices: [],
    closed: false,
  };
}

export function overlayToContext(overlay) {
  if (!overlay) return null;
  return {
    intent: overlay.intent || null,
    workCategory: overlay.workCategory || null,
    specialists: Array.isArray(overlay.specialists) ? [...overlay.specialists] : [],
    externalResearch: overlay.externalResearch || null,
    riskFlags: overlay.riskFlags || [],
    track: overlay.track || null,
  };
}

export function applyOverlayToTurn(turn, overlay) {
  if (!turn || !overlay) return turn;
  turn.overlay = overlayToContext(overlay);
  return turn;
}

export function recordSource(turn, { tool, ref }) {
  if (!turn || !tool || !ref) return;
  const key = `${tool}:${ref}`;
  if (turn.sources.some((s) => `${s.tool}:${s.ref}` === key)) return;
  turn.sources.push({ tool, ref, ts: Date.now() });
}

export function sourceFromToolEvent(event) {
  if (!event) return null;
  const title = event.title || event.kind || '';
  if (title === 'read' || title === 'grep' || title === 'glob') {
    const path = event.input?.path || event.input?.pattern || event.input?.glob;
    if (path) return { tool: title, ref: String(path) };
  }
  if (title === 'construct_tool') {
    const name = event.input?.name;
    if (name) return { tool: 'construct_tool', ref: String(name) };
  }
  return null;
}

export function turnBlocksFromTranscript(entries = []) {
  const blocks = [];
  let current = null;

  for (const entry of entries) {
    if (entry.kind && entry.block) {
      blocks.push(entry.block);
      if (entry.kind === 'turn') current = entry.block;
      continue;
    }
    if (entry.role === 'you' || entry.role === 'user') {
      current = createTurnBlock(entry.text);
      blocks.push({ kind: 'turn', block: current });
      continue;
    }
    if (!current) {
      if (entry.role === 'construct') blocks.push({ kind: 'legacy', role: 'assistant', text: entry.text });
      continue;
    }
    if (entry.role === 'thinking') current.thinking = entry.text;
    else if (entry.role === 'construct') current.assistant = entry.text;
  }
  return blocks;
}

export function flattenTurnBlocks(blocks) {
  const out = [];
  for (const item of blocks) {
    if (item.kind === 'legacy') {
      out.push({ type: 'assistant', text: item.text });
      continue;
    }
    if (item.kind !== 'turn') continue;
    const t = item.block;
    out.push({ type: 'user', text: t.userText });
    if (t.overlay) out.push({ type: 'turn_context', overlay: t.overlay, sources: t.sources });
    if (t.thinking) out.push({ type: 'thinking', text: t.thinking });
    for (const tool of t.tools) out.push({ type: 'tool', ...tool });
    if (t.assistant) out.push({ type: 'assistant', text: t.assistant });
    if (t.usage) out.push({ type: 'turn_usage', usage: t.usage });
    for (const n of t.notices) out.push({ type: 'system_notice', text: n });
  }
  return out;
}

export function serializeBlock(turn) {
  return { type: 'transcript_block', block: snapshotTurn(turn) };
}

export function deserializeBlock(row) {
  if (row?.type === 'transcript_block' && row.block) return row.block;
  if (row?.type === 'transcript' && row.role && row.text) {
    return { legacy: true, role: row.role === 'you' ? 'user' : row.role, text: row.text };
  }
  return null;
}

export function restoreBlocksFromSessionLines(lines) {
  const blocks = [];
  let current = null;

  for (const row of lines) {
    const parsed = typeof row === 'string' ? (() => { try { return JSON.parse(row); } catch { return null; } })() : row;
    if (!parsed) continue;

    const des = deserializeBlock(parsed);
    if (!des) continue;

    if (des.legacy) {
      if (des.role === 'user') {
        current = createTurnBlock(des.text);
        blocks.push({ kind: 'turn', block: current });
      } else if (current && des.role === 'assistant') {
        current.assistant = des.text;
      } else {
        blocks.push({ kind: 'legacy', role: 'assistant', text: des.text });
      }
      continue;
    }

    if (des.kind === 'user') {
      current = createTurnBlock(des.userText || des.text || '');
      blocks.push({ kind: 'turn', block: current });
    } else if (des.kind === 'turn_snapshot') {
      current = { ...des, tools: des.tools || [], sources: des.sources || [], notices: des.notices || [] };
      blocks.push({ kind: 'turn', block: current });
    }
  }
  return blocks;
}

export function snapshotTurn(turn) {
  return {
    kind: 'turn_snapshot',
    id: turn.id,
    userText: turn.userText,
    overlay: turn.overlay,
    thinking: turn.thinking,
    tools: turn.tools,
    assistant: turn.assistant,
    usage: turn.usage,
    sources: turn.sources,
    notices: turn.notices,
  };
}

export function applyEventToTurn(turn, event, state = null) {
  if (!turn || !event) return turn;
  switch (event.type) {
    case 'thinking':
      turn.thinking = state?.thinking ?? `${turn.thinking || ''}${event.text || ''}`;
      break;
    case 'text':
      turn.assistant = state?.assistant ?? `${turn.assistant || ''}${event.text || ''}`;
      break;
    case 'tool_call': {
      const src = sourceFromToolEvent(event);
      if (src) recordSource(turn, src);
      const existing = turn.tools.find((t) => t.id === event.id);
      if (existing) {
        existing.input = event.input ?? existing.input;
      } else {
        turn.tools.push({
          id: event.id,
          title: event.title || event.kind || 'tool',
          status: 'pending',
          input: event.input ?? null,
        });
      }
      break;
    }
    case 'tool_update': {
      const t = turn.tools.find((x) => x.id === event.id);
      if (t) t.status = event.status || t.status;
      else turn.tools.push({ id: event.id, title: event.id, status: event.status || 'pending' });
      break;
    }
    case 'usage':
      turn.usage = event;
      break;
    default:
      break;
  }
  return turn;
}

export function formatTurnUsageLine(usage, colors = {}) {
  return formatUsageFooter(usage, colors).replace(/^\[usage\] /, '');
}

export function finalizeTurn(turn) {
  if (!turn) return turn;
  turn.closed = true;
  if (turn.overlay?.externalResearch?.required && !turn.sources?.length) {
    const msg = 'Answer produced without recorded sources — treat as unverified';
    if (!turn.notices.includes(msg)) turn.notices.push(msg);
  }
  return turn;
}

export function turnBlocksToLegacyTranscript(blocks = []) {
  const out = [];
  for (const item of blocks) {
    if (item.kind === 'legacy') {
      out.push({ role: 'construct', text: item.text });
      continue;
    }
    if (item.kind !== 'turn') continue;
    const t = item.block;
    out.push({ role: 'you', text: t.userText });
    if (t.thinking) out.push({ role: 'thinking', text: t.thinking });
    if (t.assistant) out.push({ role: 'construct', text: t.assistant });
  }
  return out;
}

export function shouldShowInspector({ uiInspector = 'auto', turn = null, forced = null } = {}) {
  if (forced != null) return forced;
  const mode = uiInspector || 'auto';
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  if (!turn) return false;
  return Boolean(turn.overlay?.specialists?.length || turn.tools?.length || turn.thinking);
}
