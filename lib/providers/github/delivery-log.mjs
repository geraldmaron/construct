/**
 * lib/providers/github/delivery-log.mjs — durable JSONL seen-set of processed
 * webhook delivery ids, the dedup/replay record for webhook().
 *
 * Mirrors the persistence shape of lib/writes/sent-log.mjs (the established
 * durable-dedup idiom): temp-file-then-rename atomic persist so a crash
 * mid-write never leaves a truncated log, silent-on-missing-file load with
 * per-line corruption tolerance, and persist errors propagating uncaught —
 * a silently lost persist here means a replayed GitHub delivery processes
 * twice. Retention is bounded inline on every record() (age window plus
 * entry cap) because webhook receivers have no scheduled pruning caller:
 * GitHub redeliveries arrive within days, so a delivery id outside the
 * retention window cannot collide with a future redelivery and is dropped.
 *
 * The default persist path lives under the machine-scoped state
 * root (~/.construct/projects/<key>/webhooks/) — never the project tree —
 * resolved through lib/state-root.mjs exactly like the corpus cache in
 * lib/sources/repo-cache.mjs, so CX_HOME_OVERRIDE relocates it for tests.
 */

import fs from 'node:fs';
import path from 'node:path';

import { resolveStatePath } from '../../state-root.mjs';

export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_ENTRIES = 10_000;

export class WebhookDeliveryLog {
  #records = [];
  #persistPath = null;
  #retentionMs;
  #maxEntries;
  #writeCounter = 0;
  #now;

  constructor({ persistPath, retentionMs = DEFAULT_RETENTION_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) {
    this.#retentionMs = retentionMs;
    this.#maxEntries = maxEntries;
    this.#now = now;
    if (persistPath) {
      this.#persistPath = persistPath;
      this.#load();
    }
  }

  find(deliveryId) {
    let found = null;
    for (const r of this.#records) {
      if (r.deliveryId === deliveryId) found = r;
    }
    return found;
  }

  record({ deliveryId, event }) {
    const rec = {
      deliveryId,
      event: event || null,
      seenAt: new Date(this.#now()).toISOString(),
    };
    this.#records.push(rec);
    this.#prune();
    this.#persist();
    return rec;
  }

  size() {
    return this.#records.length;
  }

  // Age pruning drops ids outside the redelivery collision window; the entry
  // cap keeps the file bounded even under a flood of unique deliveries inside
  // the window, evicting oldest-first (records append in seen order).

  #prune() {
    const cutoff = this.#now() - this.#retentionMs;
    this.#records = this.#records.filter((r) => Date.parse(r.seenAt) > cutoff);
    if (this.#records.length > this.#maxEntries) {
      this.#records = this.#records.slice(this.#records.length - this.#maxEntries);
    }
  }

  // Temp-file-then-rename in the same directory keeps the rename atomic on
  // the same filesystem, so a concurrent reader never observes a half-written
  // file. Errors propagate — a lost persist loses the replay-dedup record.

  #persist() {
    if (!this.#persistPath) return;
    fs.mkdirSync(path.dirname(this.#persistPath), { recursive: true });
    const lines = this.#records.map((r) => JSON.stringify(r)).join('\n');
    this.#writeCounter = (this.#writeCounter + 1) % 100000;
    const tmpPath = `${this.#persistPath}.${process.pid}.${this.#writeCounter}.tmp`;
    fs.writeFileSync(tmpPath, lines + '\n', 'utf8');
    fs.renameSync(tmpPath, this.#persistPath);
  }

  // A missing file is expected on first run and stays silent; any other read
  // failure propagates. A single malformed JSONL line is tolerated and
  // skipped so partial corruption of one old record never blocks the rest.

  #load() {
    if (!fs.existsSync(this.#persistPath)) return;
    const lines = fs.readFileSync(this.#persistPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec && typeof rec.deliveryId === 'string') this.#records.push(rec);
      } catch {}
    }
  }

  static resolvePersistPath(projectRoot) {
    return resolveStatePath(projectRoot, 'webhooks', 'github-deliveries.jsonl', { ensureDir: false });
  }
}
