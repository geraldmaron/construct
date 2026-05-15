/**
 * lib/intake/filesystem-queue.mjs — filesystem adapter for the IntakeQueue interface.
 *
 * Backs the `.cx/intake/{pending,processed,skipped}/` layout used in solo
 * mode. Implements the contract defined in lib/intake/queue.mjs: enqueue,
 * listPending, read, markProcessed, markSkipped, reopen, count. The
 * Postgres adapter (for team and enterprise modes) lives alongside and
 * implements the same shape so callers do not branch on backend.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const QUEUE_SUBDIR = '.cx/intake';

export function queueRoot(rootDir) {
  return path.join(rootDir, QUEUE_SUBDIR);
}

export function pendingDir(rootDir) {
  return path.join(queueRoot(rootDir), 'pending');
}

export function processedDir(rootDir) {
  return path.join(queueRoot(rootDir), 'processed');
}

export function skippedDir(rootDir) {
  return path.join(queueRoot(rootDir), 'skipped');
}

function slugify(value) {
  return String(value || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

let counter = 0;
function timestamp() {
  // Milliseconds + a per-process counter to guarantee uniqueness even when
  // two enqueues fire in the same millisecond.
  counter = (counter + 1) % 1000;
  const c = String(counter).padStart(3, '0');
  return `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)}-${c}`;
}

export class FilesystemIntakeQueue {
  constructor(rootDir) {
    if (!rootDir) throw new Error('FilesystemIntakeQueue: rootDir is required');
    this.rootDir = rootDir;
  }

  enqueue(entry) {
    if (!entry?.intake?.sourcePath) throw new Error('enqueue: entry.intake.sourcePath is required');
    const dir = pendingDir(this.rootDir);
    mkdirSync(dir, { recursive: true });

    const ts = timestamp();
    const slug = slugify(path.basename(entry.intake.sourcePath, path.extname(entry.intake.sourcePath)));
    const id = `${ts}-${slug}`;
    const filePath = path.join(dir, `${id}.json`);

    const payload = { id, createdAt: new Date().toISOString(), status: 'pending', ...entry };
    writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return { id, filePath };
  }

  listPending() {
    const dir = pendingDir(this.rootDir);
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

  count() {
    const dir = pendingDir(this.rootDir);
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((name) => name.endsWith('.json')).length;
  }

  read(id) {
    for (const dir of [pendingDir(this.rootDir), processedDir(this.rootDir), skippedDir(this.rootDir)]) {
      const filePath = path.join(dir, `${id}.json`);
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf8'));
        return { ...data, filePath };
      }
    }
    return null;
  }

  markProcessed(id, { processedBy = 'unknown', notes = '' } = {}) {
    const src = path.join(pendingDir(this.rootDir), `${id}.json`);
    if (!existsSync(src)) throw new Error(`markProcessed: no pending entry ${id}`);
    const data = JSON.parse(readFileSync(src, 'utf8'));
    data.status = 'processed';
    data.processedAt = new Date().toISOString();
    data.processedBy = processedBy;
    if (notes) data.notes = notes;

    const dst = path.join(processedDir(this.rootDir), `${id}.json`);
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, JSON.stringify(data, null, 2) + '\n', 'utf8');
    rmSync(src);
    return { id, filePath: dst };
  }

  markSkipped(id, { skippedBy = 'unknown', reason = '' } = {}) {
    const src = path.join(pendingDir(this.rootDir), `${id}.json`);
    if (!existsSync(src)) throw new Error(`markSkipped: no pending entry ${id}`);
    const data = JSON.parse(readFileSync(src, 'utf8'));
    data.status = 'skipped';
    data.skippedAt = new Date().toISOString();
    data.skippedBy = skippedBy;
    if (reason) data.reason = reason;

    const dst = path.join(skippedDir(this.rootDir), `${id}.json`);
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, JSON.stringify(data, null, 2) + '\n', 'utf8');
    rmSync(src);
    return { id, filePath: dst };
  }

  reopen(id) {
    for (const dir of [processedDir(this.rootDir), skippedDir(this.rootDir)]) {
      const src = path.join(dir, `${id}.json`);
      if (!existsSync(src)) continue;
      const data = JSON.parse(readFileSync(src, 'utf8'));
      data.status = 'pending';
      delete data.processedAt;
      delete data.processedBy;
      delete data.notes;
      delete data.skippedAt;
      delete data.skippedBy;
      delete data.reason;

      const dst = path.join(pendingDir(this.rootDir), `${id}.json`);
      mkdirSync(path.dirname(dst), { recursive: true });
      writeFileSync(dst, JSON.stringify(data, null, 2) + '\n', 'utf8');
      rmSync(src);
      return { id, filePath: dst, from: path.basename(dir) };
    }
    throw new Error(`reopen: no processed or skipped entry ${id}`);
  }
}
