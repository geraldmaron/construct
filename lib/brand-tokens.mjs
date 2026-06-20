/**
 * lib/brand-tokens.mjs — Construct distribution brand primitives.
 *
 * Monochrome ink ramp from templates/distribution/construct-brand.typ plus Plus
 * Jakarta Sans / IBM Plex Mono typography. INK/FONTS/STATUS feed chat surfaces;
 * BRAND_TOKENS feed publish exports, deck HTML, and PPTX.
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
  sans: "'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
});

export const STATUS = Object.freeze({
  ok: '#98c379',
  warn: '#e5c07b',
  danger: '#e06c75',
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
    fontSans: 'Plus Jakarta Sans',
    fontDisplay: 'Plus Jakarta Sans',
    fontMono: 'IBM Plex Mono',
    fontStack: FONTS.sans,
    fontStackMono: FONTS.mono,
    weight: Object.freeze({
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    }),
    size: Object.freeze({
      micro: '8pt',
      small: '8.5pt',
      meta: '9pt',
      body: '10pt',
      h4: '8.5pt',
      h3: '11pt',
      h2: '13pt',
      h1: '17pt',
      subtitle: '11.5pt',
      title: '24pt',
    }),
  }),
  layout: Object.freeze({
    figureMaxWidth: '74%',
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
