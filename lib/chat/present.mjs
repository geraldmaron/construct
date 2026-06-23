/**
 * lib/chat/present.mjs — headless formatters for construct chat surfaces.
 *
 * Shared by Ink TUI, linear renderer, and dashboard web cockpit. Keeps route
 * rows, tool grouping, usage ledgers, and SSE overlay serialization identical
 * across surfaces.
 */

import { formatTokens, formatUsageFooter } from './tui/usage.mjs';

export function summarizeToolCalls(tools = []) {
  const groups = new Map();
  for (const t of tools) {
    const title = t.title || t.kind || 'tool';
    if (!groups.has(title)) {
      groups.set(title, { title, count: 0, status: 'completed', refs: [] });
    }
    const g = groups.get(title);
    g.count += 1;
    if (t.status === 'failed') g.status = 'failed';
    else if (t.status === 'pending' && g.status !== 'failed') g.status = 'pending';
    else if (t.status === 'in_progress' && g.status === 'completed') g.status = 'in_progress';
    const ref = t.input?.path || t.input?.pattern || t.input?.glob || t.input?.name;
    if (ref) {
      const s = String(ref);
      if (!g.refs.includes(s)) g.refs.push(s);
    }
  }
  return [...groups.values()];
}

export function summarizeSources(sources = []) {
  if (!sources?.length) {
    return { total: 0, byTool: {}, refs: [] };
  }
  const byTool = {};
  const refs = [];
  for (const s of sources) {
    if (typeof s === 'string') {
      if (!refs.includes(s)) refs.push(s);
      continue;
    }
    byTool[s.tool] = (byTool[s.tool] || 0) + 1;
    if (s.ref && !refs.includes(s.ref)) refs.push(s.ref);
  }
  return { total: sources.length, byTool, refs };
}

export function formatRefsInline(refs, { max = 3 } = {}) {
  if (!refs?.length) return '';
  if (refs.length <= max) return refs.join(', ');
  const shown = refs.slice(0, max);
  return `${shown.join(', ')} +${refs.length - max} more`;
}

export function formatSourceToolCounts(byTool) {
  const entries = Object.entries(byTool || {});
  if (!entries.length) return '';
  return entries.map(([tool, n]) => `${tool} ${n}`).join('  ');
}

export function contextRows(overlay, { layers = null } = {}) {
  if (!overlay) return [];
  const rows = [];
  if (overlay.intent) rows.push({ label: 'intent', value: overlay.intent });
  if (overlay.workCategory) rows.push({ label: 'category', value: overlay.workCategory });
  if (overlay.track) rows.push({ label: 'track', value: overlay.track });
  if (overlay.specialists?.length && layers?.specialists !== false) {
    rows.push({ label: 'route', value: overlay.specialists.join(' → ') });
  }
  if (overlay.externalResearch?.required) {
    const shape = overlay.externalResearch.shape ? ` (${overlay.externalResearch.shape})` : '';
    rows.push({ label: 'research', value: `required${shape}` });
  }
  return rows;
}

export function splitSourceLines(refs, { limit = 4 } = {}) {
  if (!refs?.length) return { lines: ['none yet'], hidden: 0, total: 0 };
  const shown = refs.slice(0, limit);
  return {
    lines: shown,
    hidden: Math.max(0, refs.length - limit),
    total: refs.length,
  };
}

export function toolGroupLabel(group) {
  const count = group.count > 1 ? ` ×${group.count}` : '';
  const refs = formatRefsInline(group.refs, { max: 2 });
  return refs ? `${group.title}${count}  ${refs}` : `${group.title}${count}`;
}

