/**
 * lib/export-validate.mjs — Post-export validity, content roundtrip, and reference integrity.
 *
 * Three deterministic checks that today only a >1KB file-size heuristic covered: a PDF is parsed
 * by pdfinfo for a real page count, exported text is extracted and compared against the source's
 * key phrases to catch dropped content, and local image/link targets are resolved on disk. Each
 * returns a typed degradation reason when its tool is absent rather than a silent pass. Closes the
 * gaps in subagents/document-export-quality.md and absorbs the construct-amfg PDF-fidelity work.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { whichBin } from './document-export.mjs';

function degraded(reason, message, extra = {}) {
  return { ok: false, degradation: reason, message, ...extra };
}

export function validatePdf(pdfPath, env = process.env) {
  if (!whichBin('pdfinfo', env)) return degraded('missing-dependency', 'pdfinfo not available', { valid: null, pageCount: 0 });
  if (!fs.existsSync(pdfPath)) return degraded('skipped-by-policy', `pdf not found: ${pdfPath}`, { valid: false, pageCount: 0 });
  const result = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8', env });
  if (result.status !== 0) {
    return { ok: false, valid: false, pageCount: 0, degradation: null, message: (result.stderr || '').trim() || 'pdfinfo reported an invalid PDF' };
  }
  const match = result.stdout.match(/^Pages:\s+(\d+)/m);
  const pageCount = match ? Number(match[1]) : 0;
  return { ok: pageCount > 0, valid: pageCount > 0, pageCount, degradation: null, message: `valid PDF, ${pageCount} page(s)` };
}

// Each format uses the cheapest faithful text extractor; a missing tool degrades with a typed
// reason instead of reporting empty text as a pass.

function extractText(filePath, format, env) {
  if (format === 'pdf') {
    if (!whichBin('pdftotext', env)) return { degradation: 'missing-dependency' };
    const result = spawnSync('pdftotext', [filePath, '-'], { encoding: 'utf8', env });
    return result.status === 0 ? { text: result.stdout } : { degradation: 'unavailable-renderer' };
  }
  if (format === 'html') {
    const raw = fs.readFileSync(filePath, 'utf8');
    const text = raw
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    return { text };
  }
  if (format === 'docx' || format === 'pptx') {
    if (!whichBin('unzip', env)) return { degradation: 'missing-dependency' };
    const member = format === 'docx' ? 'word/document.xml' : 'ppt/slides/slide*.xml';
    const result = spawnSync('unzip', ['-p', filePath, member], { encoding: 'utf8', env });
    return result.status === 0 ? { text: result.stdout.replace(/<[^>]+>/g, ' ') } : { degradation: 'unavailable-renderer' };
  }
  return { degradation: 'unsupported-format' };
}

function sourcePhrases(sourceMarkdown) {
  const body = sourceMarkdown.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '');
  const headings = [...body.matchAll(/^#{1,6}\s+(.+)$/gm)]
    .map((match) => match[1].trim())
    .filter((heading) => !/[{}<>]/.test(heading));
  return [...new Set(headings)].slice(0, 12);
}

export function contentRoundtrip({ exportPath, format, sourceMarkdown, env = process.env } = {}) {
  if (!fs.existsSync(exportPath)) return degraded('skipped-by-policy', `export not found: ${exportPath}`, { textRatio: 0, missingPhrases: [] });
  const extracted = extractText(exportPath, format, env);
  if (extracted.degradation) return degraded(extracted.degradation, `cannot extract text from ${format}`, { textRatio: 0, missingPhrases: [] });

  // PDF and DOCX text extraction wrap lines arbitrarily, so a heading that survives the export
  // can still appear with an embedded newline. Collapse all whitespace on both sides before the
  // substring match; otherwise a faithful export reads as dropped content.

  const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const haystack = normalize(extracted.text || '');
  const phrases = sourcePhrases(sourceMarkdown);
  const missingPhrases = phrases.filter((phrase) => !haystack.includes(normalize(phrase)));
  const ratio = phrases.length ? (phrases.length - missingPhrases.length) / phrases.length : 1;
  return {
    ok: missingPhrases.length === 0,
    textRatio: Math.round(ratio * 100) / 100,
    missingPhrases,
    degradation: null,
    message: `${phrases.length - missingPhrases.length}/${phrases.length} key phrases preserved`,
  };
}

// Local image and link targets must resolve on disk; remote URLs, anchors, and mailto are out of
// scope for an on-disk integrity check. Three reference forms in source are covered: ![]() syntax,
// raw inline <img src> HTML, and reference-style definitions ([id]: ./path). The produced HTML
// file's own <img src> references are also scanned, catching assets referenced only in the export.

export function referenceIntegrity(sourceMarkdown, baseDir, exportPath = null) {
  const body = sourceMarkdown.replace(/```[\s\S]*?```/g, '');
  const missingImages = [];
  const brokenLinks = [];

  // Standard Markdown image syntax: ![alt](path)
  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const ref = match[1].split(/\s+/)[0];
    if (/^https?:|^data:/.test(ref)) continue;
    if (!fs.existsSync(path.resolve(baseDir, ref))) missingImages.push(ref);
  }

  // Raw inline HTML <img src> in source markdown
  for (const match of body.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
    const ref = match[1];
    if (/^https?:|^data:|^#/.test(ref)) continue;
    if (!fs.existsSync(path.resolve(baseDir, ref))) missingImages.push(ref);
  }

  // Reference-style image/link definitions: [id]: ./path
  for (const match of body.matchAll(/^\[[^\]]+\]:\s+(\S+)/gm)) {
    const ref = match[1];
    if (/^https?:|^#|^mailto:/.test(ref)) continue;
    if (!fs.existsSync(path.resolve(baseDir, ref))) missingImages.push(ref);
  }

  // Standard Markdown link syntax: [text](path) (non-image)
  for (const match of body.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
    const ref = match[1].split(/\s+/)[0];
    if (/^https?:|^#|^mailto:/.test(ref)) continue;
    if (!fs.existsSync(path.resolve(baseDir, ref))) brokenLinks.push(ref);
  }

  // Produced HTML file: scan internal <img src> references that may not appear in source markdown
  if (exportPath && exportPath.endsWith('.html') && fs.existsSync(exportPath)) {
    let html = '';
    try { html = fs.readFileSync(exportPath, 'utf8'); } catch { /* skip */ }
    for (const match of html.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)) {
      const ref = match[1];
      if (/^https?:|^data:|^#/.test(ref)) continue;
      if (!fs.existsSync(path.resolve(baseDir, ref))) missingImages.push(ref);
    }
  }

  return { ok: missingImages.length === 0 && brokenLinks.length === 0, missingImages, brokenLinks };
}
