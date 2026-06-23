/**
 * lib/document-export.mjs — artifact export to PDF / DOCX / DOC / deck / PPTX / HTML /
 * RTF / ODT / EPUB / LaTeX / TXT / MD / MDX via external binaries (Pandoc + Typst,
 * LibreOffice for legacy .doc, pptxgenjs for PPTX), per ADR-0024.
 *
 * Export **source** is Construct-authored markdown (typed artifacts). **Output**
 * spans many distributable formats. Ingest (separate pipeline) accepts PDF, Office,
 * email, AV, and plain text — see docs/reference/document-io.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  resolvePdfTemplatePath,
  parseArtifactMetadata,
  pandocMetadataArgs,
  preprocessMarkdownForPdfExport,
  distributionFontsDir,
} from './publish-template.mjs';
import {
  preprocessMarkdownDiagrams,
  buildDistributionDiagramEnv,
  countDiagramFences,
} from './diagram-export.mjs';
import { exportDeckPptx, pptxgenPresent } from './deck-export-pptx.mjs';
import { pdfUsesBundledBrandSans } from './brand-fonts.mjs';
import { convertDocxToDoc, libreOfficeInstallHint, libreOfficePresent, resolveLibreOfficeBin } from './libreoffice-export.mjs';
import { resolveExportBranding } from './export-branding.mjs';

export const EXPORT_FORMATS = ['pdf', 'docx', 'doc', 'deck', 'pptx', 'html', 'rtf', 'odt', 'epub', 'tex', 'txt', 'md', 'mdx'];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Pandoc drives typeset formats; pptxgenjs builds slide decks; legacy `.doc` has no
// pandoc writer — export DOCX first, then LibreOffice headless down-converts.

const FORMAT_ENGINES = {
  pdf: { engine: 'pandoc', writer: null, pdfEngine: 'typst', extraBinaries: ['typst'] },
  docx: { engine: 'pandoc', writer: null, pdfEngine: null, extraBinaries: [] },
  doc: { engine: 'pandoc', writer: null, pdfEngine: null, extraBinaries: [], via: 'libreoffice', intermediate: 'docx' },
  deck: { engine: 'pandoc', writer: null, pdfEngine: null, extraBinaries: [] },
  pptx: { engine: 'pptxgenjs', writer: null, pdfEngine: null, extraBinaries: [] },
  html: { engine: 'pandoc', writer: null, pdfEngine: null, extraBinaries: [] },
  rtf: { engine: 'pandoc', writer: 'rtf', pdfEngine: null, extraBinaries: [] },
  odt: { engine: 'pandoc', writer: 'odt', pdfEngine: null, extraBinaries: [] },
  epub: { engine: 'pandoc', writer: 'epub', pdfEngine: null, extraBinaries: [] },
  tex: { engine: 'pandoc', writer: 'latex', pdfEngine: null, extraBinaries: [] },
  txt: { engine: 'pandoc', writer: 'plain', pdfEngine: null, extraBinaries: [] },
  md: { engine: 'copy', writer: null, pdfEngine: null, extraBinaries: [] },
  mdx: { engine: 'copy', writer: null, pdfEngine: null, extraBinaries: [] },
};

export function htmlTemplatePath(repoRoot = REPO_ROOT) {
  const p = path.join(repoRoot, 'templates', 'distribution', 'construct-web.html');
  return fs.existsSync(p) ? p : null;
}

export function deckTemplatePath(repoRoot = REPO_ROOT) {
  const p = path.join(repoRoot, 'templates', 'distribution', 'construct-deck.html');
  return fs.existsSync(p) ? p : null;
}

export function docxReferencePath(repoRoot = REPO_ROOT) {
  const p = path.join(repoRoot, 'templates', 'distribution', 'construct-reference.docx');
  return fs.existsSync(p) ? p : null;
}

export { resolvePdfTemplatePath } from './publish-template.mjs';

export function pdfEngineFontOpts(repoRoot = REPO_ROOT) {
  const fontPath = distributionFontsDir(repoRoot);
  return [
    '--pdf-engine-opt', `--font-path=${fontPath}`,
    '--pdf-engine-opt', '--ignore-system-fonts',
    '--pdf-engine-opt', '--ignore-embedded-fonts',
  ];
}

export function countPdfEmbeddedImages(pdfPath) {
  try {
    const data = fs.readFileSync(pdfPath);
    const text = data.toString('latin1');
    const raster = (text.match(/\/Subtype\s*\/Image/g) || []).length;
    const vector = (text.match(/\/Subtype\s*\/Form/g) || []).length;
    return raster + vector;
  } catch {
    return 0;
  }
}

export function pdfRenderedDiagrams(pdfPath, sourceContent) {
  const expected = countDiagramFences(sourceContent);
  if (expected === 0) return true;
  const embedded = countPdfEmbeddedImages(pdfPath);
  if (embedded >= expected) return true;
  try {
    const text = fs.readFileSync(pdfPath).toString('latin1');
    const rawD2 = /direction:\s*(right|down|left|up)/.test(text);
    const rawMermaid = /flowchart\s+(TD|LR|BT|RL)/.test(text);
    return !rawD2 && !rawMermaid && embedded > 0;
  } catch {
    return false;
  }
}

export { pdfUsesBundledBrandSans } from './brand-fonts.mjs';

/** @deprecated use pdfUsesBundledBrandSans */
export function pdfUsesBundledInter(pdfPath) {
  return pdfUsesBundledBrandSans(pdfPath);
}

