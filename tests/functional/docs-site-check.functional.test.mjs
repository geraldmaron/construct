/**
 * tests/functional/docs-site-check.functional.test.mjs — Generated reference drift gate.
 *
 * Asserts construct docs:site --check passes so docs/reference/ stays aligned
 * with lib/cli-commands.mjs, lib/hooks/, and specialists/registry.json.
 * Also asserts maintainer-only lanes are excluded from the public site catalog.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import assert from 'node:assert/strict';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');
const DOCS_ROOT = join(REPO_ROOT, 'docs');

const MDX_COMPONENT_NAMES = [
  'FlowPipeline', 'RequestFlow', 'SyncGrid', 'AgentGrid', 'DeployModes',
  'Cards', 'Card', 'Steps', 'Step', 'Callout',
];
const MDX_COMPONENT_RE = new RegExp(
  `<(?:${MDX_COMPONENT_NAMES.join('|')})(?:\\s|\\/|>)`,
);

const SKIP_DIRS = new Set([
  'templates', '_template', 'archive', 'meetings', 'memos', 'notes', 'incidents',
  'prd', 'prds', 'audit', 'research', 'decisions', 'intake', 'rfc', 'rfcs',
]);

const SKIP_FILE_PATTERNS = [/^roadmap\.md$/i];

function walkUrls(dir, relParts = []) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      out.push(...walkUrls(path.join(dir, entry.name), [...relParts, entry.name]));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILE_PATTERNS.some((p) => p.test(entry.name))) continue;
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
  '/research',
  '/audit',
  '/decisions',
  '/roadmap',
  '/prd',
  '/prds',
  '/rfc',
  '/rfcs',
  '/memos',
  '/notes',
  '/incidents',
  '/intake',
];

test('release gate: construct docs:site --check reports no drift', () => {
  const result = spawnSync(process.execPath, [BIN, 'docs:site', '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
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

test('public docs: .mdx reserved for pages with @cx/ui JSX components', () => {
  const offenders = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        walk(full);
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
