/**
 * lib/rules-delivery.mjs — deliver glob-scoped rules to hosts with a native rule format.
 *
 * Cursor is the one supported host with a native per-rule glob convention
 * (`.cursor/rules/*.mdc`, comma-separated `globs` frontmatter, auto-attached when a
 * matching file enters context). Project sync emits one managed `.mdc` per
 * glob-scoped rule (`rules/<dir>/<name>.md` with `paths:` frontmatter) whose globs
 * match files actually present in the project — the project's own contents are the
 * intent signal, so a Go rule lands only in a repo that contains Go. Emitted files
 * carry the `construct-` prefix and are swept when their rule stops matching, so
 * user-authored .mdc files are never touched (ADR-0027 ownership contract).
 * Claude/Codex/OpenCode have no per-rule glob mechanism; for them rules remain
 * reference-delivered (cited by path in prose) — see docs/guides/concepts/rules-delivery.md.
 */
import fs from 'node:fs';
import path from 'node:path';

import { logRuleCall } from './telemetry/rule-calls.mjs';
import { PROJECT_MARKERS } from './config-dir.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', ...PROJECT_MARKERS, 'dist', 'build', '.next', 'vendor', '.beads']);
const MAX_FILES = 5000;

function parseRule(absPath, ruleRel) {
  const raw = fs.readFileSync(absPath, 'utf8');
  logRuleCall({
    rulePath: `rules/${ruleRel.replace(/\.md$/, '')}.md`,
    source: 'sync',
    callerContext: 'rules-delivery',
  });
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) return null;
  const globs = [...fm[1].matchAll(/^\s*-\s+"([^"]+)"\s*$/gm)].map((m) => m[1]);
  if (!/^paths:/m.test(fm[1]) || globs.length === 0) return null;
  const desc = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
  return { globs, description: desc, body: raw.slice(fm[0].length).trim() };
}

export function collectGlobScopedRules(rulesDir) {
  const out = [];
  const walk = (dir, rel = '') => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, childRel);
      else if (e.name.endsWith('.md')) {
        const parsed = parseRule(full, childRel);
        if (parsed) out.push({ rule: childRel.replace(/\.md$/, ''), ...parsed });
      }
    }
  };
  walk(rulesDir);
  return out;
}

// The rule corpus uses simple glob shapes (`**/*.go`, `**/go.mod`, `*.md`); this
// translates exactly those: `**/` spans directories, `*` stays within a segment.

export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0001/g, '(?:.*/)?');
  return new RegExp(`^${escaped}$`);
}

export function listProjectFiles(targetDir, { maxFiles = MAX_FILES } = {}) {
  const files = [];
  const walk = (dir, rel = '') => {
    if (files.length >= maxFiles) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (files.length >= maxFiles) return;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else {
        files.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  walk(targetDir);
  return files;
}

/**
 * Emit managed per-rule .mdc files into <targetDir>/.cursor/rules/ for every
 * glob-scoped rule matching the project's own files, and sweep managed files
 * whose rule stopped matching. Returns { emitted, swept }.
 */
export function emitCursorRules({ rulesDir, targetDir, dryRun = false } = {}) {
  const rules = collectGlobScopedRules(rulesDir);
  const files = listProjectFiles(targetDir);
  const outDir = path.join(targetDir, '.cursor', 'rules');

  const wanted = new Map();
  for (const r of rules) {
    const regs = r.globs.map(globToRegExp);
    if (!files.some((f) => regs.some((re) => re.test(f)))) continue;
    const name = `construct-${r.rule.replace(/\//g, '-')}.mdc`;
    const mdc = `---\ndescription: ${r.description}\nglobs: ${r.globs.join(', ')}\nalwaysApply: false\n---\n\n${r.body}\n`;
    wanted.set(name, mdc);
  }

  const emitted = [];
  const swept = [];
  if (!dryRun) {
    if (wanted.size > 0) fs.mkdirSync(outDir, { recursive: true });
    for (const [name, mdc] of wanted) {
      const dest = path.join(outDir, name);
      if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== mdc) {
        fs.writeFileSync(dest, mdc);
        emitted.push(name);
      }
    }
    // Sweep only construct-<rule>.mdc files this module owns; construct.mdc (the
    // front-door pointer) and user-authored files are never touched.
    let existing = [];
    try { existing = fs.readdirSync(outDir); } catch { /* no rules dir */ }
    for (const name of existing) {
      if (name.startsWith('construct-') && name.endsWith('.mdc') && !wanted.has(name)) {
        fs.rmSync(path.join(outDir, name), { force: true });
        swept.push(name);
      }
    }
  }
  return { emitted, swept, matched: [...wanted.keys()] };
}
