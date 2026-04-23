/**
 * lib/bootstrap.mjs — imports the seed observation corpus into the local memory store.
 *
 * Reads markdown files from examples/seed-observations/, parses each ## heading group
 * into individual observations, and writes them via addObservation. Safe to re-run:
 * observations with matching content hashes are skipped. Reports counts on completion.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addObservation, listObservations } from './observation-store.mjs';

const SEED_DIR = path.resolve(import.meta.dirname, '..', 'examples', 'seed-observations');

const FILE_CATEGORY_MAP = {
  'patterns.md': 'pattern',
  'anti-patterns.md': 'anti-pattern',
  'decisions.md': 'decision',
};

function contentHash(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function parseObservations(content, category) {
  const observations = [];
  const lines = content.split('\n');
  let currentH2 = null;
  let buffer = [];

  function flush() {
    if (!buffer.length) return;
    const raw = buffer.join('\n').trim();
    if (!raw) { buffer = []; return; }
    const firstLine = raw.split('\n')[0];
    const boldMatch = firstLine.match(/^\*\*(.+?)\*\*/);
    const summary = boldMatch ? boldMatch[1] : firstLine.replace(/^#+\s*/, '').slice(0, 120);
    observations.push({
      summary,
      content: raw,
      category,
      tags: currentH2 ? [currentH2.toLowerCase().replace(/\s+/g, '-')] : [],
      role: 'construct',
      confidence: 0.85,
      source: 'seed-corpus',
    });
    buffer = [];
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      currentH2 = line.replace(/^## /, '').trim();
      continue;
    }
    if (line.startsWith('**') && buffer.length > 0) {
      flush();
    }
    buffer.push(line);
  }
  flush();

  return observations;
}

export function runBootstrap(rootDir = process.cwd(), { verbose = false } = {}) {
  if (!fs.existsSync(SEED_DIR)) {
    return { imported: 0, skipped: 0, error: `seed dir not found: ${SEED_DIR}` };
  }

  const existing = listObservations(rootDir, { limit: 10000 });
  const existingHashes = new Set(
    existing.map((o) => contentHash(o.content || o.summary || ''))
  );

  let imported = 0;
  let skipped = 0;

  for (const [filename, category] of Object.entries(FILE_CATEGORY_MAP)) {
    const filePath = path.join(SEED_DIR, filename);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const observations = parseObservations(content, category);

    for (const obs of observations) {
      const hash = contentHash(obs.content);
      if (existingHashes.has(hash)) {
        skipped++;
        if (verbose) process.stdout.write(`  skip  ${obs.summary.slice(0, 60)}\n`);
        continue;
      }
      addObservation(rootDir, obs);
      existingHashes.add(hash);
      imported++;
      if (verbose) process.stdout.write(`  import  ${obs.summary.slice(0, 60)}\n`);
    }
  }

  return { imported, skipped };
}
