/**
 * lib/tags/vocabulary.mjs — controlled tag vocabulary loader and validator.
 *
 * Loads the repo-wide controlled vocabulary from config/tag-vocabulary.json
 * and optionally merges project-local overrides from .cx/tags/vocabulary-overrides.json.
 *
 * Exports:
 *   loadVocabulary(rootDir)       — loads and merges vocab files, returns vocab object
 *   validateTags(tagArray, vocab) — validates tags against vocab, returns classified result
 *   lookupTag(id, vocab)          — returns tag entry or null
 *   getTagsByFacet(facet, vocab)  — returns all active tags in a facet
 *   isTagDeprecated(id, vocab)    — boolean
 *   isTagArchived(id, vocab)      — boolean
 *
 * Merge semantics: project overrides may add new tags or change status fields
 * on existing tags. They cannot remove repo-wide tags, only shadow/supersede them.
 * Tags with the same id in both sources: the override entry wins entirely.
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function buildTagMap(tags) {
  const map = new Map();
  for (const tag of tags) {
    map.set(tag.id, tag);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads config/tag-vocabulary.json from rootDir and merges any project-local
 * overrides from .cx/tags/vocabulary-overrides.json if the file exists.
 * Returns the merged vocabulary object with a `_tagMap` cache attached.
 */
export function loadVocabulary(rootDir) {
  const repoVocabPath = path.join(rootDir, 'config', 'tag-vocabulary.json');
  const vocab = readJsonFile(repoVocabPath);

  const overridePath = path.join(rootDir, '.cx', 'tags', 'vocabulary-overrides.json');
  if (fs.existsSync(overridePath)) {
    const overrides = readJsonFile(overridePath);
    if (Array.isArray(overrides.tags)) {
      const overrideById = buildTagMap(overrides.tags);
      const merged = vocab.tags.map(t => overrideById.has(t.id) ? overrideById.get(t.id) : t);
      for (const [id, entry] of overrideById) {
        if (!vocab.tags.some(t => t.id === id)) {
          merged.push(entry);
        }
      }
      vocab.tags = merged;
    }
    if (overrides.facets) {
      vocab.facets = { ...vocab.facets, ...overrides.facets };
    }
  }

  vocab._tagMap = buildTagMap(vocab.tags);
  return vocab;
}

/**
 * Validates an array of tag IDs against the loaded vocabulary.
 * Returns { valid: string[], unknown: string[], duplicateFacets: string[] }.
 *
 * unknown: tag IDs not present in vocab at all.
 * duplicateFacets: tag IDs that violate an exclusive facet constraint (second
 *   and subsequent tags from the same exclusive facet are listed here).
 */
export function validateTags(tagArray, vocab) {
  const valid = [];
  const unknown = [];
  const duplicateFacets = [];
  const seenExclusiveFacets = new Map();

  for (const id of tagArray) {
    const entry = vocab._tagMap ? vocab._tagMap.get(id) : vocab.tags.find(t => t.id === id);
    if (!entry) {
      unknown.push(id);
      continue;
    }

    const facetDef = vocab.facets[entry.facet];
    if (facetDef && facetDef.exclusive) {
      if (seenExclusiveFacets.has(entry.facet)) {
        duplicateFacets.push(id);
        continue;
      }
      seenExclusiveFacets.set(entry.facet, id);
    }

    valid.push(id);
  }

  return { valid, unknown, duplicateFacets };
}

/**
 * Returns the tag entry for the given id, or null if not found.
 */
export function lookupTag(id, vocab) {
  if (vocab._tagMap) return vocab._tagMap.get(id) ?? null;
  return vocab.tags.find(t => t.id === id) ?? null;
}

/**
 * Returns all active tags belonging to the given facet.
 */
export function getTagsByFacet(facet, vocab) {
  return vocab.tags.filter(t => t.facet === facet && t.status === 'active');
}

/**
 * Returns true if the tag with the given id has status 'deprecated'.
 */
export function isTagDeprecated(id, vocab) {
  const entry = lookupTag(id, vocab);
  return entry !== null && entry.status === 'deprecated';
}

/**
 * Returns true if the tag with the given id has status 'archived'.
 */
export function isTagArchived(id, vocab) {
  const entry = lookupTag(id, vocab);
  return entry !== null && entry.status === 'archived';
}
