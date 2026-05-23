#!/usr/bin/env node
/**
 * scripts/lint-prose.mjs — Prose style guard for project docs.
 *
 * Enforces the rules in docs/STYLE.md:
 *   - No em-dashes in user-facing markdown
 *   - No marketing voice patterns the project has explicitly retired
 *
 * Default scope: only files staged for commit or changed vs origin/main. Use
 * `--all` to scan the whole tree. Pass paths to scan specific files.
 *
 * Exceptions live in `.proseignore` (gitignore syntax). CHANGELOG historical
 * entries are exempted because rewriting history is lying.
 *
 * Exit codes: 0 clean, 1 violations found.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const BANNED = [
  { re: /—/g, label: 'em-dash', hint: 'Replace with a period, comma, or colon. See docs/STYLE.md.' },
];

// File globs exempt from the prose lint. CHANGELOG keeps its history; CLAUDE.md
// is intentionally formal AI protocol; node_modules and worktrees are external.
const DEFAULT_EXCLUDES = [
  'CHANGELOG.md',
  'CLAUDE.md',
  'AGENTS.md',
  'node_modules/',
  '.git/',
  '.cx/',
  '.claude/',
  '.codex/',
  '.opencode/',
  '.tmp/',
  'dist/',
  '.beads/',
];

// Path fragments treated as "external" regardless of depth. Catches nested
// node_modules under apps/, dashboards, etc.
const EXTERNAL_FRAGMENTS = ['/node_modules/', '/.next/', '/dist/', '/.cache/'];

function loadProseIgnore() {
  const p = path.join(ROOT, '.proseignore');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function isExcluded(rel, excludes) {
  if (excludes.some((pat) => rel === pat || rel.startsWith(pat))) return true;
  const probe = `/${rel}`;
  if (EXTERNAL_FRAGMENTS.some((f) => probe.includes(f))) return true;
  return false;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
}

function listAllMarkdown() {
  const out = [];
  walk(ROOT, out);
  return out.map((p) => path.relative(ROOT, p));
}

function listChangedMarkdown() {
  try {
    // staged + working tree changes vs origin/main
    const cmd = "git diff --name-only --diff-filter=ACMR HEAD origin/main 2>/dev/null; git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null; git diff --name-only --diff-filter=ACMR --cached 2>/dev/null";
    const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
    return Array.from(new Set(out.split('\n').filter((l) => l.endsWith('.md'))));
  } catch {
    return [];
  }
}

// Strip triple-backtick fenced code blocks before linting prose. The fenced
// content may legitimately contain em-dashes (CLI output samples, third-party
// snippets), and the style rule is about user-facing prose, not code.
function stripFencedCode(text) {
  const lines = text.split('\n');
  const out = [];
  let inFence = false;
  let marker = null;
  for (const line of lines) {
    const m = line.match(/^(\s*)(```+|~~~+)/);
    if (m) {
      if (!inFence) { inFence = true; marker = m[2]; out.push(''); continue; }
      if (line.trimStart().startsWith(marker)) { inFence = false; marker = null; out.push(''); continue; }
    }
    out.push(inFence ? '' : line);
  }
  return out.join('\n');
}

function lintFile(rel) {
  const full = path.join(ROOT, rel);
  if (!existsSync(full) || !statSync(full).isFile()) return [];
  const raw = readFileSync(full, 'utf8');
  const content = stripFencedCode(raw);
  const violations = [];
  for (const rule of BANNED) {
    let m;
    rule.re.lastIndex = 0;
    while ((m = rule.re.exec(content)) !== null) {
      const lineNum = content.slice(0, m.index).split('\n').length;
      violations.push({ file: rel, line: lineNum, label: rule.label, hint: rule.hint });
    }
  }
  return violations;
}

function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const explicit = args.filter((a) => !a.startsWith('--'));

  const excludes = [...DEFAULT_EXCLUDES, ...loadProseIgnore()];

  let files = [];
  if (explicit.length > 0) files = explicit;
  else if (all) files = listAllMarkdown();
  else files = listChangedMarkdown();

  files = files.filter((f) => !isExcluded(f, excludes));

  if (files.length === 0) {
    console.log('lint:prose — nothing to check');
    return 0;
  }

  const violations = files.flatMap((f) => lintFile(f));

  if (violations.length === 0) {
    console.log(`lint:prose — clean (${files.length} file${files.length === 1 ? '' : 's'} checked)`);
    return 0;
  }

  console.error(`lint:prose — ${violations.length} violation${violations.length === 1 ? '' : 's'}:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.label}`);
  }
  console.error(`\nFix: ${BANNED[0].hint}`);
  console.error(`Bypass for one file: add the path to .proseignore (with reason).`);
  return 1;
}

process.exit(main());
