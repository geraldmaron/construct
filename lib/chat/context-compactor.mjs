/**
 * lib/chat/context-compactor.mjs — the live bridge between the owned-loop's
 * message history and the deterministic context-continuation contract
 * (lib/chat/context-continuation.mjs, construct-6zga.1.10).
 *
 * The owned-loop engine keeps an ordered array of provider messages (the AI SDK
 * `messages[]`: the user turns it pushed plus the assistant/tool messages the model
 * produced). When a turn's reported context crosses the capability profile's
 * compaction trigger, this module maps that live history onto the contract's layer
 * inventory, runs compactContext, and — crucially — rebuilds a *provider-valid*
 * message array from the result. Provider validity is the constraint the pure
 * contract module does not own: the rebuilt array must begin with a user message,
 * keep tool-call/tool-result pairs intact, and never place two same-role turns
 * adjacently. The rebuild satisfies all three by collapsing the compacted prefix
 * into a single user "continuation" message (task + every user constraint verbatim,
 * plus one real summary of the elided assistant/tool work) followed by an
 * assistant-led verbatim suffix of the most recent turns.
 *
 * No silent loss: user text (task, constraints, approvals) is always carried
 * verbatim into the recap; only the model's own assistant reasoning and tool
 * results are summarized. When required state alone exceeds the budget the contract
 * returns a blocker and this module compacts nothing — it surfaces the blocker as a
 * user-visible notice instead.
 *
 * Pure except for the injected async `summarize`, so the rebuild logic is tested
 * without the AI SDK or a network call.
 */

import { compactContext, validateContinuationPacket } from './context-continuation.mjs';

function estimateTextTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

// AI SDK messages carry content either as a plain string (the user turns the
// engine pushes) or as an array of typed parts (assistant/tool messages from the
// model). Flatten both to text for token accounting and summarization, naming
// tool calls and results so an elided run still reads as what it did.

function partToText(part) {
  if (typeof part === 'string') return part;
  if (typeof part?.text === 'string') return part.text;
  if (part?.type === 'tool-call') return `[tool ${part.toolName || 'call'} ${safeJson(part.input ?? part.args)}]`;
  if (part?.type === 'tool-result') return `[result ${part.toolName || ''} ${safeJson(part.output ?? part.result)}]`.trim();
  if (typeof part?.content === 'string') return part.content;
  return '';
}

function safeJson(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) return message.content.map(partToText).filter(Boolean).join('\n');
  return '';
}

function messageRole(message) {
  return message?.role || 'user';
}

// A segment is one turn-unit: a head message (user or assistant) plus any tool
// messages that belong to it. Segmenting on tool boundaries is what lets the
// rebuild keep every tool-call/tool-result pair together — a tool message never
// becomes the head of a kept suffix, so the provider never sees an orphan result.

export function segmentMessages(messages = []) {
  const segments = [];
  let current = null;
  messages.forEach((message, index) => {
    const role = messageRole(message);
    if (role === 'tool' && current) {
      current.indices.push(index);
      current.hasTools = true;
      return;
    }
    current = { firstIndex: index, indices: [index], head: role, hasTools: role === 'tool' };
    segments.push(current);
  });
  return segments;
}

// Map the live segments onto the contract inventory. The system prompt is a
// reconstructible layer (re-derived each turn by the composer, referenced by
// source id). The first user segment is the task packet and every other user
// segment is a user constraint — both required, kept verbatim. Assistant segments
// are compactible; ordering them newest-first means compactContext fills the budget
// with the most recent turns and elides the oldest, so the kept suffix is the
// recent contiguous tail.

export function buildInventory({ systemText = '', segments = [], messages = [], estimateTokens = estimateTextTokens } = {}) {
  const layers = [];
  if (systemText) {
    layers.push({ id: 'static-instructions', kind: 'static-instructions', eligibility: 'reconstructible', sourceId: 'prompt:system', tokens: estimateTokens(systemText), content: systemText });
  }

  let seenUser = false;
  const required = [];
  const compactible = [];
  for (const segment of segments) {
    const text = segment.indices.map((i) => messageText(messages[i])).join('\n');
    const tokens = estimateTokens(text);
    if (segment.head === 'user') {
      const kind = seenUser ? 'user-constraints' : 'task-packet';
      seenUser = true;
      required.push({ id: `seg-${segment.firstIndex}`, kind, eligibility: 'required', sourceId: null, tokens, content: text, firstIndex: segment.firstIndex });
    } else {
      const kind = segment.hasTools ? 'tool-results' : 'conversation-summary';
      compactible.push({ id: `seg-${segment.firstIndex}`, kind, eligibility: 'compactible', sourceId: null, tokens, content: text, firstIndex: segment.firstIndex });
    }
  }

  compactible.sort((a, b) => b.firstIndex - a.firstIndex);
  return [...layers, ...required, ...compactible];
}

// Rebuild a provider-valid message array from the compaction packet. The cut index
// is the earliest message belonging to a retained (recent) compactible segment,
// nudged forward to land on an assistant message so the recap (a single user
// message) is followed by an assistant turn. Everything before the cut collapses
// into the recap: user text verbatim, assistant/tool work as the summary.

