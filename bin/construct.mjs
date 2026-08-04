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

const dist = new URL('../dist/cli/index.js', import.meta.url);
const src = new URL('../src/cli/index.ts', import.meta.url);
const target = existsSync(fileURLToPath(src)) ? src : dist;

const { main } = await import(target.href);
process.exitCode = await main();