export function diagramFilterPath() {
  return path.join(REPO_ROOT, 'vendor', 'pandoc-ext', 'diagram.lua');
}

export function detectPdfTemplate({
  artifactType = null,
  cwd = process.cwd(),
  repoRoot = REPO_ROOT,
} = {}) {
  const templatePath = resolvePdfTemplatePath({ artifactType, cwd, repoRoot });
  return {
    present: Boolean(templatePath),
    path: templatePath,
    message: templatePath
      ? `PDF template: ${path.relative(repoRoot, templatePath)}`
      : 'PDF template missing: templates/distribution/construct-pdf.typ',
  };
}

function whichBin(name, env = process.env) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], { encoding: 'utf8', env });
  if (result.status !== 0) return null;
  const first = (result.stdout || '').trim().split('\n')[0];
  return first || null;
}

function binVersion(name, args = ['--version'], env = process.env) {
  const r = spawnSync(name, args, { encoding: 'utf8', env });
  if (r.status !== 0) return null;
  const line = (r.stdout || '').trim().split('\n')[0];
  return line || null;
}

function installHint(name) {
  if (name === 'pandoc') return 'Install pandoc to enable document export (e.g. `brew install pandoc` on macOS, `apt install pandoc` on Debian/Ubuntu, or https://pandoc.org/installing.html).';
  if (name === 'typst') return 'Install typst to enable PDF export via Pandoc (`brew install typst` on macOS, https://github.com/typst/typst/releases for binaries).';
  if (name === 'construct-pdf.typ') return 'Bundled PDF template missing from templates/distribution/construct-pdf.typ (Construct install integrity issue).';
  if (name === 'd2') return 'Install d2 for diagram blocks (`brew install d2`).';
  if (name === 'mmdc') return 'Install mermaid-cli for mermaid blocks (`npm install -g @mermaid-js/mermaid-cli`).';
  if (name === 'pptxgenjs') return 'Install pptxgenjs to enable PPTX export (`npm install pptxgenjs` in the Construct package).';
  if (name === 'construct-deck.html') return 'Bundled deck template missing from templates/distribution/construct-deck.html (Construct install integrity issue).';
  if (name === 'libreoffice') return libreOfficeInstallHint();
  return `Install ${name} to enable this export format.`;
}

