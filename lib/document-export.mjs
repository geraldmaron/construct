/**
 * lib/document-export.mjs — markdown → PDF / DOCX / HTML export via external
 * binaries (Pandoc + Typst), per ADR-0024.
 *
 * Optional pandoc-ext/diagram Lua filter renders fenced d2/mermaid blocks at
 * export time with distribution brand themes via lib/diagram-export.mjs.
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

export const EXPORT_FORMATS = ['pdf', 'docx', 'html'];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FORMAT_ENGINES = {
  pdf: { engine: 'pandoc', pdfEngine: 'typst', extraBinaries: ['typst'] },
  docx: { engine: 'pandoc', pdfEngine: null, extraBinaries: [] },
  html: { engine: 'pandoc', pdfEngine: null, extraBinaries: [] },
};

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

export function pdfUsesBundledInter(pdfPath) {
  try {
    const data = fs.readFileSync(pdfPath);
    const text = data.toString('latin1');
    return /Geist-Regular|Geist-SemiBold|GeistMono/.test(text);
  } catch {
    return false;
  }
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
  return `Install ${name} to enable this export format.`;
}

export function detect(format, env = process.env, {
  figures = false,
  artifactType = null,
  cwd = process.cwd(),
  repoRoot = REPO_ROOT,
} = {}) {
  const config = FORMAT_ENGINES[format];
  if (!config) return { ok: false, format, present: false, missing: [], message: `Unsupported format: ${format}. Supported: ${EXPORT_FORMATS.join(', ')}.` };
  const required = [config.engine, ...(config.extraBinaries || [])];
  if (format === 'pdf') {
    const template = detectPdfTemplate({ artifactType, cwd, repoRoot });
    if (!template.present) required.push('construct-pdf.typ');
  }
  if (figures) {
    if (!fs.existsSync(diagramFilterPath())) required.push('diagram.lua');
    if (!whichBin('d2', env) && !whichBin('dot', env)) required.push('d2');
    if (!whichBin('mmdc', env)) required.push('mmdc');
  }
  const status = required.map((name) => ({ name, path: name.endsWith('.lua') ? (fs.existsSync(diagramFilterPath()) ? diagramFilterPath() : null) : whichBin(name, env), version: null }));
  for (const s of status) if (s.path && !s.name.endsWith('.lua')) s.version = binVersion(s.name, ['--version'], env);
  const missing = status.filter((s) => !s.path).map((s) => s.name);
  return {
    ok: true,
    format,
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
  if (format === 'pdf' && metadata?.title) {
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

export function exportMarkdown({
  inputPath,
  outputPath,
  format,
  figures = false,
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

  const detection = detect(format, effectiveEnv, { figures, artifactType: resolvedType, cwd, repoRoot });
  if (!detection.present) {
    return { ok: false, format, inputPath, missing: detection.missing, message: detection.message };
  }

  const config = FORMAT_ENGINES[format];
  const target = path.resolve(outputPath || defaultOutputPath(inputPath, format));
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const prepared = prepareExportInput(inputPath, { format, figures, metadata });
  const templatePath = format === 'pdf'
    ? resolvePdfTemplatePath({ artifactType: resolvedType, cwd, repoRoot })
    : null;

  const args = ['-f', 'markdown', '-o', target, '--standalone'];
  if (config.pdfEngine) args.push(`--pdf-engine=${config.pdfEngine}`);
  if (format === 'pdf') {
    if (templatePath) args.push('--template', templatePath);
    args.push(...pdfEngineFontOpts(repoRoot));
    args.push(...pandocMetadataArgs({
      title: metadata.title,
      subtitle: metadata.subtitle,
      date: metadata.date,
      status: metadata.status,
      owner: metadata.owner,
      artifactType: resolvedType || metadata.artifactType,
      version: metadata.version,
      docId: metadata.docId,
      classification: metadata.classification,
    }));
  }
  if (figures && fs.existsSync(diagramFilterPath())) {
    args.push('--lua-filter', diagramFilterPath());
  }
  args.push(path.resolve(prepared.inputPath));

  const spawnCwd = templatePath ? path.dirname(templatePath) : path.dirname(prepared.inputPath);

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
    message: `Wrote ${path.relative(process.cwd(), target)}`,
  };
}
