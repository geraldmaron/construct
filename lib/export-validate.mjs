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

// DOCX/PPTX/HTML extractors strip tags but leave XML entities encoded. Decode the common
// entities so roundtrip phrase checks see the same `&` / quotes the markdown source used.

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Each zip-container format declares the members that prove it is that format rather than a
// renamed archive, plus where its "unit count" (slides for presentations) is read from. Missing
// unzip degrades with a typed reason; a real structural gap fails.

const ARCHIVE_SPECS = {
  docx: { required: ['word/document.xml'], mimetype: null, unit: null },
  pptx: { required: ['[Content_Types].xml'], mimetype: null, unit: { glob: /^ppt\/slides\/slide\d+\.xml$/, label: 'slide' } },
  odt: { required: ['content.xml', 'META-INF/manifest.xml'], mimetype: 'application/vnd.oasis.opendocument.text', unit: null },
  odp: { required: ['content.xml', 'META-INF/manifest.xml'], mimetype: 'application/vnd.oasis.opendocument.presentation', unit: { member: 'content.xml', pattern: /<draw:page\b/g, label: 'slide' } },
  epub: { required: ['META-INF/container.xml'], mimetype: 'application/epub+zip', unit: null },
};

function zipMembers(filePath, env) {
  const result = spawnSync('unzip', ['-Z1', filePath], { encoding: 'utf8', env });
  if (result.status !== 0) return null;
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function zipMember(filePath, member, env) {
  const result = spawnSync('unzip', ['-p', filePath, member], { encoding: 'utf8', env });
  return result.status === 0 ? result.stdout : null;
}

export function validateArchive(filePath, format, env = process.env) {
  const spec = ARCHIVE_SPECS[format];
  if (!spec) return degraded('unsupported-format', `no archive spec for ${format}`, { valid: null });
  if (!whichBin('unzip', env)) return degraded('missing-dependency', 'unzip not available', { valid: null });
  if (!fs.existsSync(filePath)) return degraded('skipped-by-policy', `archive not found: ${filePath}`, { valid: false });
  const members = zipMembers(filePath, env);
  if (members === null) return { ok: false, valid: false, degradation: null, message: `not a readable zip archive: ${filePath}` };

  const memberSet = new Set(members);
  const missingMembers = spec.required.filter((m) => !memberSet.has(m));
  if (missingMembers.length) {
    return { ok: false, valid: false, degradation: null, message: `${format} missing required member(s): ${missingMembers.join(', ')}` };
  }
  if (spec.mimetype) {
    const mimetype = (zipMember(filePath, 'mimetype', env) || '').trim();
    if (mimetype !== spec.mimetype) {
      return { ok: false, valid: false, degradation: null, message: `${format} mimetype is "${mimetype || '<absent>'}", expected "${spec.mimetype}"` };
    }
  }

  let unitCount = null;
  if (spec.unit) {
    if (spec.unit.glob) {
      unitCount = members.filter((m) => spec.unit.glob.test(m)).length;
    } else if (spec.unit.member) {
      const xml = zipMember(filePath, spec.unit.member, env) || '';
      unitCount = (xml.match(spec.unit.pattern) || []).length;
    }
    if (unitCount === 0) {
      return { ok: false, valid: false, unitCount, degradation: null, message: `${format} contains zero ${spec.unit.label}(s)` };
    }
  }

  const label = spec.unit ? `, ${unitCount} ${spec.unit.label}(s)` : '';
  return { ok: true, valid: true, unitCount, degradation: null, message: `valid ${format} package${label}` };
}

// Structural sanity for exported HTML without a DOM dependency (zero-npm-core keeps HTML parsers
// out of core): a real document root plus at least one block element, and no unresolved RichDocument
// diagram source left as raw fence text.

export function validateHtml(filePath) {
  if (!fs.existsSync(filePath)) return degraded('skipped-by-policy', `html not found: ${filePath}`, { valid: false });
  let html = '';
  try { html = fs.readFileSync(filePath, 'utf8'); } catch { return degraded('unavailable-renderer', `cannot read ${filePath}`, { valid: false }); }
  const hasRoot = /<(?:article|html|section|body)\b/i.test(html);
  const blockCount = (html.match(/<(?:p|h[1-6]|ul|ol|table|figure|pre|blockquote|div)\b/gi) || []).length;
  if (!hasRoot || blockCount === 0) {
    return { ok: false, valid: false, blockCount, degradation: null, message: `HTML lacks a document root or block content (root=${hasRoot}, blocks=${blockCount})` };
  }
  return { ok: true, valid: true, blockCount, degradation: null, message: `valid HTML DOM, ${blockCount} block element(s)` };
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
    return { text: decodeXmlEntities(text) };
  }
  if (format === 'docx' || format === 'pptx') {
    if (!whichBin('unzip', env)) return { degradation: 'missing-dependency' };
    const member = format === 'docx' ? 'word/document.xml' : 'ppt/slides/slide*.xml';
    const result = spawnSync('unzip', ['-p', filePath, member], { encoding: 'utf8', env });
    return result.status === 0
      ? { text: decodeXmlEntities(result.stdout.replace(/<[^>]+>/g, ' ')) }
      : { degradation: 'unavailable-renderer' };
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

const RAW_MERMAID_SOURCE = /flowchart\s+(?:TD|LR|TB|BT|RL)/i;
const DIAGRAM_RENDER_FORMATS = new Set(['pdf', 'html', 'htmlfrag', 'docx', 'odt', 'odp', 'pptx', 'epub', 'deck']);

function archiveHasEmbeddedMedia(filePath, env) {
  const members = zipMembers(filePath, env);
  if (members === null) return { ok: false, degradation: 'missing-dependency', message: 'unzip not available' };
  const hasMedia = members.some((member) => /(?:^|\/)(?:media|embeddings)\//.test(member) || /\.(?:png|jpe?g|gif|svg|emf|wmf)$/i.test(member));
  return hasMedia
    ? { ok: true, message: 'embedded media present in archive' }
    : { ok: false, message: 'archive contains no embedded media for diagram' };
}

export function validateDiagramRendered(filePath, format, env = process.env) {
  if (!DIAGRAM_RENDER_FORMATS.has(format)) {
    return { ok: true, message: 'diagram render check not applicable for this format' };
  }
  if (!fs.existsSync(filePath)) {
    return degraded('skipped-by-policy', `export not found: ${filePath}`, { valid: false });
  }

  if (format === 'html' || format === 'htmlfrag' || format === 'deck') {
    const html = fs.readFileSync(filePath, 'utf8');
    const hasRendered = /<(?:img|svg|object)\b/i.test(html);
    const hasRawSource = RAW_MERMAID_SOURCE.test(html);
    if (hasRawSource && !hasRendered) {
      return { ok: false, message: 'diagram source text present without rendered img/svg' };
    }
    if (!hasRendered) return { ok: false, message: 'no rendered diagram markup found in HTML output' };
    return { ok: true, message: 'diagram rendered as img/svg in HTML output' };
  }

  if (format === 'pdf') {
    const extracted = extractText(filePath, 'pdf', env);
    if (extracted.degradation) return degraded(extracted.degradation, 'cannot extract pdf text for diagram check', { valid: null });
    if (RAW_MERMAID_SOURCE.test(extracted.text || '')) {
      return { ok: false, message: 'raw mermaid source text found in PDF extract' };
    }
    return { ok: true, message: 'no raw diagram source in PDF text extract' };
  }

  if (ARCHIVE_SPECS[format]) {
    return archiveHasEmbeddedMedia(filePath, env);
  }

  return { ok: true, message: 'diagram render check passed by policy default' };
}

// Composite "file-valid" check for one exported format: structural integrity,
// content roundtrip where the format has a faithful text extractor, and local reference resolution.
// fileValid is true only when every applicable check passes; a check whose optional tool is absent
// degrades (records the miss, does not advance the ladder) rather than failing; a real structural or
// content gap is a hard failure. The result feeds the completion ledger's file-valid evidence.

const ARCHIVE_FORMATS = new Set(['docx', 'pptx', 'odt', 'odp', 'epub']);
const HTML_FORMATS = new Set(['html', 'htmlfrag', 'deck']);
const ROUNDTRIP_FORMATS = new Set(['pdf', 'html', 'docx', 'pptx']);

export function validateExportedDocument({ outputPath, format, sourceMarkdown = '', baseDir = '.', env = process.env } = {}) {
  let integrity;
  if (format === 'pdf') integrity = validatePdf(outputPath, env);
  else if (ARCHIVE_FORMATS.has(format)) integrity = validateArchive(outputPath, format, env);
  else if (HTML_FORMATS.has(format)) integrity = validateHtml(outputPath);
  else {
    const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
    integrity = { ok: size > 0, degradation: null, message: size > 0 ? `${size} bytes` : `empty or absent file: ${outputPath}` };
  }

  const roundtrip = (ROUNDTRIP_FORMATS.has(format) && sourceMarkdown)
    ? { ...contentRoundtrip({ exportPath: outputPath, format, sourceMarkdown, env }), applicable: true }
    : { ok: true, applicable: false, degradation: null, message: 'content roundtrip not applicable for this format' };

  const references = referenceIntegrity(sourceMarkdown, baseDir, outputPath);

  const checks = { integrity, roundtrip, references };
  const degradations = [integrity.degradation, roundtrip.degradation].filter(Boolean);
  const hardFail = (integrity.ok === false && !integrity.degradation)
    || (roundtrip.applicable && roundtrip.ok === false && !roundtrip.degradation)
    || references.ok === false;
  const degraded = !hardFail && degradations.length > 0;
  const fileValid = !hardFail && !degraded;

  let message;
  if (hardFail) {
    if (integrity.ok === false && !integrity.degradation) message = `integrity failed: ${integrity.message}`;
    else if (references.ok === false) message = `reference integrity failed: missing ${references.missingImages.join(', ') || '-'}; broken ${references.brokenLinks.join(', ') || '-'}`;
    else message = `content roundtrip failed: ${roundtrip.missingPhrases?.join(', ') || roundtrip.message}`;
  } else if (degraded) {
    message = `file-valid degraded (${degradations.join(', ')}): validator tool unavailable`;
  } else {
    message = 'file-valid: integrity, roundtrip, and references all pass';
  }

  return { fileValid, degraded, hardFail, degradation: degraded ? degradations[0] : null, checks, message };
}