export function detect(format, env = process.env, {
  figures = false,
  artifactType = null,
  branding = 'construct',
  cwd = process.cwd(),
  repoRoot = REPO_ROOT,
} = {}) {
  const brandingPolicy = resolveExportBranding(format, branding);
  const config = format === 'pptx' && brandingPolicy.applied === 'plain'
    ? { engine: 'pandoc', writer: 'pptx', pdfEngine: null, extraBinaries: [] }
    : FORMAT_ENGINES[format];
  if (!config) return { ok: false, format, branding: brandingPolicy, present: false, missing: [], message: `Unsupported format: ${format}. Supported: ${EXPORT_FORMATS.join(', ')}.` };
  if (config.engine === 'copy') {
    return { ok: true, format, branding: brandingPolicy, figures: false, present: true, binaries: [], missing: [], message: `Ready: source emit (${format})` };
  }
  const required = [];
  if (config.engine === 'pptxgenjs') {
    required.push('pptxgenjs');
  } else {
    required.push(config.engine, ...(config.extraBinaries || []));
  }
  if (format === 'pdf' && brandingPolicy.applied === 'construct') {
    const template = detectPdfTemplate({ artifactType, cwd, repoRoot });
    if (!template.present) required.push('construct-pdf.typ');
  }
  if (format === 'deck' && brandingPolicy.applied === 'construct' && !deckTemplatePath(repoRoot)) {
    required.push('construct-deck.html');
  }
  if (format === 'html' && brandingPolicy.applied === 'construct' && !htmlTemplatePath(repoRoot)) required.push('construct-web.html');

  // The DOCX reference doc only restyles pandoc output; pandoc emits a valid file without it and
  // the export passes --reference-doc only when present, so unlike the PDF/HTML/deck templates a
  // missing reference degrades gracefully rather than blocking the export.

  if (format === 'doc' && !libreOfficePresent(env)) {
    required.push('libreoffice');
  }
  if (figures) {
    if (!fs.existsSync(diagramFilterPath())) required.push('diagram.lua');
    if (!whichBin('d2', env) && !whichBin('dot', env)) required.push('d2');
    if (!whichBin('mmdc', env)) required.push('mmdc');
  }
  const status = required.map((name) => {
    if (name.endsWith('.lua')) {
      return { name, path: fs.existsSync(diagramFilterPath()) ? diagramFilterPath() : null, version: null };
    }
    if (name === 'construct-deck.html') {
      return { name, path: deckTemplatePath(repoRoot), version: null };
    }
    if (name === 'construct-web.html') return { name, path: htmlTemplatePath(repoRoot), version: null };
    if (name === 'pptxgenjs') {
      return { name, path: pptxgenPresent() ? 'bundled' : null, version: null };
    }
    if (name === 'libreoffice') {
      return { name, path: libreOfficePresent(env) ? resolveLibreOfficeBin(env) : null, version: null };
    }
    return { name, path: whichBin(name, env), version: null };
  });
  for (const s of status) {
    if (s.path && !s.name.endsWith('.lua') && s.name !== 'pptxgenjs' && s.name !== 'libreoffice') {
      s.version = binVersion(s.name, ['--version'], env);
    }
  }
  const missing = status.filter((s) => !s.path).map((s) => s.name);
  return {
    ok: true,
    format,
    branding: brandingPolicy,
    figures,
    present: missing.length === 0,
    binaries: status,
    missing,
    message: missing.length === 0
      ? `Ready: ${status.map((s) => `${s.name} (${s.version?.split(' ').slice(0, 2).join(' ') ?? 'bundled'})`).join(', ')}`
      : missing.map(installHint).join(' '),
  };
}

