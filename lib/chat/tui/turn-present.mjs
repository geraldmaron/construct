/**
 * lib/chat/tui/turn-present.mjs — compact turn summaries for construct chat UI.
 *
 * Groups tool calls, formats source lists, and builds key-value context rows
 * shared by the Ink turn layout and the linear renderer.
 */

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
