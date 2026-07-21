/**
 * lib/diagram-export.mjs — distribution diagram styling for publish exports.
 *
 * Publish path renders compact notebook-ink diagrams: Mermaid handDrawn with
 * Caveat labels, tight spacing, and field-notebook palette (charcoal + slate-
 * teal accent). This is not the retired Construct sketch theater (loose spacing,
 * oversized Caveat, full-bleed figures). D2 uses light sketch strokes with dense
 * pad/scale. Interactive Excalidraw stays optional at the agent/tool layer.
 */

import fs from 'node:fs';
import os from 'node:os';
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

// Field-notebook diagram palette, mirroring construct-brand.typ so embedded
// diagrams and surrounding body share one design language.

const MONO = {
  ink: '#1a1d24',
  inkBody: '#2c313a',
  muted: '#545b66',
  faint: '#8b919a',
  hairline: '#d5d8dd',
  hairlineStrong: '#c0c5cc',
  surface: '#eef1f3',
  surfaceAlt: '#e3e7ea',
  paper: '#f7f8f9',
  accent: '#1f5c61',
  accentSoft: '#d8e6e7',
};

export const DISTRIBUTION_D2_THEME = D2_DISTRIBUTION_THEME_ID;
export const DISTRIBUTION_D2_PAD = D2_DISTRIBUTION_PAD;
export const DISTRIBUTION_D2_SCALE = D2_DISTRIBUTION_SCALE;
export const DISTRIBUTION_D2_SKETCH = '1';
export const DISTRIBUTION_D2_FONT_SIZE = D2_DISTRIBUTION_FONT_SIZE;
export const DISTRIBUTION_MERMAID_MIME = 'image/png';
export const DISTRIBUTION_D2_MIME = 'image/svg+xml';
export const DISTRIBUTION_MERMAID_WIDTH = '1600';
export const DISTRIBUTION_MERMAID_SCALE = '2';
export const DISTRIBUTION_FIGURE_MAX_WIDTH = '72%';

// Compact notebook ink: handwritten labels, tight spacing, accent on emphasis.

const MERMAID_FONT = 'Caveat, Segoe Print, Bradley Hand, cursive';

