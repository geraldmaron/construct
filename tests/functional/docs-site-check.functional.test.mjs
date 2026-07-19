/**
 * tests/functional/docs-site-check.functional.test.mjs — Generated reference drift gate.
 *
 * Asserts construct docs:site --check passes so docs/guides/reference/ stays aligned
 * with lib/cli-commands.mjs, lib/hooks/, and registry.
 * Also asserts maintainer-only lanes are excluded from the public site catalog.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');
const DOCS_ROOT = join(REPO_ROOT, 'docs');

// lib/paths.mjs resolves the machine-scoped state root (ADR-0066) from
// process.env directly, so the spawned `construct` needs its own sandboxed
// HOME to avoid registering this repo under the real developer machine's
// ~/.construct/projects/.

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-site-check-home-'));
process.on('exit', () => rmTmpDir(SANDBOX_HOME));

const MDX_COMPONENT_NAMES = [
  'FlowPipeline', 'RequestFlow', 'SyncGrid', 'AgentGrid', 'DeployModes',
  'Cards', 'Card', 'Steps', 'Step', 'Callout',
];
const MDX_COMPONENT_RE = new RegExp(
  `<(?:${MDX_COMPONENT_NAMES.join('|')})(?:\\s|\\/|>)`,
);

// Mirrors apps/docs/lib/docs-source.ts exclusion model after the docs/ bucket
// regroup (ADR-0045): basename skips for scratch dirs, relative-path skips for
// maintainer lanes now nested under buckets, and bucket-root index drops. A public
// sibling in an otherwise-excluded bucket still renders (decisions/adr renders;
// decisions/rfc and the decisions index do not).

const SKIP_DIR_BASENAMES = new Set(['templates', '_template', 'archive']);
const SKIP_REL_DIRS = new Set([
  'specs', 'notes', 'decisions/rfc', 'operations/audit', 'operations/incidents',
]);
const SKIP_REL_FILES = new Set([
  'decisions/index.md', 'decisions/index.mdx', 'decisions/README.md', 'operations/audit.md',
]);

const SKIP_FILE_PATTERNS = [/^roadmap\.md$/i];

function relUnix(parts) {
  return parts.join('/');
}

function walkUrls(dir, relParts = []) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIR_BASENAMES.has(entry.name)) continue;
      if (SKIP_REL_DIRS.has(relUnix([...relParts, entry.name]))) continue;
      out.push(...walkUrls(path.join(dir, entry.name), [...relParts, entry.name]));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILE_PATTERNS.some((p) => p.test(entry.name))) continue;
    if (SKIP_REL_FILES.has(relUnix([...relParts, entry.name]))) continue;
    const ext = path.extname(entry.name).slice(1);
    if (ext !== 'md' && ext !== 'mdx') continue;
    const base = entry.name.replace(/\.mdx?$/, '');
    const isLaneIndex = /^(readme|index)$/i.test(base);
    const slug = isLaneIndex ? relParts : [...relParts, base];
    out.push('/' + slug.join('/'));
  }
  return out;
}

const MAINTAINER_LANE_PREFIXES = [
  '/notes/research',
  '/operations/audit',
  '/decisions/rfc',
  '/roadmap',
  '/specs/prd',
  '/notes/memos',
  '/notes/meetings',
  '/notes',
  '/operations/incidents',
];

test('release gate: construct docs:site --check reports no drift', () => {
  const result = spawnSync(process.execPath, [BIN, 'docs:site', '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, HOME: SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME },
  });
  assert.equal(result.status, 0, `docs:site --check exited ${result.status}; stdout: ${result.stdout}`);
});

test('docs site catalog excludes maintainer-only lanes', () => {
  const urls = walkUrls(DOCS_ROOT);
  for (const prefix of MAINTAINER_LANE_PREFIXES) {
    const hit = urls.find((u) => u === prefix || u.startsWith(`${prefix}/`));
    assert.equal(hit, undefined, `maintainer lane should not appear on site: ${prefix} (found ${hit})`);
  }
});

// The document-intake feature docs are user documentation (ADR-0045 §C): they
// live under docs/guides/intake/ and must render on the public site.

test('docs site catalog includes the document-intake guide pages', () => {
  const urls = walkUrls(DOCS_ROOT);
  assert.ok(urls.includes('/guides/intake'), 'guides/intake lane index (README) must render');
  assert.ok(urls.includes('/guides/intake/audio-video'), 'audio-video page must render');
  assert.ok(urls.includes('/guides/intake/scanned-pdfs'), 'scanned-pdfs page must render');
});

test('public docs: .mdx reserved for pages with @cx/ui JSX components', () => {
  const offenders = [];
  function walk(dir, relParts = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIR_BASENAMES.has(entry.name)) continue;
        if (SKIP_REL_DIRS.has(relUnix([...relParts, entry.name]))) continue;
        walk(full, [...relParts, entry.name]);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.mdx')) continue;
      if (SKIP_FILE_PATTERNS.some((p) => p.test(entry.name))) continue;
      const { content } = matter(fs.readFileSync(full, 'utf8'));
      if (!MDX_COMPONENT_RE.test(content)) {
        offenders.push(path.relative(DOCS_ROOT, full));
      }
    }
  }
  walk(DOCS_ROOT);
  assert.equal(
    offenders.length,
    0,
    `prose-only pages must use .md, not .mdx: ${offenders.join(', ')}`,
  );
});
