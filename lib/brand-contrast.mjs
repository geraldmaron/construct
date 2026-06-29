/**
 * lib/brand-contrast.mjs — WCAG contrast over the Construct brand palette.
 *
 * Computes WCAG 2.1 relative-luminance contrast ratios between brand colors and checks them
 * against the AA thresholds (4.5:1 for body text, 3:1 for large text and UI). validateBrandContrast
 * runs a declared set of text-bearing ink-on-surface pairs so a palette change that drops legibility
 * fails a test instead of shipping unverified. Mirrors the gap in
 * docs/notes/research/construct-asset-quality/subagents/branding-typography-spacing.md.
 */
import { BRAND_TOKENS } from './brand-tokens.mjs';

export const AA_BODY = 4.5;
export const AA_LARGE = 3.0;

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsWcagAA(ratio, { large = false } = {}) {
  return ratio >= (large ? AA_LARGE : AA_BODY);
}

// The text-bearing pairs that must stay legible: body and strong ink against every surface they
// land on, and muted secondary text held to body AA. ink.faint is a decorative color measuring
// 2.86:1 on paper (below large-text AA), excluded here and guarded by the test as decorative-only
// rather than promoted to a text color.

export const BRAND_TEXT_PAIRS = Object.freeze([
  { label: 'ink.default on paper', fg: BRAND_TOKENS.ink.default, bg: BRAND_TOKENS.surface.paper, large: false },
  { label: 'ink.strong on paper', fg: BRAND_TOKENS.ink.strong, bg: BRAND_TOKENS.surface.paper, large: false },
  { label: 'ink.body on paper', fg: BRAND_TOKENS.ink.body, bg: BRAND_TOKENS.surface.paper, large: false },
  { label: 'ink.body on surface', fg: BRAND_TOKENS.ink.body, bg: BRAND_TOKENS.surface.default, large: false },
  { label: 'ink.body on surfaceAlt', fg: BRAND_TOKENS.ink.body, bg: BRAND_TOKENS.surface.alt, large: false },
  { label: 'ink.muted on paper', fg: BRAND_TOKENS.ink.muted, bg: BRAND_TOKENS.surface.paper, large: false },
]);

export function validateBrandContrast(pairs = BRAND_TEXT_PAIRS) {
  const results = pairs.map((pair) => {
    const ratio = contrastRatio(pair.fg, pair.bg);
    return { ...pair, ratio: Math.round(ratio * 100) / 100, pass: meetsWcagAA(ratio, { large: pair.large }) };
  });
  const failures = results.filter((result) => !result.pass);
  return { ok: failures.length === 0, results, failures };
}
