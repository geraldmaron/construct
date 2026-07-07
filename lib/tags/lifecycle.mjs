/**
 * lib/tags/lifecycle.mjs — tag lifecycle management for project and repo vocabularies.
 *
 * Pure file-read/write functions for the CLI to manage the tag
 * controlled vocabulary over time: proposing new tags, adding project-local
 * overrides, deprecating or archiving tags, and auditing tag usage across
 * knowledge files.
 *
 * No LLM calls. No database calls. All functions are synchronous and
 * operate on the filesystem via node:fs and node:path.
 *
 * File locations:
 *   .construct/tags/proposed.jsonl              — append-only proposals from agents or mining
 *   .construct/tags/vocabulary-overrides.json   — project-local tag additions/overrides
 *   config/tag-vocabulary.json           — repo-wide vocabulary (edited by deprecateTag/archiveTag)
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadVocabulary } from './vocabulary.mjs';
import { configPath } from '../config-dir.mjs';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJsonFile(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function appendJsonlLine(filePath, record) {
  ensureDir(filePath);
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
}

function proposedPath(rootDir) {
  return configPath(rootDir, 'tags', 'proposed.jsonl');
}

function overridesPath(rootDir) {
  return configPath(rootDir, 'tags', 'vocabulary-overrides.json');
}

function repoVocabPath(rootDir) {
  return path.join(rootDir, 'config', 'tag-vocabulary.json');
}

function loadOverrides(rootDir) {
  const p = overridesPath(rootDir);
  if (!fs.existsSync(p)) return { version: 1, tags: [], facets: {} };
  return readJsonFile(p);
}

function updateRepoVocabTag(rootDir, id, updates) {
  const p = repoVocabPath(rootDir);
  const vocab = readJsonFile(p);
  const idx = vocab.tags.findIndex(t => t.id === id);
  if (idx === -1) throw new Error(`tag not found in repo vocab: ${id}`);
  vocab.tags[idx] = { ...vocab.tags[idx], ...updates };
  writeJsonFile(p, vocab);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Appends a draft proposal entry to .construct/tags/proposed.jsonl.
 * Does not validate against existing vocab: proposals may be genuinely new.
 */
export function proposeTag(id, { facet, label, autoThreshold, rootDir }) {
  const record = {
    id,
    facet,
    label,
    auto_threshold: autoThreshold ?? null,
    proposed_at: new Date().toISOString(),
    status: 'proposed',
  };
  appendJsonlLine(proposedPath(rootDir), record);
  return record;
}

/**
 * Adds a project-local tag entry to .construct/tags/vocabulary-overrides.json.
 * If the file does not exist it is created. If the tag id already exists in
 * overrides it is replaced.
 */
export function addTag(id, { facet, label, scope = 'project', rootDir }) {
  const overrides = loadOverrides(rootDir);
  const entry = { id, facet, label, scope, status: 'active', added_at: new Date().toISOString() };
  const existing = overrides.tags.findIndex(t => t.id === id);
  if (existing !== -1) {
    overrides.tags[existing] = entry;
  } else {
    overrides.tags.push(entry);
  }
  writeJsonFile(overridesPath(rootDir), overrides);
  return entry;
}

/**
 * Marks a tag as deprecated in the vocabulary.
 * For repo-level tags (present in config/tag-vocabulary.json), edits that file.
 * For project-local tags, edits .construct/tags/vocabulary-overrides.json.
 */
export function deprecateTag(id, { reason, gracePeriodDays = 90, replacedBy = null, rootDir }) {
  const updates = {
    status: 'deprecated',
    deprecated_at: new Date().toISOString(),
    deprecation_reason: reason,
    grace_period_days: gracePeriodDays,
    replaced_by: replacedBy,
  };

  const repoVocab = readJsonFile(repoVocabPath(rootDir));
  const inRepo = repoVocab.tags.some(t => t.id === id);

  if (inRepo) {
    updateRepoVocabTag(rootDir, id, updates);
    return { source: 'repo', id, ...updates };
  }

  const overrides = loadOverrides(rootDir);
  const idx = overrides.tags.findIndex(t => t.id === id);
  if (idx !== -1) {
    overrides.tags[idx] = { ...overrides.tags[idx], ...updates };
  } else {
    overrides.tags.push({ id, facet: 'unknown', label: id, ...updates });
  }
  writeJsonFile(overridesPath(rootDir), overrides);
  return { source: 'project', id, ...updates };
}

