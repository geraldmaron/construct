/**
 * scripts/generate-test-corpus-inventory.mjs — regenerate tests/capabilities/corpus-inventory.json.
 *
 * Updates tests/AUDIT.md summary counts from the generated inventory. Run after
 * adding or moving test files, or when refreshing certification gap analysis.
 */

import { writeCorpusInventoryArtifacts } from '../lib/test-corpus-inventory.mjs';

const { inventoryPath, inventory } = writeCorpusInventoryArtifacts();
process.stdout.write(`Wrote ${inventoryPath}\n`);
process.stdout.write(`  ${inventory.files.length} test files indexed\n`);
process.stdout.write(`  ${inventory.releaseCriticalGaps.length} release-critical gap(s) listed\n`);
process.stdout.write('Updated tests/AUDIT.md\n');
