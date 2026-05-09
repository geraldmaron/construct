/**
 * lib/comment-lint.mjs — enforce the Construct comment policy from rules/common/comments.md.
 *
 * lintFile(path) checks a single file. lintRepo({ rootDir, fix }) checks all
 * scoped paths and optionally inserts stub headers for files missing one.
 * Used by `construct lint:comments`, the comment-lint PostToolUse hook, and CI.
 */

import fs from 'node:fs';
import path from 'node:path';

// --- scoped paths that require a file header ---

const JS_HEADER_GLOBS = [
  /^bin\//,
  /^lib\/(?!server\/)([\w-]+\.mjs)$/,
  /^lib\/hooks\//,
  /^lib\/server\//,
  /^lib\/mcp\//,
  /^lib\/metrics\//,
  /^sync-agents\.mjs$/,
  /^tests\//,
];

const MD_HEADER_GLOBS = [
  /^personas\//,
  /^skills\//,
  /^rules\//,
  /^commands\//,
];

function relPath(rootDir, absPath) {
  return path.relative(rootDir, absPath).replace(/\\/g, '/');
}

function requiresHeader(rel) {
  const ext = path.extname(rel);
  if (['.yaml', '.yml', '.json', '.toml'].includes(ext)) return { required: false, type: null };
  const jsMatch = JS_HEADER_GLOBS.some(r => r.test(rel));
  const mdMatch = MD_HEADER_GLOBS.some(r => r.test(rel));
  // Exclude static assets under lib/server/static from requiring headers
  if (rel.startsWith('lib/server/static/')) {
    return { required: false, type: null };
  }
  const type = (jsMatch && ext !== '.html') ? 'js' : (jsMatch || mdMatch) ? 'md' : null;
  return { required: jsMatch || mdMatch, type };
}

// --- header detection ---

