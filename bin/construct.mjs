#!/usr/bin/env node
/**
 * bin/construct.mjs — launcher. Prefers the built dist/ (packaged install);
 * falls back to src/ in a dev checkout, where Node's native type stripping
 * runs the TypeScript directly.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/cli/index.js', import.meta.url);
const src = new URL('../src/cli/index.ts', import.meta.url);
const target = existsSync(fileURLToPath(dist)) ? dist : src;

const { main } = await import(target.href);
process.exitCode = main();
