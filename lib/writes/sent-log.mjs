/**
 * lib/writes/sent-log.mjs — durable JSONL record of executed external writes.
 *
 * WriteSentLog persists idempotency keys and outcomes so a retried or duplicate
 * write-intent is deduplicated rather than re-executed against the remote system.
 */

import fs from 'node:fs';
import path from 'node:path';
import { configPath } from '../config-dir.mjs';

export class WriteSentLog {
  #records = [];
  #persistPath = null;

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

  #persist() {
    if (!this.#persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.#persistPath), { recursive: true });
      const lines = this.#records.map(r => JSON.stringify(r)).join('\n');
      fs.writeFileSync(this.#persistPath, lines + '\n', 'utf8');
    } catch {}
  }

  #load() {
    try {
      if (!fs.existsSync(this.#persistPath)) return;
      const lines = fs.readFileSync(this.#persistPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { this.#records.push(JSON.parse(line)); } catch {}
      }
    } catch {}
  }

  static resolvePersistPath(rootDir) {
    return configPath(rootDir, 'writes', 'sent-log.jsonl');
  }
}