/**
 * lib/deck-export-pptx.mjs — markdown slide deck → branded PPTX via pptxgenjs.
 *
 * Parses slides (---), tables, lists, and inline bold into a 16:9 deck with
 * Construct ink chrome: title band, heading rules, callout cards, styled tables,
 * and footer bar matching templates/distribution/construct-deck.html.
 */

import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { BRAND_TOKENS, INK } from './brand-tokens.mjs';
import { createPptxGenerator, embedBundledSansInPptx, embedBundledMonoInPptx, BRAND_SANS_FAMILY } from './brand-fonts.mjs';
import { parseArtifactMetadata } from './publish-template.mjs';
import { injectMermaidBrandTheme, injectD2DistributionDefaults, buildDistributionDiagramEnv } from './diagram-export.mjs';

const require = createRequire(import.meta.url);
const MODULE_URL = pathToFileURL(fileURLToPath(import.meta.url)).href;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EMU_PER_IN = 914400;

const W = 10;
const H = 5.625;
const MX = 0.54;
const MY = 0.41;
const CW = W - MX * 2;
const FOOT_BAR_H = 0.045;
const FOOT_Y = H - FOOT_BAR_H - 0.34;
const CONTENT_TOP = 1.02;
const CONTENT_MAX_Y = FOOT_Y - 0.1;
const SAFE_RIGHT = W - MX;
export const SLIDE_CONTENT_BUDGET_IN = CONTENT_MAX_Y - CONTENT_TOP;
export const SLIDE_W_IN = W;
export const SLIDE_H_IN = H;

const CARD_GAP = 0.04;
const CARD_PAD = 0.11;
const CARD_INK_BAR = 0.045;
const CARD_BADGE_W = 0.22;
const CARD_MIN_H = 0.28;

function ptSize(token) {
  return parseFloat(String(token || '').replace('pt', '')) || 10;
}

const T = Object.freeze({
  micro: ptSize(BRAND_TOKENS.typography.size.micro),
  small: ptSize(BRAND_TOKENS.typography.size.small),
  meta: ptSize(BRAND_TOKENS.typography.size.meta),
  body: ptSize(BRAND_TOKENS.typography.size.body),
  h3: ptSize(BRAND_TOKENS.typography.size.h3),
  h2: ptSize(BRAND_TOKENS.typography.size.h2),
  h1: ptSize(BRAND_TOKENS.typography.size.h1),
  subtitle: ptSize(BRAND_TOKENS.typography.size.subtitle),
  deckTitle: 26,
  slideTitle: 20,
});

const INK_RAMP_STOPS = [
  INK.ink,
  INK.inkStrong,
  INK.muted,
  INK.faint,
  INK.hairline,
  INK.surface,
];

