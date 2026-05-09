#!/usr/bin/env node
/**
 * lib/distill.mjs — Query-focused document distillation for large context windows.
 *
 * Chunks local files, scores relevance against a query, and returns the top-k
 * evidence blocks with citations. Used by the MCP distill tool and the RAG
 * knowledge layer to reduce context before LLM calls.
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, openSync, readSync, closeSync } from 'fs';
import { join, extname, relative, dirname, basename } from 'path';
import { execSync, spawnSync } from 'child_process';
import { homedir } from 'os';
import { getActiveOverlays } from './headhunt.mjs';
import {
  EXTRACTABLE_DOCUMENT_EXTS,
  UTF8_TEXT_EXTS,
  extractDocumentText as extractSharedDocumentText,
} from './document-extract.mjs';

const TEXT_EXTS = EXTRACTABLE_DOCUMENT_EXTS;

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', '.cache']);
const MAX_FILE_BYTES = 80_000;
const MAX_DISCOVER_FILE_BYTES = 5_000_000;
const MAX_TOTAL_BYTES = 600_000;
const MAX_FILES = 80;
const DEFAULT_CHUNK_BYTES = 4_000;
const DEFAULT_CHUNK_OVERLAP = 400;

function discoverFiles(dir, maxDepth = 3, allowedExts = null) {
  const files = [];
  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries.sort()) {
      if (entry.startsWith('.') && entry !== '.env.example') continue;
      const full = join(current, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full, depth + 1);
      } else {
        const ext = extname(entry).toLowerCase();
        const match = allowedExts ? allowedExts.has(ext) : TEXT_EXTS.has(ext);
        if (match && stat.size > 0 && stat.size <= MAX_DISCOVER_FILE_BYTES) files.push({ path: full, size: stat.size, ext });
      }
    }
  }
  walk(dir, 0);
  return files;
}

function decodeBytes(buffer) {
  return Buffer.from(buffer).toString('utf8').replace(/\u0000/g, '');
}

function readBoundedText(filePath, size) {
  if (size <= MAX_FILE_BYTES) {
    return {
      content: readFileSync(filePath, 'utf8'),
      truncated: false,
      sampledBytes: size,
      originalBytes: size,
    };
  }

  const headBytes = Math.floor(MAX_FILE_BYTES * 0.6);
  const tailBytes = MAX_FILE_BYTES - headBytes;
  const fd = openSync(filePath, 'r');
  try {
    const headBuffer = Buffer.alloc(headBytes);
    const tailBuffer = Buffer.alloc(tailBytes);
    const headRead = readSync(fd, headBuffer, 0, headBytes, 0);
    const tailRead = readSync(fd, tailBuffer, 0, tailBytes, Math.max(0, size - tailBytes));
    const gap = size - headRead - tailRead;
    return {
      content: `${decodeBytes(headBuffer.subarray(0, headRead))}\n\n… [middle omitted: ${Math.max(0, gap)} bytes skipped from large file] …\n\n${decodeBytes(tailBuffer.subarray(0, tailRead))}`,
      truncated: true,
      sampledBytes: headRead + tailRead,
      originalBytes: size,
    };
  } finally {
    closeSync(fd);
  }
}

function inferDocumentTitle(relPath, content) {
  const firstHeading = content.match(/^(?:#{1,2}\s+.+|title:\s*.+)$/im)?.[0];
  if (firstHeading) return firstHeading.replace(/^#{1,2}\s+|^title:\s*/i, '').trim();
  return basename(relPath);
}

