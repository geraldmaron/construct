#!/usr/bin/env node
/**
 * scripts/generate-artifact-fixtures.mjs — regenerate golden artifact fixtures per manifest type.
 */

import { writeGoldenFixtures } from '../lib/certification/artifact-fixtures.mjs';

const { written, failures } = writeGoldenFixtures();
process.stdout.write(`Wrote ${written.length} golden artifact fixture(s)\n`);
if (failures.length) {
  for (const failure of failures) {
    process.stderr.write(`  ✗ ${failure.type}: ${failure.errors.join('; ')}\n`);
  }
  process.exit(1);
}
