#!/usr/bin/env node
/**
 * scripts/sync-construct-version.mjs — keep `.construct/version` aligned with
 * `package.json`.
 *
 * `.construct/version` pins the version that `.construct/run.mjs` (and the
 * bootstrap scripts) feed to `npx -p @geraldmaron/construct@<version>` in
 * resolution step 2. If it drifts behind a published release the npx pin 404s
 * with ETARGET and project-local hooks fail before any Construct code runs.
 *
 * Wired into the `version` npm lifecycle script so `npm version <x>` regenerates
 * the pin from the freshly bumped `package.json` and stages it into the same
 * commit npm creates. Also runnable on its own to repair drift:
 *
 *   node scripts/sync-construct-version.mjs           — write package.json version
 *   node scripts/sync-construct-version.mjs --check    — exit non-zero if out of sync
 *
 * Exit code 0 = in sync (or written). Non-zero (with --check) = drift detected.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const versionFile = resolve(root, '.construct', 'version');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const target = pkg.version;

const check = process.argv.slice(2).includes('--check');
const current = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : null;

if (check) {
  if (current === target) {
    console.log(`.construct/version in sync (${target})`);
    process.exit(0);
  }
  console.error(`.construct/version drift: file is ${current ?? '(missing)'}, package.json is ${target}`);
  console.error('Run: node scripts/sync-construct-version.mjs');
  process.exit(1);
}

if (current === target) {
  console.log(`.construct/version already ${target}`);
  process.exit(0);
}

writeFileSync(versionFile, target + '\n');
console.log(`.construct/version → ${target}`);
