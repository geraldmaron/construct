/**
 * lib/writes/sent-log.mjs — durable JSONL record of executed external writes.
 *
 * WriteSentLog persists idempotency keys and outcomes so a retried or duplicate
 * write-intent is deduplicated rather than re-executed against the remote system.
 * #persist() writes via temp-file-then-rename (same pattern as
 * lib/flows/checkpoint.mjs) so a crash mid-write never leaves a truncated
 * sent-log, and a failed persist throws rather than swallowing the error:
 * the only cross-process idempotency record for external writes, where a
 * silently lost persist means a duplicate Jira comment, Slack message, etc.
 * on retry. Callers (record(), pruneOlderThan()) let the throw propagate
 * uncaught.
 */

import fs from 'node:fs';
import path from 'node:path';
import { configPath } from '../config-dir.mjs';

export class WriteSentLog {
  #records = [];
  #persistPath = null;
  #writeCounter = 0;

  constructor({ persistPath } = {}) {
    if (persistPath) {
      this.#persistPath = persistPath;
      this.#load();
    }
  }

  record(entry) {
    const rec = {
      idempotencyKey: entry.idempotencyKey,
      writeType: entry.writeType,
      provider: entry.provider,
      sentAt: entry.sentAt || new Date().toISOString(),
      completedAt: entry.completedAt || null,
      status: entry.status || 'pending',
      externalUrl: entry.externalUrl || null,
      externalId: entry.externalId || null,
      result: entry.result || null,
      error: entry.error || null,
    };
    this.#records.push(rec);
    this.#persist();
    return rec;
  }

  findByIdempotencyKey(key) {
    let found = null;
    for (const r of this.#records) {
      if (r.idempotencyKey === key) found = r;
    }
    return found;
  }

  list({ provider, status, since } = {}) {
    let results = [...this.#records];
    if (provider) results = results.filter(r => r.provider === provider);
    if (status) results = results.filter(r => r.status === status);
    if (since) results = results.filter(r => new Date(r.sentAt) >= new Date(since));
    return results;
  }

  pruneOlderThan(ms) {
    const cutoff = Date.now() - ms;
    const before = this.#records.length;
    this.#records = this.#records.filter(r => new Date(r.sentAt).getTime() > cutoff);
    this.#persist();
    return before - this.#records.length;
  }

  // Temp-file-then-rename keeps a concurrent reader from ever observing a
  // half-written file; the rename target sits in the same directory so the
  // rename is atomic on the same filesystem. Errors (mkdir/write/rename)
  // propagate to the caller — a lost persist here loses the dedup key for an
  // external write, so it must be visible, not swallowed.

  #persist() {
    if (!this.#persistPath) return;
    fs.mkdirSync(path.dirname(this.#persistPath), { recursive: true });
    const lines = this.#records.map(r => JSON.stringify(r)).join('\n');
    this.#writeCounter = (this.#writeCounter + 1) % 100000;
    const tmpPath = `${this.#persistPath}.${process.pid}.${this.#writeCounter}.tmp`;
    fs.writeFileSync(tmpPath, lines + '\n', 'utf8');
    fs.renameSync(tmpPath, this.#persistPath);
  }

  // A missing file is expected on first run and stays silent (guarded by
  // existsSync below); any other I/O failure reading the file is a genuine
  // fault and propagates. A single malformed JSONL line, by contrast, is
  // tolerated and skipped — partial corruption of one old record should not
  // block loading the rest of the log.

  #load() {
    if (!fs.existsSync(this.#persistPath)) return;
    const lines = fs.readFileSync(this.#persistPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { this.#records.push(JSON.parse(line)); } catch {}
    }
  }

  static resolvePersistPath(rootDir) {
    return configPath(rootDir, 'writes', 'sent-log.jsonl');
  }
}