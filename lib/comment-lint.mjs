/**
 * lib/comment-lint.mjs — enforce the Construct comment policy from rules/common/comments.md.
 *
 * lintFile(path) checks a single file. lintRepo({ rootDir, fix }) checks all
 * scoped paths and optionally inserts stub headers for files missing one.
 * Used by `construct lint:comments`, the comment-lint PostToolUse hook, and CI.
 * Also enforces the future-state doc marker convention (construct-9oi4.15.3 /
 * LMCP-O3): a guide/operations doc claiming a capability is "staged/
 * experimental" or "not yet {implemented,active,shipped,supported}" must cite
 * a construct-* bead id within two lines. And bans naming another project by
 * name in a code comment (BANNED_EXTERNAL_PROJECTS) outside docs/decisions/**
 * and docs/notes/**, where a prior-art comparison can carry a citation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_MARKERS } from './config-dir.mjs';

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
// Match this repo's bucketed layout (docs/specs/prd, docs/decisions/adr, …) and
// the flat init-lane layout that `construct init` scaffolds downstream (docs/prd,
// docs/adr, …), so artifact-prose linting fires in either project shape.

const ARTIFACT_PATH_GLOBS = [
  /^docs\/(?:specs\/)?prd\//,
  /^docs\/(?:decisions\/)?adr\//,
  /^docs\/(?:decisions\/)?rfc\//,
  /^docs\/(?:notes\/)?research\//,
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

// Deliverable surfaces where a tool-identity leak (rules/common/tool-invisibility.md)
// matters: project docs and the durable .cx knowledge / research / handoff / strategy
// stores. Broader than the fabrication-scoped ARTIFACT_PATH_GLOBS because a strategy
// lands in docs/ root, not only docs/specs/prd.

const DELIVERABLE_LEAK_GLOBS = [
  /^docs\/.*\.md$/,
  /^\.cx\/(?:research|knowledge|handoffs)\//,
  /^\.cx\/strategy\.md$/,
];

function isDeliverablePath(rel) {
  return DELIVERABLE_LEAK_GLOBS.some((r) => r.test(rel));
}

// The Construct repo legitimately names Construct and its cx-* roles in its own docs —
// the tool-identity check is for consuming projects only. Identify self by package name,
// memoized per rootDir so a repo-wide lint reads package.json once, not once per file.

const selfRepoCache = new Map();

function isConstructSelfRepo(rootDir) {
  if (selfRepoCache.has(rootDir)) return selfRepoCache.get(rootDir);
  let isSelf = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    isSelf = pkg.name === '@geraldmaron/construct';
  } catch { isSelf = false; }
  selfRepoCache.set(rootDir, isSelf);
  return isSelf;
}

function requiresHeader(rel) {
  const ext = path.extname(rel);
  if (['.yaml', '.yml', '.json', '.jsonl', '.toml', '.txt'].includes(ext)) return { required: false, type: null };
  const jsMatch = JS_HEADER_GLOBS.some(r => r.test(rel));
  const mdMatch = MD_HEADER_GLOBS.some(r => r.test(rel));
  // Exclude test fixture data files — these are project artifacts, not source files.
  if (rel.startsWith('tests/fixtures/projects/')
    || rel.startsWith('tests/fixtures/artifacts/')
    || rel.startsWith('tests/fixtures/document-io/')) {
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
const MD_YAML_HEADER_RE = /^---\n(?:[^\n]*\n)*?description:[\s\S]*?\n---/;
const SH_HEADER_RE = /^#!.*\n(?:#[^\n]*\n)*/;

