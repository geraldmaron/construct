/**
 * lib/brand-tokens.mjs — Construct distribution brand primitives.
 *
 * Monochrome ink ramp from templates/distribution/construct-brand.typ plus Space
 * Grotesk / JetBrains Mono typography. BRAND_TOKENS feed publish exports,
 * deck HTML, and PPTX.
 */

export const INK = Object.freeze({
  ink: '#0a0c10',
  inkStrong: '#16191f',
  inkBody: '#23272e',
  muted: '#565c66',
  faint: '#9499a2',
  hairline: '#e3e4e8',
  hairlineStrong: '#cdd0d6',
  surface: '#fafafa',
  surfaceAlt: '#f3f4f6',
  paper: '#ffffff',
  navy: '#0c1018',
});

export const FONTS = Object.freeze({
  sans: "'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
});

export const STATUS = Object.freeze({
  ok: '#98c379',
  warn: '#e5c07b',
  danger: '#e06c75',
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
  typography: Object.freeze({
    fontSans: 'Space Grotesk',
    fontDisplay: 'Space Grotesk',
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
  accent: INK.ink,
  accentWarm: INK.ink,
  navy: INK.navy,
  ink: INK.inkStrong,
  muted: INK.muted,
  surface: INK.surface,
  surfaceAlt: INK.surfaceAlt,
  tableHeader: INK.surfaceAlt,
});
