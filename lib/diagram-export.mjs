/**
 * lib/diagram-export.mjs — distribution diagram styling for publish exports.
 *
 * Publish path renders hand-drawn D2 (--sketch geometry) and Mermaid (handDrawn
 * look, Caveat handwriting) in a monochrome ink palette — black/grey strokes,
 * light surfaces, near-black text — for an Excalidraw-adjacent human aesthetic
 * that stays consistent with the document brand. Color is reserved for explicit
 * per-node emphasis in the source, not the default theme.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = path.join(REPO_ROOT, 'templates', 'distribution', 'icons');

// Monochrome diagram palette, mirroring the ink ramp in construct-brand.typ so
// embedded diagrams and surrounding body share one design language.

const MONO = {
  ink: '#0a0c10',
  inkBody: '#23272e',
  muted: '#565c66',
  faint: '#9499a2',
  hairline: '#e3e4e8',
  hairlineStrong: '#cdd0d6',
  surface: '#fafafa',
  surfaceAlt: '#f3f4f6',
  paper: '#ffffff',
};

export const DISTRIBUTION_D2_THEME = '0';
export const DISTRIBUTION_D2_PAD = '20';
export const DISTRIBUTION_D2_SCALE = '0.9';
export const DISTRIBUTION_D2_SKETCH = '1';
export const DISTRIBUTION_D2_FONT_SIZE = '15';
export const DISTRIBUTION_MERMAID_MIME = 'image/png';
export const DISTRIBUTION_MERMAID_WIDTH = '640';
export const DISTRIBUTION_MERMAID_SCALE = '2';
export const DISTRIBUTION_FIGURE_MAX_WIDTH = '74%';

// Handwritten font for Mermaid labels so its hand-drawn look matches D2 sketch
// mode. Caveat ships bundled (templates/distribution/fonts/handwritten) and is
// installed for the headless Chrome that mmdc drives; the fallbacks stay in the
// handwriting register so a missing face never drops to a serif.

const MERMAID_FONT = 'Caveat, Comic Sans MS, cursive';

const MERMAID_INIT = `%%{init: {
  'theme': 'base',
  'look': 'handDrawn',
  'fontFamily': '${MERMAID_FONT}',
  'themeVariables': {
    'fontFamily': '${MERMAID_FONT}',
    'fontSize': '19px',
    'primaryColor': '${MONO.surfaceAlt}',
    'primaryTextColor': '${MONO.ink}',
    'primaryBorderColor': '${MONO.ink}',
    'lineColor': '${MONO.muted}',
    'secondaryColor': '${MONO.paper}',
    'secondaryTextColor': '${MONO.ink}',
    'secondaryBorderColor': '${MONO.ink}',
    'tertiaryColor': '${MONO.surface}',
    'tertiaryTextColor': '${MONO.ink}',
    'tertiaryBorderColor': '${MONO.hairlineStrong}',
    'clusterBkg': '${MONO.surface}',
    'clusterBorder': '${MONO.hairlineStrong}',
    'edgeLabelBackground': '${MONO.paper}',
    'titleColor': '${MONO.ink}',
    'noteBkgColor': '${MONO.surface}',
    'noteTextColor': '${MONO.inkBody}',
    'noteBorderColor': '${MONO.hairlineStrong}',
    'actorBkg': '${MONO.surfaceAlt}',
    'actorBorder': '${MONO.ink}',
    'actorTextColor': '${MONO.ink}',
    'actorLineColor': '${MONO.hairlineStrong}',
    'signalColor': '${MONO.inkBody}',
    'signalTextColor': '${MONO.inkBody}',
    'labelBoxBkgColor': '${MONO.surface}',
    'labelBoxBorderColor': '${MONO.hairlineStrong}',
    'labelTextColor': '${MONO.ink}',
    'loopTextColor': '${MONO.inkBody}',
    'activationBkgColor': '${MONO.hairline}',
    'activationBorderColor': '${MONO.muted}'
  }
}}%%`;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function resolvePuppeteerExecutable(env = process.env) {
  if (env.PUPPETEER_EXECUTABLE_PATH) return env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* skip */
    }
  }
  return null;
}

