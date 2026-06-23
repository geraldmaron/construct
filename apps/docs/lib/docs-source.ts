/**
 * docs-source.ts — single source of truth for the docs catalog.
 *
 * Walks repo-root `docs/` at build time, returns one record per .md / .mdx
 * file: its slug path under the site root, its frontmatter (title +
 * description), and the raw markdown content. The catch-all
 * `app/[...slug]/page.tsx` uses this list to generate static params and
 * resolve a given URL → MDX file. The sidebar builder uses it to assemble
 * the editorial nav from `meta.json` files inside `docs/`.
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export const DOCS_ROOT = path.resolve(process.cwd(), '..', '..', 'docs');

export type DocPage = {
  slug: string[];
  url: string;
  filePath: string;
  ext: 'md' | 'mdx';
  title: string;
  description?: string;
  body: string;
  format: 'md' | 'mdx';
};

export type DocMeta = {
  dir: string;
  title?: string;
  pages?: string[];
};

// Maintainer-only lanes stay in git but are excluded from the public docs site.
// Two skip layers after the docs/ bucket regroup (ADR-0045):
//   - basename skip: template/scratch dirs at any depth
//   - relative-path skip: maintainer lanes now nested under buckets, identified by
//     their path from DOCS_ROOT so a public sibling in the same bucket still renders
//     (decisions/adr renders; decisions/rfc does not — operations/deploy renders;
//     operations/audit does not).

const SKIP_DIR_BASENAMES = new Set([
  'templates',
  '_template',
  'archive',
]);

const SKIP_REL_DIRS = new Set([
  'specs',
  'notes',
  'intake',
  'decisions/rfc',
  'operations/audit',
  'operations/incidents',
]);

// Bucket-root pages whose lane was excluded wholesale before the regroup; the bucket
// itself must stay walkable to reach a public child (decisions → adr), so its own
// index/README is dropped by exact relative path.

const SKIP_REL_FILES = new Set([
  'decisions/index.md',
  'decisions/index.mdx',
  'decisions/README.md',
  'operations/audit.md',
]);

function relUnix(...parts: string[]): string {
  return parts.join('/');
}

function shouldSkipDir(relParts: string[], name: string): boolean {
  if (name.startsWith('.')) return true;
  if (SKIP_DIR_BASENAMES.has(name)) return true;
  return SKIP_REL_DIRS.has(relUnix(...relParts, name));
}

const SKIP_FILE_PATTERNS = [
  /^_template/i,
  /\.template\./i,
  /^roadmap\.md$/i,
];

function shouldSkipFile(name: string): boolean {
  return SKIP_FILE_PATTERNS.some((p) => p.test(name));
}

const MDX_COMPONENT_NAMES = [
  'FlowPipeline',
  'RequestFlow',
  'SyncGrid',
  'AgentGrid',
  'DeployModes',
  'Cards',
  'Card',
  'Steps',
  'Step',
  'Callout',
] as const;

const MDX_COMPONENT_RE = new RegExp(
  `<(?:${MDX_COMPONENT_NAMES.join('|')})(?:\\s|\\/|>)`,
);

/** True when the body uses `@cx/ui` MDX shims (PascalCase JSX tags). */
export function docUsesMdxComponents(content: string): boolean {
  return MDX_COMPONENT_RE.test(content);
}

/**
 * Plain Markdown allows constructs MDX rejects: HTML comments, autolinks
 * (`<https://…>`), and placeholder syntax inside tables / inline text
 * (`--target=<value>`). Walk the body, leave fenced code blocks alone,
 * and escape every `<` outside them.
 */
function sanitizePlainMarkdown(content: string): string {
  let out = content.replace(/<!--[\s\S]*?-->/g, '');

  const FENCE = /(^|\n)(```[^\n]*\n[\s\S]*?\n```)/g;
  const segments: { text: string; isCode: boolean }[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE.exec(out)) !== null) {
    const start = match.index + match[1].length;
    if (start > cursor) segments.push({ text: out.slice(cursor, start), isCode: false });
    segments.push({ text: match[2], isCode: true });
    cursor = start + match[2].length;
  }
  if (cursor < out.length) segments.push({ text: out.slice(cursor), isCode: false });

  return segments.map((s) => (s.isCode ? s.text : s.text.replace(/</g, '\\<'))).join('');
}

/**
 * One pipeline for every doc page. Prose without JSX is sanitized and compiled
 * as CommonMark (`format: 'md'`). Only pages that embed `@cx/ui` components stay
 * on the MDX path.
 */
export function prepareDocBody(content: string): { body: string; format: 'md' | 'mdx' } {
  if (docUsesMdxComponents(content)) {
    return { body: content, format: 'mdx' };
  }
  return { body: sanitizePlainMarkdown(content), format: 'md' };
}