function detectHeadings(content) {
  const headings = [];
  for (const match of content.matchAll(/^(#{1,6}[ \t]+.+)$/gm)) {
    headings.push({ index: match.index || 0, text: match[1].replace(/^#{1,6}[ \t]+/, '').trim() });
  }
  return headings;
}

function headingForOffset(headings, offset) {
  let current = null;
  for (const heading of headings) {
    if (heading.index > offset) break;
    current = heading.text;
  }
  return current;
}

function chunkContent(relPath, content, { chunkBytes = DEFAULT_CHUNK_BYTES, overlap = DEFAULT_CHUNK_OVERLAP, truncated = false, originalBytes = content.length, sampledBytes = content.length } = {}) {
  const title = inferDocumentTitle(relPath, content);
  const headings = detectHeadings(content);
  const chunks = [];
  let offset = 0;
  let index = 0;
  while (offset < content.length) {
    const end = Math.min(content.length, offset + chunkBytes);
    const text = content.slice(offset, end);
    if (!text.trim()) break;
    chunks.push({
      id: `${relPath}#${index + 1}`,
      rel: relPath,
      title,
      section: headingForOffset(headings, offset),
      start: offset,
      end,
      text,
      truncated,
      originalBytes,
      sampledBytes,
    });
    if (end >= content.length) break;
    offset = Math.max(end - overlap, offset + 1);
    index += 1;
  }
  return chunks;
}

function scoreChunk(chunk, queryTerms) {
  if (queryTerms.length === 0) return 0;
  const haystack = `${chunk.title || ''}\n${chunk.section || ''}\n${chunk.text}`.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) score += 1;
  }
  if (chunk.section && queryTerms.some((term) => chunk.section.toLowerCase().includes(term))) score += 1;
  return score;
}

function selectChunks(chunks, query, maxChunks = 24) {
  if (!query) return chunks.slice(0, maxChunks);
  const queryTerms = Array.from(new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3)));
  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTerms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.rel.localeCompare(b.chunk.rel) || a.chunk.start - b.chunk.start)
    .slice(0, maxChunks)
    .map(({ chunk }) => chunk);
}

function evaluateSufficiency(chunks, query) {
  if (!query) return { status: 'not_applicable', matchedTerms: [], missingTerms: [] };
  const queryTerms = Array.from(new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3)));
  if (queryTerms.length === 0) return { status: 'not_applicable', matchedTerms: [], missingTerms: [] };

  const haystack = chunks.map((chunk) => `${chunk.title || ''}\n${chunk.section || ''}\n${chunk.text}`.toLowerCase()).join('\n');
  const matchedTerms = queryTerms.filter((term) => haystack.includes(term));
  const missingTerms = queryTerms.filter((term) => !haystack.includes(term));

  let status = 'insufficient';
  if (missingTerms.length === 0 && chunks.length > 0) status = 'sufficient';
  else if (matchedTerms.length > 0 && chunks.length > 0) status = 'partial';

  return { status, matchedTerms, missingTerms };
}

function readFiles(files, dir, options = {}) {
  const chunks = [];
  let totalBytes = 0;
  let truncatedFileCount = 0;
  for (const file of files) {
    if (chunks.length >= MAX_FILES) break;
    if (totalBytes >= MAX_TOTAL_BYTES) break;
    try {
      const bounded = UTF8_TEXT_EXTS.has(file.ext)
        ? readBoundedText(file.path, file.size)
        : (() => {
            const extracted = extractSharedDocumentText(file.path, { maxChars: MAX_FILE_BYTES });
            return {
              content: extracted.text,
              truncated: extracted.truncated,
              sampledBytes: Math.min(file.size, MAX_FILE_BYTES),
              originalBytes: file.size,
            };
          })();
      totalBytes += bounded.sampledBytes;
      if (bounded.truncated) truncatedFileCount += 1;
      chunks.push(...chunkContent(relative(dir, file.path), bounded.content, {
        ...options,
        truncated: bounded.truncated,
        originalBytes: bounded.originalBytes,
        sampledBytes: bounded.sampledBytes,
      }));
    } catch { /* skip unreadable files */ }
  }
  return { chunks, totalBytes, truncatedFileCount };
}

