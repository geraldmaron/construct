/**
 * lib/document-ingest.mjs — convert local source documents into normalized markdown artifacts.
 *
 * Reuses the shared extraction backends from lib/document-extract.mjs, writes
 * markdown outputs into retrieval-friendly project paths, and can optionally
 * trigger storage sync for SQL/vector indexing. The extraction step honors a
 * resolved ingest strategy (adapter | provider) with an explicit fallback policy
 * and records the selected strategy/model in the returned `ingestion` block.
 * Email attachments quarantined by lib/extractors/shared/attachment-policy.mjs
 * (construct-tsyfe.2.7) are written as a `.quarantine.json` sidecar next to the
 * output markdown, mirroring the `.assets.json` media-manifest sidecar.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { extractDocumentTextAsync, extractDocumentTextNodeNative, extractDocumentMetadata, isExtractableDocumentPath } from './document-extract.mjs';
import { syncFileStateToSql } from './storage/sync.mjs';
import { purgeExpiredData } from './storage/admin.mjs';
import { stampFrontmatter } from './doc-stamp.mjs';
import { markdownToRichDocument } from './rich-document.mjs';
import { buildAssetManifest } from './document-assets.mjs';
import { KNOWLEDGE_ROOT, KNOWLEDGE_SUBDIRS } from './knowledge/layout.mjs';
import { loadProjectConfig } from './config/project-config.mjs';
import { resolveEffectiveSourceTargetsFromConfig } from './config/source-targets.mjs';
import { resolveIngestStrategy, INGEST_STRATEGIES, INGEST_ORCHESTRATION_STRATEGIES } from './ingest/strategy.mjs';
import { extractViaProvider } from './ingest/provider-extract.mjs';
import { extractViaDoclingRemote } from './ingest/docling-remote.mjs';
import { CONFIG_DIR_NAME } from './config-dir.mjs';

const DEFAULT_TARGET_DIR = `${CONFIG_DIR_NAME}/knowledge/internal`;

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

// docling embeds figures as base64 `data:` URIs in the markdown so no pixel data
// is lost in transit. Write each to an assets/ directory beside the output file
// and rewrite the reference to a relative path, so the markdown stays small and
// the images are real files an editor or viewer can open — replacing the bare
// `<!-- image -->` placeholder docling emits by default.

export function externalizeEmbeddedImages(markdown, { mdPath }) {
  if (!markdown || !markdown.includes('data:image/')) return { markdown, assets: [] };
  const assetsRel = `assets/${basename(mdPath, '.md')}`;
  const assetsDir = join(dirname(mdPath), assetsRel.split('/').join(sep));
  const assets = [];
  let index = 0;
  const re = /!\[([^\]]*)\]\(\s*data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+?)\s*\)/g;
  const out = markdown.replace(re, (_match, alt, type, b64) => {
    index += 1;
    const ext = type.toLowerCase() === 'jpeg' ? 'jpg' : type.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const fileName = `image-${index}.${ext}`;
    if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, fileName), Buffer.from(b64.replace(/\s+/g, ''), 'base64'));
    assets.push(join(assetsDir, fileName));
    return `![${alt || `image ${index}`}](${assetsRel}/${fileName})`;
  });
  return { markdown: out, assets };
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

// Ingest writes a markdown rendering of the source, preserving the source name
// for provenance (report.pdf → report.pdf.md). A source already in markdown keeps
// its name unchanged so it never gains a second extension (_template.md →
// _template.md, not _template.md.md).

function markdownOutputName(sourcePath) {
  const base = basename(sourcePath);
  return /\.md$/i.test(base) ? base : `${base}.md`;
}

function resolveOutputPath(sourcePath, { cwd, outputPath, outputDir, target }) {
  if (outputPath) return normalizeOutputPath(outputPath, cwd);
  if (target === 'sibling') {
    return join(dirname(sourcePath), markdownOutputName(sourcePath));
  }
  // knowledge/<subdir> targets land in .construct/knowledge/<subdir>/
  if (target.startsWith('knowledge/')) {
    const sub = target.slice('knowledge/'.length);
    const resolvedDir = normalizeOutputPath(`${KNOWLEDGE_ROOT}/${sub}`, cwd);
    return join(resolvedDir, markdownOutputName(sourcePath));
  }
  const resolvedDir = normalizeOutputPath(outputDir || DEFAULT_TARGET_DIR, cwd);
  return join(resolvedDir, markdownOutputName(sourcePath));
}

// The high-fidelity (docling) path provisions a Python venv and downloads ML
// models on first use, then runs layout inference on the document — any of which
// can stall (a large PDF, a slow model download) or fail. Without a bound the
// caller hangs: the CLI never returns, and the ingest_document MCP tool blocks
// until the client times out and surfaces an opaque error. Bound the whole
// docling attempt and fall back to the node-native extractor so ingest always
// returns a usable result, with the fallback recorded in droppedInfo. Override
// the bound with CONSTRUCT_DOCLING_TIMEOUT_MS (0 disables the timeout).

const DOCLING_TIMEOUT_MS = (() => {
  const raw = Number(process.env.CONSTRUCT_DOCLING_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 600_000;
})();

// A caller of withTimeout that gives up on `promise` still has whatever
// produced it running underneath — for the docling extractor, a still-live
// sidecar process. `onTimeout` lets a caller signal that abandonment
// downstream instead of only rejecting and leaving the real work orphaned
// (construct-4uxq0.9.13); it fires once, after reject, and never blocks the
// rejection on its own completion.

export function withTimeout(promise, ms, onTimeoutMessage, { onTimeout } = {}) {
  if (!ms) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(onTimeoutMessage), { code: 'DOCLING_TIMEOUT' }));
      if (typeof onTimeout === 'function') {
        try { onTimeout(); } catch { /* cancellation signal is best-effort */ }
      }
    }, ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// A caller-supplied timeoutMs shorter than docling-client.mjs's own internal
