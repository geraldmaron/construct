/**
 * packages/construct-ui/mermaid-interactive.mjs — hardened Mermaid interactive defaults.
 *
 * Shared constants and pure helpers for the docs/dashboard Mermaid renderer: strict
 * security profile, bounded source size, render timeouts, deterministic handDrawn
 * seeds, and SVG sanitization before DOM insertion.
 */

export const MERMAID_SECURITY_PROFILE = 'strict';
export const MERMAID_MAX_SOURCE_CHARS = 32_768;
export const MERMAID_RENDER_TIMEOUT_MS = 15_000;
export const MERMAID_HAND_DRAWN_SEED = 42;
export const MERMAID_PINNED_VERSION = '11.16.0';

export const MERMAID_DEGRADED_TOO_LARGE = 'diagram source exceeds size limit';
export const MERMAID_DEGRADED_TIMEOUT = 'diagram render timed out';

const DANGEROUS_SVG_TAG = /<\s*(script|foreignObject|iframe|object|embed|link)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const EVENT_HANDLER_ATTR = /\s(on[a-z]+|href\s*=\s*['"]\s*javascript:)[^>]*/gi;

export function assessMermaidSource(chart) {
  const source = String(chart ?? '');
  if (source.length > MERMAID_MAX_SOURCE_CHARS) {
    return { ok: false, reason: MERMAID_DEGRADED_TOO_LARGE, length: source.length };
  }
  return { ok: true, reason: null, length: source.length };
}

export function buildMermaidInitializeConfig({
  theme = 'dark',
  look = 'classic',
  seed = MERMAID_HAND_DRAWN_SEED,
} = {}) {
  const palette = theme === 'light'
    ? { bg: '#fafaf9', txt: '#0a0a0a', line: '#bbb', node: '#ffffff', border: '#0a0a0a' }
    : { bg: '#050505', txt: '#f4f4f4', line: '#3a3a3a', node: '#0e0e0e', border: '#f4f4f4' };
  /** @type {import('mermaid').MermaidConfig} */
  const config = {
    startOnLoad: false,
    theme: 'base',
    securityLevel: MERMAID_SECURITY_PROFILE,
    look,
    themeVariables: {
      background: palette.bg,
      primaryColor: palette.node,
      primaryTextColor: palette.txt,
      primaryBorderColor: palette.border,
      lineColor: palette.line,
      secondaryColor: palette.node,
      tertiaryColor: palette.node,
      fontFamily: 'Plus Jakarta Sans, ui-sans-serif, system-ui',
      fontSize: '13px',
    },
    flowchart: { curve: 'basis', padding: 14 },
    deterministicIds: true,
    deterministicIDSeed: String(seed),
  };
  if (look === 'handDrawn') {
    config.handDrawnSeed = seed;
  }
  return config;
}

export function sanitizeMermaidSvg(svg) {
  let cleaned = String(svg ?? '');
  cleaned = cleaned.replace(DANGEROUS_SVG_TAG, '');
  cleaned = cleaned.replace(/<\s*[a-z0-9:-]+[^>]*>/gi, (tag) => tag.replace(EVENT_HANDLER_ATTR, ''));
  return cleaned;
}

export function withRenderTimeout(promise, timeoutMs = MERMAID_RENDER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(MERMAID_DEGRADED_TIMEOUT));
    }, timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * @param {object} [options]
 * @param {string} [options.id]
 * @param {'dark'|'light'} [options.theme]
 * @param {'classic'|'handDrawn'} [options.look]
 * @param {number} [options.seed]
 * @param {string} [options.engineVersion]
 * @param {string} [options.accessibilityDescription]
 * @param {boolean} [options.degraded]
 * @param {string|null} [options.reason]
 * @param {string} [options.chart]
 */
export function buildInteractiveMermaidDiagramCard({
  id,
  theme = 'dark',
  look = 'classic',
  seed = MERMAID_HAND_DRAWN_SEED,
  engineVersion = MERMAID_PINNED_VERSION,
  accessibilityDescription,
  degraded = false,
  reason = null,
  chart = '',
} = {}) {
  const assessment = assessMermaidSource(chart);
  const cardDegraded = degraded || !assessment.ok;
  const cardReason = cardDegraded
    ? (reason || assessment.reason || 'interactive mermaid render degraded')
    : null;
  return {
    id: String(id || `mermaid-${Date.now()}`),
    source: 'interactive-mermaid',
    engine: 'mermaid-source-only',
    engineVersion,
    theme,
    seed: look === 'handDrawn' ? seed : null,
    securityProfile: MERMAID_SECURITY_PROFILE,
    accessibilityDescription: String(accessibilityDescription || '').trim() || 'Mermaid diagram',
    provenance: {
      module: 'packages/construct-ui/components/mermaid.tsx',
      command: 'interactive render',
      generatedAt: new Date().toISOString(),
    },
    degraded: cardDegraded,
    reason: cardReason,
  };
}

export function assertMermaidComponentHardened(sourceText) {
  const errors = [];
  if (/securityLevel:\s*['"]loose['"]/.test(sourceText)) {
    errors.push('securityLevel must not be loose');
  }
  if (!/buildMermaidInitializeConfig|securityLevel:\s*MERMAID_SECURITY_PROFILE|securityLevel:\s*['"]strict['"]/.test(sourceText)) {
    errors.push('must initialize mermaid via hardened config helper');
  }
  if (/ref\.current\.innerHTML\s*=/.test(sourceText)) {
    errors.push('must not assign raw innerHTML');
  }
  if (!/sanitizeMermaidSvg|replaceChildren|importNode/.test(sourceText)) {
    errors.push('must mount SVG via sanitized DOM insertion');
  }
  if (!/role=["']img["']/.test(sourceText)) {
    errors.push('diagram container must expose role="img"');
  }
  if (!/accessibilityDescription|aria-label/.test(sourceText)) {
    errors.push('diagram must carry an accessible description');
  }
  if (!/assessMermaidSource|MERMAID_MAX_SOURCE_CHARS/.test(sourceText)) {
    errors.push('diagram source must be size-checked before render');
  }
  if (!/withRenderTimeout|MERMAID_RENDER_TIMEOUT_MS/.test(sourceText)) {
    errors.push('render must be wrapped with a timeout');
  }
  return { ok: errors.length === 0, errors };
}