function buildPrompt(dir, chunks, { format, query, mode }) {
  const overlays = getActiveOverlays(dir);
  const instructions = {
    summary: `Produce a structured distillation with sections: Executive Summary, Key Themes, Decisions & Actions, Open Questions, File Index.`,
    decisions: `Focus only on decisions, recommendations, owners, deadlines, blockers, and action items.`,
    full: `Produce a comprehensive distillation with Executive Summary, Background & Context, Key Themes, Architecture & Design Decisions, Decisions & Actions, Risks & Open Questions, Glossary, and File Index.`,
    extract: `Answer the query using only the provided evidence. Output sections: Answer, Evidence, Gaps, Sufficiency (sufficient | partial | insufficient).`,
  };

  const fileBlocks = chunks.map((chunk) => {
    const meta = [
      `source=${chunk.rel}`,
      `chunk=${chunk.id}`,
      `range=${chunk.start}-${chunk.end}`,
      chunk.title ? `title=${chunk.title}` : null,
      chunk.section ? `section=${chunk.section}` : null,
    ].filter(Boolean).join(' | ');
    return `### ${meta}\n\n${chunk.text}`;
  }).join('\n\n');

  const overlayBlock = overlays.length > 0
    ? `Active domain overlays:\n${overlays.map((overlay) => `- ${overlay.domain}: ${overlay.objective}${overlay.scope ? ` (scope: ${overlay.scope})` : ''}`).join('\n')}\n\nUse overlays only as temporary scope guidance, not as permanent truth.\n\n`
    : '';

  return `You are analyzing document evidence from: ${dir}\n\nMode: ${mode}\n${query ? `Query: ${query}\n` : ''}${instructions[format] || instructions.summary}\n\nRules:\n- Use only provided evidence.\n- Prefer query-focused extraction when a query is provided.\n- Every substantive claim must cite one or more chunk IDs in inline form like [source: path#chunk].\n- If evidence is incomplete, say so explicitly.\n- Do not invent facts.\n\n${overlayBlock}---\n\n${fileBlocks}`;
}

function buildStructuredOutput(dir, chunks, { format, query, mode }) {
  const overlays = getActiveOverlays(dir);
  const sufficiency = evaluateSufficiency(chunks, query);
  const files = new Map();
  for (const chunk of chunks) {
    if (!files.has(chunk.rel)) {
      files.set(chunk.rel, {
        file: chunk.rel,
        title: chunk.title || basename(chunk.rel),
        sections: new Set(),
        chunkIds: [],
        truncated: Boolean(chunk.truncated),
        sampledBytes: Number(chunk.sampledBytes || 0),
        originalBytes: Number(chunk.originalBytes || 0),
      });
    }
    const entry = files.get(chunk.rel);
    if (chunk.section) entry.sections.add(chunk.section);
    entry.chunkIds.push(chunk.id);
    entry.truncated = entry.truncated || Boolean(chunk.truncated);
    entry.sampledBytes = Math.max(entry.sampledBytes, Number(chunk.sampledBytes || 0));
    entry.originalBytes = Math.max(entry.originalBytes, Number(chunk.originalBytes || 0));
  }

  return {
    mode,
    format,
    query: query || null,
    overlays: overlays.map((overlay) => ({
      id: overlay.id,
      domain: overlay.domain,
      objective: overlay.objective,
      scope: overlay.scope,
      attachTo: overlay.attachTo,
    })),
    fileCount: files.size,
    chunkCount: chunks.length,
    sufficiency,
    files: Array.from(files.values()).map((entry) => ({
      file: entry.file,
      title: entry.title,
      sections: Array.from(entry.sections),
      chunkIds: entry.chunkIds,
      truncated: entry.truncated,
      sampledBytes: entry.sampledBytes,
      originalBytes: entry.originalBytes,
    })),
    evidence: chunks.map((chunk) => ({
      id: chunk.id,
      file: chunk.rel,
      title: chunk.title,
      section: chunk.section,
      citation: `[source: ${chunk.id}]`,
      truncated: Boolean(chunk.truncated),
      text: chunk.text,
    })),
    prompt: buildPrompt(dir, chunks, { format, query, mode }),
  };
}

function hasClaude() {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const flags = Object.fromEntries(argv.filter((arg) => arg.startsWith('--')).map((arg) => {
    const [k, ...v] = arg.slice(2).split('=');
    return [k, v.length ? v.join('=') : true];
  }));
  return { positional, flags };
}

