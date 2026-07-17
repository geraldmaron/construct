/**
 * Hand-rolled hardening helpers for the Mermaid component: an allowlist
 * sanitizer for rendered SVG strings, a chart-size cap, and a render timeout
 * wrapper. Colocated as a plain module (no JSX) so it can be unit-tested with
 * node's native test runner independent of the React component tree.
 * ADR-0001 (zero-npm-core) rules out DOMPurify or an equivalent sanitizer
 * dependency; this pass plus Mermaid's own `securityLevel: 'strict'` is the
 * deliberate defense-in-depth combination for construct-4uxq0.9.11.
 */

// Mermaid diagrams in this repo top out at under 1,000 characters (docs/
// corpus, checked at implementation time). 20,000 gives headroom for
// legitimately large diagrams while still bounding a pathological chart
// string that would otherwise hang the client-side layout engine.

export const MERMAID_CHART_SIZE_LIMIT = 20_000;

export function isChartOversized(chart: string): boolean {
  return chart.length > MERMAID_CHART_SIZE_LIMIT;
}

// A hung/never-resolving mermaid.render() (e.g. adversarial input that
// defeats the layout engine) must not leave the component spinning forever.
// 8s comfortably covers real diagrams, which render in well under 1s.

export const MERMAID_RENDER_TIMEOUT_MS = 8_000;

export class MermaidTimeoutError extends Error {
  constructor(message = 'mermaid render timed out') {
    super(message);
    this.name = 'MermaidTimeoutError';
  }
}

const SCRIPT_TAG_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SELF_CLOSING_SCRIPT_RE = /<script\b[^>]*\/>/gi;
const FOREIGN_OBJECT_RE = /<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi;
const SELF_CLOSING_FOREIGN_OBJECT_RE = /<foreignObject\b[^>]*\/>/gi;
const EVENT_HANDLER_ATTR_RE = /\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_URL_ATTR_RE = /\s(?:href|xlink:href)\s*=\s*("(?:javascript:|data:text\/html)[^"]*"|'(?:javascript:|data:text\/html)[^']*')/gi;
const ANCHOR_OPEN_TAG_RE = /<a\b([^>]*)>/gi;

// External-link policy: safe (http/https) hyperlinks that survive the
// dangerous-URL strip above are hardened with rel="noopener noreferrer" and
// target="_blank" rather than removed outright. Mermaid's `click id "url"`
// directive is a legitimate, widely used diagram feature (flowcharts/graphs
// linking out to docs); stripping it would silently break diagrams that rely
// on it. Locking the anchor down instead prevents the clicked link from
// reaching back into this window via window.opener (reverse tabnabbing)
// without removing the navigation itself.

function hardenAnchorAttrs(attrs: string): string {
  if (!/\bhref\s*=/i.test(attrs) && !/\bxlink:href\s*=/i.test(attrs)) return attrs;
  const stripped = attrs.replace(/\s(?:target|rel)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  return `${stripped} target="_blank" rel="noopener noreferrer"`;
}

// Runs on every render regardless of securityLevel — defense in depth, not a
// replacement for `strict` mode. Strips executable/embedding surfaces
// (script, event-handler attributes, foreignObject, javascript:/data:
// URLs) that a raw innerHTML assignment would otherwise execute or embed.

export function sanitizeMermaidSvg(svg: string): string {
  let out = svg;
  out = out.replace(SCRIPT_TAG_RE, '');
  out = out.replace(SELF_CLOSING_SCRIPT_RE, '');
  out = out.replace(FOREIGN_OBJECT_RE, '');
  out = out.replace(SELF_CLOSING_FOREIGN_OBJECT_RE, '');
  out = out.replace(EVENT_HANDLER_ATTR_RE, '');
  out = out.replace(DANGEROUS_URL_ATTR_RE, '');
  out = out.replace(ANCHOR_OPEN_TAG_RE, (match, attrs: string) => `<a${hardenAnchorAttrs(attrs)}>`);
  return out;
}

// A hung render must land in the component's error state, not spin forever.
// Promise.race against a bounded timer; the timer is cleared either way so a
// fast render doesn't leave a dangling timeout behind.

export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error = () => new MermaidTimeoutError()): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
