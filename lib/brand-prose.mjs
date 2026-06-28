/**
 * lib/brand-prose.mjs — marketing voice, retired typography, and Construct naming lint.
 *
 * Shared by scripts/audit/03d-brand.mjs, lib/hooks/brand-prose-lint.mjs, and
 * `construct lint:brand`. Scans markdown prose only (skips fenced code and inline code).
 */

import fs from 'node:fs';
import path from 'node:path';

export const MARKETING_VOICE_RE =
  /\b(robust|enterprise-grade|best-in-class|world-class|cutting-edge|powerful|battle-tested|seamless)\b/i;

export const RETIRED_FONT_RE =
  /Plus\s+Jakarta|PlusJakarta|Geist(?:Mono)?|IBM\s+Plex|Libertinus|font-family:\s*["']?Inter["']?/i;

const CLI_SUBCOMMANDS =
  'doctor|init|sync|dev|stop|status|intake|install|drop|search|prune|upgrade|config|list|graph|beads|export|publish|artifact|demo|oracle|ci|acp|profile|models|uninstall|reconcile|embed|ingest|classify|workflow|capability';

const PRODUCT_NOUN_PHRASES =
  /\bConstruct (?:install|MCP server|MCP tools?|workflow|package|repo|surfaces?|integration|orchestrator|daemon|specialists?|persona|brand|tooling|standards|config|adapters?|platform|version|release|hooks?|memory|loop|Dashboard|capability)\b/i;

const UNBACKTICKED_CLI_RE = new RegExp(
  `(?<![\`~/])construct\\s+(${CLI_SUBCOMMANDS})(?:\\s+[\\w:-]+)*\\b`,
  'i',
);

const MISCAPITALIZED_CLI_RE = new RegExp(
  `\\bConstruct\\s+(${CLI_SUBCOMMANDS})(?:\\s+[\\w:-]+)*\\b`,
);

const MARKETING_SCAN_ROOTS = ['docs', 'skills', 'specialists', 'personas', 'templates', 'rules'];
const MARKETING_SCAN_EXTS = ['.md', '.mdx'];
const FONT_SCAN_EXTS = ['.mjs', '.js', '.md', '.mdx', '.json', '.html', '.css', '.tsx', '.ts', '.jsx', '.typ'];

const EXCLUDE_PATH =
  /(node_modules|\.git|audit-artifacts|scripts\/audit|CHANGELOG\.md|fonts\/legacy\/|\.next\/|\/out\/|tests\/e2e\/reports\/|package-lock\.json)/;

const DOC_EXEMPT =
  /(?:^|\/)(docs\/STYLE\.md|docs\/guides\/reference\/branding\.md|templates\/distribution\/fonts\/README\.md)$/;

const HOOK_SCOPED =
  /^(docs\/|skills\/|specialists\/|personas\/|templates\/|rules\/|apps\/(dashboard|docs)\/)/;

export function isBrandHookPath(relPath) {
  if (!relPath || EXCLUDE_PATH.test(relPath) || DOC_EXEMPT.test(relPath)) return false;
  return HOOK_SCOPED.test(relPath.replace(/\\/g, '/'));
}

export function splitProseLines(content) {
  const prose = [];
  let inFence = false;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    prose.push({ line: i + 1, text: line });
  }
  return prose;
}

function stripInlineCode(text) {
  return text.replace(/`[^`]*`/g, '');
}

function isMarketingAllowlisted(relPath, lineText) {
  if (/skills\/roles\//.test(relPath) && /["']robust["']|POUR|Symptom/i.test(lineText)) return true;
  if (/<!--/.test(lineText)) return true;
  if (/\b(WCAG|Perceivable, Operable)/i.test(lineText) && /\bRobust\b/.test(lineText)) return true;
  return false;
}

function isNamingAllowlisted(relPath, lineText) {
  const trimmed = lineText.trim();
  if (/^#+\s+construct\s+/i.test(trimmed)) return true;
  if (/^title:\s/i.test(trimmed)) return true;
  if (/^description:\s/i.test(trimmed)) return true;
  if (/node\s+bin\/construct/.test(lineText)) return true;
  if (/CONSTRUCT_[A-Z_]+=/.test(lineText) && /construct\s+sync/.test(lineText)) return true;
  if ((lineText.match(/\|/g) || []).length >= 2) return true;
  if (/cli:construct/.test(lineText)) return true;
  if (/mcp:.*construct/.test(lineText)) return true;
  if (/\{\s*label:\s*['`]construct/.test(lineText)) return true;
  if (PRODUCT_NOUN_PHRASES.test(lineText)) return true;
  if (/verified_by:\s*construct\b/.test(lineText)) return true;
  if (/construct_schema_migrations/.test(lineText)) return true;
  if (/non-Construct/.test(lineText)) return true;
  return false;
}

