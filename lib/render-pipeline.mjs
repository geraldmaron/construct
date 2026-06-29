/**
 * lib/render-pipeline.mjs — Render exported artifacts to inspectable images.
 *
 * A declarative per-format renderer registry (PDF/HTML/PPTX → page or slide PNGs, Mermaid/D2 →
 * SVG/PNG) plus availability detection that reuses the document-export binary probe. When a
 * renderer is absent the result carries a typed degradation reason from the shared enum instead of
 * a silent skip, so a caller can downgrade the completion state honestly. The actual render runs
 * only when its tools resolve on PATH; detection and degradation need no tools and are
 * deterministic.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { whichBin } from './document-export.mjs';

const CHROME_CANDIDATES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
const SOFFICE_CANDIDATES = ['soffice', 'libreoffice'];

// Each format declares the binaries its render needs (all must resolve), the image kind it emits,
// and candidate names for tools that ship under different names per platform.

export const RENDERERS = Object.freeze({
  pdf: { tools: ['pdftoppm'], kind: 'png' },
  html: { tools: ['chromium'], candidates: { chromium: CHROME_CANDIDATES }, kind: 'png' },
  pptx: { tools: ['soffice', 'pdftoppm'], candidates: { soffice: SOFFICE_CANDIDATES }, kind: 'png' },
  mermaid: { tools: ['mmdc'], kind: 'png' },
  d2: { tools: ['d2'], kind: 'svg' },
});

export const RENDERABLE_FORMATS = Object.freeze(Object.keys(RENDERERS));

function resolveTool(name, candidates, env) {
  const names = candidates?.[name] ?? [name];
  for (const candidate of names) {
    const found = whichBin(candidate, env);
    if (found) return { name, resolved: candidate, path: found };
  }
  return { name, resolved: null, path: null };
}

export function detectRenderer(format, env = process.env) {
  const spec = RENDERERS[format];
  if (!spec) {
    return { format, available: false, unsupported: true, tools: [], missing: [], message: `No renderer for format: ${format}` };
  }
  const tools = spec.tools.map((tool) => resolveTool(tool, spec.candidates, env));
  const missing = tools.filter((tool) => !tool.path).map((tool) => tool.name);
  return {
    format,
    available: missing.length === 0,
    unsupported: false,
    tools,
    missing,
    message: missing.length === 0
      ? `Ready: render ${format} to ${spec.kind}`
      : `Missing renderer tool(s): ${missing.join(', ')}`,
  };
}

function toolPath(detection, name) {
  return detection.tools.find((tool) => tool.name === name)?.path ?? name;
}

function producedFiles(outDir, prefix, ext) {
  return fs.readdirSync(outDir)
    .filter((file) => file.startsWith(prefix) && file.endsWith(ext))
    .sort()
    .map((file) => path.join(outDir, file));
}

// Each render function runs its real command and returns the produced image paths, or throws so
// the caller can record a typed degradation. Commands are gated behind detection, so they only run
// when their tools resolved.

const RENDER_FNS = {
  pdf(inputPath, outDir, detection) {
    const result = spawnSync(toolPath(detection, 'pdftoppm'), ['-png', inputPath, path.join(outDir, 'page')], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'pdftoppm failed');
    return producedFiles(outDir, 'page', '.png');
  },
  html(inputPath, outDir, detection) {
    const out = path.join(outDir, 'page.png');
    const result = spawnSync(toolPath(detection, 'chromium'), [
      '--headless', '--no-sandbox', '--hide-scrollbars',
      `--screenshot=${out}`, '--window-size=1280,1696',
      pathToFileURL(path.resolve(inputPath)).href,
    ], { encoding: 'utf8' });
    if (result.status !== 0 || !fs.existsSync(out)) throw new Error(result.stderr || 'chromium screenshot failed');
    return [out];
  },
  mermaid(inputPath, outDir, detection) {
    const out = path.join(outDir, 'diagram.png');
    const result = spawnSync(toolPath(detection, 'mmdc'), ['-i', inputPath, '-o', out], { encoding: 'utf8' });
    if (result.status !== 0 || !fs.existsSync(out)) throw new Error(result.stderr || 'mmdc failed');
    return [out];
  },
  d2(inputPath, outDir, detection) {
    const out = path.join(outDir, 'diagram.svg');
    const result = spawnSync(toolPath(detection, 'd2'), [inputPath, out], { encoding: 'utf8' });
    if (result.status !== 0 || !fs.existsSync(out)) throw new Error(result.stderr || 'd2 failed');
    return [out];
  },
  pptx(inputPath, outDir, detection) {
    const conv = spawnSync(toolPath(detection, 'soffice'), ['--headless', '--convert-to', 'pdf', '--outdir', outDir, inputPath], { encoding: 'utf8' });
    if (conv.status !== 0) throw new Error(conv.stderr || 'soffice convert failed');
    const pdf = path.join(outDir, path.basename(inputPath).replace(/\.pptx$/i, '.pdf'));
    if (!fs.existsSync(pdf)) throw new Error('soffice produced no pdf');
    const result = spawnSync(toolPath(detection, 'pdftoppm'), ['-png', pdf, path.join(outDir, 'slide')], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'pdftoppm failed');
    return producedFiles(outDir, 'slide', '.png');
  },
};

function degraded(format, degradation, message, detection) {
  return { ok: false, format, images: [], degradation, message, detection };
}

export function renderToImages({ format, inputPath, outDir, env = process.env } = {}) {
  const detection = detectRenderer(format, env);
  if (detection.unsupported) return degraded(format, 'unsupported-format', detection.message, detection);
  if (!detection.available) return degraded(format, 'missing-dependency', detection.message, detection);
  if (!inputPath || !fs.existsSync(inputPath)) {
    return degraded(format, 'skipped-by-policy', `input not found: ${inputPath}`, detection);
  }

  fs.mkdirSync(outDir, { recursive: true });
  try {
    const images = RENDER_FNS[format](inputPath, outDir, detection);
    if (!images.length) return degraded(format, 'unavailable-renderer', `renderer produced no images for ${format}`, detection);
    return { ok: true, format, images, degradation: null, message: `Rendered ${images.length} image(s) for ${format}`, detection };
  } catch (err) {
    const reason = format === 'html' ? 'headless-limitation' : 'unavailable-renderer';
    return degraded(format, reason, err.message, detection);
  }
}
