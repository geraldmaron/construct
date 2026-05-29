/**
 * lib/sync/skill-frontmatter.mjs — Build Anthropic Agent Skills frontmatter
 * for SKILL.md files emitted by sync-specialists.
 *
 * Anthropic Skills require YAML frontmatter with at minimum `name` and
 * `description`. The description gates skill selection — without it, the
 * loader silently skips the file (the user-reported bug: 141 files dropped).
 * Source Construct skills carry an HTML comment header with the description;
 * extractSkillDescription pulls it out.
 *
 * Also exports a conservative stripLeadingFrontmatter helper so we never
 * emit double-frontmatter when the source body already has its own block.
 */

const HTML_COMMENT_RE = /^<!--([\s\S]*?)-->/;
// Matches the source skill comment header shape: `skills/path/foo.md (Title)
// Use when X.\n...rest of comment...`. Group 1 captures the optional title,
// group 2 captures all subsequent prose inside the comment. No /m flag — `$`
// matches end of input, not end of line, so multi-line "Use when..." prose
// is captured in full and firstSentence() picks the first terminator.

const SOURCE_HEADER_RE = /^skills\/[\w./-]+\s*(?:\(([^)]+)\))?\s*([\s\S]*?)$/;

// Anthropic Skills cap descriptions at 1024 chars; this cap is tighter so
// the YAML stays readable in `construct skills list` output too.
const DESCRIPTION_MAX = 240;

export function buildSkillFrontmatter(name, sourceContent) {
  const skillName = String(name).replace(/\//g, '.');
  const description = extractSkillDescription(sourceContent) || `Construct skill: ${skillName}`;
  const safeDescription = description.replace(/\n+/g, ' ').slice(0, DESCRIPTION_MAX).replace(/"/g, "'");
  return `---\nname: ${skillName}\ndescription: "${safeDescription}"\n---\n`;
}

export function extractSkillDescription(content) {
  if (!content) return null;
  const commentMatch = content.match(HTML_COMMENT_RE);
  if (commentMatch) {
    const inner = commentMatch[1].trim();
    const headerMatch = inner.match(SOURCE_HEADER_RE);
    if (headerMatch) {
      const prose = (headerMatch[2] || '').trim();
      if (prose) return firstSentence(prose);
    }
    const lines = inner.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) return firstSentence(lines.slice(1).join(' '));
  }
  const body = content.replace(HTML_COMMENT_RE, '').trim();
  const paragraphs = body.split(/\n\s*\n/);
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (trimmed.startsWith('#')) continue;
    if (trimmed) return firstSentence(trimmed);
  }
  return null;
}

function firstSentence(text) {
  const match = text.match(/^[\s\S]*?[.!?](?:\s|$)/);
  return (match ? match[0] : text).trim();
}

export function stripLeadingFrontmatter(content) {
  if (!content) return content;
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return content;
  const closeIdx = content.indexOf('\n---', 4);
  if (closeIdx === -1) return content;
  const afterClose = content.indexOf('\n', closeIdx + 1);
  if (afterClose === -1) return '';
  return content.slice(afterClose + 1);
}
