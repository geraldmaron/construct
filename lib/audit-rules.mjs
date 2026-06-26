/**
 * lib/audit-rules.mjs — static reference audit for the rules/ corpus.
 *
 * Rules are not retrieved into agent context through any single runtime path the
 * way skills are (no `logSkillCall` analog fits — they are named by path in prose
 * the host's Read tool resolves, or read by enforcement tooling), so "which rules
 * earn their keep" is a STATIC question. A rule is load-bearing two ways:
 *   1. GLOB-SCOPED — its frontmatter declares `paths:` globs (the Cline/Cursor
 *      pattern), so it is intended to activate on a matching edit. Whether those
 *      globs are actually delivered to each host's rule config is a separate
 *      concern; here they mark the rule as intentionally scoped, not an orphan.
 *   2. REFERENCED — the canonical `rules/<dir>/<name>` path token (with or without
 *      the .md) appears somewhere in the active surface (personas, CLAUDE.md,
 *      skills, all of lib/, registry/
 *      contracts, other rules, scripts, the CLI).
 * A rule that is neither glob-activated nor referenced is a true orphan — a
 * pruning candidate. A rule's own file never counts as referencing itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Directories and files that make up the "active surface" a rule could be cited
// from. Code and prose both count — a rule named in a hook or in bin/construct is
// as load-bearing as one named in a persona.

const SURFACE_DIRS = ['personas', 'skills', 'rules', 'lib', 'specialists', 'scripts'];
const SURFACE_FILES = ['CLAUDE.md', 'AGENTS.md', 'bin/construct', 'claude/settings.template.json'];
const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.json', '.txt', '.mdx']);

const SURFACE_SKIP = [];

function isSkipped(full, root) {
  const rel = path.relative(root, full);
  return SURFACE_SKIP.some((s) => rel === s || rel.startsWith(`${s}${path.sep}`));
}

// A rule with `paths:` globs in its frontmatter is glob-activated by the host on a
// matching edit — load-bearing regardless of whether it is named anywhere.
function hasPathGlobs(absPath) {
  try {
    const head = fs.readFileSync(absPath, 'utf8').slice(0, 1200);
    const fm = head.match(/^---\n([\s\S]*?)\n---/);
    return Boolean(fm && /\n?paths:\s*\n\s*-\s+/.test(fm[1]));
  } catch { return false; }
}

function collectRuleFiles(rulesDir) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.md')) out.push(path.relative(rulesDir, full).replace(/\.md$/, ''));
    }
  };
  if (fs.existsSync(rulesDir)) walk(rulesDir);
  return out;
}

function collectSurfaceText(root, ruleFileAbsSet) {
  const texts = [];
  const add = (full) => {
    if (ruleFileAbsSet.has(full)) return;
    if (!TEXT_EXT.has(path.extname(full))) return;
    try { texts.push(fs.readFileSync(full, 'utf8')); } catch { /* unreadable — skip */ }
  };
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (isSkipped(full, root)) continue;
      if (ent.isDirectory()) walk(full);
      else add(full);
    }
  };
  for (const d of SURFACE_DIRS) walk(path.join(root, d));
  for (const f of SURFACE_FILES) add(path.join(root, f));
  return texts.join('\n');
}

/**
 * Audit which rules are referenced in the active surface.
 * @returns {{ total: number, referenced: Array<{rule:string,refs:number}>, orphans: string[], issues: object[] }}
 */
export function auditRules({ rootDir, silent = false } = {}) {
  const root = rootDir ?? REPO_ROOT;
  const rulesDir = path.join(root, 'rules');
  const ruleFiles = collectRuleFiles(rulesDir);
  const ruleAbsSet = new Set(ruleFiles.map((r) => path.join(rulesDir, `${r}.md`)));
  const surface = collectSurfaceText(root, ruleAbsSet);

  const referenced = [];
  const globScoped = [];
  const orphans = [];
  for (const rule of ruleFiles) {
    // Count `rules/<rule>` occurrences (with or without the .md suffix) so a
    // citation in any surface file marks the rule load-bearing.
    const token = `rules/${rule}`;
    const refs = surface.split(token).length - 1;
    if (refs > 0) referenced.push({ rule, refs });
    else if (hasPathGlobs(path.join(rulesDir, `${rule}.md`))) globScoped.push(rule);
    else orphans.push(rule);
  }
  referenced.sort((a, b) => b.refs - a.refs);

  const issues = [];
  if (orphans.length > 0) issues.push({ kind: 'orphan-rules', items: orphans });

  if (!silent) {
    const line = (s) => process.stdout.write(`${s}\n`);
    line(`Rule reference audit (${ruleFiles.length} rules: ${referenced.length} referenced, ${globScoped.length} glob-scoped, ${orphans.length} orphan):`);
    if (orphans.length === 0) {
      line('  ✓ Every rule is referenced or glob-scoped');
    } else {
      line(`  ⚠ Rules neither referenced nor glob-scoped (${orphans.length}) — pruning candidates:`);
      for (const r of orphans) line(`      - rules/${r}.md`);
    }
  }

  return { total: ruleFiles.length, referenced, globScoped, orphans, issues };
}
