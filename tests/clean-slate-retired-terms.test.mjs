/**
 * tests/clean-slate-retired-terms.test.mjs — active test/fixture retired-term ratchet.
 *
 * Blocks reintroduction of retired organizational roots, legacy prompt trees, and
 * specialist-named active fixtures. Historical tracker corpus and docs/obsolete are
 * excluded from the scan.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = path.join(ROOT, 'tests');

const RETIRED_BASENAMES = /(?:^|[-_/])(?:specialist|persona|cert-specialist)(?:[-_.]|$)/i;
const RETIRED_PATH_RE = /(?:^|['"`\s])(?:specialists\/|personas\/|\.cx\/|packages\/cx-ui|@cx\/ui)/;
const EXCLUDED_PREFIXES = [
  'tests/tracker-projection/fixtures/',
  'tests/e2e/reports/',
  'tests/fixtures/publish/',
  'tests/fixtures/rich-document-corpus/',
  'tests/capabilities/corpus-inventory.json',
];

const EXCLUDED_FILES = [
  'tests/canonical-terminology.test.mjs',
  'tests/fixtures/mcp-tool-schemas/results/project_context.result.json',
];

function relativePosix(fullPath) {
  return path.relative(ROOT, fullPath).split(path.sep).join('/');
}

function shouldScan(relativePath) {
  if (EXCLUDED_FILES.includes(relativePath)) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false;
  if (relativePath.includes('/docs/obsolete/')) return false;
  return true;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test('active test paths do not encode retired organizational fixture names', () => {
  const hits = [];
  for (const file of walk(SCAN_ROOT)) {
    const relative = relativePosix(file);
    if (!shouldScan(relative)) continue;
    const base = path.basename(relative);
    if (RETIRED_BASENAMES.test(base)) hits.push(relative);
  }
  assert.deepEqual(hits, [], `retired fixture filenames remain under tests/:\n${hits.join('\n')}`);
});

test('active tests and fixtures do not reference retired repository roots', () => {
  const hits = [];
  for (const file of walk(SCAN_ROOT)) {
    const relative = relativePosix(file);
    if (!shouldScan(relative)) continue;
    if (!/\.(?:mjs|js|json|md|tsx?)$/.test(relative)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (RETIRED_PATH_RE.test(line)) hits.push(`${relative}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], `retired root guidance remains in active tests:\n${hits.join('\n')}`);
});

test('retired organization directories are absent from the repository', () => {
  for (const dir of ['specialists', 'personas', '.cx']) {
    assert.equal(fs.existsSync(path.join(ROOT, dir)), false, `${dir}/ must not exist`);
  }
});
