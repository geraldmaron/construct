/**
 * artifacts.mjs — shared output sink for audit phases.
 *
 * Stable filenames under audit-artifacts/ so phases compose (each fills its column in
 * the coverage matrix) and CI gates can locate evidence. The directory is gitignored;
 * gates import phase functions directly rather than depending on committed artifacts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './handlers.mjs';

export const ARTIFACTS_DIR = path.join(REPO_ROOT, 'audit-artifacts');

export function ensureArtifactsDir() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  return ARTIFACTS_DIR;
}

export function writeJson(name, data) {
  ensureArtifactsDir();
  const file = path.join(ARTIFACTS_DIR, name);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

export function readJson(name) {
  const file = path.join(ARTIFACTS_DIR, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeText(name, text) {
  ensureArtifactsDir();
  const file = path.join(ARTIFACTS_DIR, name);
  fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
  return file;
}

// Render a fixed-width markdown table from a header row and string cells.

export function mdTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const fmt = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [fmt(headers), sep, ...rows.map(fmt)].join('\n');
}