function stripInlineMarkdown(text) {
  return String(text || '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

function cellPlainLength(cell) {
  return stripInlineMarkdown(cell).length;
}

function charsPerInchAtFont(fontSize, mono = false) {
  const factor = mono ? 0.52 : 0.68;
  return Math.max(6, Math.floor(fontSize * factor));
}

function itemUsesMono(text) {
  return /`[^`]+`/.test(String(text || ''));
}

// One wrapped line occupies the leading that addWrappedText actually applies:
// lineSpacing = fontSize * 1.45 pt, i.e. fontSize * 1.45 / 72 inches. The prior
// 0.038x + 0.065 over-allocated ~2x, inflating table rows and text boxes until
// content bled past the footer band.

function lineHeightIn(fontSize) {
  return (fontSize * 1.45) / 72;
}

function clampBox(x, y, w, h, { minW = 0.4, minH = 0.14 } = {}) {
  const cx = Math.max(MX, x);
  let cw = w;
  if (cx + cw > SAFE_RIGHT) cw = SAFE_RIGHT - cx;
  cw = Math.max(minW, cw);
  let ch = h;
  if (y + ch > CONTENT_MAX_Y) ch = CONTENT_MAX_Y - y;
  ch = Math.max(minH, ch);
  return { x: cx, y, w: cw, h: ch };
}

function textBoxHeight(text, widthIn, fontSize, padding = 0.12) {
  const mono = itemUsesMono(text);
  const lines = wrappedLineCount(text, widthIn, fontSize, mono);
  return (padding + lines * lineHeightIn(fontSize)) * 1.2;
}

function wrappedLineCount(text, colWidthIn, fontSize, mono = itemUsesMono(text)) {
  const plain = stripInlineMarkdown(text);
  if (!plain) return 1;
  const cpi = charsPerInchAtFont(fontSize, mono);
  const charsPerLine = Math.max(8, Math.floor(colWidthIn * cpi));
  return Math.max(1, Math.ceil(plain.length / charsPerLine));
}

function listTextWidth(layout, block) {
  const numberedInset = block.type === 'number' ? CARD_BADGE_W + 0.18 : 0;
  return layout.w - CARD_INK_BAR - CARD_PAD - numberedInset - 0.1;
}

function cardHeightForItem(item, layout, block, fontSize = T.body) {
  const textW = listTextWidth(layout, block);
  return Math.max(CARD_MIN_H, textBoxHeight(item, textW, fontSize, 0.12));
}

function contentRegionForTitle(title) {
  return { x: MX, w: CW, mode: slideVisualMode(title) };
}

function textShapeOpts(extra = {}) {
  return {
    wrap: true,
    fit: 'shrink',
    valign: 'top',
    inset: 0.06,
    ...extra,
  };
}

function addWrappedText(slide, text, box, fontSize, extra = {}) {
  const plain = stripInlineMarkdown(text);
  const sized = clampBox(box.x, box.y, box.w, box.h);
  slide.addText(plain, {
    ...sized,
    ...textDefaults({ fontSize, ...extra }),
    ...textShapeOpts(),
    lineSpacing: Math.round(fontSize * 1.45),
  });
}

function tableFontSize(headers, rows) {
  const maxLen = Math.max(
    0,
    ...headers.map(cellPlainLength),
    ...rows.flat().map(cellPlainLength),
  );
  if (maxLen > 72) return 9;
  if (maxLen > 48) return 10;
  if (maxLen > 32) return 10;
  return 11;
}

function computeTableColWidths(headers, rows) {
  const colCount = headers.length;
  if (colCount === 0) return [];
  if (colCount === 1) return [CW];

  const maxLens = Array.from({ length: colCount }, (_, ci) => Math.max(
    cellPlainLength(headers[ci] || ''),
    ...rows.map((row) => cellPlainLength(row[ci] || '')),
  ));

  if (colCount === 2) {
    const total = maxLens[0] + maxLens[1] || 1;
    const leftRatio = Math.max(0.18, Math.min(0.34, maxLens[0] / total));
    return [CW * leftRatio, CW * (1 - leftRatio)];
  }

  const sum = maxLens.reduce((a, b) => a + b, 0) || colCount;
  return maxLens.map((len) => CW * Math.max(0.12, len / sum));
}

// Single source of truth for row heights so the pre-export audit and the render
// agree. headerFont mirrors addTableBlock (one point smaller, floored at 9).

function tableRowHeights(block, colW, headerFont, bodyFont) {
  const heights = [
    Math.max(0.32, ...block.headers.map((cell, ci) => textBoxHeight(cell, (colW[ci] || CW) - 0.12, headerFont, 0.1))),
  ];
  for (const row of block.rows) {
    let rh = 0.3;
    row.forEach((cell, ci) => {
      rh = Math.max(rh, textBoxHeight(cell, (colW[ci] || CW) - 0.12, bodyFont, 0.1));
    });
    heights.push(rh);
  }
  return heights;
}

function estimateTableHeight(block, colW, fontSize) {
  const headerFont = Math.max(9, fontSize - 1);
  const rowHeights = tableRowHeights(block, colW, headerFont, fontSize);
  return rowHeights.reduce((sum, h) => sum + h, 0) + 0.1;
}

function estimateListHeight(block, layout) {
  const fontSize = T.body;
  let total = 0;
  for (const item of block.items) {
    total += cardHeightForItem(item, layout, block, fontSize) + CARD_GAP;
  }
  return total;
}

function estimateBlockHeight(block, layout = { w: CW }) {
  if (block.type === 'heading') return 0;
  if (block.type === 'diagram') return 2.6;
  if (block.type === 'code') {
    const lineCount = String(block.code || '').split('\n').length;
    return Math.min(3.0, 0.2 + lineCount * lineHeightIn(T.small) * 1.1);
  }
  if (block.type === 'text') {
    const len = cellPlainLength(block.text);
    const fontSize = len > 140 ? T.small : T.body;
    return Math.min(2.2, textBoxHeight(block.text, layout.w, fontSize, 0.1));
  }
  if (block.type === 'bullet' || block.type === 'number') {
    return Math.min(4.5, estimateListHeight(block, layout));
  }
  if (block.type === 'table') {
    const colWidths = computeTableColWidths(block.headers, block.rows);
    const fontSize = tableFontSize(block.headers, block.rows);
    return estimateTableHeight(block, colWidths, fontSize) + 0.16;
  }
  return 0;
}

/**
 * Pre-export layout audit: estimates vertical budget and horizontal wrap risk per slide.
 * Returns structured issues so tests and export can fail closed before shipping bleed.
 */
export function auditDeckMarkdownLayout(markdown, metadata = {}) {
  const allChunks = splitSlides(String(markdown || ''));
  if (allChunks.length === 0) {
    return { ok: false, issues: [{ slide: 0, code: 'no_slides', detail: 'no slide chunks found' }], slides: [] };
  }

  let contentChunks = allChunks;
  if (isTitleOnlyChunk(allChunks[0], metadata)) {
    contentChunks = allChunks.slice(1);
  }

  const issues = [];
  const slides = contentChunks.map((chunk, index) => {
    const slideIndex = index + 2;
    const blocks = slideBlocks(chunk);
    const titleBlock = blocks.find((b) => b.type === 'heading');
    const layout = contentRegionForTitle(titleBlock?.text || '');
    let y = 0;
    const slideIssues = [];

    for (const block of blocks) {
      if (block === titleBlock || block.type === 'heading') continue;

      if (block.type === 'table') {
        const colW = computeTableColWidths(block.headers, block.rows);
        const fontSize = tableFontSize(block.headers, block.rows);
        block.rows.forEach((row, ri) => {
          row.forEach((cell, ci) => {
            const lines = wrappedLineCount(cell, colW[ci], fontSize);
            if (lines > 5) {
              slideIssues.push({
                code: 'table_cell_wrap_excess',
                detail: `row ${ri + 1} col ${ci + 1} needs ${lines} lines at ${fontSize}pt`,
              });
            }
          });
        });
      }

      if (block.type === 'text' && cellPlainLength(block.text) > 200) {
        slideIssues.push({
          code: 'text_dense',
          detail: `paragraph length ${cellPlainLength(block.text)} may need a slimmer slide or continuation`,
        });
      }

      y += estimateBlockHeight(block, layout);
    }

    if (layout.mode === 'ink-panel') {
      const panelBottom = 0.28 + 0.05 + 0.18 + 0.38 + 0.72;
      if (panelBottom > SLIDE_CONTENT_BUDGET_IN * 0.55) {
        slideIssues.push({
          code: 'panel_tall',
          detail: 'ink panel competes with stacked list content',
        });
      }
    }

    if (y > SLIDE_CONTENT_BUDGET_IN + 0.02) {
      slideIssues.push({
        code: 'vertical_overflow',
        detail: `estimated ${y.toFixed(2)}in > budget ${SLIDE_CONTENT_BUDGET_IN.toFixed(2)}in`,
      });
    }

    for (const issue of slideIssues) issues.push({ slide: slideIndex, ...issue });
    return { slideIndex, estimatedHeightIn: Number(y.toFixed(3)), issues: slideIssues };
  });

  return { ok: issues.length === 0, issues, slides };
}

/**
 * Post-export PPTX bounds audit: inspects text/table shape boxes in the content band.
 */
export function readPptxSlideSizeIn(pptxPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-size-'));
  try {
    execSync(`unzip -q ${JSON.stringify(pptxPath)} -d ${JSON.stringify(tmp)}`);
    const pres = fs.readFileSync(path.join(tmp, 'ppt/presentation.xml'), 'utf8');
    const m = pres.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
    if (!m) return { w: W, h: H };
    return { w: +m[1] / EMU_PER_IN, h: +m[2] / EMU_PER_IN };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function auditPptxFile(pptxPath) {
  const { w: slideW, h: slideH } = readPptxSlideSizeIn(pptxPath);
  const safeRight = (slideW - MX) * EMU_PER_IN;
  const contentTop = CONTENT_TOP * EMU_PER_IN;
  const contentMax = CONTENT_MAX_Y * EMU_PER_IN;
  const footerTop = FOOT_Y * EMU_PER_IN;
  const bandPad = 0.02 * EMU_PER_IN;
  const tol = 0.03 * EMU_PER_IN;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-audit-'));
  const issues = [];

  if (Math.abs(slideW - W) > 0.02 || Math.abs(slideH - H) > 0.02) {
    issues.push({
      slide: 0,
      code: 'slide_size_mismatch',
      detail: `expected ${W}x${H}, got ${slideW.toFixed(3)}x${slideH.toFixed(3)}`,
    });
  }

  try {
    execSync(`unzip -q ${JSON.stringify(pptxPath)} -d ${JSON.stringify(tmp)}`);
    const slideDir = path.join(tmp, 'ppt/slides');
    const slideFiles = fs.readdirSync(slideDir).filter((f) => /^slide\d+\.xml$/.test(f));

    for (const file of slideFiles) {
      const slideNum = +file.match(/\d+/)[0];
      const xml = fs.readFileSync(path.join(slideDir, file), 'utf8');
      if (xml.includes('[object Object]')) {
        issues.push({ slide: slideNum, code: 'unresolved_rich_text', detail: file });
      }
      if (xml.includes('<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">')) {
        issues.push({ slide: slideNum, code: 'native_table', detail: 'pptxgen tables lack cell wrap' });
      }

      // Scan every shape box, not a pptxgen-specific name. Header band (title,
      // accents, heading rule) and footer chrome sit outside the content band and
      // are skipped; anything else whose right/bottom exceeds the safe area is bleed.

      const shapeRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
      let m;
      while ((m = shapeRe.exec(xml))) {
        const inner = m[1];
        const off = inner.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
        if (!off) continue;
        const x = +off[1];
        const y = +off[2];
        const right = x + +off[3];
        const bottom = y + +off[4];
        if (y < contentTop - bandPad || y > footerTop - bandPad) continue;
        if (x < MX * EMU_PER_IN - bandPad) continue;
        const textMatch = inner.match(/<a:t>([^<]*)<\/a:t>/);
        const label = (textMatch ? textMatch[1] : 'shape').slice(0, 24) || 'shape';
        if (right > safeRight + tol) {
          issues.push({ slide: slideNum, code: 'horizontal_overflow', detail: `"${label}" right=${(right / EMU_PER_IN).toFixed(3)}in (max ${(slideW - MX).toFixed(3)})` });
        }
        if (bottom > contentMax + tol) {
          issues.push({ slide: slideNum, code: 'vertical_overflow', detail: `"${label}" bottom=${(bottom / EMU_PER_IN).toFixed(3)}in (max ${CONTENT_MAX_Y.toFixed(3)})` });
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return { ok: issues.length === 0, issues };
}

function loadPptxGen() {
  try {
    require('pptxgenjs');
    return true;
  } catch {
    return false;
  }
}

export function pptxgenPresent() {
  return loadPptxGen();
}

function hex(hexColor) {
  return String(hexColor || '').replace(/^#/, '');
}

// A level-1 `# ` heading starts a new slide (pandoc slide-level 1, matching the HTML
// deck template), as do explicit `---` / `****` rules. Boundaries inside fenced code are
// ignored so a `#` comment in a d2 block or a `---` in a snippet never splits a slide.

function splitSlides(markdown) {
  let body = String(markdown || '');
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4);
  }

  const parts = [];
  let current = [];
  let inFence = false;
  const flush = () => {
    if (current.some((line) => line.trim())) parts.push(current.join('\n'));
    current = [];
  };
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && /^#\s+\S/.test(line)) {
      flush();
      current.push(line);
      continue;
    }
    if (!inFence && /^(?:---|\*\*\*\*)\s*$/.test(line)) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return parts.map((chunk) => chunk.trim()).filter(Boolean);
}

