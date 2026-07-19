/**
 * scripts/catalog-regen.mjs — Regenerate the derived registry/catalog.json projection.
 */

import { regenerateCapabilityCatalog } from '../lib/registry/catalog.mjs';

const result = regenerateCapabilityCatalog();
process.stdout.write(
  `catalog:regen → ${result.path} (${result.capabilityCount} capabilities, `
  + `${result.npmScriptCount} npm scripts, ${result.cliCommandCount} CLI commands, `
  + `${result.procedureCount} Procedures)\n`,
);
