/**
 * lib/handoffs/contract.mjs — handoff schema + parse/validate/format.
 *
 * A handoff is a markdown file in `.cx/handoffs/` written when a session
 * bridges work to the next agent. Until now the shape was implicit, so
 * handoffs varied in quality and there was no automated cleanup beyond
 * raw mtime/count caps. This module defines a contract:
 *
 *   ---
 *   schema: cx-handoff/v1
 *   id: 2026-05-18-something-something            # filename stem
 *   created: 2026-05-18T14:00:00.000Z
 *   from_session: <session-uuid-or-alias>
 *   beads: [construct-xyz, construct-abc]         # work this handoff is about
 *   status: open                                   # open | resolved | archived
 *   title: One-line summary
 *   tags: [optional, free-form]
 *   ---
 *
 *   ## What was done
 *   …
 *   ## What's left
 *   …
 *   ## Open questions
 *   …
 *   ## How to resume
 *   …
 *
 * Status semantics:
 *   - open      — bead(s) still in progress or open; handoff is live context
 *   - resolved  — every referenced bead is closed; handoff is informational
 *   - archived  — moved to .cx/handoffs/archive/ during cleanup
 *
 * Cleanup uses these fields:
 *   - resolved handoffs older than retention → archived
 *   - archived handoffs older than 2× retention → deleted
 *   - any handoff past `handoffsMaxItems` (FIFO by mtime) → deleted
 *
 * `parseHandoff` is intentionally permissive — pre-contract handoffs with
 * no frontmatter still parse with status='legacy' so they aren't lost.
 * `validateHandoffFile` is the strict version, used when writing.
 */

import { readFileSync } from 'node:fs';

export const HANDOFF_SCHEMA_VERSION = 'cx-handoff/v1';
export const HANDOFF_STATUSES = Object.freeze(['open', 'resolved', 'archived']);
export const REQUIRED_SECTIONS = Object.freeze(['What was done', "What's left"]);

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function parseFrontmatterBlock(text) {
  const out = {};
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (!key) continue;
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      out[key] = rawValue.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (rawValue === 'true' || rawValue === 'false') {
      out[key] = rawValue === 'true';
    } else if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
      out[key] = Number(rawValue);
    } else {
      const unquoted = rawValue.replace(/^["']|["']$/g, '');
      out[key] = unquoted;
    }
  }
  return out;
}

export function parseHandoff(text) {
  if (typeof text !== 'string') {
    return { frontmatter: {}, body: '', sections: {}, status: 'invalid', error: 'text required' };
  }
  const fmMatch = text.match(FRONTMATTER_RE);
  let frontmatter = {};
  let body = text;
  if (fmMatch) {
    frontmatter = parseFrontmatterBlock(fmMatch[1]);
    body = text.slice(fmMatch[0].length);
  }
  const sections = {};
  let currentHeading = null;
  let currentLines = [];
  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (currentHeading) sections[currentHeading] = currentLines.join('\n').trim();
      currentHeading = heading[1];
      currentLines = [];
    } else if (currentHeading) {
      currentLines.push(line);
    }
  }
  if (currentHeading) sections[currentHeading] = currentLines.join('\n').trim();

  const status = frontmatter?.schema === HANDOFF_SCHEMA_VERSION
    ? (HANDOFF_STATUSES.includes(frontmatter.status) ? frontmatter.status : 'open')
    : 'legacy';
  return { frontmatter, body, sections, status };
}

export function parseHandoffFile(filePath) {
  const text = readFileSync(filePath, 'utf8');
  return parseHandoff(text);
}

export function validateHandoffFile(parsed) {
  const errors = [];
  const fm = parsed?.frontmatter || {};
  if (fm.schema !== HANDOFF_SCHEMA_VERSION) errors.push(`schema must be '${HANDOFF_SCHEMA_VERSION}'`);
  if (typeof fm.id !== 'string' || !fm.id) errors.push('id required (typically the filename stem)');
  if (typeof fm.created !== 'string' || !/\d{4}-\d{2}-\d{2}/.test(fm.created)) errors.push("created required (ISO-8601 string starting with YYYY-MM-DD)");
  if (typeof fm.title !== 'string' || !fm.title.trim()) errors.push('title required');
  if (fm.status && !HANDOFF_STATUSES.includes(fm.status)) errors.push(`status must be one of ${HANDOFF_STATUSES.join(', ')}`);
  if (fm.beads !== undefined && !Array.isArray(fm.beads)) errors.push('beads must be an array of bd issue ids');
  for (const section of REQUIRED_SECTIONS) {
    if (!parsed?.sections?.[section] || !parsed.sections[section].trim()) {
      errors.push(`required section missing or empty: "${section}"`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function formatHandoff({ id, title, beads = [], status = 'open', from_session = null, tags = [], whatWasDone = '', whatsLeft = '', openQuestions = '', howToResume = '' } = {}) {
  if (!id) throw new Error('formatHandoff: id required');
  if (!title) throw new Error('formatHandoff: title required');
  const lines = [
    '---',
    `schema: ${HANDOFF_SCHEMA_VERSION}`,
    `id: ${id}`,
    `created: ${new Date().toISOString()}`,
    from_session ? `from_session: ${from_session}` : null,
    `beads: [${beads.join(', ')}]`,
    `status: ${status}`,
    `title: ${JSON.stringify(title)}`,
    tags.length ? `tags: [${tags.join(', ')}]` : null,
    '---',
    '',
    '## What was done',
    '',
    whatWasDone.trim() || '_TBD_',
    '',
    "## What's left",
    '',
    whatsLeft.trim() || '_TBD_',
    '',
    '## Open questions',
    '',
    openQuestions.trim() || '_(none)_',
    '',
    '## How to resume',
    '',
    howToResume.trim() || '_TBD_',
    '',
  ].filter((line) => line !== null);
  return lines.join('\n');
}
