/**
 * lib/diagram-export.mjs — distribution diagram styling for publish exports.
 *
 * Publish path uses professional D2 neutral theme and branded Mermaid init blocks.
 * Sketch/hand-drawn themes are reserved for exploratory `construct diagram` only.
 */

import { BRAND } from './publish-template.mjs';

export const DISTRIBUTION_D2_THEME = '0';
export const DISTRIBUTION_D2_PAD = '8';

const MERMAID_INIT = `%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '${BRAND.surface}',
    'primaryTextColor': '${BRAND.navy}',
    'primaryBorderColor': '${BRAND.accent}',
    'lineColor': '${BRAND.accent}',
    'secondaryColor': '${BRAND.surfaceAlt}',
    'tertiaryColor': '#ffffff',
    'fontFamily': 'Helvetica Neue, Arial, sans-serif'
  }
}}%%`;

export function injectMermaidBrandTheme(code) {
  const body = String(code || '').trim();
  if (!body) return body;
  if (/%%\{init:/.test(body)) return body;
  return `${MERMAID_INIT}\n${body}\n`;
}

export function preprocessMarkdownDiagrams(content) {
  let out = String(content);
  out = out.replace(/```mermaid\n([\s\S]*?)```/g, (_match, inner) => `\`\`\`mermaid\n${injectMermaidBrandTheme(inner)}\`\`\``);
  return out;
}

export function buildDistributionDiagramEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    CONSTRUCT_D2_THEME: DISTRIBUTION_D2_THEME,
    CONSTRUCT_D2_PAD: DISTRIBUTION_D2_PAD,
    CONSTRUCT_MERMAID_THEME: 'construct',
  };
}

export function distributionDiagramDefaults() {
  return {
    d2Theme: 'neutral',
    d2ThemeId: DISTRIBUTION_D2_THEME,
    mermaidTheme: 'construct',
    accent: BRAND.accent,
  };
}
