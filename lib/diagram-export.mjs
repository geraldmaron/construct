/**
 * lib/diagram-export.mjs — distribution diagram styling for publish exports.
 *
 * Publish path uses D2 --sketch (hand-drawn geometry) plus Mermaid handDrawn look
 * with Construct violet accent tokens — Excalidraw-adjacent human styling.
 */

import fs from 'node:fs';
import { BRAND } from './publish-template.mjs';

export const DISTRIBUTION_D2_THEME = '0';
export const DISTRIBUTION_D2_PAD = '12';
export const DISTRIBUTION_D2_SCALE = '0.9';
export const DISTRIBUTION_D2_SKETCH = '1';
export const DISTRIBUTION_D2_FONT_SIZE = '14';
export const DISTRIBUTION_MERMAID_MIME = 'image/png';
export const DISTRIBUTION_MERMAID_WIDTH = '680';
export const DISTRIBUTION_MERMAID_SCALE = '0.92';
export const DISTRIBUTION_FIGURE_MAX_WIDTH = '84%';

const MERMAID_INIT = `%%{init: {
  'look': 'handDrawn',
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '${BRAND.surface}',
    'primaryTextColor': '${BRAND.navy}',
    'primaryBorderColor': '${BRAND.accent}',
    'lineColor': '${BRAND.accent}',
    'secondaryColor': '${BRAND.surfaceAlt}',
    'tertiaryColor': '#ffffff',
    'fontFamily': 'Geist, Inter, Helvetica Neue, Arial, sans-serif'
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

export function injectD2DistributionDefaults(code) {
  const body = String(code || '').trim();
  if (!body) return body;
  if (/CONSTRUCT_D2_DEFAULTS/.test(body)) return body;
  return `*: {
  style.font-size: ${DISTRIBUTION_D2_FONT_SIZE}
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
    accent: BRAND.accent,
  };
}