// per-request timeout means this bound can fire while the sidecar is still
// mid-conversion, before the client's own timeout would have killed it.
// Killing it here applies the same "no interruption API, so kill" tradeoff
// docling-client.mjs documents at its own layer, from one layer up. The
// import is dynamic so a caller that never touches docling paths doesn't
// pull in the sidecar module.

async function killDoclingSidecarOnAbandon() {
  const { killActiveDoclingSidecar } = await import('./document-extract/docling-client.mjs');
  killActiveDoclingSidecar();
}

/**
 * Run the high-fidelity (docling) extractor with a bound, falling back to the
 * node-native extractor on timeout or any failure so a caller never hangs. The
 * extractor functions are injectable for testing; production uses the real
 * docling-async and node-native extractors.
 */
export async function extractWithDoclingFallback(sourcePath, {
  maxChars = null,
  timeoutMs = DOCLING_TIMEOUT_MS,
  asyncExtract = extractDocumentTextAsync,
  nodeNativeExtract = extractDocumentTextNodeNative,
  onTimeout = killDoclingSidecarOnAbandon,
} = {}) {
  try {
    return await withTimeout(
      asyncExtract(sourcePath, { maxChars }),
      timeoutMs,
      `docling extraction exceeded ${Math.round(timeoutMs / 1000)}s`,
      { onTimeout },
    );
  } catch (err) {
    const fallback = await nodeNativeExtract(sourcePath, { maxChars });
    fallback.droppedInfo = [
      ...(fallback.droppedInfo ?? []),
      {
        kind: 'docling-fallback',
        count: 1,
        reason: `High-fidelity (docling) extraction failed or timed out (${err.message}); used the node-native extractor. Re-run after \`construct install --with-docling\`, or pass --fidelity=fast to skip docling.`,
        recoverable: true,
      },
    ];
    return fallback;
  }
}

// The default adapter path prefers the Node-native extractor (unpdf/mammoth) so
// plain PDF/DOCX ingest needs no Python venv; high-fidelity stays on docling for
// scanned/layout-critical content and formats without a Node backend.

function extractViaAdapter(sourcePath, { highFidelity, maxChars }) {
  return highFidelity
    ? extractWithDoclingFallback(sourcePath, { maxChars })
    : extractDocumentTextNodeNative(sourcePath, { maxChars });
}