export function lintMarketingVoiceLine(relPath, lineNumber, lineText) {
  const prose = stripInlineCode(lineText);
  if (!MARKETING_VOICE_RE.test(prose)) return null;
  if (isMarketingAllowlisted(relPath, lineText)) return null;
  const match = prose.match(MARKETING_VOICE_RE);
  return {
    kind: 'marketing-voice',
    line: lineNumber,
    token: match?.[0] ?? 'marketing',
    text: lineText.trim().slice(0, 140),
  };
}

export function lintRetiredFontLine(relPath, lineNumber, lineText) {
  if (!RETIRED_FONT_RE.test(lineText)) return null;
  return {
    kind: 'retired-font',
    line: lineNumber,
    text: lineText.trim().slice(0, 140),
  };
}

export function lintConstructNamingLine(relPath, lineNumber, lineText) {
  if (!/\.mdx?$/.test(relPath)) return null;
  if (isNamingAllowlisted(relPath, lineText)) return null;
  const prose = stripInlineCode(lineText);
  const miscap = prose.match(MISCAPITALIZED_CLI_RE);
  if (miscap) {
    return {
      kind: 'construct-naming',
      line: lineNumber,
      text: lineText.trim().slice(0, 140),
      detail: `Use lowercase CLI form: \`construct ${miscap[1]}\``,
    };
  }
  if (/^\s*\d+\.\s/.test(lineText) || /^\s*-\s/.test(lineText)) {
    const unback = prose.match(UNBACKTICKED_CLI_RE);
    if (unback) {
      return {
        kind: 'construct-naming',
        line: lineNumber,
        text: lineText.trim().slice(0, 140),
        detail: `Backtick CLI invocations: \`construct ${unback[1]}...\``,
      };
    }
  }
  return null;
}

export function lintMarkdownBrand(content, { relPath = '', checks = ['marketing', 'naming', 'font'] } = {}) {
  const violations = [];
  for (const { line, text } of splitProseLines(content)) {
    if (checks.includes('marketing')) {
      const hit = lintMarketingVoiceLine(relPath, line, text);
      if (hit) violations.push(hit);
    }
    if (checks.includes('naming')) {
      const hit = lintConstructNamingLine(relPath, line, text);
      if (hit) violations.push(hit);
    }
    if (checks.includes('font')) {
      const hit = lintRetiredFontLine(relPath, line, text);
      if (hit) violations.push(hit);
    }
  }
  return violations;
}

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (EXCLUDE_PATH.test(full)) continue;
    if (e.isDirectory()) walk(full, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

export function scanRepoBrandProse(rootDir, { checks = ['marketing', 'naming', 'font'] } = {}) {
  const hits = [];
  for (const base of MARKETING_SCAN_ROOTS) {
    const abs = path.join(rootDir, base);
    for (const file of walk(abs, [...MARKETING_SCAN_EXTS, ...(checks.includes('font') ? FONT_SCAN_EXTS : [])])) {
      const rel = path.relative(rootDir, file).replace(/\\/g, '/');
      if (DOC_EXEMPT.test(rel)) continue;
      const ext = path.extname(file);
      const fileChecks = checks.filter((c) => c !== 'font' || FONT_SCAN_EXTS.includes(ext));
      const content = fs.readFileSync(file, 'utf8');
      for (const v of lintMarkdownBrand(content, { relPath: rel, checks: fileChecks })) {
        hits.push({ file: rel, ...v });
      }
    }
  }
  return hits;
}

export function lintFile(absPath, { rootDir = process.cwd() } = {}) {
  const rel = path.relative(rootDir, absPath).replace(/\\/g, '/');
  if (!isBrandHookPath(rel)) return { rel, violations: [] };
  const ext = path.extname(absPath).toLowerCase();
  if (!['.md', '.mdx', '.html', '.css', '.tsx', '.ts', '.jsx', '.typ'].includes(ext)) {
    return { rel, violations: [] };
  }
  const content = fs.readFileSync(absPath, 'utf8');
  const checks = ['.md', '.mdx'].includes(ext) ? ['marketing', 'naming', 'font'] : ['font'];
  return { rel, violations: lintMarkdownBrand(content, { relPath: rel, checks }) };
}

export function formatBrandViolations(results) {
  const lines = [];
  for (const { rel, violations } of results) {
    for (const v of violations) {
      const detail = v.detail ? ` — ${v.detail}` : '';
      lines.push(`${rel}:${v.line} [${v.kind}] ${v.text}${detail}`);
    }
  }
  return lines.join('\n');
}
