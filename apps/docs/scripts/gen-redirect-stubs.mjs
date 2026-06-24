#!/usr/bin/env node
/**
 * gen-redirect-stubs.mjs — post-export redirect generator for the docs site.
 *
 * ADR-0045 Phase 1 regrouped repo-root `docs/` into intent-revealing buckets,
 * which moved every public docs-site URL under a bucket prefix (`/adr/*` →
 * `/decisions/adr/*`, `/cookbook/*` → `/guides/cookbook/*`, …). The site is a
 * static Next.js export, so `next.config.mjs` `redirects()` never runs; old
 * bookmarks 404. This script runs after `next build` and walks `out/`: for every
 * rendered page whose path starts with a moved NEW prefix, it writes a
 * meta-refresh stub at the matching OLD path so the legacy URL resolves.
 *
 * Driving from the rendered tree (not a static page list) keeps redirects in
 * lockstep with what actually shipped — pages excluded by docs-source skip rules
 * (specs, notes, decisions/rfc, operations/audit, …) never render, so they never
 * get a stub. basePath (DOCS_BASE_PATH) and trailingSlash are honored exactly as
 * the rest of the site emits them. An existing real page at an OLD path is never
 * overwritten.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '..', 'out');

// OLD top-level path → NEW bucket-prefixed path. Only buckets whose pages render
// post-regroup appear here; lanes dropped by docs-source skip rules (specs/prd,
// notes/*, decisions/rfc, operations/audit, operations/incidents) are omitted so
// no stub points at a 404. Verified against the rendered out/ tree and the
// pre-taxonomy docs/ layout (git 498bb6b~1).

const PREFIX_MAP = [
  ['decisions/adr', 'adr'],
  ['guides/concepts', 'concepts'],
  ['guides/cookbook', 'cookbook'],
  ['guides/start', 'start'],
  ['guides/reference', 'reference'],
  ['guides/intake', 'intake'],
  ['guides/contributing', 'contributing'],
  ['operations/deploy', 'deploy'],
  ['operations/maintenance', 'maintenance'],
  ['operations/runbooks', 'runbooks'],
  ['operations/releases', 'releases'],
];

// basePath is read per call (not memoized at import) so the env the build runs
// under is the env that lands in the stub, and so a test can flip DOCS_BASE_PATH
// without import-order games.

function basePath() {
  return (process.env.DOCS_BASE_PATH || '').replace(/\/$/, '');
}

// trailingSlash: true means every page is emitted as <dir>/index.html and links
// to its directory with a trailing slash. The stub mirrors that: NEW_URL ends in
// `/`, and the stub itself is written as <oldpath>/index.html.

function newUrlFor(newSlug) {
  const slugPath = newSlug.length ? `/${newSlug.join('/')}/` : '/';
  return `${basePath()}${slugPath}`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stubHtml(newUrl) {
  const attr = escapeHtml(newUrl);
  const js = JSON.stringify(newUrl);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${attr}"><link rel="canonical" href="${attr}"><title>Redirecting…</title><script>location.replace(${js})</script></head><body><p>This page has moved to <a href="${attr}">${attr}</a>.</p></body></html>`;
}

// A page rendered at out/<bucket>/<rest>/index.html maps to OLD path
// out/<oldTop>/<rest>/index.html. The collision guard skips any OLD path that is
// already a real exported page so a redirect never shadows live content.

function collectStubs(outDir) {
  const stubs = [];
  for (const [newTop, oldTop] of PREFIX_MAP) {
    const newRoot = path.join(outDir, ...newTop.split('/'));
    if (!fs.existsSync(newRoot)) continue;

    for (const indexFile of walkIndexFiles(newRoot)) {
      const relFromNewRoot = path.relative(newRoot, path.dirname(indexFile));
      const restParts = relFromNewRoot ? relFromNewRoot.split(path.sep) : [];

      const newSlug = [...newTop.split('/'), ...restParts];
      const oldDir = path.join(outDir, oldTop, ...restParts);
      const oldIndex = path.join(oldDir, 'index.html');

      if (fs.existsSync(oldIndex)) continue;

      stubs.push({ oldIndex, newUrl: newUrlFor(newSlug) });
    }
  }
  return stubs;
}

function* walkIndexFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkIndexFiles(full);
    } else if (entry.isFile() && entry.name === 'index.html') {
      yield full;
    }
  }
}

export function generateRedirectStubs(outDir = OUT_DIR) {
  if (!fs.existsSync(outDir)) {
    throw new Error(`redirect-stubs: export dir not found at ${outDir} — run \`next build\` first`);
  }
  const stubs = collectStubs(outDir);
  let written = 0;
  for (const { oldIndex, newUrl } of stubs) {
    fs.mkdirSync(path.dirname(oldIndex), { recursive: true });
    fs.writeFileSync(oldIndex, stubHtml(newUrl), 'utf8');
    written += 1;
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = generateRedirectStubs();
  console.log(`redirect-stubs: wrote ${count} legacy redirect${count === 1 ? '' : 's'} into out/`);
}
