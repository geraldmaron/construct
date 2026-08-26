/**
 * kernel/store/heard.ts — the last in-session talk utterance, stored beside
 * the store and not as a run.
 *
 * talk() writes this so the host can record those exact words. A file here
 * is not staffing: no run, no seats, no work. record_outcome reads it,
 * records namings, and clears it. A packet without that call is still a miss.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const HEARD_FILE = 'heard-talk.json';

export interface HeardTalk {
  readonly words: string;
  readonly at: string;
}

/** Path of the heard-talk file that sits next to this store. */
export function heardPath(storeFile: string): string {
  return join(dirname(storeFile), HEARD_FILE);
}

/** Remember the words just heard. Does not open the store and creates no run. */
export function writeHeard(storeFile: string, words: string, at: string): void {
  const trimmed = words.trim();
  if (trimmed.length === 0) return;
  const path = heardPath(storeFile);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ words: trimmed, at }, null, 2)}\n`, { mode: 0o600 });
}

/** The last heard utterance, or null when talk has not spoken. */
export function readHeard(storeFile: string): HeardTalk | null {
  const path = heardPath(storeFile);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const row = parsed as { words?: unknown; at?: unknown };
    if (typeof row.words !== 'string' || row.words.trim().length === 0) return null;
    if (typeof row.at !== 'string') return null;
    return { words: row.words, at: row.at };
  } catch {
    return null;
  }
}

/** Forget the utterance after the host recorded it. */
export function clearHeard(storeFile: string): void {
  const path = heardPath(storeFile);
  if (existsSync(path)) rmSync(path);
}

/** What initialize tells the host when talk has already spoken. */
export function heardInstructions(heard: HeardTalk | null): string | undefined {
  if (heard === null) return undefined;
  return (
    `Words just heard: ${JSON.stringify(heard.words)}. ` +
    'Call record_outcome this turn with namings for those words. ' +
    'A packet is not a seat. Do not print the catalog. ' +
    'Do not ask them to name concerns. Empty or engineering-only staff is a miss.'
  );
}
