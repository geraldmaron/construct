/**
 * tests/graph/build-import-graph.test.mjs — static import derivation must
 * resolve relative specifiers, type test files distinctly, and derive
 * realizes (file→capability) edges from declared-test import closures.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildImportGraph } from '../../lib/graph/build-import-graph.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function scaffold(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'import-graph-'));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

test('resolves relative imports into file→file edges and skips bare specifiers', () => {
  const root = scaffold({
    'lib/a.mjs': "import { b } from './b.mjs';\nimport fs from 'node:fs';\nexport const a = b;\n",
    'lib/b.mjs': "export const b = 1;\n",
  });
  const { nodes, edges } = buildImportGraph({ root: root, rootDir: root });
  const ids = new Set(nodes.map((n) => n.id));
  assert.ok(ids.has('file:lib/a.mjs'));
  assert.ok(ids.has('file:lib/b.mjs'));
  const imports = edges.filter((e) => e.rel === 'imports');
  assert.ok(imports.some((e) => e.from === 'file:lib/a.mjs' && e.to === 'file:lib/b.mjs'));
  assert.ok(!imports.some((e) => e.to.includes('node:fs')), 'node: specifiers must be ignored');
});

test('test files become test-typed nodes, not file-typed', () => {
  const root = scaffold({
    'lib/a.mjs': "export const a = 1;\n",
    'tests/a.test.mjs': "import { a } from '../lib/a.mjs';\n",
  });
  const { nodes } = buildImportGraph({ rootDir: root });
  const test = nodes.find((n) => n.name === 'tests/a.test.mjs');
  assert.equal(test.type, 'test');
  assert.equal(test.id, 'test:tests/a.test.mjs');
});

test('realizes edges flow from a validating test closure to its capability', () => {
  const root = scaffold({
    'lib/a.mjs': "import './b.mjs';\nexport const a = 1;\n",
    'lib/b.mjs': "export const b = 1;\n",
    'lib/unrelated.mjs': "export const u = 1;\n",
    'tests/a.test.mjs': "import '../lib/a.mjs';\n",
  });
  const validates = [{ from: 'test:tests/a.test.mjs', to: 'capability:x', rel: 'validates' }];
  const { edges } = buildImportGraph({ rootDir: root, validates });
  const realizes = edges.filter((e) => e.rel === 'realizes');
  const realizers = new Set(realizes.map((e) => e.from));

  assert.ok(realizers.has('file:lib/a.mjs'), 'directly imported impl realizes the capability');
  assert.ok(realizers.has('file:lib/b.mjs'), 'transitively imported impl realizes the capability');
  assert.ok(!realizers.has('file:lib/unrelated.mjs'), 'unreached file does not realize the capability');
  for (const e of realizes) assert.equal(e.to, 'capability:x');
});

test('dynamic import() and export-from specifiers are captured', () => {
  const root = scaffold({
    'lib/a.mjs': "export async function load(){ return import('./b.mjs'); }\nexport * from './c.mjs';\n",
    'lib/b.mjs': "export const b = 1;\n",
    'lib/c.mjs': "export const c = 1;\n",
  });
  const { edges } = buildImportGraph({ rootDir: root });
  const imports = edges.filter((e) => e.rel === 'imports' && e.from === 'file:lib/a.mjs').map((e) => e.to).sort();
  assert.deepEqual(imports, ['file:lib/b.mjs', 'file:lib/c.mjs']);
});
