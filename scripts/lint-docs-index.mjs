#!/usr/bin/env node
/**
 * lint-docs-index.mjs — docs/ is a closed set, and docs/README.md is what
 * closes it.
 *
 * The directory holds two kinds of writing that look identical from outside:
 * documentation someone reads to use Construct, and the records of how it was
 * built — dated probe transcripts, acceptance packets written to one reader,
 * design decisions, measurement runs. The records live under docs/internal/.
 * Nothing about a filename says which a document is, so the split survives only
 * as long as each new file is sorted deliberately.
 *
 * A content heuristic was measured against the real corpus before this was
 * written, and it is not good enough to be the gate: matching a dated opening,
 * a date-stamped filename, a status block, or a tracker id caught 13 of 16
 * development records, missed three, and flagged one document that had been
 * filed as documentation. Missing three is survivable. Flagging a legitimate
 * document is not — a check people learn to argue with is a check people learn
 * to ignore.
 *
 * So the gate is not a guess. Every documentation file is listed in
 * docs/README.md, which a reader wants regardless, and this holds the directory
 * and that list to each other. A new file fails until someone either lists it,
 * which is the moment they decide it is documentation, or moves it to
 * docs/internal/. The judgment stays with the person and stops being silent.
 *
 * The heuristic survives as a hint, and only that: when an unlisted file is
 * reported, whichever marks it carries are named, because "this reads like a
 * development record" is useful next to the question and worthless as a verdict.
 *
 * Only the top level is governed. docs/internal/ is where records are supposed
 * to go and is not indexed; its own README says what it is.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const DOCS = 'docs';
const INDEX = join(DOCS, 'README.md');

/** The marks a development record tends to carry. Reported, never decisive. */
function recordMarks(path) {
  const head = readFileSync(path, 'utf8').split('\n').slice(0, 20).join('\n');
  const marks = [];
  if (/^\d{4}-\d{2}-\d{2}-/.test(basename(path))) marks.push('a date-stamped filename');
  if (/\b(?:Dated|Filed|Written|Recorded)\s+\d{4}-\d{2}-\d{2}/.test(head)) {
    marks.push('an opening that dates the document');
  }
  if (/^\s*Status:\s*(?:draft|proposed|accepted)/im.test(head)) marks.push('a status block');
  if (/construct-[a-z0-9]{3,4}(?:\.\d+)?\b/.test(head)) marks.push('a tracker id');
  return marks;
}

const listed = new Set([...readFileSync(INDEX, 'utf8').matchAll(/\]\(([A-Za-z0-9._-]+\.md)\)/g)].map((m) => m[1]));
const present = readdirSync(DOCS)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .sort();

const failures = [];

// Check the copyable public documentation graph, not dated internal records.
// A link into history must resolve, but history is not recursively treated as a guide.
function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? markdownFiles(join(dir, e.name)) : e.isFile() && e.name.endsWith('.md') ? [join(dir, e.name)] : [],
  );
}
function prose(text) {
  return text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
}
function anchors(text) {
  const used = new Map(),
    out = new Set();
  for (const m of prose(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = m[1]
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .trim()
      .replace(/\s/g, '-');
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  for (const m of text.matchAll(/<(?:a|span)\b[^>]*(?:id|name)=["']([^"']+)["']/g)) out.add(m[1]);
  return out;
}
const publicFiles = [
  'README.md',
  'SECURITY.md',
  'GLOSSARY.md',
  INDEX,
  ...present.map((name) => join(DOCS, name)),
  ...markdownFiles('skills'),
].filter(existsSync);
let checkedLinks = 0;
for (const file of publicFiles) {
  const text = prose(readFileSync(file, 'utf8'));
  const links = [
    ...text.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*["'])?\)/g),
    ...text.matchAll(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm),
  ];
  for (const match of links) {
    let target = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    checkedLinks++;
    try {
      target = decodeURIComponent(target);
    } catch {
      failures.push(`${file}: malformed link ${target}`);
      continue;
    }
    const [path, fragment] = target.split('#');
    const resolved = path ? resolve(dirname(file), path.split('?')[0]) : resolve(file);
    const rel = relative(process.cwd(), resolved);
    if (rel.startsWith('..') || !existsSync(resolved)) {
      failures.push(`${file}: link ${target} names no repository path`);
      continue;
    }
    if (fragment && statSync(resolved).isFile() && resolved.endsWith('.md') && !anchors(readFileSync(resolved, 'utf8')).has(fragment)) {
      failures.push(`${file}: link ${target} names no heading anchor`);
    }
  }
}

for (const name of present) {
  if (listed.has(name)) continue;
  const marks = recordMarks(join(DOCS, name));
  const hint = marks.length > 0 ? ` It carries ${marks.join(' and ')}, so it may belong in docs/internal/.` : '';
  failures.push(
    `docs/${name} is not listed in ${INDEX}. Add it there if it is documentation ` +
      `someone reads to use Construct, or move it to docs/internal/ if it is a ` +
      `record of how Construct was built.${hint}`,
  );
}

for (const name of [...listed].sort()) {
  if (present.includes(name)) continue;
  failures.push(
    `${INDEX} lists docs/${name}, which does not exist. An index pointing at a ` + `file nobody can open is worse than no index.`,
  );
}

if (failures.length > 0) {
  for (const line of failures) process.stderr.write(`${line}\n`);
  process.exit(1);
}

process.stdout.write(
  `lint-docs-index: clean — ${String(present.length)} documentation file(s), all listed; ${checkedLinks} local links checked\n`,
);