/**
 * Marks a tag as archived in the vocabulary.
 * Same source-selection logic as deprecateTag.
 */
export function archiveTag(id, { rootDir }) {
  const updates = { status: 'archived', archived_at: new Date().toISOString() };

  const repoVocab = readJsonFile(repoVocabPath(rootDir));
  const inRepo = repoVocab.tags.some(t => t.id === id);

  if (inRepo) {
    updateRepoVocabTag(rootDir, id, updates);
    return { source: 'repo', id, ...updates };
  }

  const overrides = loadOverrides(rootDir);
  const idx = overrides.tags.findIndex(t => t.id === id);
  if (idx !== -1) {
    overrides.tags[idx] = { ...overrides.tags[idx], ...updates };
  } else {
    overrides.tags.push({ id, facet: 'unknown', label: id, ...updates });
  }
  writeJsonFile(overridesPath(rootDir), overrides);
  return { source: 'project', id, ...updates };
}

/**
 * Reads .construct/tags/proposed.jsonl and returns an array of proposal records.
 * Returns [] if the file does not exist.
 */
export function listProposed(rootDir) {
  const p = proposedPath(rootDir);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim() !== '');
  return lines.map(l => JSON.parse(l));
}

/**
 * Scans .construct/knowledge/**\/*.md frontmatter for tags and cross-references them
 * against the vocabulary. Returns:
 *   { active, overBudget, deprecated, unknown, orphan }
 *
 * active:      tags in use that are valid and current
 * overBudget:  tags that exceed their expected_cardinality (checked per window)
 * deprecated:  tags in use that are deprecated
 * unknown:     tags in use that are not in vocabulary
 * orphan:      tags in vocabulary with no usage in any document
 */
export function auditTags(rootDir) {
  const vocab = loadVocabulary(rootDir);
  const knowledgeDir = configPath(rootDir, 'knowledge');

  const usageCounts = new Map();

  if (fs.existsSync(knowledgeDir)) {
    collectTagsFromDir(knowledgeDir, usageCounts);
  }

  const active = [];
  const overBudget = [];
  const deprecated = [];
  const unknown = [];

  for (const [tagId, count] of usageCounts) {
    const entry = vocab._tagMap ? vocab._tagMap.get(tagId) : vocab.tags.find(t => t.id === tagId);
    if (!entry) {
      unknown.push({ id: tagId, count });
      continue;
    }
    if (entry.status === 'deprecated') {
      deprecated.push({ id: tagId, count });
      continue;
    }
    if (entry.expected_cardinality && count > entry.expected_cardinality) {
      overBudget.push({ id: tagId, count, budget: entry.expected_cardinality });
    } else {
      active.push({ id: tagId, count });
    }
  }

  const orphan = vocab.tags
    .filter(t => t.status === 'active' && !usageCounts.has(t.id))
    .map(t => ({ id: t.id, facet: t.facet }));

  return { active, overBudget, deprecated, unknown, orphan };
}

// ---------------------------------------------------------------------------
// Internal: recursive directory scanner for frontmatter tags
// ---------------------------------------------------------------------------

function collectTagsFromDir(dir, usageCounts) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTagsFromDir(full, usageCounts);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = fs.readFileSync(full, 'utf8');
      const tags = extractFrontmatterTags(content);
      for (const tag of tags) {
        usageCounts.set(tag, (usageCounts.get(tag) ?? 0) + 1);
      }
    }
  }
}

function extractFrontmatterTags(content) {
  if (!content.startsWith('---\n')) return [];
  const closeIdx = content.indexOf('\n---\n', 4);
  if (closeIdx === -1) return [];
  const block = content.slice(4, closeIdx);
  const tagLine = block.split('\n').find(l => l.startsWith('tags:'));
  if (!tagLine) return [];

  const inlineMatch = tagLine.match(/^tags:\s*\[(.+)\]/);
  if (inlineMatch) {
    return inlineMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }

  const indented = [];
  const lines = block.split('\n');
  let inTagsBlock = false;
  for (const line of lines) {
    if (line.startsWith('tags:')) { inTagsBlock = true; continue; }
    if (inTagsBlock) {
      if (/^\s+-\s+/.test(line)) {
        indented.push(line.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, ''));
      } else if (line.trim() !== '' && !/^\s/.test(line)) {
        break;
      }
    }
  }
  return indented;
}