function walk(dir: string, relParts: string[] = []): DocPage[] {
  if (!fs.existsSync(dir)) return [];
  const out: DocPage[] = [];

  // Inventory entries first so we can prefer index.mdx > index.md > README.md
  // when multiple candidates exist for the same URL.

  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(relParts, entry.name)) continue;
      out.push(...walk(fullPath, [...relParts, entry.name]));
      continue;
    }
    if (!entry.isFile()) continue;
    if (shouldSkipFile(entry.name)) continue;
    if (SKIP_REL_FILES.has(relUnix(...relParts, entry.name))) continue;
    const ext = path.extname(entry.name).slice(1);
    if (ext !== 'md' && ext !== 'mdx') continue;
    files.push(entry.name);
  }

  // Pick the lane-index file (if any). Preference: index.mdx > index.md >
  // README.md. The losers are dropped — they would otherwise collide on the
  // same URL and produce duplicate sidebar entries / React-key warnings.

  const indexCandidates = ['index.mdx', 'index.md', 'README.md', 'readme.md'];
  const chosenIndex = indexCandidates.find((c) => files.includes(c));
  const droppedIndexes = indexCandidates.filter((c) => files.includes(c) && c !== chosenIndex);
  const keep = files.filter((f) => !droppedIndexes.includes(f));

  for (const name of keep) {
    const fullPath = path.join(dir, name);
    const ext = path.extname(name).slice(1) as 'md' | 'mdx';
    const raw = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(raw);

    const base = name.replace(/\.mdx?$/, '');
    const isLaneIndex = /^(readme|index)$/i.test(base);
    const slug = isLaneIndex ? [...relParts] : [...relParts, base];

    const title = (data.title as string)
      || base.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const description = (data.description as string) || undefined;

    const prepared = prepareDocBody(content);

    out.push({
      slug,
      url: slug.length === 0 ? '/' : '/' + slug.join('/'),
      filePath: fullPath,
      ext,
      title,
      description,
      body: prepared.body,
      format: prepared.format,
    });
  }
  return out;
}

let cached: DocPage[] | null = null;

export function listDocs(): DocPage[] {
  if (cached) return cached;
  cached = walk(DOCS_ROOT);
  return cached;
}

export function getDocBySlug(slug: string[]): DocPage | undefined {
  const target = '/' + slug.join('/');
  return listDocs().find((d) => d.url === target);
}

/** Read the meta.json sidecar for a directory under docs/, if present. */
export function readMeta(dir: string): DocMeta | null {
  const metaPath = path.join(DOCS_ROOT, dir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return { dir, title: json.title, pages: Array.isArray(json.pages) ? json.pages : undefined };
  } catch {
    return null;
  }
}

/**
 * Build the sidebar nav from the docs tree + meta.json hints. The shape
 * matches NavGroup so AppShell can render it without translation.
 */
export type SidebarItem = {
  id: string;
  title: string;
  href: string;
  external?: boolean;
};

export type SidebarSection = {
  label: string;
  href?: string;
  items: SidebarItem[];
};

// Lane dir is the slug path from the site root. After the bucket regroup the
// public lanes are nested one level under their bucket (guides/*, operations/*,
// decisions/adr), so each entry is a two-segment path.

const SIDEBAR_LAYOUT: { label: string; dir: string }[] = [
  { label: 'Start', dir: 'guides/start' },
  { label: 'Concepts', dir: 'guides/concepts' },
  { label: 'Cookbook', dir: 'guides/cookbook' },
  { label: 'Reference', dir: 'guides/reference' },
  { label: 'Maintenance', dir: 'operations/maintenance' },
  { label: 'Contributing', dir: 'guides/contributing' },
  { label: 'ADRs', dir: 'decisions/adr' },
];

export function buildSidebar(): SidebarSection[] {
  const docs = listDocs();
  const home: SidebarSection = {
    label: 'Overview',
    items: [{ id: 'home', title: 'Home', href: '/' }],
  };

  const sections: SidebarSection[] = [home];
  for (const layout of SIDEBAR_LAYOUT) {
    const laneRoot = '/' + layout.dir;
    const laneParts = layout.dir.split('/');

    // Sidebar items = direct children of the lane only. Sub-pages nested
    // more than one level under the lane (e.g. guides/reference/cli/advanced)
    // live inside their parent's body, not the sidebar. The lane-index
    // page itself becomes the group's clickable label, not a sibling item.

    const inLane = docs.filter(
      (d) => d.slug.length === laneParts.length + 1 && laneParts.every((p, i) => d.slug[i] === p),
    );
    if (inLane.length === 0) continue;

    const meta = readMeta(layout.dir);
    const orderHint = meta?.pages ?? [];
    const sorted = [...inLane].sort((a, b) => {
      const aKey = a.slug[a.slug.length - 1] || 'index';
      const bKey = b.slug[b.slug.length - 1] || 'index';
      const aIdx = orderHint.indexOf(aKey);
      const bIdx = orderHint.indexOf(bKey);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.title.localeCompare(b.title);
    });

    const laneIndex = docs.find((d) => d.url === laneRoot);

    sections.push({
      label: laneIndex?.title || meta?.title || layout.label,
      href: laneIndex ? laneRoot : undefined,
      items: sorted.map((d) => ({
        id: d.slug.join('/'),
        title: d.title,
        href: d.url,
      })),
    });
  }
  return sections;
}