export function injectMermaidBrandTheme(code) {
  const body = String(code || '').trim();
  if (!body) return body;
  if (/%%\{init:/.test(body)) return body;
  return `${MERMAID_INIT}\n${body}\n`;
}

// `icon: @name` in a d2 block resolves to the bundled monochrome Lucide icon at
// templates/distribution/icons/name.svg, keeping source markdown portable while
// d2 (which runs in a temp dir) still receives an absolute path it can read.

export function resolveIconTokens(code) {
  return String(code || '').replace(
    /icon:\s*@([a-z0-9-]+)/gi,
    (match, name) => {
      const file = path.join(ICON_DIR, `${name}.svg`);
      return fs.existsSync(file) ? `icon: ${file}` : match;
    },
  );
}

export function injectD2DistributionDefaults(code) {
  const body = resolveIconTokens(String(code || '').trim());
  if (!body) return body;
  if (/CONSTRUCT_D2_DEFAULTS/.test(body)) return body;
  return `**: {
  style.font-size: ${DISTRIBUTION_D2_FONT_SIZE}
  style.font-color: "${MONO.ink}"
  style.stroke: "${MONO.ink}"
  style.fill: "${MONO.surfaceAlt}"
}
(** -> **)[*]: {
  style.stroke: "${MONO.muted}"
  style.font-color: "${MONO.inkBody}"
}

${body}
`;
}

export function preprocessMarkdownDiagrams(content) {
  let out = String(content);
  out = out.replace(/```mermaid\n([\s\S]*?)```/g, (_match, inner) => `\`\`\`mermaid\n${injectMermaidBrandTheme(inner)}\`\`\``);
  out = out.replace(/```d2\n([\s\S]*?)```/g, (_match, inner) => `\`\`\`d2\n${injectD2DistributionDefaults(inner)}\`\`\``);
  return out;
}

export function countDiagramFences(content) {
  const matches = String(content || '').match(/```(?:d2|mermaid)\n/g);
  return matches ? matches.length : 0;
}

export function buildDistributionDiagramEnv(baseEnv = process.env) {
  const env = {
    ...baseEnv,
    CONSTRUCT_D2_THEME: DISTRIBUTION_D2_THEME,
    CONSTRUCT_D2_PAD: DISTRIBUTION_D2_PAD,
    CONSTRUCT_D2_SCALE: DISTRIBUTION_D2_SCALE,
    CONSTRUCT_D2_SKETCH: DISTRIBUTION_D2_SKETCH,
    CONSTRUCT_MERMAID_THEME: 'construct',
    CONSTRUCT_MERMAID_MIME: DISTRIBUTION_MERMAID_MIME,
    CONSTRUCT_MERMAID_WIDTH: DISTRIBUTION_MERMAID_WIDTH,
    CONSTRUCT_MERMAID_SCALE: DISTRIBUTION_MERMAID_SCALE,
  };
  const chrome = resolvePuppeteerExecutable(baseEnv);
  if (chrome) env.PUPPETEER_EXECUTABLE_PATH = chrome;
  return env;
}

export function distributionDiagramDefaults() {
  return {
    d2Theme: 'neutral',
    d2ThemeId: DISTRIBUTION_D2_THEME,
    d2Sketch: true,
    d2Scale: Number(DISTRIBUTION_D2_SCALE),
    d2FontSize: Number(DISTRIBUTION_D2_FONT_SIZE),
    figureMaxWidth: DISTRIBUTION_FIGURE_MAX_WIDTH,
    mermaidLook: 'handDrawn',
    mermaidTheme: 'construct',
    mermaidWidth: Number(DISTRIBUTION_MERMAID_WIDTH),
    mermaidScale: Number(DISTRIBUTION_MERMAID_SCALE),
    accent: MONO.ink,
  };
}