function parseInlineRuns(text, base = {}) {
  const runs = [];
  const src = String(text || '');
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) {
      runs.push({ text: src.slice(last, m.index), options: { ...base } });
    }
    const token = m[0];
    if (token.startsWith('**')) {
      runs.push({
        text: token.slice(2, -2),
        options: { ...base, bold: true, color: hex(BRAND_TOKENS.ink.default) },
      });
    } else {
      runs.push({
        text: token.slice(1, -1),
        options: {
          ...base,
          fontFace: BRAND_TOKENS.typography.fontMono,
          color: hex(BRAND_TOKENS.ink.strong),
        },
      });
    }
    last = m.index + token.length;
  }
  if (last < src.length) runs.push({ text: src.slice(last), options: { ...base } });
  if (runs.length === 0) runs.push({ text: stripInlineMarkdown(src), options: { ...base } });
  return runs;
}

function isTableLine(line) {
  return /^\|.+\|$/.test(line.trim());
}

function isTableSeparator(line) {
  return /^\|[-:\s|]+\|$/.test(line.trim());
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function slideBlocks(chunk) {
  const lines = chunk.split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  let i = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'text', text: para.join(' ') });
      para = [];
    }
  };

  const flushList = () => {
    if (list?.items.length) blocks.push(list);
    list = null;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      flushPara();
      flushList();
      const lang = fence[1].toLowerCase();
      i += 1;
      const code = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i].trimEnd())) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      const body = code.join('\n');
      if (lang === 'mermaid' || lang === 'd2') {
        blocks.push({ type: 'diagram', lang, code: body });
      } else {
        blocks.push({ type: 'code', lang, code: body });
      }
      continue;
    }

    if (isTableLine(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      flushList();
      const headers = parseTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableLine(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)/);
    const numbered = line.match(/^\d+\.\s+(.+)/);
    const heading = line.match(/^(#{1,3})\s+(.+)/);

    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: 'heading', level: heading[1].length, text: stripInlineMarkdown(heading[2]) });
      i += 1;
      continue;
    }
    if (bullet) {
      flushPara();
      if (!list || list.type !== 'bullet') {
        flushList();
        list = { type: 'bullet', items: [] };
      }
      list.items.push(bullet[1]);
      i += 1;
      continue;
    }
    if (numbered) {
      flushPara();
      if (!list || list.type !== 'number') {
        flushList();
        list = { type: 'number', items: [] };
      }
      list.items.push(numbered[1]);
      i += 1;
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      flushList();
      i += 1;
      continue;
    }
    flushList();
    para.push(line.trim());
    i += 1;
  }
  flushPara();
  flushList();
  return blocks;
}