const MERMAID_INIT = `%%{init: {
  'theme': 'base',
  'look': 'handDrawn',
  'fontFamily': '${MERMAID_FONT}',
  'flowchart': {
    'htmlLabels': false,
    'nodeSpacing': 24,
    'rankSpacing': 28,
    'padding': 6,
    'curve': 'basis',
    'useMaxWidth': true
  },
  'sequence': {
    'actorMargin': 28,
    'messageMargin': 28,
    'boxMargin': 6,
    'useMaxWidth': true
  },
  'quadrantChart': {
    'chartWidth': 480,
    'chartHeight': 360,
    'pointLabelFontSize': 12,
    'pointRadius': 3
  },
  'themeVariables': {
    'fontFamily': '${MERMAID_FONT}',
    'fontSize': '14px',
    'primaryColor': '${MONO.accentSoft}',
    'primaryTextColor': '${MONO.ink}',
    'primaryBorderColor': '${MONO.accent}',
    'lineColor': '${MONO.muted}',
    'secondaryColor': '${MONO.paper}',
    'secondaryTextColor': '${MONO.ink}',
    'secondaryBorderColor': '${MONO.ink}',
    'tertiaryColor': '${MONO.surface}',
    'tertiaryTextColor': '${MONO.ink}',
    'tertiaryBorderColor': '${MONO.hairlineStrong}',
    'clusterBkg': '${MONO.surface}',
    'clusterBorder': '${MONO.accent}',
    'edgeLabelBackground': '${MONO.paper}',
    'titleColor': '${MONO.ink}',
    'noteBkgColor': '${MONO.accentSoft}',
    'noteTextColor': '${MONO.inkBody}',
    'noteBorderColor': '${MONO.accent}',
    'actorBkg': '${MONO.surfaceAlt}',
    'actorBorder': '${MONO.accent}',
    'actorTextColor': '${MONO.ink}',
    'actorLineColor': '${MONO.hairlineStrong}',
    'signalColor': '${MONO.inkBody}',
    'signalTextColor': '${MONO.inkBody}',
    'labelBoxBkgColor': '${MONO.surface}',
    'labelBoxBorderColor': '${MONO.accent}',
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

function listBrowserCacheDirs(cacheRoot) {
  try {
    return fs.readdirSync(cacheRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
}

function sortBrowserCacheEntries(entries) {
  return entries.slice().sort((a, b) => {
    const aHeadless = a.name.startsWith('chromium_headless_shell-') || a.name.startsWith('chrome-headless-shell-') ? 0 : 1;
    const bHeadless = b.name.startsWith('chromium_headless_shell-') || b.name.startsWith('chrome-headless-shell-') ? 0 : 1;
    if (aHeadless !== bHeadless) return aHeadless - bHeadless;
    const aVer = Number((a.name.match(/-(\d+)/) || [])[1] || 0);
    const bVer = Number((b.name.match(/-(\d+)/) || [])[1] || 0);
    return bVer - aVer;
  });
}

// Playwright caches under ~/Library/Caches on macOS and ~/.cache on Linux; Puppeteer
// uses ~/.cache/puppeteer. CI installs browsers into those trees — without Linux paths
// mmdc falls through to a dead azureedge driver download (404) and DOCX figures fail.

function playwrightChromeCandidates(home = process.env.HOME || '') {
  if (!home) return [];
  const cacheRoots = [
    path.join(home, 'Library', 'Caches', 'ms-playwright'),
    path.join(home, '.cache', 'ms-playwright'),
  ];
  const candidates = [];
  for (const cacheRoot of cacheRoots) {
    const entries = sortBrowserCacheEntries(listBrowserCacheDirs(cacheRoot));
    for (const entry of entries) {
      const base = path.join(cacheRoot, entry.name);
      if (entry.name.startsWith('chromium_headless_shell-') || entry.name.startsWith('chrome-headless-shell-')) {
        candidates.push(path.join(base, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
        candidates.push(path.join(base, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'));
        candidates.push(path.join(base, 'chrome-headless-shell-mac', 'chrome-headless-shell'));
      }
      if (entry.name.startsWith('chromium-')) {
        candidates.push(path.join(base, 'chrome-linux64', 'chrome'));
        candidates.push(path.join(base, 'chrome-linux', 'chrome'));
        candidates.push(path.join(base, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
        candidates.push(path.join(base, 'chrome-mac-arm64', 'chrome'));
        candidates.push(path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
        candidates.push(path.join(base, 'chrome-mac', 'chrome'));
      }
    }
  }
  return candidates;
}

function puppeteerChromeCandidates(home = process.env.HOME || '', env = process.env) {
  const cacheRoots = [
    env.PUPPETEER_CACHE_DIR,
    home ? path.join(home, '.cache', 'puppeteer') : null,
    home ? path.join(home, '.local', 'mermaid-cli', 'puppeteer-cache') : null,
  ].filter(Boolean);
  const candidates = [];
  for (const cacheRoot of cacheRoots) {
    const chromeRoot = path.join(cacheRoot, 'chrome');
    const entries = sortBrowserCacheEntries(listBrowserCacheDirs(chromeRoot));
    for (const entry of entries) {
      const base = path.join(chromeRoot, entry.name);
      candidates.push(path.join(base, 'chrome-linux64', 'chrome'));
      candidates.push(path.join(base, 'chrome-linux', 'chrome'));
      candidates.push(path.join(base, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
      candidates.push(path.join(base, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
    }
  }
  return candidates;
}

function chromeCandidates(env = process.env) {
  return [
    ...puppeteerChromeCandidates(env.HOME, env),
    ...playwrightChromeCandidates(env.HOME),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
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

function readMermaidPuppeteerBaseConfig() {
  if (!fs.existsSync(MERMAID_PPTR_CONFIG)) {
    return {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-mock-keychain'],
    };
  }
  try {
    return JSON.parse(fs.readFileSync(MERMAID_PPTR_CONFIG, 'utf8'));
  } catch {
    return {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-mock-keychain'],
    };
  }
}

export function buildDistributionDiagramEnv(baseEnv = process.env) {
  const env = {
    ...baseEnv,
    CONSTRUCT_D2_THEME: DISTRIBUTION_D2_THEME,
    CONSTRUCT_D2_PAD: DISTRIBUTION_D2_PAD,
    CONSTRUCT_D2_SCALE: DISTRIBUTION_D2_SCALE,
    CONSTRUCT_D2_SKETCH: DISTRIBUTION_D2_SKETCH,
    CONSTRUCT_D2_MIME: DISTRIBUTION_D2_MIME,
    CONSTRUCT_MERMAID_THEME: 'construct',
    CONSTRUCT_MERMAID_MIME: DISTRIBUTION_MERMAID_MIME,
    CONSTRUCT_MERMAID_WIDTH: DISTRIBUTION_MERMAID_WIDTH,
    CONSTRUCT_MERMAID_SCALE: DISTRIBUTION_MERMAID_SCALE,
  };
  const chrome = puppeteerExecutableUsable(baseEnv) ? resolvePuppeteerExecutable(baseEnv) : null;
  if (chrome) {
    env.PUPPETEER_EXECUTABLE_PATH = chrome;

    // mmdc reads executablePath from --puppeteerConfigFile; env alone is not enough when
    // the bundled config only lists sandbox args. Merge the resolved Chrome path so Linux
    // CI does not fall through to a retired Playwright CDN download.

    const mergedPath = path.join(os.tmpdir(), `construct-mermaid-pptr-${process.pid}.json`);
    fs.writeFileSync(mergedPath, JSON.stringify({
      ...readMermaidPuppeteerBaseConfig(),
      executablePath: chrome,
    }));
    env.CONSTRUCT_MERMAID_PPTR_CONFIG = mergedPath;
  } else if (fs.existsSync(MERMAID_PPTR_CONFIG)) {
    env.CONSTRUCT_MERMAID_PPTR_CONFIG = MERMAID_PPTR_CONFIG;
  }
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
    accent: MONO.accent,
  };
}
