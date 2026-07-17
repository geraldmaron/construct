/**
 * lib/embed/degradation.mjs — durable record of a daemon job declining work
 * because a capability it needs isn't there: an unresolvable directive
 * reference, an unavailable provider, an exhausted budget. A stderr line
 * scrolls off and is never seen again; an append-only ledger under
 * .construct/degradation.jsonl is what lib/doctor/watchers/degradation.mjs
 * reads to escalate it once, so a silent skip stays visible.
 */

import fs from 'node:fs';
import path from 'node:path';

import { configPath } from '../config-dir.mjs';

function ledgerPath(rootDir) {
  return configPath(rootDir, 'degradation.jsonl');
}

/**
 * @param {string} rootDir
 * @param {object} entry
 * @param {string} entry.job - the daemon job/module that declined work
 * @param {string} entry.reason - short machine-stable reason code
 * @param {string} [entry.detail] - human-readable detail
 * @returns {object} the recorded entry (with `at` stamped)
 */
export function recordDegradation(rootDir, { job, reason, detail = null } = {}) {
  const entry = { job, reason, detail, at: new Date().toISOString() };
  const target = ledgerPath(rootDir);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, JSON.stringify(entry) + '\n');
  } catch (err) {
    process.stderr.write(`[degradation] failed to record: ${err?.message ?? String(err)}\n`);
  }
  return entry;
}

/**
 * @param {string} rootDir
 * @returns {object[]} every recorded entry, oldest first
 */
export function listDegradations(rootDir) {
  try {
    const raw = fs.readFileSync(ledgerPath(rootDir), 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}