function hasHeader(content, type) {
  if (type === 'js') return JS_HEADER_RE.test(content.trimStart());
  if (type === 'md') {
    const trimmed = content.trimStart();
    return MD_HEADER_RE.test(trimmed) || MD_YAML_HEADER_RE.test(trimmed);
  }
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
  { pattern: new RegExp(`${CMT}\\s*TODO(?!\\s*\\(\\w+\\)\\s*:)`, 'i'), label: 'TODO without owner — use: TODO(owner): what and why' }, // construct-lint-ignore
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

// Future-state doc markers (construct-9oi4.15.3 / LMCP-O3): a guide or
// operations doc that tells the reader a capability is "staged/experimental"
// or "not yet {implemented,active,shipped,supported}" must cite a tracked
// construct-* bead within two lines, or the claim is unfalsifiable — nobody
// can check whether the gap is still open. Scope is guides/operations/README,
// matching where the M3 sweep (construct-9oi4.13.3) found and fixed its
// contradictions. ADRs/RFCs carry their own Status/Tracking header convention
// and docs/notes/research/** are working notes, not shipped-behavior claims —
// both excluded. hooks-deprecated.md is excluded: it is a self-governing
// ledger of removed hooks (checked separately by `construct doctor`), not a
// forward-looking capability claim.

const FUTURE_STATE_DOC_INCLUDE = [
  /^docs\/guides\//,
  /^docs\/operations\//,
  /^docs\/README\.md$/,
];

const FUTURE_STATE_DOC_EXCLUDE = [
  /^docs\/guides\/reference\/hooks-deprecated\.md$/,
];

function isFutureStateDocPath(rel) {
  return FUTURE_STATE_DOC_INCLUDE.some((r) => r.test(rel)) && !FUTURE_STATE_DOC_EXCLUDE.some((r) => r.test(rel));
}

const FUTURE_STATE_MARKERS = [
  /\bstaged\/experimental\b/i,
  /\bnot\s+yet\s+(?:implemented|active|shipped|supported)\b/i,
  /\bplanned[;:—-]+\s*not\s+(?:yet\s+)?implemented\b/i,
];

const BEAD_ID_RE = /\bconstruct-[a-z0-9]+(?:\.[a-z0-9]+)*\b/i;

function hasBeadIdNearby(lines, idx) {
  const lo = Math.max(0, idx - 2);
  const hi = Math.min(lines.length, idx + 3);
  for (let i = lo; i < hi; i++) {
    if (BEAD_ID_RE.test(lines[i])) return true;
  }
  return false;
}

function checkFutureStateMarkers(content, rel) {
  if (!isFutureStateDocPath(rel)) return [];
  const lines = content.split('\n');
  const skip = buildSkipMap(lines);
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    if (skip[i]) continue;
    if (lines[i].includes('construct-lint-ignore')) continue;
    for (const pattern of FUTURE_STATE_MARKERS) {
      if (pattern.test(lines[i]) && !hasBeadIdNearby(lines, i)) {
        violations.push({
          line: i + 1,
          label: 'future-state doc marker ("staged/experimental" / "not yet implemented" / "planned — not implemented") has no construct-* bead id within 2 lines (rules/common/no-fabrication.md)',
          kind: 'artifact',
        });
      }
    }
  }
  return violations;
}

function isBannedCheckSkipped(filePath) {
  if (!filePath) return false;
  return BANNED_CHECK_SKIP.some((suffix) => filePath.endsWith(suffix));
}

// External project names named in a code comment read as an unverifiable
// comparison — no-fabrication requires prior-art comparisons carry a citation,
// and only a decision document carries one. docs/decisions/** and docs/notes/**
// are that citation-bearing exception; every other comment in the repo
// describes this codebase's own behavior. A variant of CMT excludes the `//`
// in a URL scheme (`https://…`) so a cited reference link doesn't misread as
// a comment marker — this check runs on markdown prose too, unlike the other
// BANNED entries above, so citation URLs are common in its input.

const BANNED_EXTERNAL_PROJECTS = ['CrewAI', 'LangGraph', 'AutoGen', 'LangChain', 'MetaGPT', 'Aider', 'Devin'];

const EXTERNAL_PROJECT_CMT = '(?:(?<!:)\\/\\/|^\\s*\\*(?!\\/))';

const EXTERNAL_PROJECT_NAME_RE = new RegExp(
  `${EXTERNAL_PROJECT_CMT}.*\\b(?:${BANNED_EXTERNAL_PROJECTS.join('|')})\\b`,
  'i',
);

const EXTERNAL_PROJECT_EXEMPT_GLOBS = [
  /^docs\/decisions\//,
  /^docs\/notes\//,
];

function isExternalProjectExempt(rel) {
  return EXTERNAL_PROJECT_EXEMPT_GLOBS.some((r) => r.test(rel));
}

function checkExternalProjectNames(content, filePath, rel) {
  if (isBannedCheckSkipped(filePath)) return [];
  if (isExternalProjectExempt(rel)) return [];

  // Same JS/TS comment-convention scope as checkBanned: the "// " / " * "
  // detection matches markdown's own "**bold**"/"* bullet" syntax as a
  // false positive, so markdown/MDX prose is out of scope for this check.
  if (filePath && ['.md', '.mdx'].includes(path.extname(filePath))) return [];
  const lines = content.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('construct-lint-ignore')) continue;
    if (EXTERNAL_PROJECT_NAME_RE.test(lines[i])) {
      violations.push({
        line: i + 1,
        label: 'external project name in a code comment — prior-art comparisons belong in docs/decisions or docs/notes with citations (rules/common/comments.md)',
        kind: 'artifact',
      });
    }
  }
  return violations;
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

// A citation marker proves nothing if it resolves to nothing. Two marker kinds
// are mechanically verifiable offline: a `[^n]` footnote must have a matching
// `[^n]:` definition, and a `[source: <repo-path>]` must point at a file that
// exists. URLs and free-text sources are left alone — unverifiable here, and
// flagging them would punish honest prose. Skip code fences and tables so regex
// examples and tabular data never read as dangling citations.

function looksLikeRepoPath(value) {
  return /^[\w./@-]+$/.test(value) && value.includes('/') && !/^https?:/i.test(value);
}