async function extractWithStrategy(sourcePath, { strategy, fallback, model, provider, highFidelity, maxChars, env }) {
  const primary = strategy === 'provider' || strategy === 'docling-remote' ? strategy : 'adapter';
  const run = (mode) => (mode === 'provider'
    ? extractViaProvider({ filePath: sourcePath, model, provider, maxChars, env })
    : mode === 'docling-remote'
      ? extractViaDoclingRemote({ filePath: sourcePath, maxChars, env })
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
  as = null,
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

  // `--as=<targetId>` binds ingested knowledge to a registered source target so
  // the written files carry re-verifiable provenance (origin_target_id /
  // origin_provider in the stamp) rather than landing unattributed. An unknown
  // id is a hard error — silently dropping the binding would defeat the point.
  let originFields = null;
  if (as) {
    const targets = resolveEffectiveSourceTargetsFromConfig(config, env);
    const bound = targets.find((t) => t.id === as);
    if (!bound) {
      const known = targets.map((t) => t.id).join(', ') || '(none registered)';
      const err = new Error(`ingest --as: unknown source target "${as}". Known targets: ${known}`);
      err.code = 'INGEST_UNKNOWN_TARGET';
      throw err;
    }
    originFields = { origin_target_id: bound.id, origin_provider: bound.provider };
  }
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
    const { markdown: bodyText, assets: imageAssets } = externalizeEmbeddedImages(extracted.text, { mdPath: finalPath });
    const markdown = renderMarkdown({
      sourcePath,
      extractedAt,
      title,
      extractionMethod: extracted.extractionMethod,
      characters: extracted.characters,
      truncated: extracted.truncated,
      text: bodyText,
      outputPath: finalPath,
      cwd,
      metadata,
    });
    writeFileSync(finalPath, stampFrontmatter(markdown, { generator: 'construct/ingest', extraFields: originFields }));

    // The asset manifest is derived from the ingested content's RichDocument (ADR-0073) and written
    // beside the markdown as a `.assets.json` sidecar, so the export side can preserve/embed media by
    // policy and fail closed on a broken local ref (construct-d1r7.10). Media refs resolve against the
    // markdown's own directory, where externalizeEmbeddedImages just wrote the assets/ tree.

    const assetBaseDir = dirname(finalPath);
    const richDoc = markdownToRichDocument(bodyText, { title });
    const assetManifest = buildAssetManifest(richDoc, { baseDir: assetBaseDir });
    let manifestPath = null;
    if (assetManifest.assets.length) {
      manifestPath = join(assetBaseDir, `${basename(finalPath, extname(finalPath))}.assets.json`);
      writeFileSync(manifestPath, `${JSON.stringify(assetManifest, null, 2)}\n`);
    }

    // Email attachments that failed lib/extractors/shared/attachment-policy.mjs's
    // size/count/zip-bomb checks (construct-tsyfe.2.7) are quarantined — content
    // withheld, disposition recorded — rather than silently dropped. The record
    // is written beside the markdown as a `.quarantine.json` sidecar, mirroring
    // the `.assets.json` sidecar convention above, so a reviewer can inspect
    // exactly what was withheld and why without re-parsing the source email.

    const quarantinedAttachments = (extracted.attachmentProvenance ?? []).filter((a) => a.disposition === 'quarantined');
    let quarantinePath = null;
    if (quarantinedAttachments.length) {
      quarantinePath = join(assetBaseDir, `${basename(finalPath, extname(finalPath))}.quarantine.json`);
      writeFileSync(quarantinePath, `${JSON.stringify({ sourcePath, quarantined: quarantinedAttachments }, null, 2)}\n`);
    }

    results.push({
      sourcePath,
      outputPath: finalPath,
      extension: extracted.extension,
      extractionMethod: extracted.extractionMethod,
      truncated: extracted.truncated,
      characters: extracted.characters,
      droppedInfo: extracted.droppedInfo ?? [],
      structured: extracted.structured ?? null,
      images: imageAssets.map((p) => relative(cwd, p)),
      assetManifest: manifestPath ? relative(cwd, manifestPath) : null,
      assets: assetManifest.assets,
      quarantine: quarantinePath ? relative(cwd, quarantinePath) : null,
      metadata: { title, authors: metadata?.authors || [], dates: metadata?.dates || {} },
    });
  }

  let syncResult = null;
  if (sync) {
    syncResult = await syncFileStateToSql(cwd, {
      env,
      project: inferProjectName(cwd),
    });

    // Retention purge on every real sync, matching the MCP storage_sync tool
    // (lib/mcp/tools/storage.mjs) — best-effort since eviction must never
    // block a successful ingest.
    try {
      const purge = await purgeExpiredData(cwd, { env, project: inferProjectName(cwd) });
      if (purge.status === 'ok') syncResult = { ...syncResult, retention: purge };
    } catch { /* best effort */ }
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
    fidelity: highFidelity ? 'high' : 'fast',
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
  let as = null;
  let sync = false;
  let strict = false;
  let fidelity = 'high';
  let strategy = null;
  let orchestration = null;

  for (const arg of argv) {
    if (arg.startsWith('--out=')) outputPath = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--out-dir=')) outputDir = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--target=')) target = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--as=')) as = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--strategy=')) strategy = arg.split('=').slice(1).join('=');
    else if (arg === '--strategy') strategy = '';
    else if (arg.startsWith('--orchestration=')) orchestration = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--fidelity=')) {
      const value = arg.split('=').slice(1).join('=');
      if (value !== 'fast' && value !== 'high') {
        throw new Error(`Unsupported fidelity: ${value}. Valid values: fast, high`);
      }
      fidelity = value;
    } else if (arg === '--sync') sync = true;
    else if (arg === '--strict') strict = true;
    else if (arg === '--legacy-extractor') fidelity = 'fast';
    else if (strategy === '') strategy = arg;
    else inputs.push(arg);
  }

  const highFidelity = fidelity === 'high';

  if (inputs.length === 0) {
    throw new Error(
      `Usage: construct ingest <file-or-dir> [more paths] [--out=FILE] [--out-dir=DIR] ` +
      `[--target=sibling|knowledge/<subdir>] [--as=<targetId>] [--strategy=adapter|provider] [--orchestration=prompt-only|orchestrated] [--sync] [--strict] [--fidelity=fast|high]\n` +
      `  --as: bind ingested knowledge to a registered source target; stamps origin provenance\n` +
      `  --strategy: extraction strategy override (adapter = local extractors; provider = configured provider/model)\n` +
      `  --orchestration: prompt-only (deterministic extraction) or orchestrated (engage the specialist chain)\n` +
      `  --strict: exit non-zero if any extraction drops occur\n` +
      `  --fidelity=fast|high: fast = node-native extractors; high = docling (default)\n` +
      `  --legacy-extractor: deprecated alias for --fidelity=fast\n` +
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

  return ingestDocuments(inputs, { cwd, outputPath, outputDir, target, as: as || null, sync, strict, highFidelity, strategy: strategy || null, orchestration: orchestration || null, env });
}
