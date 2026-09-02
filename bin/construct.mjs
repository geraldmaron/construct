#!/usr/bin/env node
/**
 * bin/construct.mjs — launcher. Runs src/ when it is present (a dev checkout,
 * where Node's native type stripping runs the TypeScript directly) and dist/
 * only when it is not (a packaged install, whose files[] ships bin, dist and
 * schemas but no src).
 *
 * The order used to be the other way round, and that was the defect in
 * construct-0dj: dist/ is gitignored build output that `npm run smoke` creates
 * as a side effect of prepack and never removes, so after one smoke run a dev
 * checkout permanently held a dist/ that aged against src/. Every test spawning
 * this launcher as a subprocess then exercised the stale build while the same
 * test's in-process fixtures exercised src/ — two halves of one test running
 * different builds of the codebase. It surfaced as a false red when a
 * SCHEMA_VERSION bump made the child refuse the fixture's store; the inverse, a
 * stale-but-compatible dist producing a false green, announces nothing.
 *
 * Preferring src loses no coverage of the packaged path: that path is proven by
 * scripts/smoke-packaged-install.sh, which installs a real tarball into a
 * scratch project where src/ genuinely does not exist, so this file takes the
 * dist branch there for the real reason rather than by preference.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fail before the CLI graph loads `node:sqlite`. On Node 20 the import
// throws an unknown-builtin error that names the module, not the floor.
// Major 22 and newer have the builtin (experimental on 22.x); the 22.18
// floor remains doctor's to report. This check is only the crash.
const major = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(major) || major < 22) {
  process.stderr.write(
    `construct: Node v${process.versions.node} cannot run this tool.\n` +
      '  node:sqlite needs Node 22 or newer (the install floor is 22.18).\n',
  );
  process.exit(1);
}

// Node 22 marks node:sqlite experimental and prints a warning on every run.
// The floor is 22.18, so the warning is expected and says nothing the person
// can act on; it would land in stderr of every command, and in any capture
// that merges the streams. Every other warning still prints as Node would.
const printWarning = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  for (const listener of printWarning) listener(warning);
});

const dist = new URL('../dist/cli/index.js', import.meta.url);
const src = new URL('../src/cli/index.ts', import.meta.url);
const target = existsSync(fileURLToPath(src)) ? src : dist;

let main;
try {
  ({ main } = await import(target.href));
} catch (error) {
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  if (/node:sqlite|ERR_UNKNOWN_BUILTIN_MODULE/.test(text)) {
    process.stderr.write(
      `construct: Node v${process.versions.node} cannot load node:sqlite.\n` +
        '  Need Node 22.18 or newer. `construct doctor` cannot run until that is met.\n',
    );
    process.exit(1);
  }
  throw error;
}
process.exitCode = await main();