export function findDanglingCitations(content, { rootDir = process.cwd() } = {}) {
  const lines = content.split('\n');
  const skip = buildSkipMap(lines);
  const defs = new Set();
  lines.forEach((line, i) => {
    if (skip[i]) return;
    const d = line.match(/^\s*\[\^([^\]]+)\]:/);
    if (d) defs.add(d[1]);
  });

  const violations = [];
  lines.forEach((line, i) => {
    if (skip[i] || line.includes('construct-lint-ignore')) return;
    const scan = line.replace(/`[^`]*`/g, '');
    let m;
    const refRe = /\[\^([^\]]+)\](?!:)/g;
    while ((m = refRe.exec(scan)) !== null) {
      if (!defs.has(m[1])) {
        violations.push({ line: i + 1, label: `dangling footnote citation [^${m[1]}] has no definition`, kind: 'artifact' });
      }
    }
    const srcRe = /\[source:\s*([^\]]+)\]/gi;
    while ((m = srcRe.exec(scan)) !== null) {
      const value = m[1].trim();
      if (looksLikeRepoPath(value) && !fs.existsSync(path.resolve(rootDir, value))) {
        violations.push({ line: i + 1, label: `citation source path not found: ${value}`, kind: 'artifact' });
      }
    }
  });
  return violations;
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

// Internal specialist role ids (cx-business-strategist, cx-product-manager, …) are
// implementation detail; in a consuming project's deliverable they read as a tool-identity
// leak. The set is anchored to the real role ids from specialists/org — an
// open-ended /cx-[a-z-]+/ also matches unrelated npm packages (cx-ray, cx-pro, cx-widget)
// and would fail the release gate on legitimate user content. Drift from the registry is
// caught by tests/tool-invisibility.test.mjs, not at runtime: this module sits on the hook
// path and must never throw on a missing or malformed registry file.

export const KNOWN_CX_ROLE_IDS = [
  'architect', 'data-analyst', 'debugger', 'designer', 'engineer', 'operations',
  'orchestrator', 'product-manager', 'qa', 'researcher', 'reviewer', 'security',
];

const CX_ROLE_LEAK = new RegExp(
  `\\bcx-(?:${[...KNOWN_CX_ROLE_IDS].sort((a, b) => b.length - a.length).join('|')})\\b`,
);

// Code fences (``` or ~~~) wrap non-prose content, so a role id inside one is not a leak.
// Only closed fences are skipped: an unclosed fence must not suppress scanning of the rest
// of the document, or the backstop would fail open on a leak. Returns the line indices that
// fall inside a properly terminated fence.

function closedFenceLines(lines) {
  const inside = new Set();
  let openChar = null;
  let pending = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].match(/^(```+|~~~+)/);
    if (openChar === null) {
      if (marker) { openChar = marker[1][0]; pending = [i]; }
      continue;
    }
    pending.push(i);
    if (marker && marker[1][0] === openChar) {
      for (const idx of pending) inside.add(idx);
      openChar = null;
      pending = [];
    }
  }
  return inside;
}

function findToolIdentityLeaks(content) {
  const lines = content.split('\n');
  const fenced = closedFenceLines(lines);
  const violations = [];
  let inFrontmatter = false;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) { if (line.trim() === '---') inFrontmatter = false; continue; }
    if (fenced.has(i)) continue;
    if (inComment) { if (line.includes('-->')) inComment = false; continue; }
    if (line.includes('construct-lint-ignore')) continue;
    const scan = line.replace(/<!--.*?-->/g, '');
    if (line.includes('<!--') && !line.includes('-->')) inComment = true;
    if (CX_ROLE_LEAK.test(scan)) {
      violations.push({
        line: i + 1,
        label: 'tool-identity leak: internal cx-* specialist role id in a deliverable — the artifact is about the user\'s project, not Construct\'s roles (tool-invisibility §2)',
        kind: 'artifact',
      });
    }
  }
  return violations;
}

function checkBanned(content, filePath) {
  if (isBannedCheckSkipped(filePath)) return [];

  // Banned patterns are JS/TS comment conventions — they don't apply to markdown/MDX prose.
  if (filePath && ['.md', '.mdx'].includes(path.extname(filePath))) return [];

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
  if (isArtifactPath(rel)) artifactHits.push(...findDanglingCitations(content, { rootDir }));
  artifactHits.push(...checkFutureStateMarkers(content, rel));
  artifactHits.push(...checkExternalProjectNames(content, filePath, rel));
  if (artifactHits.length > 0) {
    const mode = process.env.CONSTRUCT_ARTIFACT_LINT_MODE || 'warn';
    const bucket = mode === 'block' ? errors : warnings;
    for (const v of artifactHits) bucket.push(v);
  }

  // Tool-identity leak (rules/common/tool-invisibility.md): consuming-project deliverables
  // only — skipped on the Construct repo, where naming Construct and cx-* roles is correct.
  // Same mode routing as the artifact lint (warn by default, block in the release gate).
  if (!isConstructSelfRepo(rootDir) && isDeliverablePath(rel)) {
    const leaks = findToolIdentityLeaks(content);
    if (leaks.length > 0) {
      const mode = process.env.CONSTRUCT_ARTIFACT_LINT_MODE || 'warn';
      const bucket = mode === 'block' ? errors : warnings;
      for (const v of leaks) bucket.push(v);
    }
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
      if (['.git', 'node_modules', 'site', ...PROJECT_MARKERS, '.claude'].includes(entry.name)) continue;
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
    if (!required && !['.mjs', '.md', '.mdx', '.sh'].includes(ext)) continue;
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