export function isTitleOnlyChunk(chunk, metadata = {}) {
  const blocks = slideBlocks(chunk);
  const headings = blocks.filter((b) => b.type === 'heading');
  if (headings.some((h) => h.level > 1)) return false;
  if (blocks.some((b) => b.type === 'bullet' || b.type === 'number' || b.type === 'table')) return false;
  const h1 = headings.find((h) => h.level === 1);
  if (!h1) return false;
  if (metadata.title && h1.text.toLowerCase() !== metadata.title.toLowerCase()) return false;
  return true;
}

function textDefaults(opts = {}) {
  return {
    fontFace: BRAND_TOKENS.typography.fontSans,
    color: hex(opts.color || BRAND_TOKENS.ink.body),
    fontSize: opts.fontSize ?? T.body,
    bold: Boolean(opts.bold),
    italic: Boolean(opts.italic),
  };
}

function slideVisualMode(title) {
  const lower = String(title || '').toLowerCase();
  if (lower.includes('branded')) return 'ink-panel';
  if (lower.includes('what construct')) return 'feature-grid';
  return 'default';
}

function addSlideAccent(slide) {
  INK_RAMP_STOPS.slice(0, 4).forEach((color, i) => {
    const size = 0.08;
    const x = SAFE_RIGHT - size - i * 0.11;
    slide.addShape('rect', {
      x,
      y: MY + 0.04,
      w: size,
      h: size,
      fill: { color: hex(color) },
      line: { color: hex(color), width: 0 },
    });
  });
}

function addInkRampVisual(slide, x, y, w, h) {
  const box = clampBox(x, y, w, h);
  const segW = box.w / INK_RAMP_STOPS.length;
  INK_RAMP_STOPS.forEach((color, i) => {
    slide.addShape('rect', {
      x: box.x + i * segW,
      y: box.y,
      w: segW,
      h: box.h,
      fill: { color: hex(color) },
      line: { color: hex(color), width: 0 },
    });
  });
  const label = clampBox(box.x, box.y + box.h + 0.04, box.w, 0.16);
  slide.addText('INK RAMP', {
    ...label,
    ...textDefaults({ color: BRAND_TOKENS.ink.faint, fontSize: T.micro, bold: true }),
    charSpacing: 1.2,
  });
}

function addTypographyPanel(slide, pptx, x, y, w) {
  const box = clampBox(x, y, w, 0.68);
  slide.addShape(pptx.shapes.RECTANGLE, {
    ...box,
    fill: { color: hex(BRAND_TOKENS.surface.alt) },
    line: { color: hex(BRAND_TOKENS.line.hairline), width: 0.75 },
    rectRadius: 0.05,
  });
  slide.addText('Aa', {
    x: box.x + 0.12,
    y: box.y + 0.08,
    w: 0.42,
    h: 0.3,
    ...textDefaults({ color: BRAND_TOKENS.ink.default, fontSize: 18, bold: true }),
  });
  slide.addText(BRAND_TOKENS.typography.fontSans, {
    x: box.x + 0.5,
    y: box.y + 0.1,
    w: box.w - 0.58,
    h: 0.2,
    ...textDefaults({ color: BRAND_TOKENS.ink.strong, fontSize: T.small, bold: true }),
    wrap: true,
    fit: 'shrink',
  });
  slide.addText('const brand = tokens.ink;', {
    x: box.x + 0.12,
    y: box.y + 0.38,
    w: box.w - 0.2,
    h: 0.22,
    fontFace: BRAND_TOKENS.typography.fontMono,
    color: hex(BRAND_TOKENS.ink.muted),
    fontSize: T.small,
    wrap: true,
    fit: 'shrink',
  });
  return box.y + box.h;
}

