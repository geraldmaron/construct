/**
 * lib/review/queue.mjs — `.cx/review-queue/` storage for pending intake reviews.
 *
 * When a file lands in the inbox and gets ingested, the daemon writes a
 * preparation packet here (intake source, suggested doc lane, related
 * existing docs from hybrid-query, excerpt). The agent — running in the
 * user's editor — reads from this queue when invoked, performs the
 * actual LLM analysis, and marks entries processed. The daemon never
 * makes LLM calls itself; that's the agent's job. This file is just
 * durable handoff between the two.
 *
 * Queue layout:
 *   <project>/.cx/review-queue/
 *     pending/
 *       <ts>-<slug>.json    — review packet, status: pending
 *     processed/
 *       <ts>-<slug>.json    — moved here after agent handles it
 *
 * Queue entry shape:
 *   {
 *     id, createdAt, status: 'pending'|'processed',
 *     intake: { sourcePath, outputPath, characters, knowledgeSubdir },
 *     suggestion: { lane, confidence },
 *     related: [{ path, title, score, summary }],
 *     excerpt: string,
 *     processedAt?, processedBy?, notes?
 *   }
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const QUEUE_SUBDIR = '.cx/review-queue';

export function queueRoot(rootDir) {
  return path.join(rootDir, QUEUE_SUBDIR);
}

export function pendingDir(rootDir) {
  return path.join(queueRoot(rootDir), 'pending');
}

export function processedDir(rootDir) {
  return path.join(queueRoot(rootDir), 'processed');
}

function slugify(value) {
  return String(value || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function enqueueReview(rootDir, entry) {
  if (!rootDir) throw new Error('enqueueReview: rootDir is required');
  if (!entry?.intake?.sourcePath) throw new Error('enqueueReview: entry.intake.sourcePath is required');

  const dir = pendingDir(rootDir);
  mkdirSync(dir, { recursive: true });

  const ts = timestamp();
  const slug = slugify(path.basename(entry.intake.sourcePath, path.extname(entry.intake.sourcePath)));
  const id = `${ts}-${slug}`;
  const filePath = path.join(dir, `${id}.json`);

  const payload = {
    id,
    createdAt: new Date().toISOString(),
    status: 'pending',
    ...entry,
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { id, filePath };
}

export function listPending(rootDir) {
  const dir = pendingDir(rootDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filePath = path.join(dir, name);
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf8'));
        return { ...data, filePath };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export function countPending(rootDir) {
  const dir = pendingDir(rootDir);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => name.endsWith('.json')).length;
}

export function markProcessed(rootDir, id, { processedBy = 'unknown', notes = '' } = {}) {
  const src = path.join(pendingDir(rootDir), `${id}.json`);
  if (!existsSync(src)) {
    throw new Error(`markProcessed: no pending entry ${id}`);
  }
  const data = JSON.parse(readFileSync(src, 'utf8'));
  data.status = 'processed';
  data.processedAt = new Date().toISOString();
  data.processedBy = processedBy;
  if (notes) data.notes = notes;

  const dst = path.join(processedDir(rootDir), `${id}.json`);
  mkdirSync(path.dirname(dst), { recursive: true });
  writeFileSync(dst, JSON.stringify(data, null, 2) + '\n', 'utf8');
  rmSync(src);
  return { id, filePath: dst };
}

export function readEntry(rootDir, id) {
  for (const dir of [pendingDir(rootDir), processedDir(rootDir)]) {
    const filePath = path.join(dir, `${id}.json`);
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      return { ...data, filePath };
    }
  }
  return null;
}
