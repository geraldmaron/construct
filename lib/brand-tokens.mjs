/**
 * lib/brand-tokens.mjs — Construct distribution brand primitives.
 *
 * Field-notebook visual language: cool stone paper, charcoal ink, slate-teal
 * evidence accent, Plus Jakarta Sans / JetBrains Mono. Hand-drawn diagram
 * geometry (D2 sketch, Mermaid handDrawn) shares this palette. BRAND_TOKENS
 * feed publish exports, deck HTML, and PPTX. Not the retired Construct 2.0
 * monochrome folio (inverted masthead / Space Grotesk-only chrome).
 */

export const INK = Object.freeze({
  ink: '#1a1d24',
  inkStrong: '#12141a',
  inkBody: '#2c313a',
  muted: '#545b66',
  faint: '#8b919a',
  hairline: '#d5d8dd',
  hairlineStrong: '#c0c5cc',
  surface: '#eef1f3',
  surfaceAlt: '#e3e7ea',
  paper: '#f7f8f9',
  navy: '#1a1d24',
  accent: '#1f5c61',
  accentSoft: '#d8e6e7',
});

export const FONTS = Object.freeze({
  sans: "'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
});

export const STATUS = Object.freeze({
  ok: '#3d8b6e',
  warn: '#b0892e',
  danger: '#b54a52',
});

// One spacing scale as base-unit multiples so PDF (Typst em), HTML/CSS (rem), and templates derive
// from a single rhythm instead of drifting with ad hoc per-surface values. Consumers multiply by
// their own base unit.

export const SPACING_SCALE = Object.freeze({
  none: 0,
  xs: 0.25,
  sm: 0.5,
  md: 1,
  lg: 1.5,
  xl: 2,
  xxl: 3,
});

export const BRAND_TOKENS = Object.freeze({
  ink: Object.freeze({
    default: INK.ink,
    strong: INK.inkStrong,
    body: INK.inkBody,
    muted: INK.muted,
    faint: INK.faint,
  }),
  line: Object.freeze({
    hairline: INK.hairline,
    hairlineStrong: INK.hairlineStrong,
  }),
  surface: Object.freeze({
    default: INK.surface,
    alt: INK.surfaceAlt,
    paper: INK.paper,
  }),
  navy: INK.navy,
  accent: INK.accent,
  accentSoft: INK.accentSoft,
  typography: Object.freeze({
    fontSans: 'Plus Jakarta Sans',
    fontDisplay: 'Plus Jakarta Sans',
    fontMono: 'JetBrains Mono',
    fontStack: FONTS.sans,
    fontStackMono: FONTS.mono,
    weight: Object.freeze({
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    }),
    size: Object.freeze({
      micro: '7.5pt',
      small: '8.5pt',
      meta: '9pt',
      body: '11pt',
      h4: '8.5pt',
      h3: '12.5pt',
      h2: '15pt',
      h1: '18pt',
      subtitle: '12pt',
      title: '28pt',
    }),
  }),
  layout: Object.freeze({
    figureMaxWidth: '58%',
    slideAspect: '16 / 9',
  }),
});

export const BRAND = Object.freeze({
  accent: INK.accent,
  accentWarm: INK.accent,
  navy: INK.navy,
  ink: INK.inkStrong,
  muted: INK.muted,
  surface: INK.surface,
  surfaceAlt: INK.surfaceAlt,
  tableHeader: INK.accentSoft,
});
