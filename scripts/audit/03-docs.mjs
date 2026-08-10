/**
 * 03-docs.mjs — Phase 3: command/flag <-> documentation alignment, both directions.
 *
 * Runs over the WHOLE docs/ tree and with NO skip list, so masked gaps surface:
 *   (a) docs -> registry : every `construct <token>` mention whose token is not a current
 *       command is a stale reference (catches the dev/dashboard rename: up/serve/down).
 *   (b) orphaned docs    : every .md/.mdx unreachable from README link-closure (templates
 *       excluded) is orphaned.
 * The registry -> docs direction (every command/flag mentioned in docs/) was removed with
 * the documentation system: the CLI catalog is the reference surface, so absence from the
 * minimal docs tree is the intended state, not a finding.
 *
 * Read-only. Run: node scripts/audit/03-docs.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLI_COMMANDS, ALL_COMMAND_NAMES, COMMAND_NAMES } from '../../lib/cli-commands.mjs';
import { REPO_ROOT } from './lib/handlers.mjs';
import { writeJson } from './lib/artifacts.mjs';
import { recordFindings } from './lib/findings.mjs';

const DOCS_DIR = path.join(REPO_ROOT, 'docs');

function walk(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

const isTemplate = (p) => /(^|\/)(templates?)(\/|$)|_template|\.template\./i.test(p);

// Quarantined archive — deliberately outside site nav (construct-tsyfe.8.17).

const isObsoleteDoc = (p) => /(^|\/)docs\/obsolete(\/|$)/.test(p.replace(/\\/g, '/'));

// Command names retired by the dev/dashboard/stop rename. A doc that still says
// `construct up` is hard drift, not a placeholder — these gate.

const RETIRED_ALIASES = { up: 'dev', down: 'stop', serve: 'dashboard', 'init-docs': 'init' };

// Tokens that legitimately follow `construct` in prose without being commands:
// example placeholders and documented rejected/future verbs. Excluded from review noise.
//   - capability verbs the capability-matrix names as skill-driven non-commands
//     (build/fix/plan/ship/test) — it explicitly states "no `construct <verb>`";
// - install-scope verbs listed under Rejected alternatives;
//   - MCP tool names quoted in provider cookbook prose (provider_fetch/rovo_search);
//   - concept nouns that trail "construct" in prose (agent/hooks/rules/strategy).

const PLACEHOLDER_TOKENS = new Set([
  'foo', 'bar', 'baz', 'x', 'uri', 'cmd', 'command', 'name', 'project', 'analyze',
  'build', 'fix', 'plan', 'ship', 'test',
  'install-both', 'install-project', 'install-user',
  'provider_fetch', 'rovo_search',
  'agent', 'hooks', 'rules', 'strategy',
]);

function buildCorpus() {
  const files = walk(DOCS_DIR, ['.md', '.mdx']);
  const corpus = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  return { files, corpus };
}

// (a) + (b): command mentions across the corpus.

function commandAlignment(corpus) {
  const mentioned = new Set([
    ...corpus.matchAll(/`construct\s+([\w:_-]+)/g),
    ...corpus.matchAll(/^[ \t]*construct\s+([\w:_-]+)/gm),
  ].map((m) => m[1]));

  const current = new Set(ALL_COMMAND_NAMES);
  const undocumented = COMMAND_NAMES.filter((n) => !mentioned.has(n));

  const retired = [];
  const review = [];
  for (const tok of [...mentioned].sort()) {
    if (current.has(tok) || tok.startsWith('-') || PLACEHOLDER_TOKENS.has(tok)) continue;
    if (tok in RETIRED_ALIASES) retired.push(tok);
    else review.push(tok);
  }
  return { undocumented, retired, review, mentionedCount: mentioned.size };
}

// (a) flags: a flag is documented if its bare form appears anywhere in docs.

function flagAlignment(corpus) {
  const missing = [];
  for (const spec of CLI_COMMANDS) {
    if (spec.internal) continue;
    for (const opt of spec.options || []) {
      const bare = opt.flag.split('=')[0].trim();
      if (!bare.startsWith('--')) continue;
      if (!corpus.includes(bare)) missing.push({ command: spec.name, flag: bare });
    }
  }
  return missing;
}

// (c) orphans against the real nav model: a per-directory meta.json `pages` tree rooted
// at docs/meta.json, augmented by markdown-link closure. Two distinct signals:
//   nav_orphans       — a file in a meta.json'd directory whose stem is dropped from pages
//                        (siblings are navigable; this one is stranded). High confidence.
//   unnavigated_dirs  — a directory with no meta.json whose files nothing links to
//                        (reported once per directory, not per file).

function resolveStem(dir, stem) {
  for (const ext of ['.md', '.mdx']) {
    const f = path.join(dir, `${stem}${ext}`);
    if (fs.existsSync(f)) return { file: f };
  }
  const sub = path.join(dir, stem);
  if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) return { dir: sub };
  return null;
}

function metaReachable() {
  const reached = new Set();
  const dirsWithMeta = new Set();
  const queue = [DOCS_DIR];
  while (queue.length) {
    const dir = queue.shift();
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    dirsWithMeta.add(dir);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    for (const stem of meta.pages || []) {
      const r = resolveStem(dir, stem);
      if (!r) continue;
      if (r.file) reached.add(r.file);
      else if (r.dir) queue.push(r.dir);
    }
  }
  return { reached, dirsWithMeta };
}

function linkClosure(seedFiles) {
  const reached = new Set(seedFiles);
  const queue = [...seedFiles];
  while (queue.length) {
    const file = queue.shift();
    if (!fs.existsSync(file)) continue;
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = m[1].split('#')[0].split(' ')[0].trim();
      if (!href || /^[a-z]+:\/\//i.test(href) || !/\.(md|mdx)$/.test(href)) continue;
      const target = path.resolve(path.dirname(file), href);
      if (fs.existsSync(target) && !reached.has(target)) { reached.add(target); queue.push(target); }
    }
  }
  return reached;
}

function orphanAlignment(files) {
  const { reached: metaSeed, dirsWithMeta } = metaReachable();
  const reached = linkClosure([...metaSeed, path.join(DOCS_DIR, 'README.md'), path.join(REPO_ROOT, 'README.md')]);

  const nav_orphans = [];
  const unnavigatedCount = {};
  for (const f of files) {
    if (isTemplate(f) || reached.has(f) || isObsoleteDoc(path.relative(REPO_ROOT, f))) continue;
    if (/\/(README|index)\.(md|mdx)$/.test(f)) continue;
    const dir = path.dirname(f);
    if (dirsWithMeta.has(dir)) nav_orphans.push(path.relative(REPO_ROOT, f));
    else unnavigatedCount[path.relative(REPO_ROOT, dir)] = (unnavigatedCount[path.relative(REPO_ROOT, dir)] || 0) + 1;
  }
  const unnavigated_dirs = Object.entries(unnavigatedCount).map(([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count);
  return { nav_orphans, unnavigated_dirs };
}

export function runDocsAlignment() {
  const { files, corpus } = buildCorpus();
  const cmd = commandAlignment(corpus);
  const flags = flagAlignment(corpus);
  const { nav_orphans, unnavigated_dirs } = orphanAlignment(files);
  return {
    docFiles: files.length,
    undocumented_commands: cmd.undocumented,
    retired_alias_references: cmd.retired,
    review_references: cmd.review,
    undocumented_flags: flags,
    nav_orphans,
    unnavigated_dirs,
  };
}

export function docsFindings() {
  return toFindings(runDocsAlignment());
}

function toFindings(report) {
  const rows = [];
  for (const s of report.retired_alias_references) {
    rows.push({ type: 'stale-doc-reference', target: s, severity: 'high', tier: 'mechanical',
      evidence: '`construct ' + s + '` is a retired alias still referenced in docs',
      recommendation: `Replace ${s} with ${{ up: 'dev', down: 'stop', serve: 'dashboard' }[s]}.` });
  }
  for (const s of report.review_references) {
    rows.push({ type: 'review-doc-reference', target: s, severity: 'low', tier: 'judgment',
      evidence: '`construct ' + s + '` referenced in docs but is not a current command',
      recommendation: 'Confirm intentional (rejected/future capability) or fix the reference.' });
  }
  for (const o of report.nav_orphans) {
    rows.push({ type: 'orphaned-doc', target: o, severity: 'medium', tier: 'judgment',
      evidence: 'sibling files are in the directory meta.json but this one is dropped from pages',
      recommendation: 'Add it to the directory meta.json pages, link it from an index, or retire it.' });
  }
  for (const d of report.unnavigated_dirs) {
    rows.push({ type: 'unnavigated-doc-dir', target: d.dir, severity: 'medium', tier: 'judgment',
      evidence: `${d.count} doc(s) in a directory with no meta.json and no inbound links`,
      recommendation: `Add a meta.json/index for ${d.dir} or fold it into the site nav.` });
  }
  return rows;
}

function main() {
  const report = runDocsAlignment();
  const findings = toFindings(report);
  recordFindings('03-docs', findings);
  writeJson('docs-alignment.json', report);
  process.stdout.write(`[audit:03] ${report.docFiles} docs scanned. ` +
    `${report.undocumented_commands.length} undocumented cmds, ` +
    `${report.retired_alias_references.length} retired-alias refs, ` +
    `${report.review_references.length} review refs, ` +
    `${report.undocumented_flags.length} undocumented flags, ` +
    `${report.nav_orphans.length} nav-orphans, ${report.unnavigated_dirs.length} unnavigated dirs.\n`);
  if (report.retired_alias_references.length) {
    process.stdout.write(`[audit:03] retired aliases in docs: ${report.retired_alias_references.join(', ')}\n`);
  }
  if (report.nav_orphans.length) {
    process.stdout.write(`[audit:03] nav-orphans: ${report.nav_orphans.join(', ')}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
