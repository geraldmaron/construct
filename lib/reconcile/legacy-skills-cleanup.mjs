/**
 * lib/reconcile/legacy-skills-cleanup.mjs — clean up SKILL.md files at
 * ~/.agents/skills/ whose frontmatter is missing the `name` and
 * `description` fields required by the Anthropic Agent Skills loader.
 *
 * The cleanup is constrained to files whose frontmatter matches the
 * Construct doc-stamp shape (cx_doc_id + generator: construct/sync-specialists
 * + body_hash), so non-Construct skill authors in the same tree are
 * untouched. Empty parent directories prune upward; ~/.agents itself is
 * removed only if Construct emptied it.
 *
 * Safety: `auto`. detect() is pure-read; apply() never modifies files
 * outside the matched-stamp set and never touches files whose mtime falls
 * after the doc-stamp timestamp recorded in the frontmatter (a signal
 * that something other than Construct's sync may have edited the file).
 */

import fs from 'node:fs';
import path from 'node:path';

import { homeDir } from '../paths.mjs';

const LEGACY_REL = path.join('.agents', 'skills');

function legacyRoot() {
  return path.join(homeDir(), LEGACY_REL);
}

const STAMP_RE = /^cx_doc_id:\s*\S+/m;
const GENERATOR_RE = /^generator:\s*construct\/sync-specialists/m;
const BODY_HASH_RE = /^body_hash:\s*sha256:/m;
const NAME_RE = /^name:\s*\S+/m;
const DESCRIPTION_RE = /^description:\s*\S/m;
const UPDATED_AT_RE = /^updated_at:\s*(\S+)/m;

// Frontmatter shapes the Construct sync writer has emitted. The "stale"
// shape is doc-stamp-only (cx_doc_id + generator + body_hash, no name, no
// description) — the Anthropic Agent Skills loader rejects it. The current
// shape carries name + description and parses cleanly.

function classifyFrontmatter(content) {
  if (!content || !content.startsWith('---\n')) return { kind: 'no-frontmatter' };
  const closeIdx = content.indexOf('\n---', 4);
  if (closeIdx === -1) return { kind: 'malformed' };
  const fm = content.slice(4, closeIdx);
  const isConstructStamp = STAMP_RE.test(fm) && GENERATOR_RE.test(fm) && BODY_HASH_RE.test(fm);
  const hasName = NAME_RE.test(fm);
  const hasDescription = DESCRIPTION_RE.test(fm);
  const updatedMatch = fm.match(UPDATED_AT_RE);
  const updatedAtMs = updatedMatch ? Date.parse(updatedMatch[1]) : NaN;
  if (isConstructStamp && !hasName && !hasDescription) {
    return { kind: 'construct-stale', updatedAtMs };
  }
  if (isConstructStamp && hasName && hasDescription) {
    return { kind: 'construct-current', updatedAtMs };
  }
  return { kind: 'foreign' };
}

function walkSkillFiles(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSkillFiles(full));
    else if (entry.isFile() && entry.name === 'SKILL.md') out.push(full);
  }
  return out;
}

function inspectFile(file) {
  let content = '';
  let stat;
  try {
    content = fs.readFileSync(file, 'utf8');
    stat = fs.statSync(file);
  } catch {
    return { file, classification: { kind: 'unreadable' } };
  }
  const classification = classifyFrontmatter(content);
  return { file, classification, mtimeMs: stat.mtimeMs };
}

// A file is safe to remove when (a) it matches the Construct stale shape,
// (b) its mtime is within a small skew of its declared updated_at — if
// the user edited it after Construct wrote it, mtime drifts ahead, and
// the file is preserved.

const USER_EDIT_SKEW_MS = 5 * 60 * 1000;

function isSafeToRemove(inspection) {
  const c = inspection.classification;
  if (c.kind !== 'construct-stale') return false;
  if (!Number.isFinite(c.updatedAtMs)) return true;
  const drift = inspection.mtimeMs - c.updatedAtMs;
  return drift <= USER_EDIT_SKEW_MS;
}

function pruneEmptyDirsUpward(startDir, stopDir) {
  let cur = startDir;
  while (cur && cur.startsWith(stopDir) && cur !== stopDir) {
    let entries;
    try { entries = fs.readdirSync(cur); } catch { return; }
    if (entries.length > 0) return;
    try { fs.rmdirSync(cur); } catch { return; }
    cur = path.dirname(cur);
  }
}

async function detect() {
  const root = legacyRoot();
  if (!fs.existsSync(root)) {
    return { needsRepair: false, summary: 'No legacy ~/.agents/skills directory present.' };
  }
  const files = walkSkillFiles(root);
  if (files.length === 0) {
    return { needsRepair: false, summary: 'Legacy directory present but empty.' };
  }
  let stale = 0;
  let staleUserEdited = 0;
  let constructCurrent = 0;
  let foreign = 0;
  let unreadable = 0;
  for (const file of files) {
    const inspection = inspectFile(file);
    const kind = inspection.classification.kind;
    if (kind === 'construct-stale') {
      if (isSafeToRemove(inspection)) stale += 1;
      else staleUserEdited += 1;
    } else if (kind === 'construct-current') {
      constructCurrent += 1;
    } else if (kind === 'foreign') {
      foreign += 1;
    } else {
      unreadable += 1;
    }
  }
  if (stale === 0) {
    return {
      needsRepair: false,
      summary: `Legacy directory present, no Construct-shaped stale files to remove (current: ${constructCurrent}, foreign: ${foreign}, user-edited stale: ${staleUserEdited}).`,
      details: { stale, staleUserEdited, constructCurrent, foreign, unreadable, total: files.length },
    };
  }
  return {
    needsRepair: true,
    summary: `${stale} stale Construct SKILL.md files at ~/.agents/skills (current: ${constructCurrent}, foreign: ${foreign}, user-edited stale: ${staleUserEdited}, unreadable: ${unreadable}).`,
    details: { stale, staleUserEdited, constructCurrent, foreign, unreadable, total: files.length },
  };
}

async function apply() {
  const root = legacyRoot();
  if (!fs.existsSync(root)) return { summary: 'Already clean.' };
  const files = walkSkillFiles(root);
  let removed = 0;
  let preserved = 0;
  const dirsToCheck = new Set();
  for (const file of files) {
    const inspection = inspectFile(file);
    if (!isSafeToRemove(inspection)) {
      preserved += 1;
      continue;
    }
    try {
      fs.unlinkSync(file);
      removed += 1;
      dirsToCheck.add(path.dirname(file));
    } catch {
      preserved += 1;
    }
  }
  for (const dir of [...dirsToCheck].sort((a, b) => b.length - a.length)) {
    pruneEmptyDirsUpward(dir, root);
  }
  // If the root is now empty, prune it and the .agents parent if also empty.

  try {
    if (fs.readdirSync(root).length === 0) {
      fs.rmdirSync(root);
      const parent = path.dirname(root);
      try {
        if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
      } catch { /* parent has unrelated content */ }
    }
  } catch { /* root has remaining entries */ }
  return {
    summary: `Removed ${removed} stale SKILL.md file${removed === 1 ? '' : 's'} from ~/.agents/skills${preserved > 0 ? ` (preserved ${preserved} with user-edit signal)` : ''}.`,
  };
}

export default {
  id: 'legacy-skills-cleanup',
  description: 'Remove SKILL.md files at ~/.agents/skills whose frontmatter lacks the required name/description fields.',
  safety: 'auto',
  detect,
  apply,
};
