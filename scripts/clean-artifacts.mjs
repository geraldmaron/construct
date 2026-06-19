/**
 * scripts/clean-artifacts.mjs — remove local build caches and exported static trees.
 *
 * Safe to run anytime; only deletes gitignored or reproducible outputs. Does not
 * touch source, .cx/, or beads data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  'apps/dashboard/.next',
  'apps/dashboard/out',
  'apps/docs/.next',
  'apps/docs/out',
  'lib/server/static',
  'coverage',
  '.nyc_output',
  'audit-artifacts',
  '.tmp',
];

function rmrf(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return null;
  fs.rmSync(full, { recursive: true, force: true });
  return rel;
}

const removed = TARGETS.map(rmrf).filter(Boolean);
if (removed.length) {
  for (const r of removed) process.stdout.write(`removed ${r}\n`);
} else {
  process.stdout.write('nothing to clean\n');
}
