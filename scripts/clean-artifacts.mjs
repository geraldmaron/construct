/**
 * scripts/clean-artifacts.mjs — remove local build caches and exported static trees.
 *
 * Safe to run anytime; only deletes gitignored or reproducible outputs. Does not
 * touch source, .construct/, or beads data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  'apps/docs/.next',
  'apps/docs/out',
  'coverage',
  '.nyc_output',
  'audit-artifacts',
  '.tmp',
  '.playwright-mcp',
];

function rmrf(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return null;
  fs.rmSync(full, { recursive: true, force: true });
  return rel;
}

function rmRootTarballs() {
  const removed = [];
  for (const name of fs.readdirSync(ROOT)) {
    if (!name.endsWith('.tgz') && !name.endsWith('.tar.gz')) continue;
    const full = path.join(ROOT, name);
    if (!fs.statSync(full).isFile()) continue;
    fs.rmSync(full, { force: true });
    removed.push(name);
  }
  return removed;
}

const removed = TARGETS.map(rmrf).filter(Boolean);
const tarballs = rmRootTarballs();
if (tarballs.length) removed.push(...tarballs.map((n) => `(root) ${n}`));
if (removed.length) {
  for (const r of removed) process.stdout.write(`removed ${r}\n`);
} else {
  process.stdout.write('nothing to clean\n');
}