export function rebuildMessages({ messages = [], segments = [], packet = null, summaryText = '' } = {}) {
  const dispositionByFirstIndex = new Map();
  for (const layer of packet?.layers || []) {
    const match = /^seg-(\d+)$/.exec(layer.id || '');
    if (match) dispositionByFirstIndex.set(Number(match[1]), layer.disposition);
  }

  const retainedFirstIndices = segments
    .filter((s) => s.head !== 'user' && dispositionByFirstIndex.get(s.firstIndex) === 'retained')
    .map((s) => s.firstIndex);

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messageRole(messages[i]) === 'assistant') return i;
    }
    return messages.length;
  })();

  let cut = retainedFirstIndices.length ? Math.min(...retainedFirstIndices) : lastAssistantIndex;
  while (cut < messages.length && messageRole(messages[cut]) !== 'assistant') cut++;
  if (cut >= messages.length) cut = lastAssistantIndex;

  const userVerbatim = [];
  for (let i = 0; i < cut; i++) {
    if (messageRole(messages[i]) === 'user') userVerbatim.push(messageText(messages[i]));
  }

  const recap = buildRecapText({ userVerbatim, summaryText, packet });
  return [{ role: 'user', content: recap }, ...messages.slice(cut)];
}

export function buildRecapText({ userVerbatim = [], summaryText = '', packet = null } = {}) {
  const elidedTokens = packet?.budget?.elidedTokens || 0;
  const lines = [
    '[Context continuation — earlier turns were compacted to fit the model context budget. Nothing required was dropped.]',
    '',
    '== Task & constraints (verbatim) ==',
    ...userVerbatim.filter(Boolean),
  ];
  if (summaryText) {
    lines.push('', `== Summary of prior assistant work & tool results (~${elidedTokens} tokens compacted) ==`, summaryText);
  }
  return lines.join('\n');
}

function fallbackSummary(elidedSegments, messages) {
  const count = elidedSegments.reduce((n, s) => n + s.indices.length, 0);
  const tail = elidedSegments.slice(-1).map((s) => messageText(messages[s.firstIndex]))[0] || '';
  const clipped = tail.length > 280 ? `${tail.slice(0, 277)}...` : tail;
  return `Compacted ${count} earlier message(s) without a model summary. Most recent elided turn began: ${clipped}`.trim();
}

export function shouldCompact({ contextTokens = 0, triggerTokens = null } = {}) {
  return Number.isFinite(triggerTokens) && triggerTokens > 0 && contextTokens >= triggerTokens;
}

/**
 * The orchestrator the engine calls once per turn. Returns the compaction outcome:
 * `compacted` with a rebuilt message array and a notice, a `blocker` with a notice
 * and no mutation when required state exceeds the budget, or an inert result when
 * there is no pressure or nothing safe to elide. The packet is always returned for
 * persistence and re-verification.
 */
export async function maybeCompact({
  messages = [],
  systemText = '',
  triggerTokens = null,
  contextTokens = 0,
  summarize = null,
  estimateTokens = estimateTextTokens,
} = {}) {
  if (!shouldCompact({ contextTokens, triggerTokens })) return { compacted: false, packet: null, notice: null, blocker: null };

  const segments = segmentMessages(messages);
  if (segments.length <= 2) return { compacted: false, packet: null, notice: null, blocker: null };

  const inventory = buildInventory({ systemText, segments, messages, estimateTokens });
  const packet = compactContext(inventory, { triggerTokens });

  if (packet.blocker) {
    const { requiredTokens, budgetTokens, overflowTokens } = packet.blocker;
    return {
      compacted: false,
      packet,
      blocker: packet.blocker,
      notice: `Context pressure: required context (~${requiredTokens} tokens) exceeds the model budget (~${budgetTokens}) by ~${overflowTokens}. Nothing was dropped — reduce scope or start a new session.`,
    };
  }

  const elidedSegments = segments.filter((s) => {
    const layer = packet.layers.find((l) => l.id === `seg-${s.firstIndex}`);
    return layer && layer.disposition === 'elided';
  });
  if (!elidedSegments.length) return { compacted: false, packet, notice: null, blocker: null };

  const elidedText = elidedSegments
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map((s) => s.indices.map((i) => messageText(messages[i])).join('\n'))
    .join('\n\n');

  let summaryText = '';
  if (typeof summarize === 'function') {
    try {
      const out = await summarize(elidedText, {
        segmentCount: elidedSegments.length,
        tokens: packet.budget.elidedTokens,
      });
      summaryText = typeof out === 'string' ? out.trim() : '';
    } catch { summaryText = ''; }
  }
  if (!summaryText) summaryText = fallbackSummary(elidedSegments, messages);

  const newMessages = rebuildMessages({ messages, segments, packet, summaryText });

  const elidedMessageCount = elidedSegments.reduce((n, s) => n + s.indices.length, 0);
  return {
    compacted: true,
    messages: newMessages,
    packet,
    blocker: null,
    notice: `Context compacted: summarized ${elidedMessageCount} earlier message(s) (~${packet.budget.elidedTokens} tokens) to stay within the model's ~${triggerTokens}-token budget. Task, constraints, and recent turns kept verbatim.`,
  };
}

export { estimateTextTokens, validateContinuationPacket };
