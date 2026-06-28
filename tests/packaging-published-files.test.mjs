/**
 * tests/packaging-published-files.test.mjs
 *
 * The npm `files` allowlist must cover every module that shipped code imports.
 * Shipped code may import modules from apps/ only when those modules are listed
 * in package.json files. This walks the shipped surface and checks any such
 * imports. Pure static analysis, no npm pack.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

// Translate an npm files glob into a regex with a single character scan so no
// placeholder substitution is needed: ** spans path separators, a lone * stops
// at one, and regex-significant characters are escaped literally.

function globToRegExp(glob) {
  let body = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') { body += '.*'; i += 1; } else { body += '[^/]*'; }
    } else if ('.+^${}()|[]\\'.includes(char)) {
      body += `\\${char}`;
    } else {
      body += char;
    }
  }
  return new RegExp(`^${body}$`);
}

const allowMatchers = pkg.files.map(globToRegExp);
function isPublished(relPath) {
  return allowMatchers.some((re) => re.test(relPath));
}

const SHIPPED_ROOTS = [path.join(REPO, 'lib'), path.join(REPO, 'bin', 'construct')];
const IMPORT_RE = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

function walk(target, acc) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) walk(path.join(target, entry), acc);
  } else if (/\.(mjs|js)$/.test(target) || path.basename(target) === 'construct') {
    acc.push(target);
  }
  return acc;
}

function collectAppsImports() {
  const targets = SHIPPED_ROOTS.flatMap((root) => walk(root, []));
  const found = new Map();
  for (const file of targets) {
    const src = fs.readFileSync(file, 'utf8');
    for (const match of src.matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), spec);
      const rel = path.relative(REPO, resolved);
      if (rel.startsWith('apps/')) found.set(rel, file);
    }
  }
  return found;
}

test('every apps/ module imported by shipped code is in the npm files allowlist', () => {
  const imports = collectAppsImports();
  const offenders = [];
  for (const [rel, importer] of imports) {
    if (!isPublished(rel)) offenders.push(`${rel} (imported by ${path.relative(REPO, importer)})`);
  }
  assert.deepEqual(offenders, [], `apps/ imports missing from package.json files:\n${offenders.join('\n')}`);
});

test('imported apps/ engine modules exist on disk', () => {
  const imports = collectAppsImports();
  for (const rel of imports.keys()) {
    assert.ok(fs.existsSync(path.join(REPO, rel)), `${rel} is imported but missing on disk`);
  }
});