const JS_HEADER_RE = /^(?:#![^\n]*\n)?(?:\/\/[^\n]*\n)*\/\*\*[\s\S]*?\*\//;
const MD_HEADER_RE = /^<!--[\s\S]*?-->/;
const SH_HEADER_RE = /^#!.*\n(?:#[^\n]*\n)*/;

function hasHeader(content, type) {
  if (type === 'js') return JS_HEADER_RE.test(content.trimStart());
  if (type === 'md') return MD_HEADER_RE.test(content.trimStart());
  return SH_HEADER_RE.test(content.trimStart());
}

// --- banned comment patterns ---

const BANNED = [
  // point-in-time
  { pattern: /\/\/.*\b(?:added for|added recently|recently added|just added|new:)\b/i, label: 'point-in-time: "added for / recently / just / new:"' },
  { pattern: /\/\/.*\b(?:previously|no longer|used to|removed|was replaced|replaced by)\b/i, label: 'point-in-time: history belongs in git log, not source' },
  { pattern: /\/\/.*(?:#\d{3,}|GH-\d+|JIRA-\d+|closes #|fixes #|ticket )/i, label: 'issue/PR reference in source comment (put in commit message instead)' },
  // narrative voice
  { pattern: /\/\/\s+(?:We |This |It |Now )\w/i, label: 'narrative voice: avoid "We/This/It/Now" — describe the constraint, not the story' },
  // noise sentinels
  { pattern: /\/\/\s*(?:ok|OK|skip|Skip|best effort)\s*$/i, label: 'noise sentinel: "ok / skip / best effort" carries no decision content' },
  // caller references
  { pattern: /\/\/.*\b(?:used by|called from|only consumer)\b/i, label: 'caller reference: "used by / called from"' },
  // step markers (inline numbered lists)
  { pattern: /\/\/\s+\d+\.\s+\w/, label: 'step marker: use function names or block structure instead of "// 1. Step"' },
  // markdown equivalents
  { pattern: /<!--.*\b(?:added for|added recently|just added|new:)\b.*-->/i, label: 'point-in-time in markdown comment' },
  { pattern: /<!--.*\b(?:used by|called from|only consumer)\b.*-->/i, label: 'caller reference in markdown comment' },
  // TODO without owner
  { pattern: /\/\/\s*TODO(?:\((\w+)\))?:?(?!\s*\(\w+\):)/i, label: 'TODO without owner — use: TODO(owner): what and why' }, // construct-lint-ignore
];

// Files whose content is authored precisely to demonstrate banned patterns
// (the linter itself, the canonical rule file, test fixtures that feed the
// linter banned strings, and teaching docs that show patterns to avoid).
// Linting them would flag the demonstrations as violations.
const BANNED_CHECK_SKIP = [
  'lib/comment-lint.mjs',
  'rules/common/comments.md',
  'tests/comment-lint.test.mjs',
  'commands/work/clean.md',
  'skills/utility/clean-code.md',
];

function isBannedCheckSkipped(filePath) {
  if (!filePath) return false;
  return BANNED_CHECK_SKIP.some((suffix) => filePath.endsWith(suffix));
}

function checkBanned(content, filePath) {
  if (isBannedCheckSkipped(filePath)) return [];

  // Banned patterns are JS/TS comment conventions — they don't apply to markdown prose.
  if (filePath && path.extname(filePath) === '.md') return [];

  const warnings = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Per-line escape hatch for the rare legitimate case — a section label
    // describing the pattern it detects, e.g. "// TODO/FIXME/HACK comments"
    // in a detector. Marker must appear on the same line.
    if (lines[i].includes('construct-lint-ignore')) continue;
    for (const { pattern, label } of BANNED) {
      if (pattern.test(lines[i])) {
        warnings.push({ line: i + 1, label });
      }
    }
  }
  return warnings;
}

// --- stub header generation ---

function stubJsHeader(rel) {
  return `/**\n * ${rel} — <one-line purpose>\n *\n * <2–6 line summary: what it does, who calls it, key side effects.>\n */\n`;
}

function stubMdHeader(rel) {
  return `<!--\n${rel} — <one-line purpose>\n\n<2–6 line summary.>\n-->\n`;
}

function extractShebang(content) {
  if (content.startsWith('#!')) {
    const nl = content.indexOf('\n');
    if (nl !== -1) return { shebang: content.slice(0, nl + 1), rest: content.slice(nl + 1) };
  }
  return { shebang: '', rest: content };
}

// --- single file lint ---

/**
 * Check one file against the comment policy.
 * Returns { path, errors, warnings }.
 */
export function lintFile(filePath, { rootDir = process.cwd(), fix = false } = {}) {
  const rel = relPath(rootDir, filePath);
  const { required, type } = requiresHeader(rel);

  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return { path: rel, errors: [], warnings: [] }; }

  const errors = [];
  const warnings = [];

  if (required && !hasHeader(content, type)) {
    errors.push({ line: 1, label: `missing file header block (see rules/common/comments.md §1)` });
    if (fix) {
      const stub = type === 'md' ? stubMdHeader(rel) : stubJsHeader(rel);
      const { shebang, rest } = extractShebang(content);
      fs.writeFileSync(filePath, shebang + stub + rest);
    }
  }

  const banned = checkBanned(content, filePath);
  for (const w of banned) warnings.push(w);

  return { path: rel, errors, warnings };
}

// --- repo-wide lint ---

function walkDir(dir, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'site', '.cx', '.construct', '.claude'].includes(entry.name)) continue;
      walkDir(full, results);
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Lint all scoped files in the repo. Returns an array of lint results.
 * With fix:true, inserts stub headers for missing-header errors.
 */
export function lintRepo({ rootDir = process.cwd(), fix = false } = {}) {
  const files = walkDir(rootDir);
  const results = [];
  for (const f of files) {
    const rel = relPath(rootDir, f);
    const { required } = requiresHeader(rel);
    const ext = path.extname(f);
    if (!required && !['.mjs', '.md', '.sh'].includes(ext)) continue;
    const result = lintFile(f, { rootDir, fix });
    if (result.errors.length || result.warnings.length) results.push(result);
  }
  return results;
}

/**
 * Format lint results for terminal output. Returns { output, exitCode }.
 */
export function formatResults(results) {
  if (!results.length) return { output: '  ✓  No comment policy violations found.\n', exitCode: 0 };

  const lines = [];
  let errorCount = 0;
  let warnCount = 0;

  for (const { path: p, errors, warnings } of results) {
    for (const { line, label } of errors) {
      lines.push(`  error  ${p}:${line}  ${label}`);
      errorCount++;
    }
    for (const { line, label } of warnings) {
      lines.push(`  warn   ${p}:${line}  ${label}`);
      warnCount++;
    }
  }

  const summary = `\n  ${errorCount} error(s), ${warnCount} warning(s)`;
  lines.push(summary);

  return { output: lines.join('\n') + '\n', exitCode: errorCount > 0 ? 1 : 0 };
}
