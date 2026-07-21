/**
 * Bundle-size bench for the Excalidraw feasibility prototype (construct-tsyfe.4.6).
 * Measures esbuild output for a lazy-import entry vs a static-import control.
 */

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.bench-out');

function gzipSize(bytes) {
  return gzipSync(bytes).length;
}

async function measureEntry(label, entrySource) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const entryPath = path.join(OUT_DIR, `${label}.mjs`);
  fs.writeFileSync(entryPath, entrySource);

  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [entryPath],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    minify: true,
    metafile: true,
    external: ['react', 'react-dom', 'react/jsx-runtime'],
  });

  const output = result.outputFiles[0];
  const minified = output.contents.length;
  const gz = gzipSize(output.contents);

  return { label, minified, gzip: gz, metafile: result.metafile };
}

async function main() {
  const lazy = await measureEntry('lazy-entry', `
    export async function loadEditor() {
      const mod = await import('@excalidraw/excalidraw');
      return mod.Excalidraw;
    }
  `);

  const eager = await measureEntry('eager-entry', `
    import { Excalidraw } from '@excalidraw/excalidraw';
    export { Excalidraw };
  `);

  const report = {
    measuredAt: new Date().toISOString(),
    bead: 'construct-tsyfe.4.6',
    lazyEntry: { minifiedBytes: lazy.minified, gzipBytes: lazy.gzip },
    eagerEntry: { minifiedBytes: eager.minified, gzipBytes: eager.gzip },
    delta: {
      minifiedBytes: eager.minified - lazy.minified,
      gzipBytes: eager.gzip - lazy.gzip,
    },
  };

  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bench-results.json');
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
