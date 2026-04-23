/**
 * lib/document-ingest.mjs — convert local source documents into normalized markdown artifacts.
 *
 * Reuses the shared extraction backends from lib/document-extract.mjs, writes
 * markdown outputs into retrieval-friendly project paths, and can optionally
 * trigger storage sync for SQL/vector indexing.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { extractDocumentText, isExtractableDocumentPath } from './document-extract.mjs';
import { syncFileStateToSql } from './storage/sync.mjs';
import { stampFrontmatter } from './doc-stamp.mjs';

const DEFAULT_TARGET_DIR = '.cx/product-intel/sources/ingested';

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function normalizeOutputPath(value, cwd) {
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function formatTitle(sourcePath) {
  return basename(sourcePath).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Ingested document';
}

function inferProjectName(rootDir) {
  const name = basename(resolve(rootDir)).trim();
  return slugify(name || 'construct') || 'construct';
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function nextAvailablePath(targetPath) {
  if (!existsSync(targetPath)) return targetPath;
  const parsed = parse(targetPath);
  let index = 2;
  while (true) {
    const candidate = join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!existsSync(candidate)) return candidate;
    index += 1;
  }
}

function renderMarkdown({ sourcePath, extractedAt, title, extractionMethod, characters, truncated, text, outputPath, cwd }) {
  const relSource = relative(cwd, sourcePath) || basename(sourcePath);
  const relOutput = relative(cwd, outputPath) || basename(outputPath);
  return [
    '---',
    `source_path: ${JSON.stringify(sourcePath)}`,
    `source_relative_path: ${JSON.stringify(relSource)}`,
    `source_extension: ${JSON.stringify(extname(sourcePath).toLowerCase())}`,
    `extracted_at: ${JSON.stringify(extractedAt)}`,
    `extraction_method: ${JSON.stringify(extractionMethod)}`,
    `characters: ${characters}`,
    `truncated: ${truncated ? 'true' : 'false'}`,
    `output_path: ${JSON.stringify(outputPath)}`,
    `output_relative_path: ${JSON.stringify(relOutput)}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## Source',
    '',
    `- File: \`${relSource}\``,
    `- Method: \`${extractionMethod}\``,
    `- Characters: ${characters}`,
    `- Truncated: ${truncated ? 'yes' : 'no'}`,
    `- Extracted at: ${extractedAt}`,
    '',
    '## Extracted Content',
    '',
    text,
    '',
  ].join('\n');
}

function collectInputFiles(inputPath) {
  const resolvedPath = resolve(inputPath);
  if (!existsSync(resolvedPath)) throw new Error(`Input path not found: ${resolvedPath}`);

  const stat = statSync(resolvedPath);
  if (stat.isFile()) {
    if (!isExtractableDocumentPath(resolvedPath)) return [];
    return [resolvedPath];
  }

  if (!stat.isDirectory()) return [];

  const files = [];
  const stack = [resolvedPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && isExtractableDocumentPath(full)) files.push(full);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function resolveOutputPath(sourcePath, { cwd, outputPath, outputDir, target }) {
  if (outputPath) return normalizeOutputPath(outputPath, cwd);
  if (target === 'sibling') {
    return join(dirname(sourcePath), `${basename(sourcePath)}.md`);
  }
  const resolvedDir = normalizeOutputPath(outputDir || DEFAULT_TARGET_DIR, cwd);
  return join(resolvedDir, `${basename(sourcePath)}.md`);
}

export async function ingestDocuments(inputPaths, {
  cwd = process.cwd(),
  outputPath = null,
  outputDir = null,
  target = 'product-intel',
  sync = false,
  env = process.env,
} = {}) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error('At least one input path is required');
  }
  if (outputPath && inputPaths.length > 1) {
    throw new Error('--out can only be used with a single input path');
  }

  const files = inputPaths.flatMap((inputPath) => collectInputFiles(isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath)));
  if (files.length === 0) {
    throw new Error('No supported document files found');
  }

  const results = [];
  for (const sourcePath of files) {
    const extracted = extractDocumentText(sourcePath, { maxChars: 200_000 });
    const targetPath = resolveOutputPath(sourcePath, { cwd, outputPath, outputDir, target });
    ensureDir(dirname(targetPath));
    const finalPath = nextAvailablePath(targetPath);
    const extractedAt = new Date().toISOString();
    const markdown = renderMarkdown({
      sourcePath,
      extractedAt,
      title: formatTitle(sourcePath),
      extractionMethod: extracted.extractionMethod,
      characters: extracted.characters,
      truncated: extracted.truncated,
      text: extracted.text,
      outputPath: finalPath,
      cwd,
    });
    writeFileSync(finalPath, stampFrontmatter(markdown, { generator: 'construct/ingest' }));
    results.push({
      sourcePath,
      outputPath: finalPath,
      extension: extracted.extension,
      extractionMethod: extracted.extractionMethod,
      truncated: extracted.truncated,
      characters: extracted.characters,
    });
  }

  let syncResult = null;
  if (sync) {
    syncResult = await syncFileStateToSql(cwd, {
      env,
      project: inferProjectName(cwd),
    });
  }

  return {
    status: 'ok',
    target: outputPath ? 'custom' : target,
    outputDir: outputPath ? dirname(normalizeOutputPath(outputPath, cwd)) : normalizeOutputPath(outputDir || DEFAULT_TARGET_DIR, cwd),
    indexedLocally: true,
    storageSync: syncResult,
    files: results,
  };
}

export async function runIngestCli(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env } = {}) {
  const inputs = [];
  let outputPath = null;
  let outputDir = null;
  let target = 'product-intel';
  let sync = false;

  for (const arg of argv) {
    if (arg.startsWith('--out=')) outputPath = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--out-dir=')) outputDir = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--target=')) target = arg.split('=').slice(1).join('=');
    else if (arg === '--sync') sync = true;
    else inputs.push(arg);
  }

  if (inputs.length === 0) {
    throw new Error('Usage: construct ingest <file-or-dir> [more paths] [--out=FILE] [--out-dir=DIR] [--target=product-intel|sibling] [--sync]');
  }
  if (!['product-intel', 'sibling'].includes(target)) {
    throw new Error(`Unsupported target: ${target}`);
  }

  return ingestDocuments(inputs, { cwd, outputPath, outputDir, target, sync, env });
}