export async function distill(dir, { format = 'summary', query = '', mode = 'auto', out = null, depth = 3, ext = null } = {}) {
  const resolvedDir = dir.startsWith('/') ? dir : join(process.cwd(), dir);
  if (!existsSync(resolvedDir)) throw new Error(`Directory not found: ${resolvedDir}`);

  const allowedExts = ext ? new Set(ext.split(',').map((value) => value.trim().startsWith('.') ? value.trim() : `.${value.trim()}`)) : null;
  const files = discoverFiles(resolvedDir, depth, allowedExts);
  if (files.length === 0) throw new Error(`No readable text files found in ${resolvedDir}`);

  process.stderr.write(`\n🔬 Distilling ${files.length} file(s) from ${resolvedDir}\n`);
  if (files.length > MAX_FILES) process.stderr.write(`   (scanning first ${MAX_FILES} files by name order)\n`);

  const { chunks, totalBytes, truncatedFileCount } = readFiles(files, resolvedDir);
  process.stderr.write(`   Built ${chunks.length} chunk(s) · ${Math.round(totalBytes / 1024)} KB\n`);
  if (truncatedFileCount > 0) process.stderr.write(`   Sampled ${truncatedFileCount} large file(s) with bounded head/tail reads\n`);

  const selectedChunks = query ? selectChunks(chunks, query) : chunks.slice(0, 24);
  process.stderr.write(`   Selected ${selectedChunks.length} chunk(s) for analysis${query ? ' using query-focused retrieval' : ''}\n`);

  const structured = buildStructuredOutput(resolvedDir, selectedChunks, { format, query, mode });

  if (mode === 'json') {
    const output = `${JSON.stringify(structured, null, 2)}\n`;
    if (out) {
      try { mkdirSync(dirname(out), { recursive: true }); } catch { /* exists */ }
      writeFileSync(out, output);
      process.stderr.write(`✓ Distillation JSON written to: ${out}\n`);
    } else {
      process.stdout.write(output);
    }
    return structured;
  }

  const prompt = structured.prompt;
  if (mode === 'prompt' || !hasClaude()) {
    const tmpFile = out || join(homedir(), '.cx', 'distill-prompt.txt');
    try { mkdirSync(dirname(tmpFile), { recursive: true }); } catch { /* exists */ }
    writeFileSync(tmpFile, prompt);
    process.stderr.write(`\n⚠ Prompt written to: ${tmpFile}\n`);
    if (mode !== 'prompt' && !hasClaude()) process.stderr.write('   claude CLI not found. Paste the prompt into your preferred model interface.\n\n');
    return structured;
  }

  process.stderr.write('   Invoking claude --print …\n\n');
  const result = spawnSync('claude', ['--print', prompt], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });

  if (result.error) throw result.error;
  const output = result.stdout || '';
  const errOut = result.stderr || '';
  if (result.status !== 0) {
    if (errOut) process.stderr.write(`${errOut}\n`);
    throw new Error(`claude exited with status ${result.status}`);
  }

  if (out) {
    try { mkdirSync(dirname(out), { recursive: true }); } catch { /* exists */ }
    writeFileSync(out, output);
    process.stderr.write(`✓ Distillation written to: ${out}\n`);
  } else {
    process.stdout.write(output);
  }

  return structured;
}

export async function runDistillCli(argv = process.argv.slice(2)) {
  const { positional, flags } = parseArgs(argv);
  const dir = positional[0];
  if (!dir) throw new Error('Usage: construct distill <dir> [--format=summary|decisions|full|extract] [--query=TEXT] [--mode=auto|prompt|json] [--out=FILE] [--depth=N] [--ext=LIST]');
  return distill(dir, {
    format: flags.format || 'summary',
    query: typeof flags.query === 'string' ? flags.query : '',
    mode: flags.mode || 'auto',
    out: flags.out || null,
    depth: flags.depth ? parseInt(flags.depth, 10) : 3,
    ext: flags.ext || null,
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const dir = positional[0];
  if (!dir) {
    process.stderr.write('Usage: construct distill <dir> [--format=summary|decisions|full|extract] [--query=TEXT] [--mode=auto|prompt|json] [--out=FILE] [--depth=N] [--ext=LIST]\n');
    process.exit(1);
  }
  distill(dir, {
    format: flags.format || 'summary',
    query: typeof flags.query === 'string' ? flags.query : '',
    mode: flags.mode || 'auto',
    out: flags.out || null,
    depth: flags.depth ? parseInt(flags.depth, 10) : 3,
    ext: flags.ext || null,
  }).catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}
