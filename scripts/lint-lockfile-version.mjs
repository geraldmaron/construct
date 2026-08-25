#!/usr/bin/env node
/**
 * lint-lockfile-version.mjs — package.json's version and package-lock.json's
 * own recorded version agree.
 *
 * `npm version` and a hand edit of package.json both update package.json
 * alone; package-lock.json only follows along when something runs `npm
 * install` (or `--package-lock-only`) afterward. Nothing enforced that
 * second step, so the two drifted a full release apart with `npm ci` never
 * once complaining — `npm ci` installs from whatever the lockfile says and
 * does not compare it against package.json's own version field.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function versionMismatch(pkg, lock) {
  const pkgVersion = pkg.version;
  const lockVersion = lock.version;
  const lockRootVersion = lock.packages?.['']?.version;
  if (pkgVersion === lockVersion && pkgVersion === lockRootVersion) return null;
  return { pkgVersion, lockVersion, lockRootVersion };
}

function main() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const mismatch = versionMismatch(pkg, lock);
  if (mismatch) {
    process.stderr.write(
      `lockfile-version: package.json is ${mismatch.pkgVersion}, but package-lock.json says ` +
        `${mismatch.lockVersion} at the top and ${String(mismatch.lockRootVersion)} on the root package.\n` +
        '  Run: npm install --package-lock-only\n',
    );
    process.exit(1);
  }
  console.log('lint-lockfile-version: clean');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