function addSlideChrome(slide, pptx, { slideIndex, totalSlides, title = '' }) {
  slide.background = { color: hex(BRAND_TOKENS.surface.paper) };

  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: H - FOOT_BAR_H,
    w: 0.42,
    h: FOOT_BAR_H,
    fill: { color: hex(BRAND_TOKENS.ink.default) },
    line: { color: hex(BRAND_TOKENS.ink.default), width: 0 },
  });
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0.42,
    y: H - FOOT_BAR_H,
    w: W - 0.42,
    h: FOOT_BAR_H,
    fill: { color: hex(BRAND_TOKENS.line.hairline) },
    line: { color: hex(BRAND_TOKENS.line.hairline), width: 0 },
  });

  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 0.06,
    h: H - FOOT_BAR_H,
    fill: { color: hex(BRAND_TOKENS.surface.alt) },
    line: { color: hex(BRAND_TOKENS.surface.alt), width: 0 },
  });

  slide.addText('Construct', {
    x: MX,
    y: FOOT_Y,
    w: 1.6,
    h: 0.28,
    ...textDefaults({ color: BRAND_TOKENS.ink.default, fontSize: 10, bold: true }),
  });

  if (title) {
    const footTitle = title.length > 34 ? `${title.slice(0, 32)}…` : title;
    slide.addText(footTitle, {
      x: MX + 1.5,
      y: FOOT_Y,
      w: CW - 2.4,
      h: 0.28,
      ...textDefaults({ color: BRAND_TOKENS.ink.faint, fontSize: 9 }),
      align: 'left',
      ...textShapeOpts(),
    });
  }

  slide.addText(`${slideIndex} / ${totalSlides}`, {
    x: W - MX - 0.9,
    y: FOOT_Y,
    w: 0.9,
    h: 0.28,
    align: 'right',
    ...textDefaults({ color: BRAND_TOKENS.ink.faint, fontSize: 9 }),
  });
}

function addTitleSlide(pptx, metadata = {}, totalSlides) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, pptx, { slideIndex: 1, totalSlides, title: metadata.title || '' });

  slide.addShape(pptx.shapes.RECTANGLE, {
    x: MX,
    y: 0.86,
    w: CW * 0.42,
    h: 0.035,
    fill: { color: hex(BRAND_TOKENS.ink.default) },
    line: { color: hex(BRAND_TOKENS.ink.default), width: 0 },
  });

  const chips = [
    metadata.artifactType,
    metadata.docId,
    metadata.version ? `v${metadata.version}` : '',
  ].filter(Boolean);

  let y = 1.0;
  if (chips.length) {
    slide.addText(chips.join('  ·  ').toUpperCase(), {
      x: MX,
      y,
      w: CW,
      h: 0.28,
      ...textDefaults({ color: BRAND_TOKENS.ink.muted, fontSize: 11, bold: true }),
      charSpacing: 1.5,
    });
    y += 0.34;
  }

  slide.addText(metadata.title || 'Untitled', {
    x: MX,
    y: 1.52,
    w: CW,
    h: 0.82,
    ...textDefaults({ color: BRAND_TOKENS.ink.default, fontSize: T.deckTitle, bold: true }),
    valign: 'top',
  });

  if (metadata.subtitle) {
    slide.addText(metadata.subtitle, {
      x: MX,
      y: 2.38,
      w: CW * 0.82,
      h: 0.5,
      ...textDefaults({ color: BRAND_TOKENS.ink.muted, fontSize: T.subtitle }),
      valign: 'top',
    });
  }

  const byline = [metadata.owner, metadata.date, metadata.status].filter(Boolean).join('  ·  ');
  if (byline) {
    const chipW = Math.min(CW * 0.72, byline.length * 0.07 + 0.4);
    const chip = clampBox(MX, 3.02, chipW, 0.3);
    slide.addShape(pptx.shapes.RECTANGLE, {
      ...chip,
      fill: { color: hex(BRAND_TOKENS.surface.alt) },
      line: { color: hex(BRAND_TOKENS.line.hairline), width: 0.75 },
      rectRadius: 0.06,
    });
    slide.addText(byline, {
      x: chip.x + 0.14,
      y: chip.y + 0.06,
      w: chip.w - 0.22,
      h: chip.h - 0.1,
      ...textDefaults({ color: BRAND_TOKENS.ink.muted, fontSize: T.meta }),
      wrap: true,
      fit: 'shrink',
    });
  }

  INK_RAMP_STOPS.forEach((color, i) => {
    const size = Math.max(0.12, 0.34 - i * 0.05);
    const x = SAFE_RIGHT - size - i * 0.08;
    slide.addShape('rect', {
      x,
      y: 0.9 + i * 0.025,
      w: size,
      h: size,
      fill: { color: hex(color) },
      line: { color: hex(color), width: 0 },
    });
  });
}

function addHeadingRule(slide, y) {
  slide.addShape('rect', {
    x: MX,
    y,
    w: 0.48,
    h: 0.045,
    fill: { color: hex(BRAND_TOKENS.ink.default) },
    line: { color: hex(BRAND_TOKENS.ink.default), width: 0 },
  });
}

function fontSizeForItem(item) {
  const len = cellPlainLength(item);
  if (itemUsesMono(item) && len > 42) return T.small;
  if (len > 90) return T.small;
  return T.body;
}

