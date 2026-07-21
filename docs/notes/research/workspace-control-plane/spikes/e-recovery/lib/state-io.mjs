/**
 * lib/state-io.mjs (spike e-recovery) — durable checkpoint primitives for the
 * recovery harness (construct-b0nny.5.5, directive §11 spike E).
 *
 * A crash (real SIGKILL, in this spike) can land mid-write. Every durable
 * write here goes through writeJsonAtomic (write to a sibling .tmp file,
 * fsync, rename) so a kill can only ever leave the previous, fully-written
 * state file in place — never a half-written, unparseable one. That
 * atomicity is itself one of the properties under test: resume must read a
 * valid checkpoint no matter when the kill lands.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

/**
 * Write JSON durably: temp file in the same directory (same filesystem, so
 * rename is atomic) + fsync of the temp file's fd + rename over the target.
 * A kill between the write and the rename leaves the old target untouched;
 * a kill after the rename leaves the new content fully committed. There is
 * no window that produces a partially-written target file.
 */
export function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

export function appendHistory(runDir, event) {
  const historyPath = path.join(runDir, 'history.jsonl');
  fs.mkdirSync(runDir, { recursive: true });
  fs.appendFileSync(historyPath, JSON.stringify({ ts: nowIso(), ...event }) + '\n');
}

export function readHistory(runDir) {
  const historyPath = path.join(runDir, 'history.jsonl');
  if (!fs.existsSync(historyPath)) return [];
  return fs.readFileSync(historyPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Phase markers prove a stage reached a specific point of no return before a
// crash; the driver polls for phase1 to time a kill precisely between two
// halves of one stage's work, and cleanup (cancellation / supersession /
// stage completion) removes them so a finished run leaves none behind.

export function tmpDir(runDir) {
  return path.join(runDir, 'tmp');
}

export function writeMarker(runDir, name) {
  const dir = tmpDir(runDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), nowIso());
}

export function hasMarker(runDir, name) {
  return fs.existsSync(path.join(tmpDir(runDir), name));
}

export function removeMarker(runDir, name) {
  const p = path.join(tmpDir(runDir), name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function listOrphanTmpFiles(runDir) {
  const dir = tmpDir(runDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}
