/**
 * lib/deck-export-pptx.mjs — markdown slide deck → branded PPTX via pptxgenjs.
 *
 * Parses slides (---), tables, lists, and inline bold into a 16:9 deck with
 * Construct ink chrome: title band, heading rules, callout cards, styled tables,
 * and footer bar matching templates/distribution/construct-deck.html.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { BRAND_TOKENS, INK } from './brand-tokens.mjs';
import { createPptxGenerator, embedBundledSansInPptx, BRAND_SANS_FAMILY } from './brand-fonts.mjs';
import { parseArtifactMetadata } from './publish-template.mjs';

const require = createRequire(import.meta.url);
const MODULE_URL = pathToFileURL(fileURLToPath(import.meta.url)).href;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const W = 13.333;
const H = 7.5;
const MX = 0.72;
const MY = 0.55;
const CW = W - MX * 2;
const FOOT_Y = H - 0.52;

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

function splitSlides(markdown) {
  let body = String(markdown || '');
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  return body
    .split(/\n(?:---|\*\*\*\*)\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function stripInlineMarkdown(text) {
  return String(text || '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
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
    fontSize: opts.fontSize ?? 18,
    bold: Boolean(opts.bold),
    italic: Boolean(opts.italic),
  };
}

function addSlideChrome(slide, pptx, { slideIndex, totalSlides, title = '' }) {
  slide.background = { color: hex(BRAND_TOKENS.surface.paper) };

  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: H - 0.06,
    w: 0.55,
    h: 0.06,
    fill: { color: hex(BRAND_TOKENS.ink.default) },
    line: { color: hex(BRAND_TOKENS.ink.default), width: 0 },
  });
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0.55,
    y: H - 0.06,
    w: W - 0.55,
    h: 0.06,
    fill: { color: hex(BRAND_TOKENS.line.hairline) },
    line: { color: hex(BRAND_TOKENS.line.hairline), width: 0 },
  });

  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 0.08,
    h: H - 0.06,
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
    slide.addText(title, {
      x: MX + 1.5,
      y: FOOT_Y,
      w: CW - 2.2,
      h: 0.28,
      ...textDefaults({ color: BRAND_TOKENS.ink.faint, fontSize: 9 }),
      align: 'left',
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
    y: 1.15,
    w: CW * 0.42,
    h: 0.04,
    fill: { color: hex(BRAND_TOKENS.ink.default) },
    line: { color: hex(BRAND_TOKENS.ink.default), width: 0 },
  });

  const chips = [
    metadata.artifactType,
    metadata.docId,
    metadata.version ? `v${metadata.version}` : '',
  ].filter(Boolean);

  let y = 1.35;
  if (chips.length) {
    slide.addText(chips.join('  ·  ').toUpperCase(), {
      x: MX,
      y,
      w: CW,
      h: 0.35,
      ...textDefaults({ color: BRAND_TOKENS.ink.muted, fontSize: 11, bold: true }),
      charSpacing: 1.5,
    });
    y += 0.45;
  }

  slide.addText(metadata.title || 'Untitled', {
    x: MX,
    y: 2.05,
    w: CW,
    h: 1.35,
    ...textDefaults({ color: BRAND_TOKENS.ink.default, fontSize: 40, bold: true }),
    valign: 'top',
  });

  if (metadata.subtitle) {
    slide.addText(metadata.subtitle, {
      x: MX,
      y: 3.55,
      w: CW * 0.85,
      h: 0.85,
      ...textDefaults({ color: BRAND_TOKENS.ink.muted, fontSize: 22 }),
      valign: 'top',
    });
  }

  const byline = [metadata.owner, metadata.date, metadata.status].filter(Boolean).join('  ·  ');
  if (byline) {
    slide.addShape(pptx.shapes.RECTANGLE, {
      x: MX,
      y: 4.65,
      w: Math.min(CW, byline.length * 0.09 + 0.5),
      h: 0.42,
      fill: { color: hex(BRAND_TOKENS.surface.alt) },
      line: { color: hex(BRAND_TOKENS.line.hairline), width: 0.75 },
      rectRadius: 0.06,
    });
    slide.addText(byline, {
      x: MX + 0.18,
      y: 4.72,
      w: CW,
      h: 0.3,
      ...textDefaults({ color: BRAND_TOKENS.ink.muted, fontSize: 12 }),
    });
  }
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

function addCallout(slide, pptx, text, y) {
  const h = Math.min(1.35, 0.28 + Math.ceil(text.length / 90) * 0.22);
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: MX,
    y,
    w: CW,
    h,
    fill: { color: hex(BRAND_TOKENS.surface.alt) },
    line: { color: hex(BRAND_TOKENS.line.hairline), width: 0.75 },
    rectRadius: 0.05,
  });
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: MX,
    y,
    w: 0.06,
    h,
    fill: { color: hex(BRAND_TOKENS.ink.default) },
    line: { color: hex(BRAND_TOKENS.ink.default), width: 0 },
  });
  slide.addText(parseInlineRuns(text, textDefaults({ fontSize: 16 })), {
    x: MX + 0.22,
    y: y + 0.12,
    w: CW - 0.35,
    h: h - 0.2,
    valign: 'top',
    fit: 'shrink',
  });
  return y + h + 0.18;
}

function addTableBlock(slide, block, y) {
  const colCount = block.headers.length;
  if (colCount === 0) return y;
  const colW = Array(colCount).fill(CW / colCount);
  const headerRow = block.headers.map((cell) => ({
    text: parseInlineRuns(cell, textDefaults({ fontSize: 13, bold: true, color: INK.paper })),
    options: {
      fill: { color: hex(BRAND_TOKENS.ink.default) },
      color: hex(INK.paper),
      bold: true,
      fontSize: 13,
      fontFace: BRAND_TOKENS.typography.fontSans,
      valign: 'middle',
    },
  }));
  const bodyRows = block.rows.map((row, ri) =>
    row.map((cell) => ({
      text: parseInlineRuns(cell, textDefaults({ fontSize: 14 })),
      options: {
        fill: { color: hex(ri % 2 === 0 ? BRAND_TOKENS.surface.paper : BRAND_TOKENS.surface.alt) },
        fontSize: 14,
        fontFace: BRAND_TOKENS.typography.fontSans,
        valign: 'middle',
      },
    })),
  );
  const tableH = Math.min(2.8, 0.42 + bodyRows.length * 0.38);
  slide.addTable([headerRow, ...bodyRows], {
    x: MX,
    y,
    w: CW,
    h: tableH,
    colW,
    border: { type: 'solid', color: hex(BRAND_TOKENS.line.hairline), pt: 0.75 },
    margin: [0.06, 0.1, 0.06, 0.1],
    autoPage: false,
  });
  return y + tableH + 0.2;
}

function addListBlock(slide, block, y, maxY) {
  const lineH = block.type === 'number' ? 0.42 : 0.4;
  const avail = maxY - y;
  const maxItems = Math.max(1, Math.floor(avail / lineH));
  const items = block.items.slice(0, maxItems);
  const runs = items.map((item, idx) => ({
    text: parseInlineRuns(item, textDefaults({ fontSize: 17 })),
    options: {
      bullet: block.type === 'bullet'
        ? { code: '2022', color: hex(BRAND_TOKENS.ink.default) }
        : { type: 'number', number: idx + 1, color: hex(BRAND_TOKENS.ink.default) },
      paraSpaceAfter: 6,
      lineSpacing: 22,
    },
  }));
  const h = Math.min(avail, lineH * items.length + 0.1);
  slide.addText(runs, {
    x: MX,
    y,
    w: CW,
    h,
    valign: 'top',
    fit: 'shrink',
  });
  return y + h + 0.12;
}

function addContentSlide(pptx, chunk, slideIndex, totalSlides, deckTitle) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, pptx, { slideIndex, totalSlides, title: deckTitle });

  const blocks = slideBlocks(chunk);
  const titleBlock = blocks.find((b) => b.type === 'heading') || { text: `Slide ${slideIndex}`, level: 2 };
  const titleLevel = titleBlock.level <= 2 ? 32 : 26;
  const titleSize = titleBlock.level === 1 ? 34 : titleLevel;

  slide.addText(titleBlock.text, {
    x: MX,
    y: MY,
    w: CW,
    h: 0.72,
    ...textDefaults({ color: BRAND_TOKENS.ink.default, fontSize: titleSize, bold: true }),
    valign: 'top',
  });
  addHeadingRule(slide, MY + 0.78);
  let y = MY + 1.02;
  const maxY = FOOT_Y - 0.15;

  for (const block of blocks) {
    if (block === titleBlock || block.type === 'heading') continue;
    if (y >= maxY) break;

    if (block.type === 'text') {
      const isLead = y < MY + 1.35;
      if (isLead && block.text.length < 140) {
        y = addCallout(slide, pptx, block.text, y);
      } else {
        const estH = Math.min(1.8, 0.35 + Math.ceil(block.text.length / 85) * 0.24);
        slide.addText(parseInlineRuns(block.text, textDefaults({ fontSize: 17 })), {
          x: MX,
          y,
          w: CW,
          h: Math.min(estH, maxY - y),
          valign: 'top',
          fit: 'shrink',
          lineSpacing: 24,
        });
        y += Math.min(estH, maxY - y) + 0.14;
      }
    } else if (block.type === 'bullet' || block.type === 'number') {
      y = addListBlock(slide, block, y, maxY);
    } else if (block.type === 'table') {
      y = addTableBlock(slide, block, y);
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
  const allChunks = splitSlides(fs.readFileSync(inputPath, 'utf8'));
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

  addTitleSlide(pptx, metadata, totalSlides);
  contentChunks.forEach((chunk, index) => {
    addContentSlide(pptx, chunk, index + 2, totalSlides, metadata.title || '');
  });

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

  return {
    ok: true,
    format: 'pptx',
    inputPath,
    outputPath,
    engine: 'pptxgenjs',
    slideCount: totalSlides,
    fontsEmbedded: fontEmbed.embedded,
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