function addCallout(slide, pptx, text, y, layout = {}) {
  const { x = MX, w = CW } = layout;
  const fontSize = T.h3;
  const innerW = w - 0.34;
  const h = Math.min(1.35, textBoxHeight(text, innerW, fontSize, 0.14));
  const box = clampBox(x, y, w, h);
  slide.addShape(pptx.shapes.RECTANGLE, {
    ...box,
    fill: { color: hex(BRAND_TOKENS.surface.alt) },
    line: { color: hex(BRAND_TOKENS.line.hairline), width: 0.75 },
    rectRadius: 0.05,
  });
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: box.x,
    y: box.y,
    w: CARD_INK_BAR,
    h: box.h,
    fill: { color: hex(BRAND_TOKENS.ink.default) },
    line: { color: hex(BRAND_TOKENS.ink.default), width: 0 },
  });
  addWrappedText(slide, text, {
    x: box.x + 0.18,
    y: box.y + 0.08,
    w: box.w - 0.3,
    h: box.h - 0.12,
  }, fontSize);
  return box.y + box.h + 0.12;
}

function addTableBlock(slide, pptx, block, y, maxY) {
  const colCount = block.headers.length;
  if (colCount === 0) return y;
  const colW = computeTableColWidths(block.headers, block.rows);
  const bodyFont = tableFontSize(block.headers, block.rows);
  const headerFont = Math.max(9, bodyFont - 1);

  const rowHeights = tableRowHeights(block, colW, headerFont, bodyFont);

  let cy = y;
  const paintRow = (cells, rowIndex, isHeader) => {
    const rh = rowHeights[rowIndex];
    if (cy + rh > maxY) return false;
    let cx = MX;
    for (let ci = 0; ci < cells.length; ci += 1) {
      const fw = colW[ci];
      const cellBox = clampBox(cx, cy, fw, rh);
      const fill = isHeader
        ? BRAND_TOKENS.ink.default
        : (rowIndex % 2 === 0 ? BRAND_TOKENS.surface.paper : BRAND_TOKENS.surface.alt);
      const fs = isHeader ? headerFont : bodyFont;
      slide.addShape(pptx.shapes.RECTANGLE, {
        ...cellBox,
        fill: { color: hex(fill) },
        line: { color: hex(BRAND_TOKENS.line.hairline), width: 0.75 },
      });
      addWrappedText(slide, cells[ci], {
        x: cellBox.x + 0.08,
        y: cellBox.y + 0.05,
        w: cellBox.w - 0.14,
        h: cellBox.h - 0.08,
      }, fs, { bold: isHeader, color: isHeader ? INK.paper : BRAND_TOKENS.ink.body });
      cx += fw;
    }
    cy += rh;
    return true;
  };

  if (!paintRow(block.headers, 0, true)) return y;
  for (let ri = 0; ri < block.rows.length; ri += 1) {
    if (!paintRow(block.rows[ri], ri + 1, false)) break;
  }
  return cy + 0.1;
}

function addListCards(slide, pptx, block, y, maxY, layout = {}) {
  const { x = MX, w = CW } = layout;
  let cy = y;

  for (let idx = 0; idx < block.items.length; idx += 1) {
    const item = block.items[idx];
    const fontSize = fontSizeForItem(item);
    const cardH = cardHeightForItem(item, layout, block, fontSize);
    if (cy + cardH > maxY) break;

    const box = clampBox(x, cy, w, cardH);
    slide.addShape(pptx.shapes.RECTANGLE, {
      ...box,
      fill: { color: hex(BRAND_TOKENS.surface.alt) },
      line: { color: hex(BRAND_TOKENS.line.hairline), width: 0.75 },
      rectRadius: 0.04,
    });
    slide.addShape(pptx.shapes.RECTANGLE, {
      x: box.x,
      y: box.y,
      w: CARD_INK_BAR,
      h: box.h,
      fill: { color: hex(BRAND_TOKENS.ink.default) },
      line: { color: hex(BRAND_TOKENS.ink.default), width: 0 },
    });

    let textX = box.x + CARD_PAD;
    if (block.type === 'number') {
      const badgeX = box.x + 0.1;
      const badgeY = box.y + (box.h - CARD_BADGE_W) / 2;
      slide.addShape(pptx.shapes.RECTANGLE, {
        x: badgeX,
        y: badgeY,
        w: CARD_BADGE_W,
        h: CARD_BADGE_W,
        fill: { color: hex(BRAND_TOKENS.ink.default) },
        line: { color: hex(BRAND_TOKENS.ink.default), width: 0 },
        rectRadius: 0.03,
      });
      slide.addText(String(idx + 1), {
        x: badgeX,
        y: badgeY,
        w: CARD_BADGE_W,
        h: CARD_BADGE_W,
        align: 'center',
        valign: 'mid',
        ...textDefaults({ color: INK.paper, fontSize: T.small, bold: true }),
      });
      textX = box.x + CARD_BADGE_W + 0.2;
    }
    const textW = Math.min(listTextWidth(layout, block), SAFE_RIGHT - textX - 0.08);
    addWrappedText(slide, item, {
      x: textX,
      y: box.y + 0.06,
      w: textW,
      h: box.h - 0.1,
    }, fontSize);

    cy += box.h + CARD_GAP;
  }

  return cy + 0.04;
}

// PNG carries width/height as big-endian uint32 at byte offsets 16 and 20 (the IHDR
// chunk). Reading the header avoids an image dependency just to fit a diagram by aspect.

function pngDimensions(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  return null;
}

// Diagram fences are rendered to PNG with the same monochrome sketch styling as the
// PDF/HTML path: mmdc for mermaid (hand-drawn theme injected), d2 --sketch for d2. A
// missing renderer returns a typed error so the caller can record it, never a silent drop.

