/**
 * tests/consumer/declared-imports.test.mjs — every bare static import in shipped
 * runtime code must be declared in package.json.
 *
 * Regression gate: lib/providers/directory/index.mjs statically imported
 * minimatch, which resolved in-repo through devDependency transitives
 * (eslint, glob, test-exclude) but was never installed for consumers, so any
 * load of the module crashed with ERR_MODULE_NOT_FOUND. A repo-side import test
 * cannot catch this — resolution succeeds here — so the gate asserts on
 * declaration instead: static bare specifiers in bin/ and lib/ must be node
 * builtins or listed in dependencies/optionalDependencies.
 *
 * Dynamic import() specifiers are exempt: guarded optional integrations
 * (tiktoken, @atlassian/rovo-search) fail soft at the call site by design.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Files that embed generated source inside template literals; the line-anchored
// regexes below cannot tell emitted code from real imports, so the named
// specifiers are exempted per file. Scaffold output runs in the consumer's
// project against the consumer's own dependencies.

const SCAFFOLD_ALLOWLIST = new Map([
  ['lib/demo.mjs', new Set(['@playwright/test'])],
  ['lib/playwright-demo.mjs', new Set(['${baseImport}'])],
]);

const STATIC_IMPORT_RES = [
  /^\s*import\s+[^;'"]*?from\s+['"]([^'"]+)['"]/gm,
  /^\s*import\s+['"]([^'"]+)['"]/gm,
  /^\s*export\s+[^;'"]*?from\s+['"]([^'"]+)['"]/gm,
];

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectFiles(p, out);
    } else if (/\.(mjs|cjs|js)$/.test(entry.name) || entry.name === 'construct') {
      out.push(p);
    }
  }
  return out;
}

function bareName(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) return null;
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

test('static bare imports in bin/ and lib/ are declared in package.json', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    pkg.name,
  ]);
  const builtins = new Set(builtinModules);

  const files = [
    ...collectFiles(resolve(ROOT, 'bin')),
    ...collectFiles(resolve(ROOT, 'lib')),
  ];
  assert.ok(files.length > 100, `expected to scan shipped runtime files, found ${files.length}`);

  const violations = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    const allow = SCAFFOLD_ALLOWLIST.get(rel) ?? new Set();
    const src = readFileSync(file, 'utf8');
    for (const re of STATIC_IMPORT_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const name = bareName(m[1]);
        if (!name || name.startsWith('node:') || builtins.has(name)) continue;
        if (declared.has(name) || allow.has(name)) continue;
        violations.push(`${rel} imports '${name}'`);
      }
    }
  }

  assert.deepEqual(violations, [],
    'undeclared static imports found — a consumer install will crash loading these modules. ' +
    'Declare the package in dependencies/optionalDependencies (plus deps/intent.json per ADR-0059), ' +
    'or add a SCAFFOLD_ALLOWLIST entry if the match is emitted template source:\n  ' +
    violations.join('\n  '));
});

test('the directory provider uses the in-tree glob matcher, not minimatch (regression pin)', () => {
  const src = readFileSync(resolve(ROOT, 'lib', 'providers', 'directory', 'index.mjs'), 'utf8');
  assert.ok(!/from ['"]minimatch['"]/.test(src),
    'lib/providers/directory/index.mjs must use lib/rules-delivery.mjs globToRegExp (ADR-0001) — ' +
    'minimatch is not a declared dependency and crashes consumer installs');
});
