/**
 * lib/doctor/source-checkout.mjs — distinguish Construct source tree vs npm install.
 *
 * `isConstructPackageRepo` is true for both checkouts and consumer installs.
 * Source-only doctor checks (certification role cards) should run only when this
 * returns true.
 */

import fs from 'node:fs';
import path from 'node:path';

export function isConstructSourceCheckout(rootDir) {
  const root = path.resolve(rootDir);
  return fs.existsSync(path.join(root, 'tests', 'certification', 'worker-profiles'));
}