function defaultOutputPath(inputPath, format) {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.${format}`);
}

export function parsePublishFrontmatter(inputPath) {
  try {
    const content = fs.readFileSync(inputPath, 'utf8');
    if (!content.startsWith('---')) return null;
    const end = content.indexOf('\n---', 3);
    if (end === -1) return null;
    const block = content.slice(3, end);
    const publish = {};
    let inPublish = false;
    for (const line of block.split('\n')) {
      if (/^publish:\s*$/.test(line)) { inPublish = true; continue; }
      if (inPublish && /^\S/.test(line) && !line.startsWith(' ')) inPublish = false;
      if (!inPublish) continue;
      const m = line.match(/^\s+(\w+):\s*(.+)$/);
      if (m) publish[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return Object.keys(publish).length ? publish : null;
  } catch {
    return null;
  }
}

function prepareExportInput(inputPath, { format = 'html', figures = false, metadata = null } = {}) {
  let raw = fs.readFileSync(inputPath, 'utf8');
  let processed = raw;
  if ((format === 'pdf' || format === 'html') && metadata?.title) {
    processed = preprocessMarkdownForPdfExport(processed, metadata);
  }
  if (figures) {
    processed = preprocessMarkdownDiagrams(processed);
  }
  if (processed === raw) return { inputPath, cleanup: null };
  const tmp = path.join(path.dirname(inputPath), `.construct-export-${path.basename(inputPath)}`);
  fs.writeFileSync(tmp, processed, 'utf8');
  return {
    inputPath: tmp,
    cleanup: () => { try { fs.unlinkSync(tmp); } catch { /* skip */ } },
  };
}

// md and mdx are emitted straight from the authored source: the artifact already
// is Markdown, and Construct-authored Markdown is MDX-compatible (fenced diagrams,
// YAML frontmatter), so no transform is needed beyond writing the target file.

function exportSourceCopy({ inputPath, target, format }) {
  const content = fs.readFileSync(inputPath, 'utf8');
  fs.writeFileSync(target, content, 'utf8');
  return {
    ok: true,
    format,
    inputPath,
    outputPath: target,
    engine: 'copy',
    message: `Wrote ${path.relative(process.cwd(), target)}`,
  };
}

export function exportMarkdown({
  inputPath,
  outputPath,
  format,
  figures = false,
  branding = 'construct',
  artifactType = null,
  env = process.env,
  spawnFn = spawnSync,
  cwd = process.cwd(),
  repoRoot = REPO_ROOT,
} = {}) {
  if (!inputPath) return { ok: false, format, message: 'exportMarkdown: inputPath is required.' };
  if (!EXPORT_FORMATS.includes(format)) return { ok: false, format, inputPath, message: `Unsupported format: ${format}. Supported: ${EXPORT_FORMATS.join(', ')}.` };
  if (!fs.existsSync(inputPath)) return { ok: false, format, inputPath, message: `exportMarkdown: input does not exist: ${inputPath}` };

  const metadata = parseArtifactMetadata(inputPath);
  const resolvedType = artifactType || metadata.artifactType || null;
  const effectiveEnv = figures ? buildDistributionDiagramEnv(env) : env;

  const brandingPolicy = resolveExportBranding(format, branding);
  const detection = detect(format, effectiveEnv, { figures, artifactType: resolvedType, branding, cwd, repoRoot });
  if (!detection.present) {
    return { ok: false, format, inputPath, missing: detection.missing, message: detection.message };
  }

  const config = format === 'pptx' && brandingPolicy.applied === 'plain'
    ? { engine: 'pandoc', writer: 'pptx', pdfEngine: null, extraBinaries: [] }
    : FORMAT_ENGINES[format];
  const target = path.resolve(outputPath || defaultOutputPath(inputPath, format));
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (config.engine === 'copy') {
    return { ...exportSourceCopy({ inputPath, target, format }), branding: brandingPolicy };
  }

  if (format === 'pptx' && brandingPolicy.applied === 'construct') {
    return { ...exportDeckPptx({ inputPath, outputPath: target, metadata, repoRoot }), branding: brandingPolicy };
  }

  if (format === 'doc') {
    const intermediate = path.join(path.dirname(target), `.construct-export-${path.basename(inputPath, path.extname(inputPath))}.docx`);
    const docxResult = exportMarkdown({
      inputPath,
      outputPath: intermediate,
      format: 'docx',
      figures,
      branding,
      artifactType: resolvedType,
      env: effectiveEnv,
      spawnFn,
      cwd,
      repoRoot,
    });
    if (!docxResult.ok) return { ...docxResult, format: 'doc' };
    const loResult = convertDocxToDoc({ docxPath: intermediate, outputPath: target, env: effectiveEnv, spawnFn });
    try { fs.unlinkSync(intermediate); } catch { /* skip */ }
    if (!loResult.ok) {
      return {
        ok: false,
        format: 'doc',
        inputPath,
        outputPath: target,
        missing: loResult.missing,
        message: loResult.message,
      };
    }
    return {
      ok: true,
      format: 'doc',
      inputPath,
      outputPath: target,
      engine: 'libreoffice',
      pdfEngine: null,
      figures,
      template: null,
      branding: brandingPolicy,
      message: loResult.message,
    };
  }

  const prepared = prepareExportInput(inputPath, { format, figures, metadata });
  const templatePath = format === 'pdf' && brandingPolicy.applied === 'construct'
    ? resolvePdfTemplatePath({ artifactType: resolvedType, cwd, repoRoot })
    : null;

  const metadataArgs = pandocMetadataArgs({
    title: metadata.title,
    subtitle: metadata.subtitle,
    date: metadata.date,
    status: metadata.status,
    owner: metadata.owner,
    artifactType: resolvedType || metadata.artifactType,
    version: metadata.version,
    docId: metadata.docId,
    classification: metadata.classification,
  });

  const args = ['-f', 'markdown', '-o', target, '--standalone'];
  if (config.writer) args.push('-t', config.writer);
  if (config.pdfEngine) args.push(`--pdf-engine=${config.pdfEngine}`);
  if (format === 'pdf') {
    if (templatePath) args.push('--template', templatePath);
    if (brandingPolicy.applied === 'construct') args.push(...pdfEngineFontOpts(repoRoot));
    args.push(...metadataArgs);
  } else if (format === 'html') {
    const htmlTpl = htmlTemplatePath(repoRoot);
    if (htmlTpl && brandingPolicy.applied === 'construct') args.push('--template', htmlTpl);
    args.push('--embed-resources');
    args.push(...metadataArgs);
  } else if (format === 'deck') {
    const deckTpl = deckTemplatePath(repoRoot);
    if (deckTpl && brandingPolicy.applied === 'construct') args.push('--template', deckTpl);
    args.push('--section-divs');
    args.push('--embed-resources');
    args.push(...metadataArgs);
  } else if (format === 'docx') {
    const ref = docxReferencePath(repoRoot);
    if (ref && brandingPolicy.applied === 'construct') args.push('--reference-doc', ref);
    args.push(...metadataArgs);
  }
  if (figures && fs.existsSync(diagramFilterPath())) {
    args.push('--lua-filter', diagramFilterPath());
  }
  args.push(path.resolve(prepared.inputPath));

  const spawnCwd = (format === 'pdf' && templatePath) ? path.dirname(templatePath) : path.dirname(prepared.inputPath);

  const result = spawnFn(config.engine, args, { encoding: 'utf8', env: effectiveEnv, cwd: spawnCwd });
  if (prepared.cleanup) prepared.cleanup();

  if (result.status !== 0) {
    return {
      ok: false,
      format,
      inputPath,
      outputPath: target,
      engine: config.engine,
      message: `Export failed (${config.engine} exit ${result.status}): ${(result.stderr || result.stdout || '').trim().slice(0, 400)}`,
    };
  }

  if (format === 'pdf' && figures) {
    const source = fs.readFileSync(inputPath, 'utf8');
    const expectedDiagrams = countDiagramFences(source);
    if (expectedDiagrams > 0 && !pdfRenderedDiagrams(target, source)) {
      return {
        ok: false,
        format,
        inputPath,
        outputPath: target,
        message: `Export wrote PDF but rendered 0/${expectedDiagrams} diagram(s). Ensure d2 and mmdc are installed; mmdc needs Chrome (set PUPPETEER_EXECUTABLE_PATH or install Google Chrome). Pandoc stderr: ${(result.stderr || '').trim().slice(0, 300)}`,
      };
    }
  }

  return {
    ok: true,
    format,
    inputPath,
    outputPath: target,
    engine: config.engine,
    pdfEngine: config.pdfEngine,
    figures,
    template: templatePath,
    branding: brandingPolicy,
    message: `Wrote ${path.relative(process.cwd(), target)}`,
  };
}