function renderDiagramToPng(lang, code, tmpDir, baseEnv, idx) {
  const env = buildDistributionDiagramEnv(baseEnv);
  const out = path.join(tmpDir, `diagram-${idx}.png`);
  if (lang === 'mermaid') {
    const src = path.join(tmpDir, `diagram-${idx}.mmd`);
    fs.writeFileSync(src, injectMermaidBrandTheme(code));
    const args = ['-i', src, '-o', out, '-b', 'transparent', '-s', '2', '-w', '1600'];
    if (env.CONSTRUCT_MERMAID_PPTR_CONFIG) args.push('-p', env.CONSTRUCT_MERMAID_PPTR_CONFIG);
    const r = spawnSync('mmdc', args, { encoding: 'utf8', env });
    if (r.status !== 0 || !fs.existsSync(out)) return { error: (r.stderr || 'mmdc failed').trim().slice(0, 200) };
  } else {
    const src = path.join(tmpDir, `diagram-${idx}.d2`);
    fs.writeFileSync(src, injectD2DistributionDefaults(code));
    const r = spawnSync('d2', ['--sketch', '--pad', '16', '--theme', '0', src, out], { encoding: 'utf8', env });
    if (r.status !== 0 || !fs.existsSync(out)) return { error: (r.stderr || 'd2 failed').trim().slice(0, 200) };
  }
  const dim = pngDimensions(out) || { w: 1600, h: 900 };
  return { path: out, w: dim.w, h: dim.h };
}

function addDiagramImage(slide, pptx, block, y, maxY, layout, renderCtx) {
  const availH = maxY - y - 0.04;
  if (availH < 0.6) return y;
  const rendered = renderDiagramToPng(block.lang, block.code, renderCtx.tmpDir, renderCtx.env, renderCtx.seq);
  renderCtx.seq += 1;
  renderCtx.attempted += 1;

  if (rendered.error) {
    renderCtx.errors.push({ lang: block.lang, error: rendered.error });
    const box = clampBox(layout.x, y, layout.w, Math.min(availH, 0.9));
    slide.addShape(pptx.shapes.RECTANGLE, {
      ...box,
      fill: { color: hex(BRAND_TOKENS.surface.alt) },
      line: { color: hex(BRAND_TOKENS.line.hairline), width: 0.75 },
      rectRadius: 0.04,
    });
    addWrappedText(slide, `[${block.lang} diagram could not render]`, {
      x: box.x + 0.14, y: box.y + 0.1, w: box.w - 0.28, h: box.h - 0.16,
    }, T.small, { color: BRAND_TOKENS.ink.muted, italic: true });
    return box.y + box.h + 0.1;
  }

  renderCtx.rendered += 1;
  const availW = layout.w;
  const imgAspect = rendered.w / rendered.h;
  let drawW = availW;
  let drawH = availW / imgAspect;
  if (drawH > availH) {
    drawH = availH;
    drawW = availH * imgAspect;
  }
  const ix = layout.x + (availW - drawW) / 2;
  slide.addImage({ path: rendered.path, x: ix, y, w: drawW, h: drawH });
  return y + drawH + 0.1;
}

function addCodeBlock(slide, pptx, block, y, maxY, layout) {
  const fontSize = T.small;
  const lineCount = String(block.code || '').split('\n').length;
  const estH = Math.min(maxY - y - 0.04, 0.2 + lineCount * lineHeightIn(fontSize) * 1.1);
  const box = clampBox(layout.x, y, layout.w, estH);
  slide.addShape(pptx.shapes.RECTANGLE, {
    ...box,
    fill: { color: hex(BRAND_TOKENS.surface.default) },
    line: { color: hex(BRAND_TOKENS.line.hairline), width: 0.75 },
    rectRadius: 0.04,
  });
  slide.addText(String(block.code || ''), {
    x: box.x + 0.12,
    y: box.y + 0.08,
    w: box.w - 0.24,
    h: box.h - 0.16,
    fontFace: BRAND_TOKENS.typography.fontMono,
    color: hex(BRAND_TOKENS.ink.strong),
    fontSize,
    valign: 'top',
    wrap: true,
    fit: 'shrink',
  });
  return box.y + box.h + 0.1;
}

function addContentSlide(pptx, chunk, slideIndex, totalSlides, deckTitle, renderCtx) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, pptx, { slideIndex, totalSlides, title: deckTitle });
  addSlideAccent(slide);

  const blocks = slideBlocks(chunk);
  const titleBlock = blocks.find((b) => b.type === 'heading') || { text: `Slide ${slideIndex}`, level: 2 };
  const region = contentRegionForTitle(titleBlock.text);
  const contentLayout = { x: region.x, w: region.w };

  const titleBox = clampBox(MX, MY, CW, 0.4);
  slide.addText(titleBlock.text, {
    ...titleBox,
    ...textDefaults({ color: BRAND_TOKENS.ink.default, fontSize: T.slideTitle, bold: true }),
    ...textShapeOpts(),
  });
  addHeadingRule(slide, MY + 0.44);

  let y = CONTENT_TOP;
  if (region.mode === 'ink-panel') {
    addInkRampVisual(slide, MX, MY + 0.52, CW, 0.08);
    y = MY + 0.64;
  }

  const maxY = CONTENT_MAX_Y;

  for (const block of blocks) {
    if (block === titleBlock || block.type === 'heading') continue;
    if (y >= maxY - 0.12) break;

    if (block.type === 'text') {
      const plainLen = cellPlainLength(block.text);
      const fontSize = plainLen > 140 ? T.small : T.body;
      const isLead = y < CONTENT_TOP + 0.35;
      if (isLead && plainLen < 140) {
        y = addCallout(slide, pptx, block.text, y, contentLayout);
      } else {
        const estH = textBoxHeight(block.text, contentLayout.w, fontSize, 0.08);
        const box = clampBox(contentLayout.x, y, contentLayout.w, estH);
        addWrappedText(slide, block.text, box, fontSize);
        y = box.y + box.h + 0.1;
      }
    } else if (block.type === 'bullet' || block.type === 'number') {
      y = addListCards(slide, pptx, block, y, maxY, contentLayout);
    } else if (block.type === 'table') {
      y = addTableBlock(slide, pptx, block, y, maxY);
    } else if (block.type === 'diagram' && renderCtx) {
      y = addDiagramImage(slide, pptx, block, y, maxY, contentLayout, renderCtx);
    } else if (block.type === 'code') {
      y = addCodeBlock(slide, pptx, block, y, maxY, contentLayout);
    }
  }
}

