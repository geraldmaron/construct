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
  /^sync-specialists\.mjs$/,
  /^tests\//,
];

const MD_HEADER_GLOBS = [
  /^personas\//,
  /^skills\//,
  /^rules\//,
  /^commands\//,
];

// Artifact paths receive an additional prose-lint pass for fabrication patterns
// (manufactured confidence, hand-wave percentages, mind-reading, speculation).
// Scope is deliberately narrow — READMEs, cookbook, concepts, and reference are
// unaffected. The patterns live in BANNED_ARTIFACT below; the severity (block
// vs warn) is controlled by CONSTRUCT_ARTIFACT_LINT_MODE.
const ARTIFACT_PATH_GLOBS = [
  /^docs\/prd\//,
  /^docs\/adr\//,
  /^docs\/rfc\//,
  /^docs\/research\//,
  /^\.cx\/knowledge\//,
  /^\.cx\/handoffs\//,
  /^\.cx\/research\//,
];

function relPath(rootDir, absPath) {
  return path.relative(rootDir, absPath).replace(/\\/g, '/');
}

function isArtifactPath(rel) {
  return ARTIFACT_PATH_GLOBS.some((r) => r.test(rel));
}

function requiresHeader(rel) {
  const ext = path.extname(rel);
  if (['.yaml', '.yml', '.json', '.jsonl', '.toml'].includes(ext)) return { required: false, type: null };
  const jsMatch = JS_HEADER_GLOBS.some(r => r.test(rel));
  const mdMatch = MD_HEADER_GLOBS.some(r => r.test(rel));
  // Exclude static assets under lib/server/static from requiring headers
  if (rel.startsWith('lib/server/static/')) {
    return { required: false, type: null };
  }
  // Exclude test fixture data files — these are project artifacts, not source files.
  if (rel.startsWith('tests/fixtures/projects/')) {
    return { required: false, type: null };
  }
  // Markdown files always get markdown-style headers, even if the directory
  // glob (e.g. ^tests/) primarily targets JS sources. Without this, .md docs
  // co-located with .mjs tests were forced into /** */ format.
  let type;
  if (ext === '.md') type = mdMatch || jsMatch ? 'md' : null;
  else if (jsMatch && ext !== '.html') type = 'js';
  else type = (jsMatch || mdMatch) ? 'md' : null;
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
//
// Comment-line prefix matches both `//` line comments and JSDoc body lines
// (those start with optional whitespace + `*`). The leading `^\s*\*(?!\/)`
// keeps it from matching `*/` block-end lines or arithmetic.

const CMT = '(?:\\/\\/|^\\s*\\*(?!\\/))';

const BANNED = [
  // point-in-time
  { pattern: new RegExp(`${CMT}.*\\b(?:added for|added recently|recently added|just added|new:)\\b`, 'i'), label: 'point-in-time: "added for / recently / just / new:"' },
  { pattern: new RegExp(`${CMT}.*\\b(?:previously|no longer|used to|was replaced|replaced by)\\b`, 'i'), label: 'point-in-time: history belongs in git log, not source' },
  { pattern: new RegExp(`${CMT}.*\\b(?:replaces the (?:old|previous|prior)|consolidates what was|instead of (?:only|the|a) (?:old|prior|previous))\\b`, 'i'), label: 'comparative narrative: describe what the code does, not what it used to do' },
  { pattern: new RegExp(`${CMT}.*\\b(?:the (?:new|current) (?:path|approach|impl|implementation|design) (?:uses|writes|reads|does|fires|spins))\\b`, 'i'), label: 'comparative narrative: "the new X uses/does Y" — describe the design directly' },
  { pattern: new RegExp(`${CMT}.*(?:#\\d{3,}|GH-\\d+|JIRA-\\d+|closes #|fixes #|ticket )`, 'i'), label: 'issue/PR reference in source comment (put in commit message instead)' },
  // narrative voice
  { pattern: new RegExp(`${CMT}\\s+(?:We |This |It |Now )\\w`, 'i'), label: 'narrative voice: avoid "We/This/It/Now" — describe the constraint, not the story' },
  // noise sentinels
  { pattern: new RegExp(`${CMT}\\s*(?:ok|OK|skip|Skip|best effort)\\s*$`, 'i'), label: 'noise sentinel: "ok / skip / best effort" carries no decision content' },
  // caller references
  { pattern: new RegExp(`${CMT}.*\\b(?:used by|called from|only consumer)\\b`, 'i'), label: 'caller reference: "used by / called from"' },
  // step markers — only flag in `//` comments. Ordered lists are
  // conventional inside JSDoc decision-tree and flow documentation.
  { pattern: /\/\/\s+\d+\.\s+\w/, label: 'step marker: use function names or block structure instead of "// 1. Step"' },
  // deferred-implementation wording: signals incomplete work that should
  // either ship or be removed before release.
  { pattern: new RegExp(`${CMT}.*\\bphase\\s+[abc]\\s+follow-?up\\b`, 'i'), label: 'deferred implementation: "Phase X follow-up" — ship it or remove it' },
  { pattern: new RegExp(`${CMT}.*\\bin a real implementation\\b`, 'i'), label: 'deferred implementation: "in a real implementation" — implement the contract honestly' },
  { pattern: new RegExp(`${CMT}.*\\bwould go here\\b`, 'i'), label: 'deferred implementation: "would go here" — implement or delete the placeholder' },
  { pattern: new RegExp(`${CMT}.*\\bcoming soon\\b`, 'i'), label: 'deferred implementation: "coming soon" — not a release-ready statement' },
  { pattern: new RegExp(`${CMT}.*\\bnot yet supported\\b`, 'i'), label: 'deferred implementation: "not yet supported" — document the supported contract instead' },
  // markdown equivalents
  { pattern: /<!--.*\b(?:added for|added recently|just added|new:)\b.*-->/i, label: 'point-in-time in markdown comment' },
  { pattern: /<!--.*\b(?:used by|called from|only consumer)\b.*-->/i, label: 'caller reference in markdown comment' },
  // TODO without owner
  { pattern: new RegExp(`${CMT}\\s*TODO(?:\\((\\w+)\\))?:?(?!\\s*\\(\\w+\\):)`, 'i'), label: 'TODO without owner — use: TODO(owner): what and why' }, // construct-lint-ignore
];

// Files whose content is authored precisely to demonstrate banned patterns
// (the linter itself, the canonical rule file, test fixtures that feed the
// linter banned strings, and teaching docs that show patterns to avoid).
// Linting them would flag the demonstrations as violations.
const BANNED_CHECK_SKIP = [
  'lib/comment-lint.mjs',
  'rules/common/comments.md',
  'rules/common/no-fabrication.md',
  'tests/comment-lint.test.mjs',
  'commands/work/clean.md',
  'skills/utility/clean-code.md',
];

// Artifact-prose patterns. Scoped to ARTIFACT_PATH_GLOBS. Each entry can mark
// requireCitation: true — in that case the violation is suppressed when a
// citation (`[source: …]`, http URL, or footnote ref) appears in the same line
// or within 2 lines of context.
const BANNED_ARTIFACT = [
  {
    pattern: /\b(?:clearly|obviously|undoubtedly|definitely|certainly|surely)\b/i,
    label: 'manufactured confidence: "clearly/obviously/undoubtedly/etc" smuggles certainty without evidence (no-fabrication §4)',
  },
  {
    pattern: /\b\d{1,3}\s*%/,
    label: 'unattributed percentage: quantitative claims require a [source: …] citation (no-fabrication §4)',
    requireCitation: true,
  },
  {
    pattern: /\b(?:users|customers|everyone)\s+(?:want|expect|prefer|agree|need)\b/i,
    label: 'customer mind-reading: "users want / customers expect / everyone agrees" requires a [source: …] citation (no-fabrication §5)',
    requireCitation: true,
  },
  {
    pattern: /\b(?:will\s+(?:likely|probably)|should\s+improve|expected\s+to\s+(?:improve|reduce|increase|drop|rise))\b/i,
    label: 'speculative projection: future-tense claims need a baseline + projection source (no-fabrication §3, §4)',
    requireCitation: true,
  },
];

function isBannedCheckSkipped(filePath) {
  if (!filePath) return false;
  return BANNED_CHECK_SKIP.some((suffix) => filePath.endsWith(suffix));
}

// Track fenced code blocks ( ``` … ``` ) and YAML frontmatter ( --- … --- )
// so artifact-prose patterns inside code or metadata are not flagged.
function buildSkipMap(lines) {
  const skip = new Array(lines.length).fill(false);
  let inFence = false;
  let inFrontmatter = false;
  let frontmatterClosed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      skip[i] = true;
      continue;
    }
    if (inFrontmatter) {
      skip[i] = true;
      if (line.trim() === '---') {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      continue;
    }
    if (/^```/.test(line)) {
      inFence = !inFence;
      skip[i] = true;
      continue;
    }
    if (inFence) {
      skip[i] = true;
      continue;
    }
    if (/^\s{0,3}#{1,6}\s/.test(line)) skip[i] = true;
    // Markdown table rows (start and end with `|`) are typically targets,
    // specs, or reference lookups, not narrative prose. Skip to keep the
    // pattern bank focused on the prose surface where embellishment lives.
    if (/^\s*\|.*\|\s*$/.test(line)) skip[i] = true;
  }
  void frontmatterClosed;
  return skip;
}

function hasCitationNearby(lines, idx) {
  const lo = Math.max(0, idx - 2);
  const hi = Math.min(lines.length, idx + 3);
  for (let i = lo; i < hi; i++) {
    if (/\[source:|\bhttps?:\/\/|\[\^\d+\]/i.test(lines[i])) return true;
  }
  return false;
}

function checkArtifactBanned(content, rel) {
  if (!isArtifactPath(rel)) return [];
  const lines = content.split('\n');
  const skip = buildSkipMap(lines);
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    if (skip[i]) continue;
    if (lines[i].includes('construct-lint-ignore')) continue;
    for (const entry of BANNED_ARTIFACT) {
      if (entry.pattern.test(lines[i])) {
        if (entry.requireCitation && hasCitationNearby(lines, i)) continue;
        violations.push({ line: i + 1, label: entry.label, kind: 'artifact' });
      }
    }
  }
  return violations;
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

  // Artifact-prose lint applies to markdown files under intake-fed artifact
  // paths (PRD, ADR, RFC, research, knowledge, handoffs). Severity is governed
  // by CONSTRUCT_ARTIFACT_LINT_MODE: 'block' (CLI / release-gate) routes hits
  // to errors[]; 'warn' (PostToolUse hook default) routes to warnings[] with
  // kind:'artifact' so the hook can let the edit through while still surfacing
  // the finding.
  const artifactHits = checkArtifactBanned(content, rel);
  if (artifactHits.length > 0) {
    const mode = process.env.CONSTRUCT_ARTIFACT_LINT_MODE || 'warn';
    const bucket = mode === 'block' ? errors : warnings;
    for (const v of artifactHits) bucket.push(v);
  }

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
