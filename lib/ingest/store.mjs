/**
 * lib/ingest/store.mjs — content-addressed ingest store at .cx/ingest/<hash>/.
 *
 * Each ingested document is stored under its SHA-256 content hash:
 *   .cx/ingest/<sha256>/source.json   — original path, size, sha256, ingestedAt
 *   .cx/ingest/<sha256>/markdown.md   — extracted markdown body
 *   .cx/ingest/<sha256>/meta.json     — extractor metadata, droppedInfo, chunks
 *
 * Idempotent: re-ingesting a file with the same content is a no-op (returns
 * the existing record). Re-running ingestion is the safe default.
 *
 * 2026-06 best practice notes:
 *   - SHA-256 is still the universal content-addressing primitive. BLAKE3 is
 *     ~2.3× faster on M-series and worth considering at multi-GB scale,
 *     but is not the industry default and adds an unfamiliar dependency.
 *     Revisit if ingest throughput becomes a measured bottleneck.
 *   - Storing markdown body separately from metadata keeps the embedding
 *     and search paths simple: they only read markdown.md and look up
 *     provenance from meta.json on demand.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export function defaultIngestRoot(cwd = process.cwd()) {
  return path.join(cwd, '.cx', 'ingest');
}

export async function hashFile(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function recordDirFor(root, sha256) {
  return path.join(root, sha256);
}

export async function readRecord(root, sha256) {
  const dir = recordDirFor(root, sha256);
  try {
    const [source, meta, markdown] = await Promise.all([
      fs.readFile(path.join(dir, 'source.json'), 'utf8').then(JSON.parse),
      fs.readFile(path.join(dir, 'meta.json'), 'utf8').then(JSON.parse),
      fs.readFile(path.join(dir, 'markdown.md'), 'utf8'),
    ]);
    return { sha256, source, meta, markdown, dir };
  } catch {
    return null;
  }
}

export async function writeRecord(root, { sha256, source, meta, markdown }) {
  const dir = recordDirFor(root, sha256);
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(dir, 'source.json'), JSON.stringify(source, null, 2) + '\n', 'utf8'),
    fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8'),
    fs.writeFile(path.join(dir, 'markdown.md'), markdown, 'utf8'),
  ]);
  return { sha256, dir, source, meta, markdown };
}

export async function listRecords(root) {
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch { return []; }
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sha = entry.name;
    if (!/^[a-f0-9]{64}$/.test(sha)) continue;
    const record = await readRecord(root, sha);
    if (record) records.push(record);
  }
  return records;
}
