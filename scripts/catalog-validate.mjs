/**
 * scripts/catalog-validate.mjs — Validate living capability catalog edges and drift.
 */

import { validateCapabilityCatalog } from '../lib/registry/catalog.mjs';

const checkOnly = process.argv.includes('--check');
const result = validateCapabilityCatalog();

if (!result.valid) {
  for (const err of result.errors) process.stderr.write(`✗ ${err}\n`);
  process.exit(1);
}

if (checkOnly) {
  process.stdout.write(`✓ ${result.path} catalog edges current\n`);
} else {
  process.stdout.write(`✓ capability catalog valid (${result.path})\n`);
}
