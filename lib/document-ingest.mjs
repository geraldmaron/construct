/**
 * lib/document-ingest.mjs — convert local source documents into normalized markdown artifacts.
 *
 * Reuses the shared extraction backends from lib/document-extract.mjs, writes
 * markdown outputs into retrieval-friendly project paths, and can optionally
 * trigger storage sync for SQL/vector indexing. The extraction step honors a
 * resolved ingest strategy (adapter | provider) with an explicit fallback policy
 * and records the selected strategy/model in the returned `ingestion` block.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { extractDocumentText, extractDocumentTextAsync, extractDocumentMetadata, isExtractableDocumentPath } from './document-extract.mjs';
import { syncFileStateToSql } from './storage/sync.mjs';
import { stampFrontmatter } from './doc-stamp.mjs';
import { KNOWLEDGE_ROOT, KNOWLEDGE_SUBDIRS } from './knowledge/layout.mjs';
import { loadProjectConfig } from './config/project-config.mjs';
import { resolveIngestStrategy, INGEST_STRATEGIES, INGEST_ORCHESTRATION_STRATEGIES } from './ingest/strategy.mjs';
import { extractViaProvider } from './ingest/provider-extract.mjs';

const DEFAULT_TARGET_DIR = '.cx/knowledge/internal';

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

function renderMarkdown({ sourcePath, extractedAt, title, extractionMethod, characters, truncated, text, outputPath, cwd, metadata }) {
  const relSource = relative(cwd, sourcePath) || basename(sourcePath);
  const relOutput = relative(cwd, outputPath) || basename(outputPath);
  const lines = [
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
  ];
  if (metadata?.authors?.length) lines.push(`authors: [${metadata.authors.map((a) => JSON.stringify(a)).join(', ')}]`);
  if (metadata?.dates && Object.keys(metadata.dates).length) {
    for (const [k, v] of Object.entries(metadata.dates)) lines.push(`source_${k}: ${JSON.stringify(v)}`);
  }
  if (metadata?.links?.length) lines.push(`source_links_count: ${metadata.links.length}`);
  lines.push('---', '', `# ${title}`, '', '## Source', '', `- File: \`${relSource}\``, `- Method: \`${extractionMethod}\``, `- Characters: ${characters}`, `- Truncated: ${truncated ? 'yes' : 'no'}`, `- Extracted at: ${extractedAt}`);
  if (metadata?.authors?.length) lines.push(`- Authors: ${metadata.authors.join(', ')}`);
  lines.push('', '## Extracted Content', '', text, '');
  return lines.join('\n');
}

function collectInputFiles(inputPath, { maxDepth = 10 } = {}) {
  const resolvedPath = resolve(inputPath);
  if (!existsSync(resolvedPath)) throw new Error(`Input path not found: ${resolvedPath}`);

  const stat = statSync(resolvedPath);
  if (stat.isFile()) {
    if (!isExtractableDocumentPath(resolvedPath)) return [];
    return [resolvedPath];
  }

  if (!stat.isDirectory()) return [];

  const files = [];
  const stack = [{ path: resolvedPath, depth: 0 }];
  while (stack.length > 0) {
    const { path: current, depth } = stack.pop();
    if (depth >= maxDepth) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push({ path: full, depth: depth + 1 });
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
  // knowledge/<subdir> targets land in .cx/knowledge/<subdir>/
  if (target.startsWith('knowledge/')) {
    const sub = target.slice('knowledge/'.length);
    const resolvedDir = normalizeOutputPath(`${KNOWLEDGE_ROOT}/${sub}`, cwd);
    return join(resolvedDir, `${basename(sourcePath)}.md`);
  }
  const resolvedDir = normalizeOutputPath(outputDir || DEFAULT_TARGET_DIR, cwd);
  return join(resolvedDir, `${basename(sourcePath)}.md`);
}

function extractViaAdapter(sourcePath, { highFidelity, maxChars }) {
  return highFidelity
    ? extractDocumentTextAsync(sourcePath, { maxChars })
    : extractDocumentText(sourcePath, { maxChars });
}

async function extractWithStrategy(sourcePath, { strategy, fallback, model, provider, highFidelity, maxChars, env }) {
  const primary = strategy === 'provider' ? 'provider' : 'adapter';
  const run = (mode) => (mode === 'provider'
    ? extractViaProvider({ filePath: sourcePath, model, provider, maxChars, env })
    : extractViaAdapter(sourcePath, { highFidelity, maxChars }));

  try {
    const extracted = await run(primary);
    return { extracted, strategyUsed: primary, fallbackApplied: null, error: null };
  } catch (primaryErr) {
    if (fallback === 'none' || fallback === primary) {
      const err = new Error(`ingest ${primary} strategy failed and fallback is "${fallback}": ${primaryErr.message}`);
      err.code = primaryErr.code || 'INGEST_STRATEGY_FAILED';
      err.cause = primaryErr;
      throw err;
    }
    const extracted = await run(fallback);
    return {
      extracted,
      strategyUsed: fallback,
      fallbackApplied: { from: primary, to: fallback, reason: primaryErr.message, code: primaryErr.code || 'INGEST_STRATEGY_FAILED' },
      error: null,
    };
  }
}

export async function ingestDocuments(inputPaths, {
  cwd = process.cwd(),
  outputPath = null,
  outputDir = null,
  target = 'knowledge/internal',
  sync = false,
  strict = false,
  highFidelity = true,
  strategy = null,
  orchestration = null,
  env = process.env,
} = {}) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error('At least one input path is required');
  }
  if (outputPath && inputPaths.length > 1) {
    throw new Error('--out can only be used with a single input path');
  }

  const files = inputPaths.flatMap((inputPath) => collectInputFiles(isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath), { maxDepth: 10 }));
  if (files.length === 0) {
    throw new Error('No supported document files found');
  }

  const { config } = loadProjectConfig(cwd, env);
  const resolvedStrategy = resolveIngestStrategy({ config, env, override: strategy, orchestrationOverride: orchestration, cwd });

  const results = [];
  let totalDrops = 0;
  let fallbackApplied = null;
  for (const sourcePath of files) {
    const routed = await extractWithStrategy(sourcePath, {
      strategy: resolvedStrategy.strategy,
      fallback: resolvedStrategy.fallback,
      model: resolvedStrategy.model,
      provider: resolvedStrategy.provider,
      highFidelity,
      maxChars: 200_000,
      env,
    });
    const extracted = routed.extracted;
    if (routed.fallbackApplied) fallbackApplied = routed.fallbackApplied;
    totalDrops += (extracted.droppedInfo ?? []).reduce((a, d) => a + (Number(d.count) || 1), 0);
    const metadata = extractDocumentMetadata(sourcePath);
    const targetPath = resolveOutputPath(sourcePath, { cwd, outputPath, outputDir, target });
    ensureDir(dirname(targetPath));
    const finalPath = nextAvailablePath(targetPath);
    const extractedAt = new Date().toISOString();
    const title = metadata?.title || formatTitle(sourcePath);
    const markdown = renderMarkdown({
      sourcePath,
      extractedAt,
      title,
      extractionMethod: extracted.extractionMethod,
      characters: extracted.characters,
      truncated: extracted.truncated,
      text: extracted.text,
      outputPath: finalPath,
      cwd,
      metadata,
    });
    writeFileSync(finalPath, stampFrontmatter(markdown, { generator: 'construct/ingest' }));
    results.push({
      sourcePath,
      outputPath: finalPath,
      extension: extracted.extension,
      extractionMethod: extracted.extractionMethod,
      truncated: extracted.truncated,
      characters: extracted.characters,
      droppedInfo: extracted.droppedInfo ?? [],
      structured: extracted.structured ?? null,
      metadata: { title, authors: metadata?.authors || [], dates: metadata?.dates || {} },
    });
  }

  let syncResult = null;
  if (sync) {
    syncResult = await syncFileStateToSql(cwd, {
      env,
      project: inferProjectName(cwd),
    });
  }

  if (strict && totalDrops > 0) {
    const err = new Error(`--strict: ${totalDrops} dropped items across ${results.filter(r => r.droppedInfo.length).length} files`);
    err.code = 'INGEST_DROPS';
    err.droppedInfo = results.flatMap((r) => r.droppedInfo.map((d) => ({ ...d, sourcePath: r.sourcePath })));
    throw err;
  }

  return {
    status: 'ok',
    target: outputPath ? 'custom' : target,
    outputDir: outputPath
      ? dirname(normalizeOutputPath(outputPath, cwd))
      : target === 'sibling'
        ? null
        : target.startsWith('knowledge/')
          ? normalizeOutputPath(`${KNOWLEDGE_ROOT}/${target.slice('knowledge/'.length)}`, cwd)
          : normalizeOutputPath(outputDir || DEFAULT_TARGET_DIR, cwd),
    indexedLocally: true,
    storageSync: syncResult,
    files: results,
    droppedInfo: results.flatMap((r) => r.droppedInfo.map((d) => ({ ...d, sourcePath: r.sourcePath }))),
    droppedCount: totalDrops,
    highFidelity,
    ingestion: {
      strategy: resolvedStrategy.strategy,
      fallback: resolvedStrategy.fallback,
      orchestration: resolvedStrategy.orchestration,
      model: resolvedStrategy.model,
      provider: resolvedStrategy.provider,
      fallbackApplied,
      execution: resolvedStrategy.execution,
    },
  };
}

export async function runIngestCli(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env } = {}) {
  const inputs = [];
  let outputPath = null;
  let outputDir = null;
  let target = 'knowledge/internal';
  let sync = false;
  let strict = false;
  let highFidelity = true;
  let strategy = null;
  let orchestration = null;

  for (const arg of argv) {
    if (arg.startsWith('--out=')) outputPath = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--out-dir=')) outputDir = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--target=')) target = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--strategy=')) strategy = arg.split('=').slice(1).join('=');
    else if (arg === '--strategy') strategy = '';
    else if (arg.startsWith('--orchestration=')) orchestration = arg.split('=').slice(1).join('=');
    else if (arg === '--sync') sync = true;
    else if (arg === '--strict') strict = true;
    else if (arg === '--legacy-extractor') highFidelity = false;
    else if (strategy === '') strategy = arg;
    else inputs.push(arg);
  }

  if (inputs.length === 0) {
    throw new Error(
      `Usage: construct ingest <file-or-dir> [more paths] [--out=FILE] [--out-dir=DIR] ` +
      `[--target=sibling|knowledge/<subdir>] [--strategy=adapter|provider] [--orchestration=prompt-only|orchestrated] [--sync] [--strict] [--legacy-extractor]\n` +
      `  --strategy: extraction strategy override (adapter = local extractors; provider = configured provider/model)\n` +
      `  --orchestration: prompt-only (deterministic extraction) or orchestrated (engage the specialist chain)\n` +
      `  --strict: exit non-zero if any extraction drops occur\n` +
      `  --legacy-extractor: use the pre-docling regex extractor (lower fidelity)\n` +
      `  knowledge subdirs: ${KNOWLEDGE_SUBDIRS.join(', ')}`,
    );
  }
  if (strategy !== null && strategy !== '' && !INGEST_STRATEGIES.includes(strategy)) {
    throw new Error(`Unsupported strategy: ${strategy}. Valid strategies: ${INGEST_STRATEGIES.join(', ')}`);
  }
  if (orchestration !== null && !INGEST_ORCHESTRATION_STRATEGIES.includes(orchestration)) {
    throw new Error(`Unsupported orchestration: ${orchestration}. Valid values: ${INGEST_ORCHESTRATION_STRATEGIES.join(', ')}`);
  }
  const knowledgeTargets = KNOWLEDGE_SUBDIRS.map((s) => `knowledge/${s}`);
  if (!['sibling', ...knowledgeTargets].includes(target)) {
    throw new Error(
      `Unsupported target: ${target}. Valid targets: sibling, ${knowledgeTargets.join(', ')}`,
    );
  }

  return ingestDocuments(inputs, { cwd, outputPath, outputDir, target, sync, strict, highFidelity, strategy: strategy || null, orchestration: orchestration || null, env });
}
