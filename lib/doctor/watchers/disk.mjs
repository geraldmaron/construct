/**
 * lib/doctor/watchers/disk.mjs — disk-space monitor + log rotation.
 *
 * Watches free space on the partition holding Construct state and rotates the doctor's
 * own JSONL artifacts (events.jsonl, doctor-log.jsonl, role-pending.jsonl,
 * agent-log.jsonl, session-cost.jsonl). When free space falls below the
 * watermark, escalates `service.down` so cx-sre can triage.
 *
 * Tick: 5 min. Cheap — only reads file sizes + statfs.
 */

import { existsSync, statSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { record } from '../audit.mjs';
import { escalate } from '../escalate.mjs';
import { cacheDir } from '../../config/xdg.mjs';
import { constructDir } from '../../paths.mjs';

export const name = 'disk';
export const intervalMs = 5 * 60 * 1000;

const TARGETS = [
  { path: 'events.jsonl', maxLines: 1000 },
  { path: 'doctor-log.jsonl', maxLines: 2000 },
  { path: 'role-pending.jsonl', maxLines: 500 },
  { path: 'agent-log.jsonl', maxLines: 1000 },
  { path: 'session-cost.jsonl', maxLines: 1000 },
  { path: 'hook-failures.jsonl', maxLines: 500 },
];

function freeBytesAt(p) {
  const r = spawnSync('df', ['-k', p], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const lines = r.stdout.split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  const cols = lines[1].split(/\s+/);
  const freeKb = parseInt(cols[3] || '0', 10);
  return Number.isFinite(freeKb) ? freeKb * 1024 : null;
}

function rotateTarget({ path: relPath, maxLines }) {
  const fullPath = join(constructDir(), relPath);
  if (!existsSync(fullPath)) return { rotated: false };
  try {
    const raw = readFileSync(fullPath, 'utf8').split('\n').filter(Boolean);
    if (raw.length <= maxLines) return { rotated: false, lines: raw.length };
    const trimmed = raw.slice(raw.length - maxLines).join('\n') + '\n';
    writeFileSync(fullPath, trimmed);
    return { rotated: true, droppedLines: raw.length - maxLines };
  } catch (err) {
    return { rotated: false, error: String(err) };
  }
}

function pruneRuntimeLogs() {
  const runtimeDir = join(cacheDir(), '.runtime');
  if (!existsSync(runtimeDir)) return { pruned: 0 };
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let pruned = 0;
  try {
    for (const name of readdirSync(runtimeDir)) {
      const p = join(runtimeDir, name);
      try {
        const stat = statSync(p);
        if (stat.isFile() && (now - stat.mtimeMs) > maxAgeMs) {
          unlinkSync(p);
          pruned++;
        }
      } catch { /* skip */ }
    }
  } catch { /* runtime dir disappeared */ }
  return { pruned };
}

export async function tick() {
  const actions = [];
  const escalations = [];

  for (const target of TARGETS) {
    const r = rotateTarget(target);
    if (r.rotated) {
      record({
        kind: 'action',
        watcher: name,
        action: 'rotate',
        target: target.path,
        summary: `rotated ${target.path}: dropped ${r.droppedLines} lines`,
        context: { droppedLines: r.droppedLines, keptLines: target.maxLines },
      });
      actions.push({ type: 'rotate', target: target.path });
    }
  }

  const runtimePrune = pruneRuntimeLogs();
  if (runtimePrune.pruned > 0) {
    record({
      kind: 'action',
      watcher: name,
      action: 'prune',
      target: '.cache/construct/.runtime/',
      summary: `pruned ${runtimePrune.pruned} stale runtime log(s) (>7 days)`,
      context: runtimePrune,
    });
    actions.push({ type: 'prune', target: '.cache/construct/.runtime/' });
  }

  const free = freeBytesAt(constructDir());
  const lowWaterBytes = 500 * 1024 * 1024;
  if (free !== null && free < lowWaterBytes) {
    const r = await escalate({
      watcher: name,
      eventType: 'service.down',
      summary: `Free disk below 500MB on $HOME (${Math.round(free / 1024 / 1024)}MB remaining)`,
      context: { freeBytes: free, lowWaterBytes },
    });
    escalations.push({ eventType: 'service.down', result: r });
  }

  return { actions, escalations, notes: [{ freeBytes: free, rotated: actions.filter((a) => a.type === 'rotate').length }] };
}
