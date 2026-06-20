/**
 * apps/chat/web/lib/format.ts — formatting utilities for the chat web UI.
 *
 * TypeScript mirror of lib/chat/present.mjs and lib/chat/tui/usage.mjs for
 * type-safe use in React components.
 */

export function formatTokens(n?: number | null): string {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function toolStatusGlyph(status: string): string {
  if (status === 'completed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'in_progress') return '›';
  return '·';
}

export function toolStatusClass(status: string): string {
  if (status === 'completed') return 'cx-tool-status-ok';
  if (status === 'failed') return 'cx-tool-status-err';
  if (status === 'in_progress') return 'cx-tool-status-working';
  return 'cx-tool-status-pending';
}

export function summarizeToolCalls(
  tools: Array<{ title: string; status: string; input?: Record<string, unknown> | null }>,
): string {
  if (!tools.length) return '';
  const paths = new Set<string>();
  for (const t of tools) {
    const p = t.input?.path ?? t.input?.file_path ?? t.input?.pattern;
    if (typeof p === 'string') paths.add(p);
  }
  const parts: string[] = [`${tools.length} tool${tools.length === 1 ? '' : 's'}`];
  if (paths.size) parts.push(`${paths.size} file${paths.size === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function primaryToolInput(input?: Record<string, unknown> | null): string | null {
  if (!input) return null;
  const val =
    input.path ??
    input.file_path ??
    input.pattern ??
    input.command ??
    input.query ??
    input.content;
  if (typeof val === 'string') return val.length > 72 ? val.slice(0, 72) + '…' : val;
  const first = Object.values(input)[0];
  if (typeof first === 'string') return first.length > 72 ? first.slice(0, 72) + '…' : first;
  return null;
}

export type UsageTokens = Record<string, number>;

export function formatUsageLine(
  tokens?: UsageTokens | null,
  cost?: { amount?: number } | null,
): string {
  if (!tokens) return '';
  const parts: string[] = [];
  if (tokens.input) parts.push(`${formatTokens(tokens.input)} in`);
  if (tokens.output) parts.push(`${formatTokens(tokens.output)} out`);
  if (tokens.cacheRead) parts.push(`cache↓ ${formatTokens(tokens.cacheRead)}`);
  if (tokens.cacheWrite) parts.push(`cache↑ ${formatTokens(tokens.cacheWrite)}`);
  if (tokens.reasoning) parts.push(`${formatTokens(tokens.reasoning)} thinking`);
  if (cost?.amount && cost.amount > 0) {
    const a = cost.amount;
    parts.push(`~$${a.toFixed(a < 0.01 ? 4 : a < 1 ? 3 : 2)}`);
  }
  return parts.join(' · ');
}

export function formatRouteCollapsed(overlay: {
  specialists?: string[] | null;
  riskFlags?: Record<string, boolean> | null;
  intent?: string | null;
} | null): string {
  if (!overlay) return '';
  const chain = overlay.specialists ?? [];
  const risks = Object.entries(overlay.riskFlags ?? {})
    .filter(([, v]) => v)
    .map(([k]) => k);
  const parts: string[] = [];
  if (chain.length) parts.push(`via ${chain.join(' → ')}`);
  if (risks.length) parts.push(`${risks[0]} risk`);
  return parts.join(' · ');
}