export function toolStatusGlyph(status) {
  if (status === 'completed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'in_progress') return '›';
  return '·';
}

/**
 * @param {Record<string, unknown> | null | undefined} overlay
 * @param {{ layers?: Record<string, boolean> | null }} [options]
 * @returns {{
 *   chain: string[],
 *   intent: string | null,
 *   track: string | null,
 *   gates: Array<{ label: string, value: string }>,
 *   summary: string | null,
 *   chainLine: string | null,
 * } | null}
 */
export function formatRouteStrip(overlay, { layers = null } = {}) {
  if (!overlay) return null;
  const showSpecialists = layers?.specialists !== false;
  const chain = showSpecialists && Array.isArray(overlay.specialists)
    ? [...overlay.specialists]
    : [];
  const intent = overlay.intent || null;
  const track = overlay.track || null;
  const gates = formatGateRows(overlay);
  const summary = overlay.dispatchSummary || null;
  const chainLine = showSpecialists
    ? (chain.length ? chain.join(' → ') : 'direct')
    : null;
  return { chain, intent, track, gates, summary, chainLine };
}

/**
 * @param {Record<string, unknown> | null | undefined} overlay
 * @param {{ layers?: Record<string, boolean> | null }} [options]
 */
export function formatRouteLogLine(overlay, { layers = null } = {}) {
  const strip = formatRouteStrip(overlay, { layers });
  if (!strip) return '';
  const parts = [];
  if (strip.intent) parts.push(`intent=${strip.intent}`);
  if (strip.track) parts.push(`track=${strip.track}`);
  if (strip.chainLine) parts.push(strip.chainLine);
  return parts.join(' · ');
}

export function formatRiskFlags(riskFlags = {}) {
  return Object.entries(riskFlags)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

export function formatContractChain(chain = []) {
  return chain.map((edge) => `${edge.producer} → ${edge.consumer}${edge.stage ? ` (${edge.stage})` : ''}`);
}

export function formatGateRows(overlay) {
  if (!overlay) return [];
  const rows = [];
  if (overlay.externalResearch?.required) {
    const detail = overlay.externalResearch.shape || overlay.externalResearch.reason || 'yes';
    rows.push({ label: 'research', value: `required (${detail})` });
  }
  if (overlay.framingChallenge?.required) {
    rows.push({ label: 'framing', value: 'challenge required' });
  }
  if (overlay.docAuthoring?.docType) {
    rows.push({ label: 'doc', value: `${overlay.docAuthoring.docType} → ${overlay.docAuthoring.owner || 'unknown'}` });
  }
  if (overlay.artifactReview?.requiredReviewers?.length) {
    rows.push({
      label: 'reviewers',
      value: overlay.artifactReview.requiredReviewers.join(', '),
    });
  }
  return rows;
}

export function contextMeterBar(used, size, width = 18) {
  const ratio = size > 0 ? Math.max(0, Math.min(1, used / size)) : 0;
  const filled = Math.round(ratio * width);
  return {
    bar: '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled)),
    ratio,
    percent: `${Math.round(ratio * 100)}%`,
    label: `${formatTokens(used) || '0'}/${formatTokens(size) || '?'}`,
  };
}

export function sessionUsageSummary(session) {
  const t = session?.usage?.tokens || session?.tokens || {};
  const parts = [];
  if (t.total) parts.push(`${formatTokens(t.total)} tok`);
  const cost = session?.usage?.cost?.amount ?? session?.cost?.amount;
  if (cost > 0) parts.push(`~$${cost.toFixed(cost < 1 ? 3 : 2)}`);
  const turns = session?.usage?.turns ?? session?.turns;
  if (turns) parts.push(`${turns} turn${turns === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'no tokens yet';
}

export function formatTurnUsageLine(usage) {
  return formatUsageFooter(usage, {}).replace(/^\[usage\] /, '');
}

export function overlayToSsePayload(overlay) {
  if (!overlay) return null;
  return {
    type: 'overlay',
    intent: overlay.intent || null,
    workCategory: overlay.workCategory || null,
    track: overlay.track || null,
    specialists: overlay.specialists || [],
    externalResearch: overlay.externalResearch || null,
    riskFlags: overlay.riskFlags || null,
    contractChain: overlay.contractChain || [],
    framingChallenge: overlay.framingChallenge || null,
    dispatchSummary: overlay.dispatchSummary || null,
    dispatchReasons: overlay.dispatchReasons || null,
    triggers: overlay.triggers || [],
    docAuthoring: overlay.docAuthoring || null,
    artifactReview: overlay.artifactReview || null,
    sessionTurnIndex: overlay.sessionTurnIndex ?? 0,
    priorIntent: overlay.priorIntent ?? null,
    workingBranch: overlay.workingBranch ?? null,
  };
}

export function sessionMetaToSsePayload({ session, layers, workingBranch, oracle, ctx = null }) {
  return {
    type: 'session_meta',
    model: session?.model || null,
    demoLabel: session?.demoGuide ? (session.demoTitle || 'scripted') : null,
    modelMode: session?.modelMode || 'pinned',
    sandbox: session?.sandbox || null,
    permissionMode: session?.permissionMode || null,
    layers: layers || {},
    workingBranch: workingBranch || null,
    ctx,
    oracle: oracle ? {
      visible: oracle.visible,
      summary: oracle.summary,
      topGaps: (oracle.topGaps || []).map((g) => ({ id: g.id, detail: g.detail || g.message || '' })),
    } : null,
    usage: session?.usage ? {
      turns: session.usage.turns,
      tokens: { ...session.usage.tokens },
      cost: session.usage.cost ? { ...session.usage.cost } : null,
    } : null,
  };
}
