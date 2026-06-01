/**
 * lib/ingest/pipeline.mjs — orchestrate the content-hashed ingest pipeline.
 *
 * Flow: hash → de-dup → extract via docling/whisper → chunk → write to
 * .cx/ingest/<sha>/. Returns a record describing what was stored along
 * with any droppedInfo surfaced by the extractor.
 *
 * Idempotent: re-ingesting the same content (by sha256) returns the
 * existing record without re-extracting.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDocumentTextAsync } from '../document-extract.mjs';
import { hashFile, defaultIngestRoot, readRecord, writeRecord } from './store.mjs';
import { chunkMarkdown } from './chunker.mjs';

export async function ingestFile(filePath, { cwd = process.cwd(), force = false } = {}) {
  const absPath = path.resolve(filePath);
  const stat = await fs.stat(absPath);
  if (!stat.isFile()) throw new Error(`not a regular file: ${absPath}`);

  const root = defaultIngestRoot(cwd);
  const sha256 = await hashFile(absPath);

  if (!force) {
    const existing = await readRecord(root, sha256);
    if (existing) return { ...existing, status: 'cached' };
  }

  const extracted = await extractDocumentTextAsync(absPath);
  const markdown = extracted.markdown ?? extracted.text ?? '';
  const chunks = chunkMarkdown(markdown);

  const source = {
    sourcePath: absPath,
    fileName: path.basename(absPath),
    extension: extracted.extension,
    bytes: stat.size,
    sha256,
    ingestedAt: new Date().toISOString(),
  };

  const meta = {
    extractionMethod: extracted.extractionMethod,
    extractorMetadata: extracted.metadata ?? null,
    droppedInfo: extracted.droppedInfo ?? [],
    chunkCount: chunks.length,
    chunkChars: chunks.reduce((a, c) => a + c.chars, 0),
  };

  const record = await writeRecord(root, { sha256, source, meta, markdown });
  return { ...record, status: 'ingested', droppedInfo: meta.droppedInfo, chunks };
}
