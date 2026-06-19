/**
 * lib/oracle/verdicts.mjs — durable per-tick verdict history under
 * <project>/.cx/oracle/verdicts/.
 */

import fs from 'node:fs';
import path from 'node:path';

export function verdictsDir(projectDir) {
  return path.join(projectDir, '.cx', 'oracle', 'verdicts');
}

function dateKey(iso = new Date().toISOString()) {
  return iso.slice(0, 10);
}

/**
 * Write one tick verdict. Same calendar day overwrites the latest snapshot for
 * that date (last tick wins) while preserving tick history in an array.
 *
 * @param {string} projectDir
 * @param {object} tick — runOracleTick tick payload
 * @param {object} [extra] — beadsRaised, orgGraph, etc.
 */
export function writeVerdict(projectDir, tick, extra = {}) {
  const dir = verdictsDir(projectDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${dateKey(tick.at)}.json`);
  let existing = { date: dateKey(tick.at), ticks: [] };
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* reset */ }
  }
  if (!Array.isArray(existing.ticks)) existing.ticks = [];
  existing.ticks.push({ ...tick, ...extra });
  existing.latest = existing.ticks[existing.ticks.length - 1];
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  return file;
}

export function readLatestVerdict(projectDir) {
  const dir = verdictsDir(projectDir);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) return null;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
    return data.latest ?? data;
  } catch {
    return null;
  }
}
