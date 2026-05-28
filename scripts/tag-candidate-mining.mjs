/**
 * scripts/tag-candidate-mining.mjs — scans knowledge files for unknown tags
 * and promotes frequent ones to proposed status.
 *
 * Invoked via: construct scheduler run tag-candidate-mining
 * Or directly: node scripts/tag-candidate-mining.mjs
 *
 * Algorithm:
 *   1. Walk .cx/knowledge/**\/*.md and extract YAML frontmatter tags.
 *   2. Cross-reference against the controlled vocabulary.
 *   3. Count occurrences of unknown tags within the last 30 days (based on
 *      frontmatter created_at or file mtime as fallback).
 *   4. For any unknown tag with 3+ uses, append a proposal record to
 *      .cx/tags/proposed.jsonl (skipping ids already proposed).
 *   5. Write a one-line JSON summary to
 *      .cx/scheduler/logs/tag-candidate-mining.jsonl.
 *
 * No external dependencies. No LLM calls. No database calls.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadVocabulary } from '../lib/tags/vocabulary.mjs';
import { listProposed } from '../lib/tags/lifecycle.mjs';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_USES = 3;

// ---------------------------------------------------------------------------
// Frontmatter extraction
// ---------------------------------------------------------------------------

function extractFrontmatter(content) {
  if (!content.startsWith('---\n')) return null;
  const closeIdx = content.indexOf('\n---\n', 4);
  if (closeIdx === -1) return null;
  const block = content.slice(4, closeIdx);
  const fields = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w[\w_-]*):\s*(.+)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  const tagLine = block.split('\n').find(l => l.startsWith('tags:'));
  if (tagLine) {
    const inline = tagLine.match(/^tags:\s*\[(.+)\]/);
    if (inline) {
      fields.tags = inline[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      const lines = block.split('\n');
      let inTags = false;
      const collected = [];
      for (const line of lines) {
        if (line.startsWith('tags:')) { inTags = true; continue; }
        if (inTags) {
          if (/^\s+-\s+/.test(line)) {
            collected.push(line.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, ''));
          } else if (line.trim() !== '' && !/^\s/.test(line)) {
            break;
          }
        }
      }
      fields.tags = collected;
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Directory walker
// ---------------------------------------------------------------------------

function walkDir(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, results);
    else if (entry.isFile() && entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main export (also runnable directly)
// ---------------------------------------------------------------------------

export default async function run({ cwd = process.cwd(), env = process.env } = {}) {
  const rootDir = env.CONSTRUCT_ROOT || cwd;
  const knowledgeDir = path.join(rootDir, '.cx', 'knowledge');
  const proposedPath = path.join(rootDir, '.cx', 'tags', 'proposed.jsonl');
  const logPath = path.join(rootDir, '.cx', 'scheduler', 'logs', 'tag-candidate-mining.jsonl');

  const vocab = loadVocabulary(rootDir);
  const knownIds = new Set(vocab.tags.map(t => t.id));

  const existingProposals = new Set(listProposed(rootDir).map(p => p.id));

  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const unknownCounts = new Map();

  for (const filePath of walkDir(knowledgeDir)) {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const fm = extractFrontmatter(content);

    let fileDate = stat.mtimeMs;
    if (fm && fm.created_at) {
      const parsed = Date.parse(fm.created_at);
      if (!isNaN(parsed)) fileDate = parsed;
    }

    if (fileDate < cutoff) continue;

    const tags = Array.isArray(fm?.tags) ? fm.tags : [];
    for (const tag of tags) {
      if (!knownIds.has(tag)) {
        unknownCounts.set(tag, (unknownCounts.get(tag) ?? 0) + 1);
      }
    }
  }

  let proposed = 0;
  for (const [tagId, count] of unknownCounts) {
    if (count >= MIN_USES && !existingProposals.has(tagId)) {
      const record = {
        id: tagId,
        facet: 'unknown',
        label: tagId,
        auto_threshold: null,
        proposed_at: new Date().toISOString(),
        status: 'proposed',
        source: 'tag-candidate-mining',
        occurrence_count: count,
      };
      fs.mkdirSync(path.dirname(proposedPath), { recursive: true });
      fs.appendFileSync(proposedPath, JSON.stringify(record) + '\n', 'utf8');
      proposed++;
    }
  }

  const logRecord = {
    run_at: new Date().toISOString(),
    files_scanned: walkDir(knowledgeDir).length,
    unknown_tags_found: unknownCounts.size,
    new_proposals: proposed,
  };

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(logRecord) + '\n', 'utf8');

  return logRecord;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  run().then(r => process.stdout.write(JSON.stringify(r) + '\n')).catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });
}
