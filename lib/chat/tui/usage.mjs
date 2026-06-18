/**
 * lib/chat/tui/usage.mjs — truthful token/cost accounting for `construct chat`.
 *
 * Formats a single turn's usage event into a compact footer and accumulates usage
 * across a session for the `/usage` panel. Every field is optional and only printed
 * when the host actually reported it: there are no fabricated or estimated splits
 * (no-fabrication rule). `input` tokens are labeled "prompt" since, under the
 * delegate-the-loop model, that is the only honest "prompt section" the host exposes;
 * a per-specialist breakdown is shown only when the host emits per-sub-agent usage.
 */

export function createSessionUsage() {
  return {
    turns: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 },
    cost: { amount: 0, currency: 'USD' },
    bySubAgent: new Map(),
    history: [],
  };
}

function addInto(target, tokens = {}) {
  for (const key of Object.keys(target)) {
    if (Number.isFinite(tokens[key])) target[key] += tokens[key];
  }
}

export function addUsage(session, event) {
  if (!session || !event) return;
  session.turns += 1;
  addInto(session.tokens, event.tokens || {});
  if (event.cost && Number.isFinite(event.cost.amount)) {
    session.cost.amount += event.cost.amount;
    if (event.cost.currency) session.cost.currency = event.cost.currency;
  }
  if (event.subAgent && event.tokens) {
    const prev = session.bySubAgent.get(event.subAgent) || { input: 0, output: 0, total: 0 };
    addInto(prev, event.tokens);
    session.bySubAgent.set(event.subAgent, prev);
  }
  session.history.push({ tokens: event.tokens || null, cost: event.cost || null, model: event.model || null });
}

export function formatTokens(n) {
  if (!Number.isFinite(n)) return null;
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

function formatCost(cost) {
  if (!cost || !Number.isFinite(cost.amount)) return null;
  if (cost.amount === 0) return '$0';
  const digits = cost.amount < 0.01 ? 4 : cost.amount < 1 ? 3 : 2;
  return `~$${cost.amount.toFixed(digits)}`;
}

// Builds an ordered list of "label value" parts from whatever the host reported.

function usageParts(event) {
  const t = event.tokens || {};
  const parts = [];
  if (Number.isFinite(t.input)) parts.push(`prompt ${formatTokens(t.input)}`);
  if (Number.isFinite(t.output)) parts.push(`output ${formatTokens(t.output)}`);
  if (Number.isFinite(t.reasoning) && t.reasoning > 0) parts.push(`reasoning ${formatTokens(t.reasoning)}`);
  if (Number.isFinite(t.cacheRead) && t.cacheRead > 0) parts.push(`cache\u2193 ${formatTokens(t.cacheRead)}`);
  if (Number.isFinite(t.cacheWrite) && t.cacheWrite > 0) parts.push(`cache\u2191 ${formatTokens(t.cacheWrite)}`);
  if (Number.isFinite(t.total)) parts.push(`total ${formatTokens(t.total)}`);
  const cost = formatCost(event.cost);
  if (cost) parts.push(cost);
  if (event.context && Number.isFinite(event.context.used) && Number.isFinite(event.context.size)) {
    parts.push(`ctx ${formatTokens(event.context.used)}/${formatTokens(event.context.size)}`);
  }
  if (event.model) parts.push(`model ${event.model}`);
  return parts;
}

export function formatUsageFooter(event, colors = {}) {
  const dim = colors.dim || '';
  const reset = colors.reset || '';
  const parts = usageParts(event);
  if (!parts.length) return `${dim}[usage] (host reported no token counts)${reset}`;
  return `${dim}[usage] ${parts.join(' \u00b7 ')}${reset}`;
}

// Multi-line detailed panel for the `/usage` command: session totals, per-sub-agent
// attribution when present, and a short per-turn history.

export function formatUsagePanel(session, colors = {}) {
  const dim = colors.dim || '';
  const bold = colors.bold || '';
  const reset = colors.reset || '';
  const lines = [];
  lines.push(`${bold}session usage${reset} ${dim}(${session.turns} turn${session.turns === 1 ? '' : 's'})${reset}`);

  const t = session.tokens;
  const totalParts = [];
  if (t.input) totalParts.push(`prompt ${formatTokens(t.input)}`);
  if (t.output) totalParts.push(`output ${formatTokens(t.output)}`);
  if (t.reasoning) totalParts.push(`reasoning ${formatTokens(t.reasoning)}`);
  if (t.cacheRead) totalParts.push(`cache\u2193 ${formatTokens(t.cacheRead)}`);
  if (t.cacheWrite) totalParts.push(`cache\u2191 ${formatTokens(t.cacheWrite)}`);
  if (t.total) totalParts.push(`total ${formatTokens(t.total)}`);
  const cost = formatCost(session.cost);
  if (cost) totalParts.push(cost);
  lines.push(totalParts.length ? `  ${totalParts.join(' \u00b7 ')}` : `  ${dim}no token counts reported yet${reset}`);

  if (session.bySubAgent.size) {
    lines.push(`${dim}  by sub-agent:${reset}`);
    for (const [name, st] of session.bySubAgent) {
      lines.push(`    ${name}: prompt ${formatTokens(st.input)} \u00b7 output ${formatTokens(st.output)} \u00b7 total ${formatTokens(st.total)}`);
    }
  }

  return lines.join('\n');
}
