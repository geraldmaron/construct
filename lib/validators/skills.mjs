/**
 * lib/validators/skills.mjs — Validate the structure of skill files.
 *
 * Skills are markdown files under `skills/` (and any merged plugin or project
 * skill paths) that follow this convention:
 *
 *   <!--
 *   skills/<domain>/<name>.md — <Title> — <one-line description>
 *   ...
 *   -->
 *   # <Title>
 *
 *   Use this skill when <triggering condition>.
 *   ...
 *
 * The validator splits findings into hard errors (block the build) and soft
 * warnings (surfaced by `construct doctor` without failing it):
 *
 *   Hard errors:
 *     - missing H1 title
 *     - title over 80 chars
 *     - duplicate relative paths across roots
 *     - unreadable file
 *
 *   Soft warnings:
 *     - opener is missing or doesn't match a recognised "Use this skill
 *       when/to/for ..." form (skills with non-trigger openers still load,
 *       but they're harder for routing to surface)
 *     - opener over 240 chars
 *
 * Hard checks prevent broken file structure; soft checks surface drift from
 * authoring conventions without blocking authors who legitimately diverge.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DESCRIPTION_MAX_CHARS = 240;
const TITLE_MAX_CHARS = 80;

// Accept any of the conventional skill-trigger openers actually in use across
// the corpus: "Use this skill when/to/for", "Use when:", "Use this when",
// "Trigger:", or a leading "When ..." that signals a triggering condition.
const TRIGGER_PATTERN = /^(?:use\s+(?:this\s+(?:skill\s+)?)?(?:when|to|for|if)\b|when\s+to\s+use\b|trigger\s*:|use\s+when\s*:)/i;

function* walk(root) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield full;
    }
  }
}

function extractTitleAndOpener(text) {
  const lines = text.split(/\r?\n/);
  let title = null;
  let opener = null;
  let inBody = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!title) {
      const m = line.match(/^#\s+(.+?)\s*$/);
      if (m) {
        title = m[1];
        inBody = true;
        continue;
      }
    } else if (inBody && line && !line.startsWith('#') && !line.startsWith('<!--')) {
      opener = line;
      break;
    }
  }
  return { title, opener };
}

/**
 * Validate every skill file under one or more directories.
 *
 * @param {string[]|string} roots — directories to walk recursively
 * @returns {{
 *   valid: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   skills: Array<{ path: string, title: string|null, opener: string|null }>,
 * }}
 */
export function validateSkills(roots) {
  const dirs = Array.isArray(roots) ? roots : [roots];
  const errors = [];
  const warnings = [];
  const skills = [];
  const seenRelative = new Map();

  for (const dir of dirs) {
    let exists = false;
    try { exists = statSync(dir).isDirectory(); } catch { exists = false; }
    if (!exists) continue;

    for (const filePath of walk(dir)) {
      const rel = path.relative(dir, filePath);
      if (rel === 'routing.md') continue;

      const prevSource = seenRelative.get(rel);
      if (prevSource) {
        errors.push(`duplicate skill path '${rel}' in ${prevSource} and ${dir}`);
      } else {
        seenRelative.set(rel, dir);
      }

      let raw;
      try { raw = readFileSync(filePath, 'utf8'); }
      catch (err) {
        errors.push(`${rel}: cannot read (${err.message})`);
        continue;
      }

      const { title, opener } = extractTitleAndOpener(raw);

      if (!title) {
        errors.push(`${rel}: missing H1 title (e.g. "# Skill Name")`);
      } else if (title.length > TITLE_MAX_CHARS) {
        errors.push(`${rel}: title exceeds ${TITLE_MAX_CHARS} chars (got ${title.length})`);
      }

      if (!opener) {
        warnings.push(`${rel}: no trigger opener after the H1 title — routing will have nothing to match`);
      } else if (!TRIGGER_PATTERN.test(opener)) {
        warnings.push(`${rel}: opener should start with "Use this skill when/to/for ..." (got "${opener.slice(0, 60)}…")`);
      } else if (opener.length > DESCRIPTION_MAX_CHARS) {
        warnings.push(`${rel}: opener exceeds ${DESCRIPTION_MAX_CHARS} chars (got ${opener.length})`);
      }

      skills.push({ path: rel, title, opener });
    }
  }

  return { valid: errors.length === 0, errors, warnings, skills };
}