export async function exportDeckPptxAsync({
  inputPath,
  outputPath,
  metadata: metadataOverride = null,
  repoRoot = REPO_ROOT,
} = {}) {
  if (!loadPptxGen()) {
    return {
      ok: false,
      format: 'pptx',
      inputPath,
      missing: ['pptxgenjs'],
      message: 'Install pptxgenjs to enable PPTX export (`npm install pptxgenjs` in the Construct package).',
    };
  }
  if (!inputPath) {
    return { ok: false, format: 'pptx', message: 'exportDeckPptx: inputPath is required.' };
  }
  if (!fs.existsSync(inputPath)) {
    return { ok: false, format: 'pptx', inputPath, message: `exportDeckPptx: input does not exist: ${inputPath}` };
  }

  const metadata = { ...(metadataOverride || parseArtifactMetadata(inputPath)) };
  const source = fs.readFileSync(inputPath, 'utf8');
  const layout = auditDeckMarkdownLayout(source, metadata);
  if (!layout.ok) {
    return {
      ok: false,
      format: 'pptx',
      inputPath,
      layout,
      message: `PPTX layout audit failed: ${layout.issues.map((i) => `slide ${i.slide} ${i.code}`).join('; ')}`,
    };
  }

  const allChunks = splitSlides(source);
  if (allChunks.length === 0) {
    return { ok: false, format: 'pptx', inputPath, message: 'exportDeckPptx: no slides found (separate slides with ---).' };
  }

  let contentChunks = allChunks;
  if (isTitleOnlyChunk(allChunks[0], metadata)) {
    const intro = slideBlocks(allChunks[0]).find((b) => b.type === 'text');
    if (intro && !metadata.subtitle) metadata.subtitle = stripInlineMarkdown(intro.text);
    contentChunks = allChunks.slice(1);
  }

  const totalSlides = 1 + contentChunks.length;
  const { PptxClass } = createPptxGenerator();
  const pptx = new PptxClass();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = metadata.owner || 'Construct';
  pptx.title = metadata.title || 'Construct deck';
  pptx.subject = metadata.subtitle || '';
  pptx.theme = { headFontFace: BRAND_SANS_FAMILY, bodyFontFace: BRAND_SANS_FAMILY };

  const fontEmbed = await embedBundledSansInPptx(pptx, repoRoot);
  await embedBundledMonoInPptx(pptx, repoRoot);

  const renderCtx = {
    tmpDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-fig-')),
    env: process.env,
    seq: 0,
    attempted: 0,
    rendered: 0,
    errors: [],
  };

  try {
    addTitleSlide(pptx, metadata, totalSlides);
    contentChunks.forEach((chunk, index) => {
      addContentSlide(pptx, chunk, index + 2, totalSlides, metadata.title || '', renderCtx);
    });

    if (renderCtx.attempted > 0 && renderCtx.rendered === 0) {
      return {
        ok: false,
        format: 'pptx',
        inputPath,
        outputPath,
        message: `PPTX export failed: 0/${renderCtx.attempted} diagram(s) rendered. Ensure d2 and mermaid-cli are installed (mmdc needs Chrome; set PUPPETEER_EXECUTABLE_PATH). First error: ${renderCtx.errors[0]?.error || 'unknown'}`,
      };
    }

    try {
      await pptx.writeFile({ fileName: outputPath });
    } catch (err) {
      return {
        ok: false,
        format: 'pptx',
        inputPath,
        outputPath,
        message: `PPTX export failed: ${err.message}`,
      };
    }
  } finally {
    fs.rmSync(renderCtx.tmpDir, { recursive: true, force: true });
  }

  return {
    ok: true,
    format: 'pptx',
    inputPath,
    outputPath,
    engine: 'pptxgenjs',
    slideCount: totalSlides,
    layout,
    fontsEmbedded: fontEmbed.embedded,
    diagramsRendered: renderCtx.rendered,
    diagramWarnings: renderCtx.errors,
    message: `Wrote ${outputPath}`,
  };
}

export function exportDeckPptx(opts = {}) {
  const PptxGenJS = loadPptxGen();
  if (!PptxGenJS) {
    return {
      ok: false,
      format: 'pptx',
      inputPath: opts.inputPath,
      missing: ['pptxgenjs'],
      message: 'Install pptxgenjs to enable PPTX export (`npm install pptxgenjs` in the Construct package).',
    };
  }

  const payload = Buffer.from(JSON.stringify(opts)).toString('base64');
  const child = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { exportDeckPptxAsync } from ${JSON.stringify(MODULE_URL)};
     const result = await exportDeckPptxAsync(JSON.parse(Buffer.from(${JSON.stringify(payload)}, 'base64').toString('utf8')));
     process.stdout.write(JSON.stringify(result));`,
  ], { encoding: 'utf8', env: process.env });

  if (child.status !== 0) {
    return {
      ok: false,
      format: 'pptx',
      inputPath: opts.inputPath,
      outputPath: opts.outputPath,
      message: `PPTX export failed: ${(child.stderr || child.stdout || '').trim().slice(0, 400)}`,
    };
  }

  try {
    return JSON.parse(child.stdout || '{}');
  } catch {
    return {
      ok: false,
      format: 'pptx',
      inputPath: opts.inputPath,
      message: 'PPTX export failed: invalid worker response.',
    };
  }
}
