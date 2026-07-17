#!/usr/bin/env node
/**
 * packages/cx-ui/prototypes/graph-viewer/build.mjs — bundle-size delta
 * measurement via the repo's own esbuild devDependency (construct-tsyfe.4.5).
 *
 * PROTOTYPE ONLY, run manually (`node packages/cx-ui/prototypes/graph-viewer/build.mjs`).
 * Bundles two minimal entry points — one that imports `cytoscape`, one that
 * doesn't — with the same esbuild version the repo already depends on
 * (root package.json devDependencies.esbuild), so the size delta reflects an
 * actual bundler pass rather than the raw npm package size. Output goes to
 * ./dist/ (gitignored) and is not part of the committed prototype.
 */
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
mkdirSync(distDir, { recursive: true });

const entries = {
  'baseline.min.mjs': `export function make(elements) { return elements.length; }\n`,
  '_entry-with-cytoscape.mjs': `import cytoscape from 'cytoscape';\nexport function make(elements) { return cytoscape({ headless: true, elements }); }\n`,
};

for (const [name, contents] of Object.entries(entries)) writeFileSync(path.join(distDir, name), contents);

execFileSync('npx', ['esbuild', path.join(distDir, '_entry-with-cytoscape.mjs'), '--bundle', '--format=esm', '--minify', `--outfile=${path.join(distDir, 'with-cytoscape.min.mjs')}`], { stdio: 'inherit' });

const baseline = statSync(path.join(distDir, 'baseline.min.mjs'));
const withCytoscape = statSync(path.join(distDir, 'with-cytoscape.min.mjs'));
const withCytoscapeGz = gzipSync(readFileSync(path.join(distDir, 'with-cytoscape.min.mjs')));

console.log(JSON.stringify({
  baselineBytes: baseline.size,
  withCytoscapeBytes: withCytoscape.size,
  withCytoscapeGzipBytes: withCytoscapeGz.length,
  deltaBytes: withCytoscape.size - baseline.size,
}, null, 2));
