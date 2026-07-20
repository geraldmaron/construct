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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  D2_DISTRIBUTION_FONT_SIZE,
  D2_DISTRIBUTION_PAD,
  D2_DISTRIBUTION_SCALE,
  D2_DISTRIBUTION_THEME_ID,
  distributionD2Defaults,
} from './providers/d2.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = path.join(REPO_ROOT, 'templates', 'distribution', 'icons');
const MERMAID_PPTR_CONFIG = path.join(REPO_ROOT, 'templates', 'distribution', 'mermaid-puppeteer.json');
const browserUsabilityCache = new Map();

export const HEADLESS_BROWSER_PROBE_ARGS = [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--use-mock-keychain',
  '--dump-dom',
  'data:,construct',
];

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

export const DISTRIBUTION_D2_THEME = D2_DISTRIBUTION_THEME_ID;
export const DISTRIBUTION_D2_PAD = D2_DISTRIBUTION_PAD;
export const DISTRIBUTION_D2_SCALE = D2_DISTRIBUTION_SCALE;
export const DISTRIBUTION_D2_SKETCH = '1';
export const DISTRIBUTION_D2_FONT_SIZE = D2_DISTRIBUTION_FONT_SIZE;
export const DISTRIBUTION_MERMAID_MIME = 'image/png';
export const DISTRIBUTION_MERMAID_WIDTH = '2400';
export const DISTRIBUTION_MERMAID_SCALE = '2';
export const DISTRIBUTION_FIGURE_MAX_WIDTH = '92%';

// Handwritten font for Mermaid labels so its hand-drawn look matches D2 sketch
// mode. Caveat ships bundled (templates/distribution/fonts/handwritten) and is
// installed for the headless Chrome that mmdc drives; the fallbacks stay in the
// handwriting register so a missing face never drops to a serif.

const MERMAID_FONT = 'Caveat, Comic Sans MS, cursive';

const MERMAID_INIT = `%%{init: {
  'theme': 'base',
  'look': 'handDrawn',
  'fontFamily': '${MERMAID_FONT}',
  'flowchart': {
    'htmlLabels': false,
    'nodeSpacing': 46,
    'rankSpacing': 56,
    'padding': 12
  },
  'quadrantChart': {
    'chartWidth': 620,
    'chartHeight': 460,
    'pointLabelFontSize': 13,
    'pointRadius': 4
  },
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

function firstExistingPath(paths = []) {
  for (const candidate of paths) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* skip */
    }
  }
  return null;
}

function playwrightChromeCandidates(home = process.env.HOME || '') {
  if (!home) return [];
  const cacheRoot = path.join(home, 'Library', 'Caches', 'ms-playwright');
  let entries = [];
  try {
    entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  entries = entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => {
      const aHeadless = a.name.startsWith('chromium_headless_shell-') ? 0 : 1;
      const bHeadless = b.name.startsWith('chromium_headless_shell-') ? 0 : 1;
      if (aHeadless !== bHeadless) return aHeadless - bHeadless;
      const aVer = Number((a.name.match(/-(\d+)/) || [])[1] || 0);
      const bVer = Number((b.name.match(/-(\d+)/) || [])[1] || 0);
      return bVer - aVer;
    });
  const candidates = [];
  for (const entry of entries) {
    const base = path.join(cacheRoot, entry.name);
    if (entry.name.startsWith('chromium_headless_shell-')) {
      candidates.push(path.join(base, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'));
      candidates.push(path.join(base, 'chrome-headless-shell-mac', 'chrome-headless-shell'));
    }
    if (entry.name.startsWith('chromium-')) {
      candidates.push(path.join(base, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
      candidates.push(path.join(base, 'chrome-mac-arm64', 'chrome'));
      candidates.push(path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
      candidates.push(path.join(base, 'chrome-mac', 'chrome'));
    }
  }
  return candidates;
}

function chromeCandidates(env = process.env) {
  return [
    ...playwrightChromeCandidates(env.HOME),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

export function resolvePuppeteerExecutable(env = process.env) {
  if (env.PUPPETEER_EXECUTABLE_PATH) return env.PUPPETEER_EXECUTABLE_PATH;
  return firstExistingPath(chromeCandidates(env));
}

/**
 * Probe the selected browser once, suppressing browser diagnostics. A cached
 * Playwright shell can exist on disk but fail immediately under macOS sandbox
 * restrictions; treating that path as available makes every Mermaid render
 * retry the same doomed launch.
 */
export function puppeteerExecutableUsable(env = process.env) {
  const executable = resolvePuppeteerExecutable(env);
  if (!executable) return false;
  if (browserUsabilityCache.has(executable)) return browserUsabilityCache.get(executable);
  const result = spawnSync(executable, HEADLESS_BROWSER_PROBE_ARGS, {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 5000,
    env,
  });
  const usable = result.status === 0;
  browserUsabilityCache.set(executable, usable);
  return usable;
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
  if (fs.existsSync(MERMAID_PPTR_CONFIG)) env.CONSTRUCT_MERMAID_PPTR_CONFIG = MERMAID_PPTR_CONFIG;
  const chrome = puppeteerExecutableUsable(baseEnv) ? resolvePuppeteerExecutable(baseEnv) : null;
  if (chrome) env.PUPPETEER_EXECUTABLE_PATH = chrome;
  return env;
}

export function distributionDiagramDefaults() {
  return {
    ...distributionD2Defaults(),
    figureMaxWidth: DISTRIBUTION_FIGURE_MAX_WIDTH,
    mermaidLook: 'handDrawn',
    mermaidTheme: 'construct',
    mermaidWidth: Number(DISTRIBUTION_MERMAID_WIDTH),
    mermaidScale: Number(DISTRIBUTION_MERMAID_SCALE),
    accent: MONO.ink,
  };
}
