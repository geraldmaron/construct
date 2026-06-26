/**
 * scripts/docs-sync.mjs — Regenerate docs AUTO regions from the capability catalog.
 */

import { syncCatalogDocs } from '../lib/registry/docs-sync.mjs';

const check = process.argv.includes('--check');
const result = syncCatalogDocs({ check });

if (!result.ok) {
  process.stderr.write(`✗ ${result.error}\n`);
  process.exit(1);
}

if (check) {
  process.stdout.write(`✓ ${result.path} catalog-sync region current\n`);
} else if (result.changed) {
  process.stdout.write(`✓ updated ${result.path}\n`);
} else {
  process.stdout.write(`✓ ${result.path} already current\n`);
}
