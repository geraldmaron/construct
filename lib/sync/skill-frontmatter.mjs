/**
 * lib/sync/skill-frontmatter.mjs — Build Anthropic Agent Skills frontmatter
 * for SKILL.md files emitted by sync-specialists.
 *
 * Source skills carry YAML frontmatter with at minimum `name` + `description`
 * (Anthropic spec). For role files, extra construct-internal keys (role,
 * applies_to, inherits, version, profiles, cap) live in the same block; sync
 * drops those at emit time so only spec-compliant keys ship in SKILL.md.
 *
 * Backwards-compat path: source files missing YAML frontmatter fall through
 * to HTML-comment preamble extraction, then first body paragraph. Keeps
 * unmigrated files working during transition; the validator warns until
 * they migrate.
 *
 * Zero-dep posture: runs from isolated environments (cpSync'd tmpdirs
 * without node_modules), so the YAML reader/emitter stays in-tree. Surface
 * is small — read flat top-level keys + simple inline arrays; write 2 keys
 * (name, description). For richer YAML, the migration script and validator
 * use js-yaml.
 */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const HTML_COMMENT_RE = /^<!--([\s\S]*?)-->/;
const SOURCE_HEADER_RE = /^skills\/[\w./-]+\s*(?:\(([^)]+)\))?\s*([\s\S]*?)$/;

const DESCRIPTION_MAX = 1024;

// In-tree minimal YAML parser. Handles the subset Construct skill frontmatter
// uses: flat scalar keys, double/single-quoted or unquoted strings, simple
// inline arrays ([a, b, c]), and block-style arrays (- item per line).
// Unparseable input returns null; callers fall back to extraction.

function parseFlatYaml(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split('\n');
  const out = {};
  let pendingArrayKey = null;
  try {
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (!line.trim() || line.trim().startsWith('#')) continue;
      if (pendingArrayKey && /^\s+-\s+/.test(line)) {
        out[pendingArrayKey].push(parseScalar(line.replace(/^\s+-\s+/, '')));
        continue;
      }
      pendingArrayKey = null;
      const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const rawValue = m[2];
      if (rawValue === '' || rawValue === undefined) {
        out[key] = [];
        pendingArrayKey = key;
        continue;
      }
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        const inner = rawValue.slice(1, -1).trim();
        out[key] = inner === '' ? [] : inner.split(',').map((s) => parseScalar(s.trim()));
        continue;
      }
      out[key] = parseScalar(rawValue);
    }
  } catch (err) {
    if (err instanceof YamlError) return null;
    throw err;
  }
  return out;
}

class YamlError extends Error {}

function parseScalar(s) {
  const trimmed = s.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"') || trimmed.length < 2) throw new YamlError('unclosed double quote');
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) throw new YamlError('unclosed single quote');
    return trimmed.slice(1, -1).replace(/\\'/g, "'");
  }
  return trimmed;
}

function emitScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const s = String(value);
  if (/[:"'\n#&*!|>%@`]|^[-?]/.test(s) || s.length === 0) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

export function readSkillFrontmatter(content) {
  if (!content) return null;
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  return parseFlatYaml(match[1]);
}

export function buildSkillFrontmatter(name, sourceContent) {
  const fromSource = readSkillFrontmatter(sourceContent);
  const skillName = (fromSource?.name && typeof fromSource.name === 'string')
    ? fromSource.name
    : kebabFromPath(name);
  const description = (fromSource?.description && typeof fromSource.description === 'string')
    ? fromSource.description
    : (extractSkillDescription(sourceContent) || `Construct skill: ${skillName}`);
  const safe = description.replace(/\n+/g, ' ').slice(0, DESCRIPTION_MAX).replace(/"/g, "'").trim();
  return `---\nname: ${emitScalar(skillName)}\ndescription: ${emitScalar(safe)}\n---\n`;
}

function kebabFromPath(name) {
  return String(name).replace(/[/.]/g, '-').toLowerCase();
}

export function extractSkillDescription(content) {
  if (!content) return null;
  const fromYaml = readSkillFrontmatter(content);
  if (fromYaml?.description && typeof fromYaml.description === 'string') {
    return fromYaml.description;
  }
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
  const body = content.replace(FRONTMATTER_RE, '').replace(HTML_COMMENT_RE, '').trim();
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
