/**
 * lib/render-visual-check.mjs — rendered-artifact visual gate for the test:visual script.
 *
 * Exports a fixture through the real document-export engines (Pandoc/Typst for PDF, pptxgenjs for
 * PPTX, Pandoc for DOCX) and asserts what a source-level check cannot: (1) for pdf/pptx — the same
 * RENDER_REQUIRED_FORMATS output-quality.mjs already treats as render-required — every rasterized
 * page carries real ink, not a blank/near-blank canvas from a broken template or missing font,
 * decoded straight from the produced PNG's own IDAT stream with zlib inflate plus PNG filter
 * reconstruction (no image-decoding dependency needed); (2) runOutputQuality's text-extraction-
 * parity and on-disk reference-integrity checks pass against the produced file for every format,
 * reusing the same gate publish.mjs enforces; (3) a renderer required for the requested format that
 * is absent is reported as a typed, CI-visible failure reason, never a silent skip, because a
 * visual claim that rests on a tool that was never invoked is not a visual claim. docx has no
 * raster path in render-pipeline.mjs (only pdf/html/pptx/mermaid/d2), so it is validated via export
 * plus text/reference checks only, matching the existing render-required contract.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

import { exportMarkdown, whichBin } from './document-export.mjs';
import { runOutputQuality } from './output-quality.mjs';

// Below this ink ratio a rasterized page is treated as blank: a faithful export of a
// multi-paragraph fixture always covers more of the canvas than antialiasing noise or a stray
// hairline would produce.

const MIN_INK_RATIO = 0.01;

// Formats output-quality.mjs already treats as render-required (RENDER_REQUIRED_FORMATS); only
// these get rasterized and blank-page checked. docx has no renderer in render-pipeline.mjs.

const RASTER_FORMATS = new Set(['pdf', 'pptx']);

function readPngChunks(pngPath) {
  const buf = fs.readFileSync(pngPath);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error(`${pngPath}: not a PNG (bad signature)`);

  let offset = 8;
  let header = null;
  const idatParts = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data.readUInt8(8),
        colorType: data.readUInt8(9),
      };
    }
    if (type === 'IDAT') idatParts.push(data);
    offset += 8 + len + 4;
    if (type === 'IEND') break;
  }
  if (!header) throw new Error(`${pngPath}: missing IHDR chunk`);
  if (header.bitDepth !== 8) throw new Error(`${pngPath}: unsupported bit depth ${header.bitDepth} (need 8)`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType];
  if (!channels) throw new Error(`${pngPath}: unsupported color type ${header.colorType}`);
  return { ...header, channels, raw: zlib.inflateSync(Buffer.concat(idatParts)) };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Reverses the per-scanline PNG filter (none/sub/up/average/paeth) so pixel values are real
// sample bytes rather than filter-encoded deltas.

function unfilterPng({ width, height, channels, raw }) {
  const stride = width * channels;
  const bpp = channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos];
    pos += 1;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[pos + x];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[rowStart - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[rowStart - stride + x - bpp] : 0;
      let recon;
      if (filter === 0) recon = val;
      else if (filter === 1) recon = val + a;
      else if (filter === 2) recon = val + b;
      else if (filter === 3) recon = val + Math.floor((a + b) / 2);
      else if (filter === 4) recon = val + paeth(a, b, c);
      else throw new Error(`unsupported PNG filter type ${filter} at row ${y}`);
      out[rowStart + x] = recon & 0xff;
    }
    pos += stride;
  }
  return out;
}

// Fraction of pixels that are not near-white (allows antialiasing/JPEG-adjacent noise near 255).

export function inkRatio(pngPath) {
  const decoded = readPngChunks(pngPath);
  const pixels = unfilterPng(decoded);
  const { channels } = decoded;
  let inked = 0;
  let total = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    total += 1;
    const r = pixels[i];
    const g = channels >= 2 ? pixels[i + 1] : r;
    const b = channels >= 3 ? pixels[i + 2] : r;
    if (r < 245 || g < 245 || b < 245) inked += 1;
  }
  return total === 0 ? 0 : inked / total;
}

function rasterizePdf(pdfPath, outDir) {
  const result = spawnSync('pdftoppm', ['-png', '-r', '72', pdfPath, path.join(outDir, 'page')], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`pdftoppm failed: ${(result.stderr || '').trim()}`);
  return fs.readdirSync(outDir)
    .filter((f) => f.startsWith('page') && f.endsWith('.png'))
    .sort()
    .map((f) => path.join(outDir, f));
}

// pptx has no direct rasterizer; render-pipeline.mjs's own pptx path goes soffice -> pdf ->
// pdftoppm, so this mirrors that exact chain rather than inventing a second one.

function rasterizePptx(pptxPath, outDir, env) {
  const soffice = whichBin('soffice', env) || whichBin('libreoffice', env);
  if (!soffice) return { ok: false, reason: 'missing-dependency', message: 'soffice/libreoffice not on PATH' };
  const conv = spawnSync(soffice, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, pptxPath], { encoding: 'utf8' });
  if (conv.status !== 0) return { ok: false, reason: 'unavailable-renderer', message: (conv.stderr || '').trim() || 'soffice convert failed' };
  const pdf = path.join(outDir, `${path.parse(pptxPath).name}.pdf`);
  if (!fs.existsSync(pdf)) return { ok: false, reason: 'unavailable-renderer', message: 'soffice produced no pdf' };
  return { ok: true, images: rasterizePdf(pdf, outDir) };
}

const REQUIRED_ENGINES = {
  pdf: ['pandoc', 'typst', 'pdftoppm'],
  pptx: ['pandoc', 'soffice', 'pdftoppm'],
  docx: ['pandoc'],
};

export function requiredEngineStatus(format, env = process.env) {
  const names = REQUIRED_ENGINES[format] || [];
  const missing = names.filter((name) => {
    if (name === 'soffice') return !whichBin('soffice', env) && !whichBin('libreoffice', env);
    return !whichBin(name, env);
  });
  return { format, required: names, missing, present: missing.length === 0 };
}

// Runs the full rendered-artifact gate for one format: export via the real engine, rasterize when
// the format is render-required, assert non-blank pages, and run the shared output-quality checks
// (text parity + references) against the produced file. Returns a typed failure (never throws)
// when a required engine is absent, so the caller can fail the process loudly instead of skipping.

export function checkRenderedArtifact({ fixturePath, format, workDir, env = process.env } = {}) {
  const engineStatus = requiredEngineStatus(format, env);
  if (!engineStatus.present) {
    const message = `test:visual requires real engines for ${format} but ${engineStatus.missing.join(', ')} ${engineStatus.missing.length > 1 ? 'are' : 'is'} not on PATH. Install: ${engineStatus.missing.join(', ')}. This is a hard failure: a rendered-artifact claim cannot rest on a tool that never ran.`;
    return { ok: false, format, skipped: false, reason: 'missing-dependency', message, failures: [message] };
  }

  const dir = workDir || fs.mkdtempSync(path.join(os.tmpdir(), `cx-visual-${format}-`));
  const outputPath = path.join(dir, `artifact.${format}`);
  const sourceMarkdown = fs.readFileSync(fixturePath, 'utf8');

  const exported = exportMarkdown({ inputPath: fixturePath, outputPath, format, env });
  if (!exported.ok) {
    const message = `export failed for ${format}: ${exported.message}`;
    return { ok: false, format, skipped: false, reason: 'export-failed', message, failures: [message] };
  }

  let images = [];
  if (RASTER_FORMATS.has(format)) {
    if (format === 'pdf') {
      images = rasterizePdf(outputPath, dir);
    } else {
      const raster = rasterizePptx(outputPath, dir, env);
      if (!raster.ok) {
        const message = `rasterize failed for ${format}: ${raster.message}`;
        return { ok: false, format, skipped: false, reason: raster.reason, message, failures: [message] };
      }
      images = raster.images;
    }
    if (images.length === 0) {
      const message = `${format} export produced zero rasterizable pages`;
      return { ok: false, format, skipped: false, reason: 'no-pages', message, failures: [message] };
    }
  }

  const blankPages = [];
  const ratios = [];
  for (const image of images) {
    const ratio = inkRatio(image);
    ratios.push(ratio);
    if (ratio < MIN_INK_RATIO) blankPages.push({ image, ratio });
  }

  const quality = runOutputQuality({
    exportPath: outputPath,
    format,
    sourceMarkdown,
    baseDir: path.dirname(fixturePath),
    gateLevel: 'render-smoke',
    env,
  });

  const failures = [];
  if (blankPages.length > 0) {
    failures.push(`${blankPages.length}/${images.length} rendered page(s) are blank (ink ratio < ${MIN_INK_RATIO}): ${blankPages.map((p) => `${path.basename(p.image)}=${p.ratio.toFixed(4)}`).join(', ')}`);
  }
  for (const f of quality.failures) failures.push(f);

  return {
    ok: failures.length === 0,
    format,
    skipped: false,
    pageCount: images.length,
    inkRatios: ratios,
    quality,
    failures,
    message: failures.length === 0
      ? `${format}: ${images.length ? `${images.length} page(s) rendered, all non-blank; ` : ''}text parity and references verified`
      : failures.join('; '),
  };
}
